import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UniversalSentenceEncoderEmbeddingProvider,
  type EmbeddingWorkerFactory,
  type EmbeddingWorkerLike
} from '../../src/main/application/embedding-provider'
import type {
  EmbeddingWorkerRequest,
  EmbeddingWorkerResponse
} from '../../src/main/application/embedding-worker-protocol'

const DIMENSIONS = 512

function vector(seed = 1): Float32Array {
  const result = new Float32Array(DIMENSIONS)
  result[0] = seed
  return result
}

class FakeEmbeddingWorker extends EventEmitter {
  readonly posted: EmbeddingWorkerRequest[] = []
  refCalls = 0
  unrefCalls = 0
  terminateCalls = 0

  postMessage(value: EmbeddingWorkerRequest): void {
    this.posted.push(value)
  }

  ref(): void {
    this.refCalls += 1
  }

  unref(): void {
    this.unrefCalls += 1
  }

  async terminate(): Promise<number> {
    this.terminateCalls += 1
    return 0
  }

  respond(response: EmbeddingWorkerResponse): void {
    this.emit('message', response)
  }
}

function factoryFor(...workers: FakeEmbeddingWorker[]): {
  factory: EmbeddingWorkerFactory
  calls: () => number
} {
  let callCount = 0
  return {
    calls: () => callCount,
    factory: () => {
      const worker = workers[callCount]
      callCount += 1
      if (!worker) throw new Error('No fake embedding worker is available')
      return worker as unknown as EmbeddingWorkerLike
    }
  }
}

async function waitForPosts(worker: FakeEmbeddingWorker, count: number): Promise<void> {
  await vi.waitFor(() => expect(worker.posted).toHaveLength(count))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('UniversalSentenceEncoderEmbeddingProvider', () => {
  it('multiplexes concurrent requests over one worker and resolves responses by request ID', async () => {
    const worker = new FakeEmbeddingWorker()
    const workers = factoryFor(worker)
    const provider = new UniversalSentenceEncoderEmbeddingProvider({
      workerFactory: workers.factory,
      requestTimeoutMs: 1_000
    })

    const first = provider.embed(['first'])
    const second = provider.embed(['second', 'third'])
    await waitForPosts(worker, 2)

    expect(workers.calls()).toBe(1)
    const firstRequest = worker.posted.find(({ texts }) => texts[0] === 'first')
    const secondRequest = worker.posted.find(({ texts }) => texts[0] === 'second')
    expect(firstRequest).toMatchObject({ type: 'embed', texts: ['first'] })
    expect(secondRequest).toMatchObject({ type: 'embed', texts: ['second', 'third'] })
    if (!firstRequest || !secondRequest) throw new Error('Both requests must be posted')
    expect(new Set(worker.posted.map(({ requestId }) => requestId)).size).toBe(2)
    worker.respond({
      type: 'result',
      requestId: secondRequest.requestId,
      vectors: [vector(2), vector(3)]
    })
    worker.respond({
      type: 'result', requestId: firstRequest.requestId, vectors: [vector(1)]
    })

    await expect(second).resolves.toEqual([
      expect.arrayContaining([2]),
      expect.arrayContaining([3])
    ])
    await expect(first).resolves.toEqual([expect.arrayContaining([1])])
    expect(worker.refCalls).toBe(2)
    expect(worker.unrefCalls).toBeGreaterThanOrEqual(2)
    provider.dispose()
  })

  it('surfaces an operation error and retries the next request on the same healthy worker', async () => {
    const worker = new FakeEmbeddingWorker()
    const workers = factoryFor(worker)
    const provider = new UniversalSentenceEncoderEmbeddingProvider({
      workerFactory: workers.factory,
      requestTimeoutMs: 1_000
    })

    const failed = provider.embed(['first attempt'])
    await waitForPosts(worker, 1)
    worker.respond({
      type: 'error',
      requestId: 1,
      error: { name: 'ModelLoadError', message: 'temporary local model failure' }
    })
    await expect(failed).rejects.toMatchObject({
      name: 'ModelLoadError',
      message: 'temporary local model failure'
    })

    const retried = provider.embed(['second attempt'])
    await waitForPosts(worker, 2)
    worker.respond({ type: 'result', requestId: 2, vectors: [vector()] })
    await expect(retried).resolves.toHaveLength(1)
    expect(workers.calls()).toBe(1)
    provider.dispose()
  })

  it.each(['error', 'exit'] as const)(
    'rejects pending work after worker %s and recreates the worker lazily',
    async (failureEvent) => {
      const failedWorker = new FakeEmbeddingWorker()
      const replacement = new FakeEmbeddingWorker()
      const workers = factoryFor(failedWorker, replacement)
      const provider = new UniversalSentenceEncoderEmbeddingProvider({
        workerFactory: workers.factory,
        requestTimeoutMs: 1_000
      })

      const failed = provider.embed(['before crash'])
      await waitForPosts(failedWorker, 1)
      if (failureEvent === 'error') {
        failedWorker.emit('error', new Error('worker crashed'))
        await expect(failed).rejects.toThrow('worker crashed')
      } else {
        failedWorker.emit('exit', 9)
        await expect(failed).rejects.toThrow('exited unexpectedly with code 9')
      }

      const retried = provider.embed(['after crash'])
      await waitForPosts(replacement, 1)
      expect(replacement.posted[0]).toEqual({
        type: 'embed', requestId: 2, texts: ['after crash']
      })
      replacement.respond({ type: 'result', requestId: 2, vectors: [vector()] })
      await expect(retried).resolves.toHaveLength(1)
      expect(workers.calls()).toBe(2)
      provider.dispose()
    }
  )

  it('rejects pending and future work and terminates its worker on disposal', async () => {
    const worker = new FakeEmbeddingWorker()
    const provider = new UniversalSentenceEncoderEmbeddingProvider({
      workerFactory: factoryFor(worker).factory,
      requestTimeoutMs: 1_000
    })

    const pending = provider.embed(['pending'])
    await waitForPosts(worker, 1)
    provider.dispose()

    await expect(pending).rejects.toThrow('disposed')
    await expect(provider.embed(['too late'])).rejects.toThrow('disposed')
    expect(worker.terminateCalls).toBe(1)
  })

  it('times out a silent worker, rejects every pending request, and recreates it', async () => {
    vi.useFakeTimers()
    const silent = new FakeEmbeddingWorker()
    const replacement = new FakeEmbeddingWorker()
    const workers = factoryFor(silent, replacement)
    const provider = new UniversalSentenceEncoderEmbeddingProvider({
      workerFactory: workers.factory,
      requestTimeoutMs: 25
    })

    const first = provider.embed(['first'])
    const second = provider.embed(['second'])
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    expect(silent.posted).toHaveLength(2)
    const firstRejection = expect(first).rejects.toThrow('timed out')
    const secondRejection = expect(second).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(25)
    await firstRejection
    await secondRejection
    expect(silent.terminateCalls).toBe(1)

    const retried = provider.embed(['retry'])
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    expect(replacement.posted).toHaveLength(1)
    replacement.respond({ type: 'result', requestId: 3, vectors: [vector()] })
    await expect(retried).resolves.toHaveLength(1)
    expect(workers.calls()).toBe(2)
    provider.dispose()
  })

  it('keeps the main event loop responsive while a real worker performs CPU-bound work', async () => {
    let started!: () => void
    const workerStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let worker: Worker | null = null
    const provider = new UniversalSentenceEncoderEmbeddingProvider({
      requestTimeoutMs: 5_000,
      workerFactory: () => {
        worker = new Worker(`
          const { parentPort } = require('node:worker_threads')
          parentPort.on('message', ({ requestId }) => {
            parentPort.postMessage({ type: 'started' })
            const end = Date.now() + 150
            while (Date.now() < end) {}
            const vector = new Float32Array(${DIMENSIONS})
            vector[0] = 1
            parentPort.postMessage({ type: 'result', requestId, vectors: [vector] })
          })
        `, { eval: true })
        worker.on('message', (value: unknown) => {
          if ((value as { type?: string })?.type === 'started') started()
        })
        return worker
      }
    })

    const order: string[] = []
    const embedding = provider.embed(['cpu-bound']).then((value) => {
      order.push('embedding')
      return value
    })
    await workerStarted
    const heartbeat = new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push('heartbeat')
        resolve()
      }, 0)
    })

    await heartbeat
    expect(order).toEqual(['heartbeat'])
    await expect(embedding).resolves.toHaveLength(1)
    expect(order).toEqual(['heartbeat', 'embedding'])
    provider.dispose()
  })
})
