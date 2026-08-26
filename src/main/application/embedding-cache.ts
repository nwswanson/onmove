import type { SqliteAdapter } from '../data/sqlite-adapter'

interface EmbeddingCacheRow {
  source_key: string
  content_hash: string
  dimensions: number
  vector: Uint8Array
}

export interface CachedEmbedding {
  sourceKey: string
  contentHash: string
  vector: number[]
}

function encodeVector(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setFloat32(
    index * Float32Array.BYTES_PER_ELEMENT,
    value,
    true
  ))
  return bytes
}

function decodeVector(bytes: Uint8Array, dimensions: number): number[] | null {
  if (bytes.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values = Array.from({ length: dimensions }, (_, index) =>
    view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true))
  return values.every(Number.isFinite) ? values : null
}

/** Durable, rebuildable cache. SQLite remains authoritative for all source text and identity. */
export class EmbeddingCacheRepository {
  constructor(private readonly database: SqliteAdapter) {}

  list(modelId: string, dimensions: number): Map<string, CachedEmbedding> {
    const result = new Map<string, CachedEmbedding>()
    for (const row of this.database.all<EmbeddingCacheRow>(
      `SELECT source_key, content_hash, dimensions, vector
       FROM retrieval_embedding_cache
       WHERE model_id = ? AND dimensions = ?`,
      [modelId, dimensions]
    )) {
      const vector = decodeVector(row.vector, dimensions)
      if (!vector) continue
      result.set(row.source_key, {
        sourceKey: row.source_key,
        contentHash: row.content_hash,
        vector
      })
    }
    return result
  }

  store(
    modelId: string,
    dimensions: number,
    entries: readonly CachedEmbedding[],
    now = new Date()
  ): void {
    if (entries.length === 0) return
    this.database.transaction(() => {
      for (const entry of entries) {
        if (entry.vector.length !== dimensions || entry.vector.some((value) => !Number.isFinite(value))) {
          throw new TypeError('A cached embedding has invalid dimensions or values')
        }
        this.database.run(
          `INSERT INTO retrieval_embedding_cache (
             source_key, model_id, content_hash, dimensions, vector, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_key, model_id) DO UPDATE SET
             content_hash = excluded.content_hash,
             dimensions = excluded.dimensions,
             vector = excluded.vector,
             updated_at = excluded.updated_at`,
          [
            entry.sourceKey,
            modelId,
            entry.contentHash,
            dimensions,
            encodeVector(entry.vector),
            now.toISOString()
          ]
        )
      }
    })
  }

  prune(modelId: string, retainedSourceKeys: ReadonlySet<string>): void {
    const stale = this.database.all<{ source_key: string }>(
      'SELECT source_key FROM retrieval_embedding_cache WHERE model_id = ?',
      [modelId]
    ).filter(({ source_key }) => !retainedSourceKeys.has(source_key))
    if (stale.length === 0) return
    this.database.transaction(() => {
      for (const { source_key: sourceKey } of stale) {
        this.database.run(
          'DELETE FROM retrieval_embedding_cache WHERE source_key = ? AND model_id = ?',
          [sourceKey, modelId]
        )
      }
    })
  }
}
