export type EmbeddingWorkerRequest =
  | {
      type: 'prepare'
      requestId: number
    }
  | {
      type: 'embed'
      requestId: number
      texts: string[]
    }

export type EmbeddingWorkerResponse =
  | {
      type: 'progress'
      requestId: number
      phase: 'loading-model' | 'embedding'
      completed: number
      total: number
    }
  | {
      type: 'result'
      requestId: number
      vectors: Float32Array[]
    }
  | {
      type: 'prepared'
      requestId: number
    }
  | {
      type: 'error'
      requestId: number
      error: {
        name: string
        message: string
      }
    }
