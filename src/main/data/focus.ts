import {
  FOCUS_KINDS,
  FOCUS_STATUSES,
  type CreateFocusInput,
  type FocusKind,
  type FocusSnapshot,
  type FocusStatus,
  type FocusStatusTransition,
  type ScopeApplicationSnapshot,
  type ScopeApplicationTransition,
  type SetScopeApplicationInput,
  type UpdateFocusInput
} from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelNotFoundError, ModelValidationError } from './model'
import { ScopeApplicationRepository } from './scope-model'
import type { SqliteAdapter } from './sqlite-adapter'

type FocusRecord = FocusSnapshot

interface FocusRow {
  id: number
  kind: string
  title: string
  description: string | null
  goal: string
  status: string
  status_changed_at: string
  needs_review: number
  sensitive: number
  last_review_date: string | null
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

function normalizeGoal(value: string | undefined): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw new ModelValidationError('focus goal must be text')
  }
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

function normalizeNeedsReview(value: boolean | undefined): boolean {
  if (value === undefined) return true
  if (typeof value !== 'boolean') {
    throw new ModelValidationError('focus needsReview must be a boolean')
  }
  return value
}

function normalizeSensitive(value: boolean | undefined): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new ModelValidationError('focus sensitive must be a boolean')
  }
  return value
}

function normalizeDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ModelValidationError(`${field} must use YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ModelValidationError(`${field} must be a real calendar date`)
  }
  return value
}

function today(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function focusFromRow(row: FocusRow): FocusRecord {
  return {
    id: Number(row.id),
    kind: row.kind as FocusKind,
    title: row.title,
    description: row.description,
    goal: row.goal,
    status: row.status as FocusStatus,
    statusChangedAt: row.status_changed_at,
    lastReviewDate: row.last_review_date,
    needsReview: Boolean(row.needs_review),
    sensitive: Boolean(row.sensitive),
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

  get goal(): string {
    return this.record.goal
  }

  get status(): FocusStatus {
    return this.record.status
  }

  get sensitive(): boolean {
    return this.record.sensitive
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

  scopeApplication(): ScopeApplicationSnapshot {
    return this.repository.scopeApplication(this.id)
  }

  scopeApplicationHistory(): ScopeApplicationTransition[] {
    return this.repository.scopeApplicationHistory(this.id)
  }

  setScope(input: SetScopeApplicationInput): this {
    this.repository.setScope(this.id, input)
    return this.refresh()
  }

  snapshot(asOf?: string): FocusSnapshot {
    return asOf === undefined ? this.toSnapshot() : this.repository.materialize(this.id, asOf)
  }

  toSnapshot(): FocusSnapshot {
    return structuredClone(this.record)
  }
}

export class FocusRepository extends BaseRepository<FocusRecord, FocusModel> {
  private readonly scopeApplications: ScopeApplicationRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.scopeApplications = new ScopeApplicationRepository(database)
  }

  protected instantiate(record: FocusRecord): FocusModel {
    return new FocusModel(this, record)
  }

  create(input: CreateFocusInput): FocusModel {
    const now = timestamp()
    const result = this.database.run(
      `INSERT INTO focuses (
         kind, title, description, goal, status, needs_review, sensitive, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizeKind(input.kind),
        normalizeTitle(input.title),
        normalizeDescription(input.description),
        normalizeGoal(input.goal),
        normalizeStatus(input.status),
        normalizeNeedsReview(input.needsReview) ? 1 : 0,
        normalizeSensitive(input.sensitive) ? 1 : 0,
        now,
        now
      ]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): FocusRecord | null {
    return this.materializeOrNull(id, today())
  }

  materialize(id: number, asOf = today()): FocusSnapshot {
    const record = this.materializeOrNull(id, normalizeDate(asOf, 'asOf'))
    if (!record) throw new ModelNotFoundError('Focus', id)
    return record
  }

  private materializeOrNull(id: number, asOf: string): FocusRecord | null {
    assertId(id)
    const row = this.database.get<FocusRow>(
      `SELECT id, kind, title, description, goal, status, status_changed_at, needs_review, sensitive,
              created_at, updated_at,
              (SELECT recorded_on FROM updates
               WHERE focus_id = focuses.id AND recorded_on <= ?
               ORDER BY recorded_on DESC, id DESC LIMIT 1) AS last_review_date
       FROM focuses WHERE id = ?`,
      [asOf, id]
    )
    return row ? focusFromRow(row) : null
  }

  list(asOf = today()): FocusSnapshot[] {
    const date = normalizeDate(asOf, 'asOf')
    return this.database
      .all<FocusRow>(
        `SELECT id, kind, title, description, goal, status, status_changed_at, needs_review, sensitive,
                created_at, updated_at,
                (SELECT recorded_on FROM updates
                 WHERE focus_id = focuses.id AND recorded_on <= ?
                 ORDER BY recorded_on DESC, id DESC LIMIT 1) AS last_review_date
         FROM focuses ORDER BY id`,
        [date]
      )
      .map(focusFromRow)
  }

  update(id: number, input: UpdateFocusInput): FocusRecord {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Focus', id)

    this.database.run(
      `UPDATE focuses
       SET title = ?, description = ?, goal = ?, status = ?, needs_review = ?, sensitive = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.title === undefined ? current.title : normalizeTitle(input.title),
        input.description === undefined
          ? current.description
          : normalizeDescription(input.description),
        input.goal === undefined ? current.goal : normalizeGoal(input.goal),
        input.status === undefined ? current.status : normalizeStatus(input.status),
        input.needsReview === undefined
          ? (current.needsReview ? 1 : 0)
          : (normalizeNeedsReview(input.needsReview) ? 1 : 0),
        input.sensitive === undefined
          ? (current.sensitive ? 1 : 0)
          : (normalizeSensitive(input.sensitive) ? 1 : 0),
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
    const exists = this.database.get<{ found: number }>(
      'SELECT 1 AS found FROM focuses WHERE id = ?',
      [id]
    )
    if (!exists) return false
    return this.database.transaction(() => {
      // Explicit child applications can reference Focus-owned overlay Scopes.
      // Delete those owners first so Scope cascades cannot momentarily remove
      // a required application from a still-surviving child.
      this.database.run('DELETE FROM threads WHERE focus_id = ?', [id])
      this.database.run('DELETE FROM commitments WHERE focus_id = ?', [id])
      return this.database.run('DELETE FROM focuses WHERE id = ?', [id]).changes > 0
    })
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

  scopeApplication(id: number): ScopeApplicationSnapshot {
    return this.scopeApplications.get({ type: 'focus', id })
  }

  scopeApplicationHistory(id: number): ScopeApplicationTransition[] {
    return this.scopeApplications.history({ type: 'focus', id })
  }

  setScope(id: number, input: SetScopeApplicationInput): ScopeApplicationSnapshot {
    return this.scopeApplications.set({ type: 'focus', id }, input)
  }
}
