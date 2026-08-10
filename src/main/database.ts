import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppState } from '../shared/contracts'
import { DomainStore } from './data/domain'
import { DataArchiveRepository } from './data/data-archive'
import { runMigrations } from './data/migrations'
import { SqliteAdapter } from './data/sqlite-adapter'

interface CountRow {
  count: number
}

interface TimestampRow {
  created_at: string
}

export class AppDatabase {
  private readonly database: SqliteAdapter
  readonly domain: DomainStore
  readonly dataArchive: DataArchiveRepository

  constructor(private readonly databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new SqliteAdapter(databasePath)
    try {
      runMigrations(this.database)
      this.domain = new DomainStore(this.database)
      this.dataArchive = new DataArchiveRepository(this.database)
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  recordLaunch(now = new Date()): AppState {
    this.recordEvent('launch', now)
    return this.getState()
  }

  recordGreeting(now = new Date()): AppState {
    this.recordEvent('greeting', now)
    return this.getState()
  }

  private recordEvent(kind: 'launch' | 'greeting', now: Date): void {
    this.database.run('INSERT INTO app_events (kind, created_at) VALUES (?, ?)', [
      kind,
      now.toISOString()
    ])
  }

  getState(): AppState {
    const greetingCount = this.database.get<CountRow>(
      "SELECT COUNT(*) AS count FROM app_events WHERE kind = 'greeting'"
    ) as CountRow
    const launchCount = this.database.get<CountRow>(
      "SELECT COUNT(*) AS count FROM app_events WHERE kind = 'launch'"
    ) as CountRow
    const lastGreeting = this.database.get<TimestampRow>(
      "SELECT created_at FROM app_events WHERE kind = 'greeting' ORDER BY id DESC LIMIT 1"
    )

    return {
      greeting: 'Hello, world.',
      greetingCount: Number(greetingCount.count),
      launchCount: Number(launchCount.count),
      lastGreetingAt: lastGreeting?.created_at ?? null,
      databasePath: this.databasePath
    }
  }

  close(): void {
    this.database.close()
  }
}
