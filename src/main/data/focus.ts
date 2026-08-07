import {
  FOCUS_KINDS,
  FOCUS_STATUSES,
  type CreateFocusInput,
  type FocusKind,
  type FocusSnapshot,
  type FocusStatus,
  type FocusStatusTransition,
  type UpdateFocusInput
} from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelNotFoundError, ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'

type FocusRecord = FocusSnapshot

interface FocusRow {
  id: number
  kind: string
  title: string
  description: string | null
  status: string
  status_changed_at: string
  created_at: string
  updated_at: string
}

interface FocusTransitionRow {
  id: number
  focus_id: number
  from_status: string | null
  to_status: string
  changed_at: string
}

function normalizeTitle(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ModelValidationError('focus title cannot be empty')
  }
  return value.trim()
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new ModelValidationError('focus description must be text')
  }
  if (value.trim().length === 0) return null
  return value.trim()
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError('focus id must be a positive integer')
  }
}

function normalizeKind(value: FocusKind | undefined): FocusKind {
  const kind = value ?? 'generic'
  if (!FOCUS_KINDS.includes(kind)) throw new ModelValidationError(`unsupported focus kind: ${kind}`)
  return kind
}

function normalizeStatus(value: FocusStatus | undefined): FocusStatus {
  const status = value ?? 'active'
  if (!FOCUS_STATUSES.includes(status)) {
    throw new ModelValidationError(`unsupported focus status: ${status}`)
  }
  return status
}

function focusFromRow(row: FocusRow): FocusRecord {
  return {
    id: Number(row.id),
    kind: row.kind as FocusKind,
    title: row.title,
    description: row.description,
    status: row.status as FocusStatus,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function transitionFromRow(row: FocusTransitionRow): FocusStatusTransition {
  return {
    id: Number(row.id),
    focusId: Number(row.focus_id),
    from: row.from_status as FocusStatus | null,
    to: row.to_status as FocusStatus,
    changedAt: row.changed_at
  }
}

function timestamp(): string {
  return new Date().toISOString()
}

export class FocusModel extends BaseModel<FocusRecord> {
  constructor(
    private readonly repository: FocusRepository,
    record: FocusRecord
  ) {
    super(repository, record)
  }

  get title(): string {
    return this.record.title
  }

  get description(): string | null {
    return this.record.description
  }

  get status(): FocusStatus {
    return this.record.status
  }

  update(input: UpdateFocusInput): this {
    return this.replace(this.repository.update(this.id, input))
  }

  setStatus(status: FocusStatus): this {
    return this.replace(this.repository.setStatus(this.id, status))
  }

  statusHistory(): FocusStatusTransition[] {
    return this.repository.statusHistory(this.id)
  }

  toSnapshot(): FocusSnapshot {
    return structuredClone(this.record)
  }
}

export class FocusRepository extends BaseRepository<FocusRecord, FocusModel> {
  constructor(private readonly database: SqliteAdapter) {
    super()
  }

  protected instantiate(record: FocusRecord): FocusModel {
    return new FocusModel(this, record)
  }

  create(input: CreateFocusInput): FocusModel {
    const now = timestamp()
    const result = this.database.run(
      `INSERT INTO focuses (
         kind, title, description, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        normalizeKind(input.kind),
        normalizeTitle(input.title),
        normalizeDescription(input.description),
        normalizeStatus(input.status),
        now,
        now
      ]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): FocusRecord | null {
    assertId(id)
    const row = this.database.get<FocusRow>(
      `SELECT id, kind, title, description, status, status_changed_at, created_at, updated_at
       FROM focuses WHERE id = ?`,
      [id]
    )
    return row ? focusFromRow(row) : null
  }

  list(): FocusSnapshot[] {
    return this.database
      .all<FocusRow>(
        `SELECT id, kind, title, description, status, status_changed_at, created_at, updated_at
         FROM focuses ORDER BY id`
      )
      .map(focusFromRow)
  }

  update(id: number, input: UpdateFocusInput): FocusRecord {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Focus', id)

    this.database.run(
      `UPDATE focuses
       SET title = ?, description = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.title === undefined ? current.title : normalizeTitle(input.title),
        input.description === undefined
          ? current.description
          : normalizeDescription(input.description),
        input.status === undefined ? current.status : normalizeStatus(input.status),
        timestamp(),
        id
      ]
    )
    return this.find(id) as FocusRecord
  }

  setStatus(id: number, status: FocusStatus): FocusRecord {
    return this.update(id, { status })
  }

  delete(id: number): boolean {
    assertId(id)
    return this.database.run('DELETE FROM focuses WHERE id = ?', [id]).changes > 0
  }

  statusHistory(id: number): FocusStatusTransition[] {
    if (!this.find(id)) throw new ModelNotFoundError('Focus', id)
    return this.database
      .all<FocusTransitionRow>(
        `SELECT id, focus_id, from_status, to_status, changed_at
         FROM focus_status_transitions WHERE focus_id = ? ORDER BY id`,
        [id]
      )
      .map(transitionFromRow)
  }
}
