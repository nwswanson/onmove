import { parentPort, type MessagePort } from 'node:worker_threads'
import type {
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse
} from './embedding-worker-protocol'

const EMBEDDING_DIMENSIONS = 512
const EMBEDDING_BATCH_SIZE = 24

type EncoderModel = {
  embed: (inputs: string[] | string) => Promise<{
    array: () => Promise<number[][]>
    dispose: () => void
  }>
}

let modelPromise: Promise<EncoderModel> | null = null

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

function model(): Promise<EncoderModel> {
  modelPromise ??= (async () => {
    await import('@tensorflow/tfjs-backend-cpu')
    const tensorflow = await import('@tensorflow/tfjs-core')
    if (tensorflow.getBackend() !== 'cpu') await tensorflow.setBackend('cpu')
    await tensorflow.ready()
    const encoder = await import('@tensorflow-models/universal-sentence-encoder')
    return encoder.load()
  })()
  const pending = modelPromise
  return pending.catch((error: unknown) => {
    // A transient model-load failure should not poison the worker until restart.
    if (modelPromise === pending) modelPromise = null
    throw error
  })
}

async function embed(texts: readonly string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const encoder = await model()
  const vectors: Float32Array[] = []
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const tensor = await encoder.embed([...texts.slice(start, start + EMBEDDING_BATCH_SIZE)])
    try {
      const batch = await tensor.array()
      vectors.push(...batch.map(normalizedFloat32))
    } finally {
      tensor.dispose()
    }
  }
  return vectors
}

function isRequest(value: unknown): value is EmbeddingWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<EmbeddingWorkerRequest>
  return request.type === 'embed' &&
    Number.isSafeInteger(request.requestId) &&
    Number(request.requestId) > 0 &&
    Array.isArray(request.texts) &&
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
    const vectors = await embed(request.texts)
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
