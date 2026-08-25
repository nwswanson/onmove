import type {
  CreateSidebarFolderInput,
  SidebarFolderArea,
  SidebarFolderSnapshot,
  SidebarFolderTarget
} from '../../shared/contracts'
import type { SqliteAdapter } from './sqlite-adapter'

interface SidebarFolderRow {
  folder_id: number
  kind: SidebarFolderArea['type']
  owner_focus_id: number | null
  name: string
  target_id: number | null
  created_at: string
  updated_at: string
}

const FOLDER_NAME = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

function requirePositiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
}

function normalizeArea(area: SidebarFolderArea): SidebarFolderArea {
  if (area?.type === 'focus') return { type: 'focus' }
  if (area?.type === 'thread') {
    requirePositiveId(area.focusId, 'Thread folder Focus id')
    return { type: 'thread', focusId: area.focusId }
  }
  throw new Error('A sidebar folder requires a Focus or Thread area.')
}

function normalizeName(name: string): string {
  if (typeof name !== 'string') throw new Error('A sidebar folder requires a name.')
  const normalized = name.trim().replace(/\s+/g, ' ')
  if (!FOLDER_NAME.test(normalized)) {
    throw new Error('Folder names may contain only letters, numbers, and single spaces.')
  }
  if (normalized.length > 80) throw new Error('Folder names must be 80 characters or fewer.')
  return normalized
}

function requireTarget(target: SidebarFolderTarget): void {
  if (!target || (target.type !== 'focus' && target.type !== 'thread')) {
    throw new Error('A sidebar folder target must be a Focus or Thread.')
  }
  requirePositiveId(target.id, 'Sidebar folder target id')
}

/**
 * Persists visual sidebar organization without adding fields to domain models.
 * Folder deletion cascades only membership rows, so it can never delete work.
 */
export class SidebarFolderRepository {
  constructor(private readonly database: SqliteAdapter) {}

  list(): SidebarFolderSnapshot[] {
    const rows = this.database.all<SidebarFolderRow>(`
      SELECT
        folders.id AS folder_id,
        folders.kind,
        folders.owner_focus_id,
        folders.name,
        CASE folders.kind
          WHEN 'focus' THEN memberships.focus_id
          ELSE memberships.thread_id
        END AS target_id,
        folders.created_at,
        folders.updated_at
      FROM sidebar_folders folders
      LEFT JOIN sidebar_folder_memberships memberships
        ON memberships.folder_id = folders.id
      ORDER BY
        folders.kind,
        folders.owner_focus_id,
        folders.name COLLATE NOCASE,
        folders.id,
        target_id
    `)
    const folders = new Map<number, SidebarFolderSnapshot>()
    for (const row of rows) {
      let folder = folders.get(Number(row.folder_id))
      if (!folder) {
        folder = {
          id: Number(row.folder_id),
          name: row.name,
          area: row.kind === 'focus'
            ? { type: 'focus' }
            : { type: 'thread', focusId: Number(row.owner_focus_id) },
          targetIds: [],
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
        folders.set(folder.id, folder)
      }
      if (row.target_id !== null) folder.targetIds.push(Number(row.target_id))
    }
    return [...folders.values()]
  }

  create(input: CreateSidebarFolderInput, now = new Date()): SidebarFolderSnapshot[] {
    const area = normalizeArea(input?.area)
    const name = normalizeName(input?.name)
    const ownerFocusId = area.type === 'thread' ? area.focusId : null
    if (ownerFocusId !== null && !this.database.get<{ id: number }>(
      'SELECT id FROM focuses WHERE id = ?',
      [ownerFocusId]
    )) {
      throw new Error(`Focus ${ownerFocusId} does not exist.`)
    }
    const duplicate = this.database.get<{ id: number }>(`
      SELECT id FROM sidebar_folders
      WHERE kind = ? AND owner_focus_id IS ? AND name = ? COLLATE NOCASE
    `, [area.type, ownerFocusId, name])
    if (duplicate) throw new Error(`A folder named "${name}" already exists here.`)

    const timestamp = now.toISOString()
    this.database.run(`
      INSERT INTO sidebar_folders (
        kind, owner_focus_id, name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [area.type, ownerFocusId, name, timestamp, timestamp])
    return this.list()
  }

  delete(id: number): SidebarFolderSnapshot[] {
    requirePositiveId(id, 'Sidebar folder id')
    this.database.run('DELETE FROM sidebar_folders WHERE id = ?', [id])
    return this.list()
  }

  setMembership(
    target: SidebarFolderTarget,
    folderId: number | null,
    now = new Date()
  ): SidebarFolderSnapshot[] {
    requireTarget(target)
    if (folderId !== null) requirePositiveId(folderId, 'Sidebar folder id')
    const targetTable = target.type === 'focus' ? 'focuses' : 'threads'
    const targetRow = this.database.get<{ id: number; focus_id?: number }>(
      `SELECT id${target.type === 'thread' ? ', focus_id' : ''} FROM ${targetTable} WHERE id = ?`,
      [target.id]
    )
    if (!targetRow) {
      throw new Error(`${target.type === 'focus' ? 'Focus' : 'Thread'} ${target.id} does not exist.`)
    }

    const folder = folderId === null
      ? null
      : this.database.get<{ kind: SidebarFolderArea['type']; owner_focus_id: number | null }>(
          'SELECT kind, owner_focus_id FROM sidebar_folders WHERE id = ?',
          [folderId]
        )
    if (folderId !== null && !folder) throw new Error(`Sidebar folder ${folderId} does not exist.`)
    if (folder && folder.kind !== target.type) {
      throw new Error(`A ${target.type === 'focus' ? 'Focus' : 'Thread'} cannot be placed in that folder.`)
    }
    if (
      folder &&
      target.type === 'thread' &&
      Number(folder.owner_focus_id) !== Number(targetRow.focus_id)
    ) {
      throw new Error('A Thread folder must belong to the Thread\'s current Focus.')
    }

    this.database.transaction(() => {
      this.database.run(
        `DELETE FROM sidebar_folder_memberships WHERE ${target.type}_id = ?`,
        [target.id]
      )
      if (folderId !== null) {
        this.database.run(`
          INSERT INTO sidebar_folder_memberships (
            folder_id, focus_id, thread_id, created_at
          ) VALUES (?, ?, ?, ?)
        `, [
          folderId,
          target.type === 'focus' ? target.id : null,
          target.type === 'thread' ? target.id : null,
          now.toISOString()
        ])
      }
    })
    return this.list()
  }
}
