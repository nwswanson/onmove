/** Provider-neutral local embedding boundary used by the derived retrieval index. */
export interface EmbeddingProvider {
  readonly modelId: string
  readonly dimensions: number
  embed(texts: readonly string[]): Promise<number[][]>
}

function normalize(vector: readonly number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error('The embedding model returned an invalid zero-length vector')
  }
  return vector.map((value) => value / magnitude)
}

/**
 * Runs Google's Universal Sentence Encoder entirely in the Electron main process.
 * Model weights are downloaded by TensorFlow.js, but indexed OnMove text is never
 * sent to the model host or any retrieval service.
 */
export class UniversalSentenceEncoderEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = 'universal-sentence-encoder-lite:1'
  readonly dimensions = 512
  private modelPromise: Promise<{
    embed: (inputs: string[] | string) => Promise<{
      array: () => Promise<number[][]>
      dispose: () => void
    }>
  }> | null = null

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const model = await this.model()
    const vectors: number[][] = []
    // Keep tensor memory and event-loop stalls bounded while rebuilding a large workspace.
    for (let start = 0; start < texts.length; start += 24) {
      const tensor = await model.embed([...texts.slice(start, start + 24)])
      try {
        const batch = await tensor.array()
        for (const vector of batch) {
          if (vector.length !== this.dimensions || vector.some((value) => !Number.isFinite(value))) {
            throw new Error(
              `The embedding model returned ${vector.length} dimensions; expected ${this.dimensions}`
            )
          }
          vectors.push(normalize(vector))
        }
      } finally {
        tensor.dispose()
      }
    }
    return vectors
  }

  private model(): Promise<{
    embed: (inputs: string[] | string) => Promise<{
      array: () => Promise<number[][]>
      dispose: () => void
    }>
  }> {
    this.modelPromise ??= (async () => {
      await import('@tensorflow/tfjs-backend-cpu')
      const tensorflow = await import('@tensorflow/tfjs-core')
      if (tensorflow.getBackend() !== 'cpu') await tensorflow.setBackend('cpu')
      await tensorflow.ready()
      const encoder = await import('@tensorflow-models/universal-sentence-encoder')
      return encoder.load()
    })()
    const modelPromise = this.modelPromise
    return modelPromise.catch((error: unknown) => {
      // A transient model-load failure should not poison every enhanced request until
      // the application restarts. The service still decides whether to fall back.
      if (this.modelPromise === modelPromise) this.modelPromise = null
      throw error
    })
  }
}
