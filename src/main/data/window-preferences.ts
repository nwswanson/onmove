import type { SqliteAdapter } from './sqlite-adapter'

export interface WindowSizePreference {
  width: number
  height: number
  updatedAt: string
}

interface WindowSizePreferenceRow {
  width: number
  height: number
  updated_at: string
}

const MAX_WINDOW_DIMENSION = 32767

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_WINDOW_DIMENSION
}

/** One-row, last-write-wins storage for the next main window's initial size. */
export class WindowPreferenceRepository {
  constructor(private readonly database: SqliteAdapter) {}

  getSize(): WindowSizePreference | null {
    const row = this.database.get<WindowSizePreferenceRow>(`
      SELECT width, height, updated_at
      FROM app_window_preferences
      WHERE singleton = 1
    `)
    if (!row) return null

    const width = Number(row.width)
    const height = Number(row.height)
    if (!validDimension(width) || !validDimension(height)) return null
    return { width, height, updatedAt: row.updated_at }
  }

  setSize(
    size: Pick<WindowSizePreference, 'width' | 'height'>,
    now = new Date()
  ): WindowSizePreference {
    if (!validDimension(size.width) || !validDimension(size.height)) {
      throw new Error('Window size requires positive, safe integer dimensions.')
    }
    const updatedAt = now.toISOString()
    this.database.run(`
      INSERT INTO app_window_preferences (singleton, width, height, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        width = excluded.width,
        height = excluded.height,
        updated_at = excluded.updated_at
    `, [size.width, size.height, updatedAt])
    return { ...size, updatedAt }
  }
}
