export interface EmbeddingWorkerRequest {
  type: 'embed'
  requestId: number
  texts: string[]
}

export type EmbeddingWorkerResponse =
  | {
      type: 'result'
      requestId: number
      vectors: Float32Array[]
    }
  | {
      type: 'error'
      requestId: number
      error: {
        name: string
        message: string
      }
    }
