import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { parentPort, type MessagePort } from 'node:worker_threads'
import type { Tensor2D } from '@tensorflow/tfjs-core'
import type { ModelJSON } from '@tensorflow/tfjs-core/dist/io/types'
import type {
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse
} from './embedding-worker-protocol'

const EMBEDDING_DIMENSIONS = 512
const EMBEDDING_BATCH_SIZE = 24
const EXPECTED_MODEL_SHARDS = [
  'group1-shard1of7',
  'group1-shard2of7',
  'group1-shard3of7',
  'group1-shard4of7',
  'group1-shard5of7',
  'group1-shard6of7',
  'group1-shard7of7'
] as const

type EncoderModel = {
  embed: (inputs: string[] | string) => Promise<Tensor2D>
}

let modelPromise: Promise<EncoderModel> | null = null
let modelDirectoryInUse: string | null | undefined

// The official JSON contains a few null scores (JSON's representation of
// non-finite source values); the upstream Tokenizer intentionally accepts and
// coerces those entries even though its declaration narrows them to number.
type Vocabulary = Array<[string, number | null]>

function parsedJson(contents: string, fileName: string): unknown {
  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`The bundled embedding ${fileName} is not valid JSON`, { cause: error })
  }
}

function checkedModelJson(value: unknown): ModelJSON {
  if (!value || typeof value !== 'object' || !('modelTopology' in value)) {
    throw new Error('The bundled embedding model is missing its model topology')
  }
  const manifest = (value as { weightsManifest?: unknown }).weightsManifest
  if (!Array.isArray(manifest) || manifest.length !== 1) {
    throw new Error('The bundled embedding model has an unsupported weights manifest')
  }
  const group = manifest[0]
  const paths = group && typeof group === 'object'
    ? (group as { paths?: unknown }).paths
    : undefined
  if (
    !Array.isArray(paths) ||
    paths.length !== EXPECTED_MODEL_SHARDS.length ||
    paths.some((path, index) => path !== EXPECTED_MODEL_SHARDS[index])
  ) {
    // Only these literal leaf names may reach join() below. Besides pinning the
    // model version, this keeps a modified manifest from traversing resources.
    throw new Error('The bundled embedding model references unexpected weight files')
  }
  return value as ModelJSON
}

function checkedVocabulary(value: unknown): Vocabulary {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) =>
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      (entry[1] !== null &&
        (typeof entry[1] !== 'number' || !Number.isFinite(entry[1])))
    )
  ) {
    throw new Error('The bundled embedding vocabulary has an unsupported format')
  }
  return value as Vocabulary
}

async function localModel(directory: string): Promise<EncoderModel> {
  if (!isAbsolute(directory)) {
    throw new Error('The bundled embedding model directory must be an absolute path')
  }
  const [modelContents, vocabularyContents] = await Promise.all([
    readFile(join(directory, 'model.json'), 'utf8'),
    readFile(join(directory, 'vocab.json'), 'utf8')
  ])
  const modelJson = checkedModelJson(parsedJson(modelContents, 'model.json'))
  const vocabulary = checkedVocabulary(parsedJson(vocabularyContents, 'vocab.json'))
  const shardBuffers = await Promise.all(
    EXPECTED_MODEL_SHARDS.map((name) => readFile(join(directory, name)))
  )
  if (shardBuffers.some(({ byteLength }) => byteLength === 0)) {
    throw new Error('The bundled embedding model contains an empty weight file')
  }
  const combined = Buffer.concat(shardBuffers)
  const weights = combined.buffer.slice(
    combined.byteOffset,
    combined.byteOffset + combined.byteLength
  ) as ArrayBuffer

  const [tensorflow, converter, encoder] = await Promise.all([
    import('@tensorflow/tfjs-core'),
    import('@tensorflow/tfjs-converter'),
    import('@tensorflow-models/universal-sentence-encoder')
  ])
  const graph = converter.loadGraphModelSync([modelJson, weights])
  const tokenizer = new encoder.Tokenizer(vocabulary as Array<[string, number]>)

  return {
    async embed(input: string[] | string): Promise<Tensor2D> {
      const inputs = typeof input === 'string' ? [input] : input
      const encodings = inputs.map((text) => tokenizer.encode(text))
      const flattenedIndices: number[][] = []
      for (let inputIndex = 0; inputIndex < encodings.length; inputIndex += 1) {
        for (let tokenIndex = 0; tokenIndex < encodings[inputIndex].length; tokenIndex += 1) {
          flattenedIndices.push([inputIndex, tokenIndex])
        }
      }
      const indices = tensorflow.tensor2d(
        flattenedIndices,
        [flattenedIndices.length, 2],
        'int32'
      )
      const values = tensorflow.tensor1d(encodings.flat(), 'int32')
      try {
        const result = await graph.executeAsync({ indices, values })
        if (Array.isArray(result)) {
          result.forEach((tensor) => tensor.dispose())
          throw new Error('The bundled embedding model returned multiple output tensors')
        }
        return result as Tensor2D
      } finally {
        indices.dispose()
        values.dispose()
      }
    }
  }
}

function normalizedFloat32(vector: readonly number[]): Float32Array {
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `The embedding model returned ${vector.length} dimensions; ` +
      `expected ${EMBEDDING_DIMENSIONS}`
    )
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error('The embedding model returned an invalid zero-length vector')
  }
  return Float32Array.from(vector, (value) => value / magnitude)
}

function model(modelDirectory?: string): Promise<EncoderModel> {
  const requestedDirectory = modelDirectory ?? null
  if (modelPromise && modelDirectoryInUse !== requestedDirectory) {
    return Promise.reject(new Error(
      'The embedding worker cannot switch model sources while it is running'
    ))
  }
  modelDirectoryInUse = requestedDirectory
  modelPromise ??= (async () => {
    await import('@tensorflow/tfjs-backend-cpu')
    const tensorflow = await import('@tensorflow/tfjs-core')
    if (tensorflow.getBackend() !== 'cpu') await tensorflow.setBackend('cpu')
    await tensorflow.ready()
    if (modelDirectory !== undefined) return localModel(modelDirectory)
    const encoder = await import('@tensorflow-models/universal-sentence-encoder')
    return encoder.load()
  })()
  const pending = modelPromise
  return pending.catch((error: unknown) => {
    // A transient model-load failure should not poison the worker until restart.
    if (modelPromise === pending) {
      modelPromise = null
      modelDirectoryInUse = undefined
    }
    throw error
  })
}

async function embed(
  texts: readonly string[],
  modelDirectory: string | undefined,
  onProgress: (phase: 'loading-model' | 'embedding', completed: number) => void
): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const needsModelLoad = modelPromise === null
  if (needsModelLoad) onProgress('loading-model', 0)
  const encoder = await model(modelDirectory)
  onProgress('embedding', 0)
  const vectors: Float32Array[] = []
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const tensor = await encoder.embed([...texts.slice(start, start + EMBEDDING_BATCH_SIZE)])
    try {
      const batch = await tensor.array()
      vectors.push(...batch.map(normalizedFloat32))
    } finally {
      tensor.dispose()
    }
    onProgress('embedding', Math.min(start + EMBEDDING_BATCH_SIZE, texts.length))
  }
  return vectors
}

function isRequest(value: unknown): value is EmbeddingWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<EmbeddingWorkerRequest>
  if (!Number.isSafeInteger(request.requestId) || Number(request.requestId) < 1) return false
  if (
    request.modelDirectory !== undefined &&
    (typeof request.modelDirectory !== 'string' || request.modelDirectory.length === 0)
  ) return false
  if (request.type === 'prepare') return true
  return request.type === 'embed' && Array.isArray(request.texts) &&
    request.texts.every((text) => typeof text === 'string')
}

function serializedError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) }
}

function requireParentPort(): MessagePort {
  if (!parentPort) throw new Error('The embedding worker requires a parent message port')
  return parentPort
}

const port = requireParentPort()

async function handle(request: EmbeddingWorkerRequest): Promise<void> {
  try {
    if (request.type === 'prepare') {
      if (modelPromise === null) {
        const progress: EmbeddingWorkerResponse = {
          type: 'progress',
          requestId: request.requestId,
          phase: 'loading-model',
          completed: 0,
          total: 0
        }
        port.postMessage(progress)
      }
      await model(request.modelDirectory)
      const prepared: EmbeddingWorkerResponse = {
        type: 'prepared',
        requestId: request.requestId
      }
      port.postMessage(prepared)
      return
    }
    const vectors = await embed(request.texts, request.modelDirectory, (phase, completed) => {
      const response: EmbeddingWorkerResponse = {
        type: 'progress',
        requestId: request.requestId,
        phase,
        completed,
        total: request.texts.length
      }
      port.postMessage(response)
    })
    const response: EmbeddingWorkerResponse = {
      type: 'result',
      requestId: request.requestId,
      vectors
    }
    port.postMessage(response, vectors.map(({ buffer }) => buffer as ArrayBuffer))
  } catch (error) {
    const response: EmbeddingWorkerResponse = {
      type: 'error',
      requestId: request.requestId,
      error: serializedError(error)
    }
    port.postMessage(response)
  }
}

// TensorFlow execution and its shared model are intentionally serialized.
let work = Promise.resolve()
port.on('message', (value: unknown) => {
  if (!isRequest(value)) return
  work = work.then(
    () => handle(value),
    () => handle(value)
  )
})
