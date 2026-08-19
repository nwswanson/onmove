import type { SqliteAdapter } from '../data/sqlite-adapter'

export interface PersistedMcpSettings {
  serverEnabled: boolean
  serverPort: number
  allowSensitive: boolean
  allowMutations: boolean
  updatedAt: string
}

export interface OnMoveAccessPolicy {
  sensitiveContent: 'deny' | 'allow'
  mutations: 'read-only' | 'allow'
}

export type SensitiveEntityType =
  | 'focus'
  | 'thread'
  | 'commitment'
  | 'routine'
  | 'update'
  | 'todo'
  | 'note'
  | 'subject'

interface SensitiveRow {
  sensitive: number
}

function timestamp(now = new Date()): string {
  return now.toISOString()
}

/** Persistent MCP permissions. They are read for every request, never cached by a session. */
export class McpSettingsRepository {
  constructor(private readonly database: SqliteAdapter) {}

  get(): PersistedMcpSettings {
    const row = this.database.get<{
      server_enabled: number
      server_port: number
      allow_sensitive: number
      allow_mutations: number
      updated_at: string
    }>(
      `SELECT server_enabled, server_port, allow_sensitive, allow_mutations, updated_at
       FROM mcp_settings WHERE singleton = 1`
    )
    if (!row) throw new Error('MCP settings are unavailable')
    return {
      serverEnabled: Boolean(row.server_enabled),
      serverPort: Number(row.server_port),
      allowSensitive: Boolean(row.allow_sensitive),
      allowMutations: Boolean(row.allow_mutations),
      updatedAt: row.updated_at
    }
  }

  update(
    input: Partial<Pick<
      PersistedMcpSettings,
      'serverEnabled' | 'serverPort' | 'allowSensitive' | 'allowMutations'
    >>,
    now = new Date()
  ): PersistedMcpSettings {
    if (input.serverEnabled !== undefined && typeof input.serverEnabled !== 'boolean') {
      throw new TypeError('serverEnabled must be a boolean')
    }
    if (
      input.serverPort !== undefined &&
      (!Number.isInteger(input.serverPort) || input.serverPort < 1024 || input.serverPort > 65_535)
    ) {
      throw new TypeError('serverPort must be an integer between 1024 and 65535')
    }
    if (input.allowSensitive !== undefined && typeof input.allowSensitive !== 'boolean') {
      throw new TypeError('allowSensitive must be a boolean')
    }
    if (input.allowMutations !== undefined && typeof input.allowMutations !== 'boolean') {
      throw new TypeError('allowMutations must be a boolean')
    }
    const current = this.get()
    this.database.run(
      `UPDATE mcp_settings
       SET server_enabled = ?, server_port = ?, allow_sensitive = ?, allow_mutations = ?, updated_at = ?
       WHERE singleton = 1`,
      [
        (input.serverEnabled ?? current.serverEnabled) ? 1 : 0,
        input.serverPort ?? current.serverPort,
        (input.allowSensitive ?? current.allowSensitive) ? 1 : 0,
        (input.allowMutations ?? current.allowMutations) ? 1 : 0,
        timestamp(now)
      ]
    )
    return this.get()
  }

  accessPolicy(): OnMoveAccessPolicy {
    const settings = this.get()
    return {
      sensitiveContent: settings.allowSensitive ? 'allow' : 'deny',
      mutations: settings.allowMutations ? 'allow' : 'read-only'
    }
  }
}

/** One hierarchy-aware sensitivity calculation shared by MCP queries and commands. */
export class EffectiveSensitivityRepository {
  constructor(private readonly database: SqliteAdapter) {}

  isSensitive(type: SensitiveEntityType, id: number): boolean | null {
    const query = this.query(type)
    const row = this.database.get<SensitiveRow>(query, [id])
    return row ? Boolean(row.sensitive) : null
  }

  canRead(type: SensitiveEntityType, id: number, access: OnMoveAccessPolicy): boolean {
    const sensitive = this.isSensitive(type, id)
    return sensitive !== null && (access.sensitiveContent === 'allow' || !sensitive)
  }

  private query(type: SensitiveEntityType): string {
    if (type === 'focus') {
      return 'SELECT sensitive FROM focuses WHERE id = ?'
    }
    if (type === 'thread') {
      return `SELECT MAX(thread.sensitive, focus.sensitive) AS sensitive
              FROM threads thread JOIN focuses focus ON focus.id = thread.focus_id
              WHERE thread.id = ?`
    }
    if (type === 'commitment' || type === 'routine') {
      return `SELECT MAX(commitment.sensitive, thread.sensitive, focus.sensitive) AS sensitive
              FROM commitments commitment
              JOIN threads thread ON thread.id = commitment.thread_id
              JOIN focuses focus ON focus.id = thread.focus_id
              WHERE commitment.id = ?`
    }
    if (type === 'update') {
      return `SELECT MAX(
                update_record.sensitive, thread.sensitive, focus.sensitive,
                COALESCE(commitment.sensitive, 0), COALESCE(subject.sensitive, 0),
                COALESCE(scope.sensitive, 0)
              ) AS sensitive
              FROM updates update_record
              LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
              JOIN threads thread ON thread.id = COALESCE(update_record.thread_id, commitment.thread_id)
              JOIN focuses focus ON focus.id = thread.focus_id
              LEFT JOIN subjects subject ON subject.id = update_record.subject_id
              LEFT JOIN scopes scope ON scope.id = update_record.scope_id
              WHERE update_record.id = ?`
    }
    if (type === 'todo') {
      return `SELECT MAX(
                thread.sensitive, focus.sensitive, COALESCE(commitment.sensitive, 0),
                COALESCE(subject.sensitive, 0), COALESCE(scope.sensitive, 0)
              ) AS sensitive
              FROM todos todo
              LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
              JOIN threads thread ON thread.id = COALESCE(todo.thread_id, commitment.thread_id)
              JOIN focuses focus ON focus.id = thread.focus_id
              LEFT JOIN subjects subject ON subject.id = todo.subject_id
              LEFT JOIN scopes scope ON scope.id = todo.scope_id
              WHERE todo.id = ?`
    }
    if (type === 'note') {
      return `SELECT MAX(
                focus.sensitive, COALESCE(thread.sensitive, 0),
                COALESCE(commitment.sensitive, 0)
              ) AS sensitive
              FROM notes note
              LEFT JOIN commitments commitment ON commitment.id = note.commitment_id
              LEFT JOIN threads thread ON thread.id = COALESCE(note.thread_id, commitment.thread_id)
              JOIN focuses focus ON focus.id = COALESCE(note.focus_id, thread.focus_id)
              WHERE note.id = ?`
    }
    return 'SELECT sensitive FROM subjects WHERE id = ?'
  }
}
