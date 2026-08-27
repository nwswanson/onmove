import type { SqliteAdapter } from '../data/sqlite-adapter'
import {
  MCP_CLIENT_INSTRUCTIONS_MAX_LENGTH,
  MCP_PERMISSION_RESOURCES,
  type McpPermissionGrant,
  type McpPermissionOverrideSnapshot,
  type McpPermissionPolicySnapshot,
  type McpPermissionResource,
  type McpPermissionResourceSelector,
  type McpRetrievalMode,
  type UpdateMcpPermissionInput
} from '../../shared/contracts'

export interface PersistedMcpSettings {
  serverEnabled: boolean
  serverPort: number
  retrievalMode: McpRetrievalMode
  includeClosedByDefault: boolean
  clientInstructions: string
  allowSensitive: boolean
  allowMutations: boolean
  updatedAt: string
  permissionPolicy: McpPermissionPolicySnapshot
}

export interface OnMoveAccessPolicy {
  sensitiveContent: 'deny' | 'allow'
  mutations: 'read-only' | 'allow'
  /** Omitted only by legacy direct-service callers and old tests. */
  permissionPolicy?: McpPermissionPolicySnapshot
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

export interface McpPermissionContext {
  focusId: number | null
  threadId: number | null
}

interface PermissionDefaultRow {
  resource_type: McpPermissionResource
  can_view: number
  can_edit: number
  can_delete: number
}

interface PermissionOverrideRow {
  target_id: number
  focus_id: number | null
  resource_type: McpPermissionResourceSelector
  can_view: number | null
  can_edit: number | null
}

interface DeletePermissionOverrideRow {
  target_id: number
  focus_id: number | null
  resource_type: McpPermissionResourceSelector
  can_delete: number
}

function timestamp(now = new Date()): string {
  return now.toISOString()
}

function parseRetrievalMode(value: unknown): McpRetrievalMode {
  if (value === 'classic' || value === 'enhanced') return value
  throw new TypeError('retrievalMode must be classic or enhanced')
}

/** Persistent MCP permissions. They are read for every request, never cached by a session. */
export class McpSettingsRepository {
  constructor(private readonly database: SqliteAdapter) {}

  get(): PersistedMcpSettings {
    const row = this.database.get<{
      server_enabled: number
      server_port: number
      retrieval_mode: string
      include_closed_by_default: number
      client_instructions: string
      allow_sensitive: number
      allow_mutations: number
      updated_at: string
    }>(
      `SELECT server_enabled, server_port, retrieval_mode, include_closed_by_default,
              client_instructions, allow_sensitive, allow_mutations, updated_at
       FROM mcp_settings WHERE singleton = 1`
    )
    if (!row) throw new Error('MCP settings are unavailable')
    return {
      serverEnabled: Boolean(row.server_enabled),
      serverPort: Number(row.server_port),
      retrievalMode: parseRetrievalMode(row.retrieval_mode),
      includeClosedByDefault: Boolean(row.include_closed_by_default),
      clientInstructions: row.client_instructions,
      allowSensitive: Boolean(row.allow_sensitive),
      allowMutations: Boolean(row.allow_mutations),
      updatedAt: row.updated_at,
      permissionPolicy: this.permissionPolicy()
    }
  }

  update(
    input: Partial<Pick<
      PersistedMcpSettings,
      'serverEnabled' | 'serverPort' | 'retrievalMode' | 'includeClosedByDefault' |
      'clientInstructions' | 'allowSensitive' | 'allowMutations'
    >> & {
      permission?: UpdateMcpPermissionInput
      removePermissionTarget?: { type: 'focus' | 'thread'; id: number }
    },
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
    if (input.retrievalMode !== undefined) parseRetrievalMode(input.retrievalMode)
    if (
      input.includeClosedByDefault !== undefined &&
      typeof input.includeClosedByDefault !== 'boolean'
    ) {
      throw new TypeError('includeClosedByDefault must be a boolean')
    }
    if (
      input.clientInstructions !== undefined &&
      (typeof input.clientInstructions !== 'string' ||
        input.clientInstructions.length > MCP_CLIENT_INSTRUCTIONS_MAX_LENGTH)
    ) {
      throw new TypeError(
        `clientInstructions must be a string of at most ${MCP_CLIENT_INSTRUCTIONS_MAX_LENGTH} characters`
      )
    }
    if (input.allowSensitive !== undefined && typeof input.allowSensitive !== 'boolean') {
      throw new TypeError('allowSensitive must be a boolean')
    }
    if (input.allowMutations !== undefined && typeof input.allowMutations !== 'boolean') {
      throw new TypeError('allowMutations must be a boolean')
    }
    if (input.permission !== undefined) this.validatePermission(input.permission)
    if (input.removePermissionTarget !== undefined) {
      this.validateOverrideTarget(input.removePermissionTarget)
    }
    const current = this.get()
    const changedAt = timestamp(now)
    this.database.transaction(() => {
      this.database.run(
        `UPDATE mcp_settings
         SET server_enabled = ?, server_port = ?, retrieval_mode = ?,
             include_closed_by_default = ?, client_instructions = ?, allow_sensitive = ?,
             allow_mutations = ?, updated_at = ?
         WHERE singleton = 1`,
        [
          (input.serverEnabled ?? current.serverEnabled) ? 1 : 0,
          input.serverPort ?? current.serverPort,
          input.retrievalMode ?? current.retrievalMode,
          (input.includeClosedByDefault ?? current.includeClosedByDefault) ? 1 : 0,
          input.clientInstructions ?? current.clientInstructions,
          (input.allowSensitive ?? current.allowSensitive) ? 1 : 0,
          (input.allowMutations ?? current.allowMutations) ? 1 : 0,
          changedAt
        ]
      )
      if (input.allowMutations !== undefined) {
        this.database.run(
          'UPDATE mcp_permission_defaults SET can_edit = ?, updated_at = ?',
          [input.allowMutations ? 1 : 0, changedAt]
        )
      }
      if (input.permission) this.writePermission(input.permission, changedAt)
      if (input.removePermissionTarget) {
        const table = input.removePermissionTarget.type === 'focus'
          ? 'mcp_focus_permission_overrides'
          : 'mcp_thread_permission_overrides'
        const deleteTable = input.removePermissionTarget.type === 'focus'
          ? 'mcp_focus_delete_permission_overrides'
          : 'mcp_thread_delete_permission_overrides'
        const idColumn = input.removePermissionTarget.type === 'focus' ? 'focus_id' : 'thread_id'
        this.database.run(
          `DELETE FROM ${table} WHERE ${idColumn} = ?`,
          [input.removePermissionTarget.id]
        )
        this.database.run(
          `DELETE FROM ${deleteTable} WHERE ${idColumn} = ?`,
          [input.removePermissionTarget.id]
        )
        if (input.removePermissionTarget.type === 'focus') {
          this.database.run(
            `DELETE FROM mcp_thread_permission_overrides
             WHERE thread_id IN (SELECT id FROM threads WHERE focus_id = ?)`,
            [input.removePermissionTarget.id]
          )
          this.database.run(
            `DELETE FROM mcp_thread_delete_permission_overrides
             WHERE thread_id IN (SELECT id FROM threads WHERE focus_id = ?)`,
            [input.removePermissionTarget.id]
          )
        }
      }
      const editSummary = this.database.get<{ all_enabled: number }>(
        'SELECT MIN(can_edit) AS all_enabled FROM mcp_permission_defaults'
      )
      this.database.run(
        'UPDATE mcp_settings SET allow_mutations = ?, updated_at = ? WHERE singleton = 1',
        [editSummary?.all_enabled ? 1 : 0, changedAt]
      )
    })
    return this.get()
  }

  accessPolicy(): OnMoveAccessPolicy {
    const settings = this.get()
    return {
      sensitiveContent: settings.allowSensitive ? 'allow' : 'deny',
      mutations: settings.allowMutations ? 'allow' : 'read-only',
      permissionPolicy: settings.permissionPolicy
    }
  }

  private permissionPolicy(): McpPermissionPolicySnapshot {
    const defaults = {} as Record<McpPermissionResource, McpPermissionGrant>
    for (const row of this.database.all<PermissionDefaultRow>(
      `SELECT resource_type, can_view, can_edit, can_delete
       FROM mcp_permission_defaults ORDER BY resource_type`
    )) {
      defaults[row.resource_type] = {
        view: Boolean(row.can_view),
        edit: Boolean(row.can_edit),
        delete: Boolean(row.can_delete)
      }
    }
    for (const resource of MCP_PERMISSION_RESOURCES) {
      defaults[resource] ??= { view: true, edit: false, delete: false }
    }
    const overrides: McpPermissionOverrideSnapshot[] = []
    for (const target of ['focus', 'thread'] as const) {
      const table = target === 'focus'
        ? 'mcp_focus_permission_overrides'
        : 'mcp_thread_permission_overrides'
      const deleteTable = target === 'focus'
        ? 'mcp_focus_delete_permission_overrides'
        : 'mcp_thread_delete_permission_overrides'
      const rows = this.database.all<PermissionOverrideRow>(
        target === 'focus'
          ? `SELECT focus_id AS target_id, focus_id, resource_type, can_view, can_edit
             FROM ${table} ORDER BY focus_id, resource_type`
          : `SELECT permission.thread_id AS target_id, thread.focus_id,
                    permission.resource_type, permission.can_view, permission.can_edit
             FROM ${table} permission
             JOIN threads thread ON thread.id = permission.thread_id
             ORDER BY permission.thread_id, permission.resource_type`
      )
      overrides.push(...rows.map((row) => ({
        target: target === 'focus'
          ? { type: 'focus' as const, id: Number(row.target_id) }
          : {
              type: 'thread' as const,
              id: Number(row.target_id),
              focusId: Number(row.focus_id)
            },
        resource: row.resource_type,
        view: row.can_view === null ? null : Boolean(row.can_view),
        edit: row.can_edit === null ? null : Boolean(row.can_edit),
        delete: null
      })))
      const deleteRows = this.database.all<DeletePermissionOverrideRow>(
        target === 'focus'
          ? `SELECT focus_id AS target_id, focus_id, resource_type, can_delete
             FROM ${deleteTable} ORDER BY focus_id, resource_type`
          : `SELECT permission.thread_id AS target_id, thread.focus_id,
                    permission.resource_type, permission.can_delete
             FROM ${deleteTable} permission
             JOIN threads thread ON thread.id = permission.thread_id
             ORDER BY permission.thread_id, permission.resource_type`
      )
      for (const row of deleteRows) {
        const existing = overrides.findIndex((override) =>
          override.target.type === target && override.target.id === Number(row.target_id) &&
          override.resource === row.resource_type)
        if (existing >= 0) {
          overrides[existing] = { ...overrides[existing], delete: Boolean(row.can_delete) }
          continue
        }
        overrides.push({
          target: target === 'focus'
            ? { type: 'focus', id: Number(row.target_id) }
            : {
                type: 'thread', id: Number(row.target_id), focusId: Number(row.focus_id)
              },
          resource: row.resource_type,
          view: null,
          edit: null,
          delete: Boolean(row.can_delete)
        })
      }
    }
    return { defaults, overrides }
  }

  private validatePermission(input: UpdateMcpPermissionInput): void {
    if (!input || typeof input !== 'object') throw new TypeError('permission must be an object')
    if (![...MCP_PERMISSION_RESOURCES, 'all'].includes(input.resource)) {
      throw new TypeError('permission resource is unsupported')
    }
    if (input.target.type === 'default' && input.resource === 'all') {
      // `all` is a convenient atomic update across bounded global defaults.
    } else if (input.target.type === 'default' && !MCP_PERMISSION_RESOURCES.includes(input.resource as McpPermissionResource)) {
      throw new TypeError('default permission resource is unsupported')
    } else if (input.target.type === 'focus' || input.target.type === 'thread') {
      this.validateOverrideTarget(input.target)
    } else if (input.target.type !== 'default') {
      throw new TypeError('permission target is unsupported')
    }
    for (const [field, value] of [
      ['view', input.view],
      ['edit', input.edit],
      ['delete', input.delete]
    ] as const) {
      if (value !== undefined && value !== null && typeof value !== 'boolean') {
        throw new TypeError(`permission ${field} must be a boolean or null`)
      }
    }
    if (input.view === undefined && input.edit === undefined && input.delete === undefined) {
      throw new TypeError('permission must change view, edit, or delete')
    }
    if (
      input.target.type === 'default' &&
      (input.view === null || input.edit === null || input.delete === null)
    ) {
      throw new TypeError('default permissions cannot inherit')
    }
  }

  private validateOverrideTarget(target: { type: 'focus' | 'thread'; id: number }): void {
    if (!Number.isSafeInteger(target.id) || target.id < 1) {
      throw new TypeError(`${target.type} permission target id must be a positive integer`)
    }
    const table = target.type === 'focus' ? 'focuses' : 'threads'
    if (!this.database.get(`SELECT 1 AS found FROM ${table} WHERE id = ?`, [target.id])) {
      throw new TypeError(`${target.type} permission target does not exist`)
    }
  }

  private writePermission(input: UpdateMcpPermissionInput, changedAt: string): void {
    if (input.target.type === 'default') {
      const resources = input.resource === 'all' ? MCP_PERMISSION_RESOURCES : [input.resource]
      for (const resource of resources) {
        this.database.run(
          `UPDATE mcp_permission_defaults
           SET can_view = COALESCE(?, can_view),
               can_edit = COALESCE(?, can_edit),
               can_delete = COALESCE(?, can_delete),
               updated_at = ?
           WHERE resource_type = ?`,
          [
            input.view === undefined ? null : input.view ? 1 : 0,
            input.edit === undefined ? null : input.edit ? 1 : 0,
            input.delete === undefined ? null : input.delete ? 1 : 0,
            changedAt,
            resource
          ]
        )
      }
      return
    }
    const table = input.target.type === 'focus'
      ? 'mcp_focus_permission_overrides'
      : 'mcp_thread_permission_overrides'
    const deleteTable = input.target.type === 'focus'
      ? 'mcp_focus_delete_permission_overrides'
      : 'mcp_thread_delete_permission_overrides'
    const idColumn = input.target.type === 'focus' ? 'focus_id' : 'thread_id'
    if (input.view !== undefined || input.edit !== undefined) {
      const current = this.database.get<{
        can_view: number | null
        can_edit: number | null
      }>(
        `SELECT can_view, can_edit
         FROM ${table} WHERE ${idColumn} = ? AND resource_type = ?`,
        [input.target.id, input.resource]
      )
      const view = input.view === undefined
        ? current?.can_view ?? null
        : input.view === null ? null : input.view ? 1 : 0
      const edit = input.edit === undefined
        ? current?.can_edit ?? null
        : input.edit === null ? null : input.edit ? 1 : 0
      if (view === null && edit === null) {
        this.database.run(
          `DELETE FROM ${table} WHERE ${idColumn} = ? AND resource_type = ?`,
          [input.target.id, input.resource]
        )
      } else {
        this.database.run(
          `INSERT INTO ${table} (${idColumn}, resource_type, can_view, can_edit, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (${idColumn}, resource_type) DO UPDATE SET
             can_view = excluded.can_view,
             can_edit = excluded.can_edit,
             updated_at = excluded.updated_at`,
          [input.target.id, input.resource, view, edit, changedAt]
        )
      }
    }
    if (input.delete === undefined) return
    if (input.delete === null) {
      this.database.run(
        `DELETE FROM ${deleteTable} WHERE ${idColumn} = ? AND resource_type = ?`,
        [input.target.id, input.resource]
      )
      return
    }
    this.database.run(
      `INSERT INTO ${deleteTable} (${idColumn}, resource_type, can_delete, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (${idColumn}, resource_type) DO UPDATE SET
         can_delete = excluded.can_delete,
         updated_at = excluded.updated_at`,
      [input.target.id, input.resource, input.delete ? 1 : 0, changedAt]
    )
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
    return sensitive !== null &&
      (access.sensitiveContent === 'allow' || !sensitive) &&
      this.canViewResource(type, access, this.contextFor(type, id))
  }

  canReadInContext(
    type: SensitiveEntityType,
    id: number,
    access: OnMoveAccessPolicy,
    context: McpPermissionContext
  ): boolean {
    const sensitive = this.isSensitive(type, id)
    return sensitive !== null &&
      (access.sensitiveContent === 'allow' || !sensitive) &&
      this.canViewResource(type, access, context)
  }

  canEdit(type: SensitiveEntityType, id: number, access: OnMoveAccessPolicy): boolean {
    const sensitive = this.isSensitive(type, id)
    return sensitive !== null &&
      (access.sensitiveContent === 'allow' || !sensitive) &&
      this.canEditResource(type, access, this.contextFor(type, id))
  }

  canDelete(type: SensitiveEntityType, id: number, access: OnMoveAccessPolicy): boolean {
    const sensitive = this.isSensitive(type, id)
    return sensitive !== null &&
      (access.sensitiveContent === 'allow' || !sensitive) &&
      this.canDeleteResource(type, access, this.contextFor(type, id))
  }

  canViewResource(
    resource: McpPermissionResource,
    access: OnMoveAccessPolicy,
    context: McpPermissionContext
  ): boolean {
    return this.resolveGrant(resource, access, context).view
  }

  canEditResource(
    resource: McpPermissionResource,
    access: OnMoveAccessPolicy,
    context: McpPermissionContext
  ): boolean {
    const grant = this.resolveGrant(resource, access, context)
    return grant.view && grant.edit
  }

  canDeleteResource(
    resource: McpPermissionResource,
    access: OnMoveAccessPolicy,
    context: McpPermissionContext
  ): boolean {
    const grant = this.resolveGrant(resource, access, context)
    return grant.view && grant.delete
  }

  contextFor(type: SensitiveEntityType, id: number): McpPermissionContext {
    if (type === 'focus') return { focusId: id, threadId: null }
    if (type === 'thread') {
      const row = this.database.get<{ focus_id: number }>(
        'SELECT focus_id FROM threads WHERE id = ?', [id]
      )
      return { focusId: row ? Number(row.focus_id) : null, threadId: row ? id : null }
    }
    if (type === 'commitment' || type === 'routine') {
      const row = this.database.get<{ focus_id: number; thread_id: number }>(
        `SELECT thread.focus_id, thread.id AS thread_id
         FROM commitments commitment
         JOIN threads thread ON thread.id = commitment.thread_id
         WHERE commitment.id = ?`, [id]
      )
      return {
        focusId: row ? Number(row.focus_id) : null,
        threadId: row ? Number(row.thread_id) : null
      }
    }
    if (type === 'update') {
      const row = this.database.get<{ focus_id: number; thread_id: number }>(
        `SELECT thread.focus_id, thread.id AS thread_id
         FROM updates update_record
         LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
         JOIN threads thread ON thread.id = COALESCE(update_record.thread_id, commitment.thread_id)
         WHERE update_record.id = ?`, [id]
      )
      return {
        focusId: row ? Number(row.focus_id) : null,
        threadId: row ? Number(row.thread_id) : null
      }
    }
    if (type === 'todo') {
      const row = this.database.get<{ focus_id: number; thread_id: number }>(
        `SELECT thread.focus_id, thread.id AS thread_id
         FROM todos todo
         LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
         JOIN threads thread ON thread.id = COALESCE(todo.thread_id, commitment.thread_id)
         WHERE todo.id = ?`, [id]
      )
      return {
        focusId: row ? Number(row.focus_id) : null,
        threadId: row ? Number(row.thread_id) : null
      }
    }
    if (type === 'note') {
      const row = this.database.get<{ focus_id: number; thread_id: number | null }>(
        `SELECT focus.id AS focus_id, thread.id AS thread_id
         FROM notes note
         LEFT JOIN commitments commitment ON commitment.id = note.commitment_id
         LEFT JOIN threads thread ON thread.id = COALESCE(note.thread_id, commitment.thread_id)
         JOIN focuses focus ON focus.id = COALESCE(note.focus_id, thread.focus_id)
         WHERE note.id = ?`, [id]
      )
      return {
        focusId: row ? Number(row.focus_id) : null,
        threadId: row?.thread_id == null ? null : Number(row.thread_id)
      }
    }
    return { focusId: null, threadId: null }
  }

  private resolveGrant(
    resource: McpPermissionResource,
    access: OnMoveAccessPolicy,
    context: McpPermissionContext
  ): McpPermissionGrant {
    const policy = access.permissionPolicy
    if (!policy) {
      return {
        view: true,
        edit: access.mutations === 'allow',
        delete: access.mutations === 'allow'
      }
    }
    let view = policy.defaults[resource].view
    let edit = policy.defaults[resource].edit
    let deleteGrant = policy.defaults[resource].delete
    const apply = (target: 'focus' | 'thread', id: number | null): void => {
      if (id === null) return
      for (const selector of ['all', resource] as const) {
        const row = policy.overrides.find((override) =>
          override.target.type === target && override.target.id === id &&
          override.resource === selector)
        if (!row) continue
        if (row.view !== null) view = row.view
        if (row.edit !== null) edit = row.edit
        if (row.delete !== null) deleteGrant = row.delete
      }
    }
    apply('focus', context.focusId)
    apply('thread', context.threadId)
    return { view, edit, delete: deleteGrant }
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
