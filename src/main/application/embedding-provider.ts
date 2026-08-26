import type { Worker } from 'node:worker_threads'
import type {
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse
} from './embedding-worker-protocol'

/** Provider-neutral local embedding boundary used by the derived retrieval index. */
export interface EmbeddingProvider {
  readonly modelId: string
  readonly dimensions: number
  prepare(onProgress?: (progress: EmbeddingProviderProgress) => void): Promise<void>
  embed(
    texts: readonly string[],
    onProgress?: (progress: EmbeddingProviderProgress) => void
  ): Promise<number[][]>
  dispose?(): void
}

export interface EmbeddingProviderProgress {
  phase: 'loading-model' | 'embedding'
  completed: number
  total: number
}

export type EmbeddingWorkerLike = Pick<
  Worker,
  'postMessage' | 'on' | 'terminate' | 'ref' | 'unref'
>

export type EmbeddingWorkerFactory =
  () => EmbeddingWorkerLike | Promise<EmbeddingWorkerLike>

export interface UniversalSentenceEncoderEmbeddingProviderOptions {
  workerFactory?: EmbeddingWorkerFactory
  requestTimeoutMs?: number
}

interface PendingEmbeddingBase {
  worker: EmbeddingWorkerLike
  expectedCount: number
  reject: (error: Error) => void
  onProgress?: (progress: EmbeddingProviderProgress) => void
  timeout: ReturnType<typeof setTimeout>
}

interface PendingEmbedding extends PendingEmbeddingBase {
  kind: 'embed'
  resolve: (vectors: number[][]) => void
}

interface PendingPreparation extends PendingEmbeddingBase {
  kind: 'prepare'
  resolve: () => void
}

type PendingOperation = PendingEmbedding | PendingPreparation

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000

async function defaultWorkerFactory(): Promise<EmbeddingWorkerLike> {
  const { default: createWorker } = await import('./embedding-worker?nodeWorker')
  return createWorker({ name: 'onmove-local-embeddings' })
}

function workerError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(String(value))
}

/**
 * Runs Google's Universal Sentence Encoder in a dedicated local worker thread.
 * Model weights are downloaded by TensorFlow.js, but OnMove text is never sent
 * to a hosted embedding or retrieval service.
 */
export class UniversalSentenceEncoderEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'universal-sentence-encoder-lite:1'
  readonly dimensions = 512
  private readonly workerFactory: EmbeddingWorkerFactory
  private readonly requestTimeoutMs: number
  private readonly pending = new Map<number, PendingOperation>()
  private worker: EmbeddingWorkerLike | null = null
  private workerPromise: Promise<EmbeddingWorkerLike> | null = null
  private nextRequestId = 1
  private disposed = false

  constructor(options: UniversalSentenceEncoderEmbeddingProviderOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new TypeError('requestTimeoutMs must be a positive integer')
    }
  }

  async prepare(
    onProgress?: (progress: EmbeddingProviderProgress) => void
  ): Promise<void> {
    if (this.disposed) throw new Error('The embedding provider has been disposed')
    const worker = await this.ensureWorker()
    if (this.disposed) throw new Error('The embedding provider has been disposed')
    const requestId = this.allocateRequestId()

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failWorker(worker, new Error('The local embedding worker timed out'), true)
      }, this.requestTimeoutMs)
      this.pending.set(requestId, {
        kind: 'prepare',
        worker,
        expectedCount: 0,
        resolve,
        reject,
        onProgress,
        timeout
      })
      const request: EmbeddingWorkerRequest = { type: 'prepare', requestId }
      try {
        worker.ref()
        worker.postMessage(request)
      } catch (error) {
        this.failWorker(worker, workerError(error), true)
      }
    })
  }

  async embed(
    texts: readonly string[],
    onProgress?: (progress: EmbeddingProviderProgress) => void
  ): Promise<number[][]> {
    if (this.disposed) throw new Error('The embedding provider has been disposed')
    if (texts.length === 0) return []
    if (texts.some((text) => typeof text !== 'string')) {
      throw new TypeError('embedding inputs must be strings')
    }
    const worker = await this.ensureWorker()
    if (this.disposed) throw new Error('The embedding provider has been disposed')
    const requestId = this.allocateRequestId()

    return new Promise<number[][]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failWorker(worker, new Error('The local embedding worker timed out'), true)
      }, this.requestTimeoutMs)
      this.pending.set(requestId, {
        kind: 'embed',
        worker,
        expectedCount: texts.length,
        resolve,
        reject,
        onProgress,
        timeout
      })
      const request: EmbeddingWorkerRequest = {
        type: 'embed',
        requestId,
        texts: [...texts]
      }
      try {
        worker.ref()
        worker.postMessage(request)
      } catch (error) {
        this.failWorker(worker, workerError(error), true)
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('The embedding provider has been disposed')
    const worker = this.worker
    if (worker) this.failWorker(worker, error, true)
    const creating = this.workerPromise
    this.worker = null
    this.workerPromise = null
    if (creating) {
      void creating.then((created) => this.terminate(created)).catch(() => undefined)
    }
  }

  private ensureWorker(): Promise<EmbeddingWorkerLike> {
    if (this.worker) return Promise.resolve(this.worker)
    if (this.workerPromise) return this.workerPromise
    const creating = Promise.resolve().then(() => this.workerFactory()).then((worker) => {
      if (this.disposed) {
        this.terminate(worker)
        throw new Error('The embedding provider has been disposed')
      }
      this.worker = worker
      worker.on('message', (value: unknown) => this.handleMessage(worker, value))
      worker.on('error', (error: Error) => this.failWorker(worker, error, true))
      worker.on('exit', (code: number) => {
        this.failWorker(
          worker,
          new Error(`The local embedding worker exited unexpectedly with code ${code}`),
          false
        )
      })
      this.unrefIfIdle(worker)
      return worker
    })
    this.workerPromise = creating
    return creating.catch((error: unknown) => {
      if (this.workerPromise === creating) this.workerPromise = null
      throw error
    }).finally(() => {
      if (this.workerPromise === creating) this.workerPromise = null
    })
  }

  private handleMessage(worker: EmbeddingWorkerLike, value: unknown): void {
    if (!value || typeof value !== 'object') return
    const response = value as Partial<EmbeddingWorkerResponse>
    if (!Number.isSafeInteger(response.requestId)) return
    const pending = this.pending.get(Number(response.requestId))
    if (!pending || pending.worker !== worker) return
    if (response.type === 'progress') {
      const completed = Number(response.completed)
      const total = Number(response.total)
      if (
        (response.phase !== 'loading-model' && response.phase !== 'embedding') ||
        !Number.isSafeInteger(completed) ||
        !Number.isSafeInteger(total) ||
        completed < 0 ||
        total !== pending.expectedCount ||
        completed > total
      ) return
      try {
        pending.onProgress?.({ phase: response.phase, completed, total })
      } catch (error) {
        console.error('Embedding progress listener failed:', error)
      }
      return
    }
    this.pending.delete(Number(response.requestId))
    clearTimeout(pending.timeout)
    this.unrefIfIdle(worker)

    if (response.type === 'error') {
      const detail = response.error
      const error = new Error(detail?.message ?? 'The local embedding worker failed')
      error.name = detail?.name ?? 'Error'
      pending.reject(error)
      return
    }
    if (pending.kind === 'prepare') {
      if (response.type !== 'prepared') {
        pending.reject(new Error('The local embedding worker returned an invalid response'))
        return
      }
      pending.resolve()
      return
    }
    if (response.type !== 'result' || !Array.isArray(response.vectors)) {
      pending.reject(new Error('The local embedding worker returned an invalid response'))
      return
    }
    try {
      if (response.vectors.length !== pending.expectedCount) {
        throw new Error('The local embedding worker returned the wrong number of vectors')
      }
      const vectors = response.vectors.map((vector) => {
        const values = Array.from(vector)
        if (
          values.length !== this.dimensions ||
          values.some((entry) => !Number.isFinite(entry))
        ) {
          throw new Error(
            `The embedding model returned ${values.length} dimensions; expected ${this.dimensions}`
          )
        }
        return values
      })
      pending.resolve(vectors)
    } catch (error) {
      pending.reject(workerError(error))
    }
  }

  private allocateRequestId(): number {
    const requestId = this.nextRequestId
    this.nextRequestId += 1
    if (!Number.isSafeInteger(this.nextRequestId)) this.nextRequestId = 1
    return requestId
  }

  private failWorker(worker: EmbeddingWorkerLike, error: Error, terminate: boolean): void {
    if (this.worker === worker) this.worker = null
    for (const [requestId, pending] of this.pending) {
      if (pending.worker !== worker) continue
      this.pending.delete(requestId)
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    if (terminate) this.terminate(worker)
  }

  private unrefIfIdle(worker: EmbeddingWorkerLike): void {
    if ([...this.pending.values()].every((pending) => pending.worker !== worker)) {
      try {
        worker.unref()
      } catch {
        // Ref state is only a process-lifecycle optimization; request completion wins.
      }
    }
  }

  private terminate(worker: EmbeddingWorkerLike): void {
    try {
      void Promise.resolve(worker.terminate()).catch(() => undefined)
    } catch {
      // Shutdown and timeout cleanup are best-effort after all callers are rejected.
    }
  }
}
