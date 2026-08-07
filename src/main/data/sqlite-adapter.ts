import { DatabaseSync } from 'node:sqlite'

export type SqlValue = null | number | bigint | string | Uint8Array

/**
 * Deliberately small SQLite adapter. Domain repositories depend on this class,
 * rather than Electron or a global connection, which keeps models testable and
 * gives future adapters one narrow interface to implement.
 */
export class SqliteAdapter {
  private readonly connection: DatabaseSync
  private transactionDepth = 0

  constructor(readonly path: string) {
    this.connection = new DatabaseSync(path)
    this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  }

  exec(sql: string): void {
    this.connection.exec(sql)
  }

  run(sql: string, parameters: readonly SqlValue[] = []): { changes: number; lastInsertRowid: number } {
    const result = this.connection.prepare(sql).run(...parameters)
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid)
    }
  }

  get<T>(sql: string, parameters: readonly SqlValue[] = []): T | undefined {
    return this.connection.prepare(sql).get(...parameters) as T | undefined
  }

  all<T>(sql: string, parameters: readonly SqlValue[] = []): T[] {
    return this.connection.prepare(sql).all(...parameters) as T[]
  }

  /** Supports nested repository operations through SQLite savepoints. */
  transaction<T>(work: () => T): T {
    const depth = this.transactionDepth
    const savepoint = `onmove_${depth}`
    this.transactionDepth += 1

    if (depth === 0) this.connection.exec('BEGIN IMMEDIATE')
    else this.connection.exec(`SAVEPOINT ${savepoint}`)

    try {
      const result = work()
      if (depth === 0) this.connection.exec('COMMIT')
      else this.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return result
    } catch (error) {
      if (depth === 0) this.connection.exec('ROLLBACK')
      else this.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`)
      throw error
    } finally {
      this.transactionDepth -= 1
    }
  }

  close(): void {
    this.connection.close()
  }
}
