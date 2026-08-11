import {
  COMMITMENT_TYPES,
  FOCUS_STATUSES,
  HEALTH_STATES,
  type CommitmentParent,
  type CommitmentMovePlanSnapshot,
  type CommitmentParentTransition,
  type CommitmentScopeCellSnapshot,
  type CommitmentSnapshot,
  type CommitmentStatus,
  type CommitmentStatusTransition,
  type CommitmentType,
  type CreateCommitmentInput,
  type CreateThreadInput,
  type CreateUpdateInput,
  type EditUpdateInput,
  type HealthState,
  type MoveCommitmentInput,
  type MoveThreadInput,
  type ScopeApplicationSnapshot,
  type ScopeApplicationTransition,
  type ScopeOwner,
  type SetScopeApplicationInput,
  type ThreadSnapshot,
  type ThreadMovePlanSnapshot,
  type ThreadParentTransition,
  type ThreadScopeCellSnapshot,
  type ThreadSubjectCellSnapshot,
  type ThreadStatus,
  type ThreadStatusTransition,
  type UpdateCommitmentInput,
  type UpdateParent,
  type UpdateScopeCell,
  type UpdateSnapshot,
  type UpdateThreadInput
} from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelNotFoundError, ModelValidationError } from './model'
import {
  FocusScopeRepository,
  ScopeApplicationRepository,
  ScopeRepository,
  ThreadScopeRepository
} from './scope-model'
import type { SqliteAdapter } from './sqlite-adapter'
import { NoteRepository } from './note-model'

type ThreadRecord = ThreadSnapshot
type CommitmentRecord = CommitmentSnapshot
type UpdateRecord = UpdateSnapshot

interface ThreadRow {
  id: number
  focus_id: number
  title: string
  status: string
  review_frequency_days: number
  needs_review: number
  sensitive: number
  review_poked_on: string | null
  created_at: string
  updated_at: string
}

interface CommitmentRow {
  id: number
  focus_id: number | null
  thread_id: number | null
  commitment_type: string
  title: string
  status: string
  due_on: string | null
  cadence_days: number | null
  sensitive: number
  review_poked_on: string | null
  created_at: string
  updated_at: string
}

interface UpdateRow {
  id: number
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  scope_id: number | null
  subject_id: number | null
  recorded_on: string
  observation: string
  state: string
  sensitive: number
  created_at: string
  updated_at: string
}

interface StateRow {
  state: string
}

interface LatestUpdateRow extends StateRow {
  recorded_on: string
}

interface ExistsRow {
  found: number
}

interface ThreadTransitionRow {
  id: number
  thread_id: number
  from_status: string | null
  to_status: string
  changed_at: string
}

interface ThreadParentTransitionRow {
  id: number
  thread_id: number
  from_focus_id: number | null
  to_focus_id: number
  changed_at: string
}

interface ScopeTransferRow {
  id: number
  focus_id: number
  name: string
  dimension: string
  source_type: string
  base_scope_id: number | null
  derived_relationship: string | null
  context_subject_id: number | null
  sensitive: number
  created_at: string
  updated_at: string
}

interface ScopeMembershipTransferRow {
  subject_id: number
  effect: string
  effective_from: string
  effective_until: string | null
  created_at: string
}

interface CommitmentTransitionRow {
  id: number
  commitment_id: number
  from_status: string | null
  to_status: string
  changed_at: string
}

interface CommitmentParentTransitionRow {
  id: number
  commitment_id: number
  from_focus_id: number | null
  from_thread_id: number | null
  to_focus_id: number | null
  to_thread_id: number | null
  changed_at: string
}

interface CountRow {
  count: number
}

function assertId(id: number, modelName: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError(`${modelName} id must be a positive integer`)
  }
}

function normalizeTitle(value: string, modelName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ModelValidationError(`${modelName} title cannot be empty`)
  }
  return value.trim()
}

function normalizeObservation(value: string | undefined): string {
  if (value !== undefined && typeof value !== 'string') {
    throw new ModelValidationError('update observation must be text')
  }
  return value?.trim() ?? ''
}

function normalizeStatus<T extends ThreadStatus | CommitmentStatus>(status: T | undefined): T {
  const value = status ?? ('active' as T)
  if (!FOCUS_STATUSES.includes(value)) {
    throw new ModelValidationError(`unsupported lifecycle status: ${value}`)
  }
  return value
}

function normalizeCommitmentType(type: CommitmentType): CommitmentType {
  if (!COMMITMENT_TYPES.includes(type)) {
    throw new ModelValidationError(`unsupported commitment type: ${type}`)
  }
  return type
}

function normalizeState(state: HealthState | undefined): HealthState {
  const value = state ?? 'none'
  if (!HEALTH_STATES.includes(value)) {
    throw new ModelValidationError(`unsupported update state: ${value}`)
  }
  return value
}

function normalizePositiveDays(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ModelValidationError(`${field} must be a positive whole number of days`)
  }
  return value
}

function normalizeNeedsReview(value: boolean | undefined, field: string): boolean {
  if (value === undefined) return true
  if (typeof value !== 'boolean') {
    throw new ModelValidationError(`${field} must be a boolean`)
  }
  return value
}

function normalizeSensitive(value: boolean | undefined, field: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new ModelValidationError(`${field} must be a boolean`)
  }
  return value
}

function normalizeOptionalDays(value: number | null | undefined, field: string): number | null {
  return value === null || value === undefined ? null : normalizePositiveDays(value, field)
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

function normalizeOptionalDate(value: string | null | undefined, field: string): string | null {
  return value === null || value === undefined || value.length === 0
    ? null
    : normalizeDate(value, field)
}

function today(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function latestDate(...values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>(
    (latest, value) => value !== null && value !== undefined && (latest === null || value > latest)
      ? value
      : latest,
    null
  )
}

function timestamp(now = new Date()): string {
  return now.toISOString()
}

/** Red and yellow dominate; unknown blocks green but does not hide a known warning. */
export function calculateHealth(states: readonly HealthState[]): HealthState {
  if (states.includes('red')) return 'red'
  if (states.includes('yellow')) return 'yellow'
  if (states.includes('none')) return 'none'
  return states.length === 0 ? 'none' : 'green'
}

function parentColumns(parent: CommitmentParent): [number | null, number | null] {
  assertId(parent.id, parent.type)
  return parent.type === 'focus' ? [parent.id, null] : [null, parent.id]
}

function updateParentColumns(parent: UpdateParent): [number | null, number | null, number | null] {
  assertId(parent.id, parent.type)
  if (parent.type === 'focus') return [parent.id, null, null]
  if (parent.type === 'thread') return [null, parent.id, null]
  return [null, null, parent.id]
}

function commitmentParentFromRow(row: CommitmentRow): CommitmentParent {
  return row.focus_id === null
    ? { type: 'thread', id: Number(row.thread_id) }
    : { type: 'focus', id: Number(row.focus_id) }
}

function commitmentParentFromColumns(
  focusId: number | null,
  threadId: number | null
): CommitmentParent {
  return focusId === null
    ? { type: 'thread', id: Number(threadId) }
    : { type: 'focus', id: Number(focusId) }
}

function updateParentFromRow(row: UpdateRow): UpdateParent {
  if (row.focus_id !== null) return { type: 'focus', id: Number(row.focus_id) }
  if (row.thread_id !== null) return { type: 'thread', id: Number(row.thread_id) }
  return { type: 'commitment', id: Number(row.commitment_id) }
}

function scopeOwnerForUpdateParent(parent: UpdateParent): ScopeOwner | null {
  return parent.type === 'focus' ? null : { type: parent.type, id: parent.id }
}

export class ThreadModel extends BaseModel<ThreadRecord> {
  constructor(
    private readonly repository: ThreadRepository,
    record: ThreadRecord
  ) {
    super(repository, record)
  }

  get title(): string {
    return this.record.title
  }

  get health(): HealthState {
    return this.record.health
  }

  get status(): ThreadStatus {
    return this.record.status
  }

  get sensitive(): boolean {
    return this.record.sensitive
  }

  update(input: UpdateThreadInput): this {
    return this.replace(this.repository.update(this.id, input))
  }

  setStatus(status: ThreadStatus): this {
    return this.replace(this.repository.setStatus(this.id, status))
  }

  /** Records aggregate or exact-cell review evidence without inventing an Update. */
  pokeReview(now = new Date(), cell?: UpdateScopeCell): this {
    return this.replace(this.repository.pokeReview(this.id, now, cell))
  }

  snapshot(asOf?: string): ThreadSnapshot {
    return this.repository.materialize(this.id, asOf)
  }

  statusHistory(): ThreadStatusTransition[] {
    return this.repository.statusHistory(this.id)
  }

  movePlan(focusId: number): ThreadMovePlanSnapshot {
    return this.repository.planMove(this.id, focusId)
  }

  moveTo(input: MoveThreadInput): this {
    return this.replace(this.repository.move(this.id, input))
  }

  parentHistory(): ThreadParentTransition[] {
    return this.repository.parentHistory(this.id)
  }

  scopeApplication(): ScopeApplicationSnapshot {
    return this.repository.scopeApplication(this.id)
  }

  scopeApplicationHistory(): ScopeApplicationTransition[] {
    return this.repository.scopeApplicationHistory(this.id)
  }

  scopeMatrix(asOf?: string): ThreadScopeCellSnapshot[] {
    return this.repository.scopeMatrix(this.id, asOf)
  }

  subjectMatrix(asOf?: string): ThreadSubjectCellSnapshot[] {
    return this.repository.subjectMatrix(this.id, asOf)
  }

  setScope(input: SetScopeApplicationInput): this {
    this.repository.setScope(this.id, input)
    return this.refresh()
  }
}

export class ThreadRepository extends BaseRepository<ThreadRecord, ThreadModel> {
  private readonly scopeApplications: ScopeApplicationRepository
  private readonly scopes: ScopeRepository
  private readonly focusScopes: FocusScopeRepository
  private readonly notes: NoteRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.scopeApplications = new ScopeApplicationRepository(database)
    this.scopes = new ScopeRepository(database)
    this.focusScopes = new FocusScopeRepository(database)
    this.notes = new NoteRepository(database)
  }

  protected instantiate(record: ThreadRecord): ThreadModel {
    return new ThreadModel(this, record)
  }

  create(input: CreateThreadInput, now = new Date()): ThreadModel {
    assertId(input.focusId, 'focus')
    this.assertParentExists('focuses', input.focusId, 'Focus')
    const createdAt = timestamp(now)
    const threadId = this.database.transaction(() => {
      const result = this.database.run(
        `INSERT INTO threads (
           focus_id, title, status, review_frequency_days, needs_review, sensitive, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.focusId,
          normalizeTitle(input.title, 'thread'),
          normalizeStatus(input.status),
          normalizePositiveDays(input.reviewFrequencyDays, 'reviewFrequencyDays'),
          normalizeNeedsReview(input.needsReview, 'needsReview') ? 1 : 0,
          normalizeSensitive(input.sensitive, 'sensitive') ? 1 : 0,
          createdAt,
          createdAt
        ]
      )
      if (input.scope) {
        this.scopeApplications.set(
          { type: 'thread', id: result.lastInsertRowid },
          input.scope,
          now
        )
      }
      return result.lastInsertRowid
    })
    return this.requireModel(threadId)
  }

  find(id: number): ThreadRecord | null {
    return this.materializeOrNull(id, today())
  }

  materialize(id: number, asOf = today()): ThreadSnapshot {
    const record = this.materializeOrNull(id, normalizeDate(asOf, 'asOf'))
    if (!record) throw new ModelNotFoundError('Thread', id)
    return record
  }

  listForFocus(focusId: number, asOf = today()): ThreadSnapshot[] {
    assertId(focusId, 'focus')
    const date = normalizeDate(asOf, 'asOf')
    return this.database
      .all<{ id: number }>('SELECT id FROM threads WHERE focus_id = ? ORDER BY id', [focusId])
      .map(({ id }) => this.materialize(Number(id), date))
  }

  update(id: number, input: UpdateThreadInput): ThreadRecord {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Thread', id)
    this.database.run(
      `UPDATE threads
       SET title = ?, status = ?, review_frequency_days = ?, needs_review = ?, sensitive = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.title === undefined ? current.title : normalizeTitle(input.title, 'thread'),
        input.status === undefined ? current.status : normalizeStatus(input.status),
        input.reviewFrequencyDays === undefined
          ? current.reviewFrequencyDays
          : normalizePositiveDays(input.reviewFrequencyDays, 'reviewFrequencyDays'),
        input.needsReview === undefined
          ? (current.needsReview ? 1 : 0)
          : (normalizeNeedsReview(input.needsReview, 'needsReview') ? 1 : 0),
        input.sensitive === undefined
          ? (current.sensitive ? 1 : 0)
          : (normalizeSensitive(input.sensitive, 'sensitive') ? 1 : 0),
        timestamp(),
        id
      ]
    )
    return this.find(id) as ThreadRecord
  }

  /**
   * Plans a cross-Focus move without mutating state. Inherited/Open Threads
   * preserve their current canonical Subject coverage by widening the target
   * Focus only when required. Explicit/derived Threads carry an isolated copy
   * of their Scope graph instead.
   */
  planMove(id: number, focusId: number, on = today()): ThreadMovePlanSnapshot {
    assertId(focusId, 'focus')
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Thread', id)
    this.assertParentExists('focuses', focusId, 'Focus')
    const sourceApplication = this.scopeApplications.get({ type: 'thread', id })
    const targetApplication = this.scopeApplications.get({ type: 'focus', id: focusId })
    const customScope = sourceApplication.mode === 'explicit' || sourceApplication.mode === 'derived'
    const sourceSubjects = sourceApplication.effectiveScopeId === null
      ? []
      : this.scopes.effectiveSubjects(sourceApplication.effectiveScopeId, on)
    const targetSubjectIds = new Set(
      targetApplication.effectiveScopeId === null
        ? []
        : this.scopes
            .effectiveSubjects(targetApplication.effectiveScopeId, on)
            .map(({ id: subjectId }) => subjectId)
    )
    const scopeSubjectAdditions = current.focusId === focusId || customScope
      ? []
      : sourceSubjects.filter(({ id: subjectId }) => !targetSubjectIds.has(subjectId))

    return {
      threadId: id,
      fromFocusId: current.focusId,
      toFocusId: focusId,
      sourceScopeMode: sourceApplication.mode,
      sourceScopeId: sourceApplication.effectiveScopeId,
      targetScopeId: targetApplication.effectiveScopeId,
      scopeStrategy: customScope ? 'copy-custom' : 'follow-destination',
      scopeSubjectAdditions,
      ownedRecords: {
        commitments: this.countThreadCommitments(id),
        updates: this.countThreadOwned('updates', id),
        todos: this.countThreadOwned('todos', id),
        notes: this.countThreadOwned('notes', id)
      },
      requiresConfirmation: scopeSubjectAdditions.length > 0
    }
  }

  move(id: number, input: MoveThreadInput, now = new Date()): ThreadRecord {
    assertId(input.focusId, 'focus')
    assertId(input.plannedFromFocusId, 'planned source focus')
    return this.database.transaction(() => {
      const plan = this.planMove(id, input.focusId, today(now))
      if (plan.fromFocusId !== input.plannedFromFocusId) {
        throw new ModelValidationError('Thread move plan is stale because its Focus changed')
      }
      if (plan.fromFocusId === plan.toFocusId) return this.find(id) as ThreadRecord

      const required = plan.scopeSubjectAdditions
        .map(({ id: subjectId }) => subjectId)
        .sort((left, right) => left - right)
      const confirmed = [...new Set(input.confirmedScopeSubjectIds ?? [])]
        .sort((left, right) => left - right)
      if (
        required.length !== confirmed.length ||
        required.some((subjectId, index) => subjectId !== confirmed[index])
      ) {
        throw new ModelValidationError(
          'Thread move Scope changes must be planned and explicitly confirmed'
        )
      }

      if (required.length > 0) this.focusScopes.ensureSubjects(plan.toFocusId, required, now)

      const createdAt = timestamp(now)
      this.database.run(
        `INSERT INTO thread_move_operations (
           thread_id, from_focus_id, to_focus_id, created_at
         ) VALUES (?, ?, ?, ?)`,
        [id, plan.fromFocusId, plan.toFocusId, createdAt]
      )

      const scopeIds = this.referencedScopeIds(id)
      if (plan.scopeStrategy === 'copy-custom' && plan.sourceScopeId !== null) {
        scopeIds.add(plan.sourceScopeId)
      }
      const scopeMapping = new Map<number, number>()
      const visiting = new Set<number>()
      for (const scopeId of scopeIds) {
        this.cloneScopeForFocus(
          scopeId,
          plan.fromFocusId,
          plan.toFocusId,
          scopeMapping,
          visiting,
          now
        )
      }

      const moved = this.database.run(
        'UPDATE threads SET focus_id = ?, updated_at = ? WHERE id = ?',
        [plan.toFocusId, createdAt, id]
      )
      if (moved.changes === 0) throw new ModelNotFoundError('Thread', id)

      for (const [sourceScopeId, targetScopeId] of scopeMapping) {
        this.remapOwnedScope('updates', id, sourceScopeId, targetScopeId)
        this.remapOwnedScope('todos', id, sourceScopeId, targetScopeId)
        this.remapOwnedScope('todo_lists', id, sourceScopeId, targetScopeId)
        this.remapReviewPokes(id, sourceScopeId, targetScopeId)
      }

      if (plan.scopeStrategy === 'copy-custom') {
        const targetScopeId = plan.sourceScopeId === null
          ? null
          : scopeMapping.get(plan.sourceScopeId) ?? null
        if (targetScopeId === null) {
          throw new ModelValidationError('Thread custom Scope could not be copied')
        }
        this.scopeApplications.set(
          { type: 'thread', id },
          { mode: plan.sourceScopeMode as 'explicit' | 'derived', scopeId: targetScopeId },
          now
        )
      } else {
        this.scopeApplications.set({ type: 'thread', id }, { mode: 'inherited' }, now)
      }

      this.database.run('DELETE FROM thread_move_operations WHERE thread_id = ?', [id])
      return this.materialize(id, today(now))
    })
  }

  setStatus(id: number, status: ThreadStatus): ThreadRecord {
    return this.update(id, { status })
  }

  pokeReview(id: number, now = new Date(), cell?: UpdateScopeCell): ThreadRecord {
    assertId(id, 'thread')
    const reviewDate = today(now)
    if (cell) {
      assertId(cell.scopeId, 'scope')
      assertId(cell.subjectId, 'subject')
      const isCurrentCell = this.scopeMatrix(id, reviewDate).some((candidate) =>
        candidate.scopeId === cell.scopeId && candidate.subjectId === cell.subjectId)
      if (!isCurrentCell) {
        throw new ModelValidationError('Thread review cell must be currently effective')
      }
      const changedAt = timestamp(now)
      this.database.run(
        `INSERT INTO thread_review_cell_pokes (
           thread_id, scope_id, subject_id, reviewed_on, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (thread_id, scope_id, subject_id) DO UPDATE SET
           reviewed_on = MAX(reviewed_on, excluded.reviewed_on),
           updated_at = excluded.updated_at`,
        [id, cell.scopeId, cell.subjectId, reviewDate, changedAt, changedAt]
      )
      this.database.run('UPDATE threads SET updated_at = ? WHERE id = ?', [changedAt, id])
      return this.materialize(id, reviewDate)
    }
    const result = this.database.run(
      `UPDATE threads
       SET review_poked_on = ?, updated_at = ?
       WHERE id = ? AND (review_poked_on IS NULL OR review_poked_on < ?)`,
      [reviewDate, timestamp(now), id, reviewDate]
    )
    if (result.changes === 0 && !this.database.get<ExistsRow>(
      'SELECT 1 AS found FROM threads WHERE id = ?',
      [id]
    )) {
      throw new ModelNotFoundError('Thread', id)
    }
    return this.materialize(id, reviewDate)
  }

  delete(id: number): boolean {
    assertId(id, 'thread')
    return this.database.run('DELETE FROM threads WHERE id = ?', [id]).changes > 0
  }

  statusHistory(id: number): ThreadStatusTransition[] {
    if (!this.find(id)) throw new ModelNotFoundError('Thread', id)
    return this.database
      .all<ThreadTransitionRow>(
        `SELECT id, thread_id, from_status, to_status, changed_at
         FROM thread_status_transitions WHERE thread_id = ? ORDER BY id`,
        [id]
      )
      .map((row) => ({
        id: Number(row.id),
        threadId: Number(row.thread_id),
        from: row.from_status as ThreadStatus | null,
        to: row.to_status as ThreadStatus,
        changedAt: row.changed_at
      }))
  }

  parentHistory(id: number): ThreadParentTransition[] {
    if (!this.find(id)) throw new ModelNotFoundError('Thread', id)
    return this.database.all<ThreadParentTransitionRow>(
      `SELECT id, thread_id, from_focus_id, to_focus_id, changed_at
       FROM thread_parent_transitions WHERE thread_id = ? ORDER BY id`,
      [id]
    ).map((row) => ({
      id: Number(row.id),
      threadId: Number(row.thread_id),
      fromFocusId: row.from_focus_id === null ? null : Number(row.from_focus_id),
      toFocusId: Number(row.to_focus_id),
      changedAt: row.changed_at
    }))
  }

  scopeApplication(id: number): ScopeApplicationSnapshot {
    return this.scopeApplications.get({ type: 'thread', id })
  }

  scopeApplicationHistory(id: number): ScopeApplicationTransition[] {
    return this.scopeApplications.history({ type: 'thread', id })
  }

  setScope(id: number, input: SetScopeApplicationInput): ScopeApplicationSnapshot {
    return this.scopeApplications.set({ type: 'thread', id }, input)
  }

  scopeMatrix(id: number, asOf = today()): ThreadScopeCellSnapshot[] {
    const date = normalizeDate(asOf, 'asOf')
    const row = this.findRow(id)
    if (!row) throw new ModelNotFoundError('Thread', id)
    return this.scopeMatrixForRow(row, date)
  }

  /**
   * Operational Thread matrix for the renderer. A Subject lens joins the
   * Thread's own review cell to each bounded child Commitment that currently
   * contains the same canonical Subject. Open Commitments stay in the aggregate
   * view because they have no Subject-specific evidence cell.
   */
  subjectMatrix(id: number, asOf = today()): ThreadSubjectCellSnapshot[] {
    const date = normalizeDate(asOf, 'asOf')
    const threadCells = this.scopeMatrix(id, date)
    const commitmentRepository = new CommitmentRepository(this.database)
    const commitments = commitmentRepository.listForThread(id, date)
    const commitmentCells = new Map(
      commitments.map((commitment) => [
        commitment.id,
        commitmentRepository.scopeMatrix(commitment.id, date)
      ])
    )

    return threadCells.map((threadCell) => ({
      ...threadCell,
      commitments: commitments.flatMap((commitment) => {
        const cell = commitmentCells
          .get(commitment.id)
          ?.find(({ subjectId }) => subjectId === threadCell.subjectId)
        return cell
          ? [{
              commitmentId: commitment.id,
              scopeId: cell.scopeId,
              subjectId: cell.subjectId,
              state: cell.state,
              lastUpdateDate: cell.lastUpdateDate,
              nextUpdateDate: cell.nextUpdateDate,
              needsUpdate: cell.needsUpdate
            }]
          : []
      })
    }))
  }

  private materializeOrNull(id: number, asOf: string): ThreadRecord | null {
    assertId(id, 'thread')
    const row = this.findRow(id)
    if (!row) return null

    const application = this.scopeApplications.get({ type: 'thread', id })
    const scopeCells = application.effectiveScopeId === null
      ? []
      : this.scopeMatrixForRow(row, asOf)
    const threadWide = application.effectiveScopeId === null || scopeCells.length === 0
    const threadWideEvidence = threadWide
      ? this.database.get<LatestUpdateRow>(
          `SELECT recorded_on, state FROM updates
           WHERE thread_id = ? AND scope_id IS NULL AND recorded_on <= ?
           ORDER BY recorded_on DESC, id DESC LIMIT 1`,
          [id, asOf]
        )
      : undefined
    const directStates = threadWide
      ? [(threadWideEvidence?.state as HealthState | undefined) ?? 'none']
      : scopeCells.map((cell) => cell.state)
    const commitmentStates = this.database
      .all<{ id: number }>(
        `SELECT id FROM commitments
         WHERE thread_id = ? AND status = 'active' ORDER BY id`,
        [id]
      )
      .map(({ id: commitmentId }) =>
        new CommitmentRepository(this.database).materialize(Number(commitmentId), asOf).state
      )
    const updateReviewDate = threadWide
      ? (threadWideEvidence?.recorded_on ?? null)
      : this.scopeCoverageDate(scopeCells)
    const reviewPokeDate = row.review_poked_on !== null && row.review_poked_on <= asOf
      ? row.review_poked_on
      : null
    const lastReviewDate = latestDate(updateReviewDate, reviewPokeDate)
    const defaultNextReviewDate = addDays(
      row.created_at.slice(0, 10),
      Number(row.review_frequency_days)
    )
    const nextReviewDate = threadWide
      ? addDays(
          lastReviewDate ?? row.created_at.slice(0, 10),
          Number(row.review_frequency_days)
        )
      : scopeCells.reduce(
          (earliest, cell) => cell.nextReviewDate < earliest ? cell.nextReviewDate : earliest,
          scopeCells[0]?.nextReviewDate ?? defaultNextReviewDate
        )

    return {
      id: Number(row.id),
      focusId: Number(row.focus_id),
      title: row.title,
      health: calculateHealth([...directStates, ...commitmentStates]),
      status: row.status as ThreadStatus,
      reviewFrequencyDays: Number(row.review_frequency_days),
      lastReviewDate,
      nextReviewDate,
      needsReview: Boolean(row.needs_review),
      sensitive: Boolean(row.sensitive),
      notes: this.notes.list({ type: 'thread', id: Number(row.id) }),
      reviewDue: threadWide
        ? Boolean(row.needs_review) && row.status === 'active' && nextReviewDate <= asOf
        : scopeCells.some((cell) => cell.reviewDue),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private scopeMatrixForRow(row: ThreadRow, asOf: string): ThreadScopeCellSnapshot[] {
    const application = this.scopeApplications.get({ type: 'thread', id: Number(row.id) })
    if (application.effectiveScopeId === null) return []
    const scopeId = application.effectiveScopeId
    const reviewFrequencyDays = Number(row.review_frequency_days)
    return this.scopes.effectiveSubjects(scopeId, asOf).map((subject) => {
      const latest = this.database.get<LatestUpdateRow>(
        `SELECT recorded_on, state FROM updates
         WHERE thread_id = ? AND scope_id = ? AND subject_id = ? AND recorded_on <= ?
         ORDER BY recorded_on DESC, id DESC LIMIT 1`,
        [row.id, scopeId, subject.id, asOf]
      )
      const poke = this.database.get<{ reviewed_on: string }>(
        `SELECT reviewed_on FROM thread_review_cell_pokes
         WHERE thread_id = ? AND scope_id = ? AND subject_id = ? AND reviewed_on <= ?`,
        [row.id, scopeId, subject.id, asOf]
      )
      const lastReviewDate = latestDate(latest?.recorded_on ?? null, poke?.reviewed_on ?? null)
      const nextReviewDate = addDays(
        lastReviewDate ?? row.created_at.slice(0, 10),
        reviewFrequencyDays
      )
      return {
        scopeId,
        subjectId: subject.id,
        subject,
        state: (latest?.state as HealthState | undefined) ?? 'none',
        lastReviewDate,
        nextReviewDate,
        reviewDue:
          Boolean(row.needs_review) && row.status === 'active' && nextReviewDate <= asOf
      }
    })
  }

  private scopeCoverageDate(cells: readonly ThreadScopeCellSnapshot[]): string | null {
    if (cells.length === 0 || cells.some((cell) => cell.lastReviewDate === null)) return null
    return cells.reduce<string>(
      (oldest, cell) => (cell.lastReviewDate as string) < oldest
        ? (cell.lastReviewDate as string)
        : oldest,
      cells[0].lastReviewDate as string
    )
  }

  private findRow(id: number): ThreadRow | undefined {
    assertId(id, 'thread')
    return this.database.get<ThreadRow>(
      `SELECT id, focus_id, title, status, review_frequency_days, needs_review, sensitive,
              review_poked_on, created_at, updated_at
       FROM threads WHERE id = ?`,
      [id]
    )
  }

  private countThreadCommitments(threadId: number): number {
    return Number(this.database.get<CountRow>(
      'SELECT COUNT(*) AS count FROM commitments WHERE thread_id = ?',
      [threadId]
    )?.count ?? 0)
  }

  private countThreadOwned(
    table: 'updates' | 'todos' | 'notes',
    threadId: number
  ): number {
    return Number(this.database.get<CountRow>(
      `SELECT COUNT(*) AS count FROM ${table} record
       LEFT JOIN commitments commitment ON commitment.id = record.commitment_id
       WHERE record.thread_id = ? OR commitment.thread_id = ?`,
      [threadId, threadId]
    )?.count ?? 0)
  }

  private referencedScopeIds(threadId: number): Set<number> {
    return new Set(this.database.all<{ scope_id: number }>(
      `SELECT record.scope_id
       FROM updates record
       LEFT JOIN commitments commitment ON commitment.id = record.commitment_id
       WHERE record.scope_id IS NOT NULL
         AND (record.thread_id = ? OR commitment.thread_id = ?)
       UNION
       SELECT record.scope_id
       FROM todos record
       LEFT JOIN commitments commitment ON commitment.id = record.commitment_id
       WHERE record.scope_id IS NOT NULL
         AND (record.thread_id = ? OR commitment.thread_id = ?)
       UNION
       SELECT record.scope_id
       FROM todo_lists record
       LEFT JOIN commitments commitment ON commitment.id = record.commitment_id
       WHERE record.scope_id IS NOT NULL
         AND (record.thread_id = ? OR commitment.thread_id = ?)
       UNION
       SELECT scope_id FROM thread_review_cell_pokes WHERE thread_id = ?
       UNION
       SELECT record.scope_id
       FROM commitment_review_cell_pokes record
       JOIN commitments commitment ON commitment.id = record.commitment_id
       WHERE commitment.thread_id = ?`,
      [
        threadId,
        threadId,
        threadId,
        threadId,
        threadId,
        threadId,
        threadId,
        threadId
      ]
    ).map(({ scope_id: scopeId }) => Number(scopeId)))
  }

  private cloneScopeForFocus(
    sourceScopeId: number,
    sourceFocusId: number,
    targetFocusId: number,
    mapping: Map<number, number>,
    visiting: Set<number>,
    now: Date
  ): number {
    const existing = mapping.get(sourceScopeId)
    if (existing !== undefined) return existing
    if (visiting.has(sourceScopeId)) {
      throw new ModelValidationError('Thread move Scope graph contains a cycle')
    }
    const source = this.database.get<ScopeTransferRow>(
      `SELECT id, focus_id, name, dimension, source_type, base_scope_id,
              derived_relationship, context_subject_id, sensitive, created_at, updated_at
       FROM scopes WHERE id = ?`,
      [sourceScopeId]
    )
    if (!source) throw new ModelNotFoundError('Scope', sourceScopeId)
    if (Number(source.focus_id) !== sourceFocusId) {
      throw new ModelValidationError('Thread evidence references a Scope outside its source Focus')
    }

    visiting.add(sourceScopeId)
    const baseScopeId = source.base_scope_id === null
      ? null
      : this.cloneScopeForFocus(
          Number(source.base_scope_id),
          sourceFocusId,
          targetFocusId,
          mapping,
          visiting,
          now
        )
    const changedAt = timestamp(now)
    const result = this.database.run(
      `INSERT INTO scopes (
         focus_id, name, dimension, source_type, base_scope_id,
         derived_relationship, context_subject_id, sensitive, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetFocusId,
        source.name,
        source.dimension,
        source.source_type,
        baseScopeId,
        source.derived_relationship,
        source.context_subject_id,
        source.sensitive,
        changedAt,
        changedAt
      ]
    )
    const targetScopeId = result.lastInsertRowid
    mapping.set(sourceScopeId, targetScopeId)
    visiting.delete(sourceScopeId)

    const memberships = this.database.all<ScopeMembershipTransferRow>(
      `SELECT subject_id, effect, effective_from, effective_until, created_at
       FROM scope_memberships WHERE scope_id = ? ORDER BY id`,
      [sourceScopeId]
    )
    for (const membership of memberships) {
      this.database.run(
        `INSERT INTO scope_memberships (
           scope_id, subject_id, effect, effective_from, effective_until, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          targetScopeId,
          membership.subject_id,
          membership.effect,
          membership.effective_from,
          membership.effective_until,
          membership.created_at
        ]
      )
    }
    return targetScopeId
  }

  private remapOwnedScope(
    table: 'updates' | 'todos' | 'todo_lists',
    threadId: number,
    sourceScopeId: number,
    targetScopeId: number
  ): void {
    this.database.run(
      `UPDATE ${table}
       SET scope_id = ?
       WHERE scope_id = ? AND (
         thread_id = ? OR commitment_id IN (
           SELECT id FROM commitments WHERE thread_id = ?
         )
       )`,
      [targetScopeId, sourceScopeId, threadId, threadId]
    )
  }

  private remapReviewPokes(
    threadId: number,
    sourceScopeId: number,
    targetScopeId: number
  ): void {
    this.database.run(
      `UPDATE thread_review_cell_pokes SET scope_id = ?
       WHERE thread_id = ? AND scope_id = ?`,
      [targetScopeId, threadId, sourceScopeId]
    )
    this.database.run(
      `UPDATE commitment_review_cell_pokes SET scope_id = ?
       WHERE scope_id = ? AND commitment_id IN (
         SELECT id FROM commitments WHERE thread_id = ?
       )`,
      [targetScopeId, sourceScopeId, threadId]
    )
  }

  private assertParentExists(table: 'focuses', id: number, name: string): void {
    const row = this.database.get<ExistsRow>(`SELECT 1 AS found FROM ${table} WHERE id = ?`, [id])
    if (!row) throw new ModelNotFoundError(name, id)
  }
}

export class CommitmentModel extends BaseModel<CommitmentRecord> {
  constructor(
    private readonly repository: CommitmentRepository,
    record: CommitmentRecord
  ) {
    super(repository, record)
  }

  get title(): string {
    return this.record.title
  }

  get state(): HealthState {
    return this.record.state
  }

  get status(): CommitmentStatus {
    return this.record.status
  }

  get sensitive(): boolean {
    return this.record.sensitive
  }

  update(input: UpdateCommitmentInput): this {
    return this.replace(this.repository.update(this.id, input))
  }

  setStatus(status: CommitmentStatus): this {
    return this.replace(this.repository.setStatus(this.id, status))
  }

  /** Records aggregate or exact-cell review evidence without inventing an Update. */
  pokeReview(now = new Date(), cell?: UpdateScopeCell): this {
    return this.replace(this.repository.pokeReview(this.id, now, cell))
  }

  snapshot(asOf?: string): CommitmentSnapshot {
    return this.repository.materialize(this.id, asOf)
  }

  statusHistory(): CommitmentStatusTransition[] {
    return this.repository.statusHistory(this.id)
  }

  movePlan(parent: CommitmentParent): CommitmentMovePlanSnapshot {
    return this.repository.planMove(this.id, parent)
  }

  moveTo(input: MoveCommitmentInput): this {
    return this.replace(this.repository.move(this.id, input))
  }

  parentHistory(): CommitmentParentTransition[] {
    return this.repository.parentHistory(this.id)
  }

  scopeMatrix(asOf?: string): CommitmentScopeCellSnapshot[] {
    return this.repository.scopeMatrix(this.id, asOf)
  }

  scopeApplication(): ScopeApplicationSnapshot {
    return this.repository.scopeApplication(this.id)
  }

  scopeApplicationHistory(): ScopeApplicationTransition[] {
    return this.repository.scopeApplicationHistory(this.id)
  }
}

export class CommitmentRepository extends BaseRepository<CommitmentRecord, CommitmentModel> {
  private readonly scopeApplications: ScopeApplicationRepository
  private readonly scopes: ScopeRepository
  private readonly focusScopes: FocusScopeRepository
  private readonly threadScopes: ThreadScopeRepository
  private readonly notes: NoteRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.scopeApplications = new ScopeApplicationRepository(database)
    this.scopes = new ScopeRepository(database)
    this.focusScopes = new FocusScopeRepository(database)
    this.threadScopes = new ThreadScopeRepository(database)
    this.notes = new NoteRepository(database)
  }

  protected instantiate(record: CommitmentRecord): CommitmentModel {
    return new CommitmentModel(this, record)
  }

  create(input: CreateCommitmentInput, now = new Date()): CommitmentModel {
    const [focusId, threadId] = parentColumns(input.parent)
    this.assertParentExists(input.parent)
    const createdAt = timestamp(now)
    const commitmentId = this.database.transaction(() => {
      const result = this.database.run(
        `INSERT INTO commitments (
           focus_id, thread_id, commitment_type, title, status, due_on,
           cadence_days, sensitive, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          focusId,
          threadId,
          normalizeCommitmentType(input.type),
          normalizeTitle(input.title, 'commitment'),
          normalizeStatus(input.status),
          normalizeOptionalDate(input.dueDate, 'dueDate'),
          normalizeOptionalDays(input.cadenceDays, 'cadenceDays'),
          normalizeSensitive(input.sensitive, 'sensitive') ? 1 : 0,
          createdAt,
          createdAt
        ]
      )
      return result.lastInsertRowid
    })
    return this.requireModel(commitmentId)
  }

  find(id: number): CommitmentRecord | null {
    return this.materializeOrNull(id, today())
  }

  materialize(id: number, asOf = today()): CommitmentSnapshot {
    const record = this.materializeOrNull(id, normalizeDate(asOf, 'asOf'))
    if (!record) throw new ModelNotFoundError('Commitment', id)
    return record
  }

  listForFocus(focusId: number, asOf = today()): CommitmentSnapshot[] {
    return this.listFor('focus_id', focusId, asOf)
  }

  listForThread(threadId: number, asOf = today()): CommitmentSnapshot[] {
    return this.listFor('thread_id', threadId, asOf)
  }

  update(id: number, input: UpdateCommitmentInput): CommitmentRecord {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Commitment', id)
    this.database.run(
      `UPDATE commitments
       SET commitment_type = ?, title = ?, status = ?, due_on = ?, cadence_days = ?, sensitive = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.type === undefined ? current.type : normalizeCommitmentType(input.type),
        input.title === undefined ? current.title : normalizeTitle(input.title, 'commitment'),
        input.status === undefined ? current.status : normalizeStatus(input.status),
        input.dueDate === undefined ? current.dueDate : normalizeOptionalDate(input.dueDate, 'dueDate'),
        input.cadenceDays === undefined
          ? current.cadenceDays
          : normalizeOptionalDays(input.cadenceDays, 'cadenceDays'),
        input.sensitive === undefined
          ? (current.sensitive ? 1 : 0)
          : (normalizeSensitive(input.sensitive, 'sensitive') ? 1 : 0),
        timestamp(),
        id
      ]
    )
    return this.find(id) as CommitmentRecord
  }

  setStatus(id: number, status: CommitmentStatus): CommitmentRecord {
    return this.update(id, { status })
  }

  /**
   * Plans a same-Focus reparenting operation without changing durable state.
   * Child evidence keeps its exact Scope id; canonical Subject coverage decides
   * whether it remains current under the destination context.
   */
  planMove(id: number, parent: CommitmentParent, on = today()): CommitmentMovePlanSnapshot {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Commitment', id)
    this.assertParentExists(parent)
    const sourceFocusId = this.focusIdForParent(current.parent)
    const targetFocusId = this.focusIdForParent(parent)
    if (sourceFocusId !== targetFocusId) {
      throw new ModelValidationError('a Commitment cannot move outside its Focus')
    }

    const sourceApplication = current.parent.type === 'thread'
      ? this.scopeApplications.get({ type: 'thread', id: current.parent.id })
      : this.scopeApplications.get({ type: 'commitment', id })
    const targetApplication = this.scopeApplications.get(
      parent.type === 'focus'
        ? { type: 'focus', id: parent.id }
        : { type: 'thread', id: parent.id }
    )
    const sourceSubjects = sourceApplication.effectiveScopeId === null
      ? []
      : this.scopes.effectiveSubjects(sourceApplication.effectiveScopeId, on)
    const targetSubjectIds = new Set(
      targetApplication.effectiveScopeId === null
        ? []
        : this.scopes
            .effectiveSubjects(targetApplication.effectiveScopeId, on)
            .map(({ id: subjectId }) => subjectId)
    )
    const sameParent = current.parent.type === parent.type && current.parent.id === parent.id
    const scopeSubjectAdditions = sameParent
      ? []
      : sourceSubjects.filter(({ id: subjectId }) => !targetSubjectIds.has(subjectId))

    return {
      commitmentId: id,
      from: current.parent,
      to: { ...parent },
      sourceScopeMode: sourceApplication.mode,
      sourceScopeId: sourceApplication.effectiveScopeId,
      targetScopeId: targetApplication.effectiveScopeId,
      scopeSubjectAdditions,
      ownedRecords: {
        updates: this.count('updates', 'commitment_id', id),
        todos: this.count('todos', 'commitment_id', id),
        notes: this.count('notes', 'commitment_id', id)
      },
      requiresConfirmation: scopeSubjectAdditions.length > 0
    }
  }

  move(id: number, input: MoveCommitmentInput, now = new Date()): CommitmentRecord {
    const plan = this.planMove(id, input.parent, today(now))
    if (plan.from.type === plan.to.type && plan.from.id === plan.to.id) {
      return this.find(id) as CommitmentRecord
    }
    const required = plan.scopeSubjectAdditions.map(({ id: subjectId }) => subjectId).sort((a, b) => a - b)
    const confirmed = [...new Set(input.confirmedScopeSubjectIds ?? [])].sort((a, b) => a - b)
    if (
      required.length !== confirmed.length ||
      required.some((subjectId, index) => subjectId !== confirmed[index])
    ) {
      throw new ModelValidationError(
        'Commitment move Scope changes must be planned and explicitly confirmed'
      )
    }

    this.database.transaction(() => {
      if (required.length > 0) {
        if (input.parent.type === 'focus') {
          this.focusScopes.ensureSubjects(input.parent.id, required, now)
        } else {
          this.threadScopes.ensureSubjects(input.parent.id, required, now)
        }
      }
      const [focusId, threadId] = parentColumns(input.parent)
      const result = this.database.run(
        `UPDATE commitments
         SET focus_id = ?, thread_id = ?, updated_at = ?
         WHERE id = ?`,
        [focusId, threadId, timestamp(now), id]
      )
      if (result.changes === 0) throw new ModelNotFoundError('Commitment', id)
    })
    return this.find(id) as CommitmentRecord
  }

  pokeReview(id: number, now = new Date(), cell?: UpdateScopeCell): CommitmentRecord {
    assertId(id, 'commitment')
    const reviewDate = today(now)
    if (cell) {
      assertId(cell.scopeId, 'scope')
      assertId(cell.subjectId, 'subject')
      const isCurrentCell = this.scopeMatrix(id, reviewDate).some((candidate) =>
        candidate.scopeId === cell.scopeId && candidate.subjectId === cell.subjectId)
      if (!isCurrentCell) {
        throw new ModelValidationError('Commitment review cell must be currently effective')
      }
      const changedAt = timestamp(now)
      this.database.run(
        `INSERT INTO commitment_review_cell_pokes (
           commitment_id, scope_id, subject_id, reviewed_on, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (commitment_id, scope_id, subject_id) DO UPDATE SET
           reviewed_on = MAX(reviewed_on, excluded.reviewed_on),
           updated_at = excluded.updated_at`,
        [id, cell.scopeId, cell.subjectId, reviewDate, changedAt, changedAt]
      )
      this.database.run('UPDATE commitments SET updated_at = ? WHERE id = ?', [changedAt, id])
      return this.materialize(id, reviewDate)
    }
    const result = this.database.run(
      `UPDATE commitments
       SET review_poked_on = ?, updated_at = ?
       WHERE id = ? AND (review_poked_on IS NULL OR review_poked_on < ?)`,
      [reviewDate, timestamp(now), id, reviewDate]
    )
    if (result.changes === 0 && !this.database.get<ExistsRow>(
      'SELECT 1 AS found FROM commitments WHERE id = ?',
      [id]
    )) {
      throw new ModelNotFoundError('Commitment', id)
    }
    return this.materialize(id, reviewDate)
  }

  delete(id: number): boolean {
    assertId(id, 'commitment')
    return this.database.run('DELETE FROM commitments WHERE id = ?', [id]).changes > 0
  }

  statusHistory(id: number): CommitmentStatusTransition[] {
    if (!this.find(id)) throw new ModelNotFoundError('Commitment', id)
    return this.database
      .all<CommitmentTransitionRow>(
        `SELECT id, commitment_id, from_status, to_status, changed_at
         FROM commitment_status_transitions WHERE commitment_id = ? ORDER BY id`,
        [id]
      )
      .map((row) => ({
        id: Number(row.id),
        commitmentId: Number(row.commitment_id),
        from: row.from_status as CommitmentStatus | null,
        to: row.to_status as CommitmentStatus,
        changedAt: row.changed_at
      }))
  }

  parentHistory(id: number): CommitmentParentTransition[] {
    if (!this.find(id)) throw new ModelNotFoundError('Commitment', id)
    return this.database.all<CommitmentParentTransitionRow>(
      `SELECT id, commitment_id, from_focus_id, from_thread_id,
              to_focus_id, to_thread_id, changed_at
       FROM commitment_parent_transitions
       WHERE commitment_id = ? ORDER BY id`,
      [id]
    ).map((row) => ({
      id: Number(row.id),
      commitmentId: Number(row.commitment_id),
      from: row.from_focus_id === null && row.from_thread_id === null
        ? null
        : commitmentParentFromColumns(row.from_focus_id, row.from_thread_id),
      to: commitmentParentFromColumns(row.to_focus_id, row.to_thread_id),
      changedAt: row.changed_at
    }))
  }

  scopeApplication(id: number): ScopeApplicationSnapshot {
    return this.scopeApplications.get({ type: 'commitment', id })
  }

  scopeApplicationHistory(id: number): ScopeApplicationTransition[] {
    return this.scopeApplications.history({ type: 'commitment', id })
  }

  scopeMatrix(id: number, asOf = today()): CommitmentScopeCellSnapshot[] {
    const date = normalizeDate(asOf, 'asOf')
    const row = this.database.get<CommitmentRow>(
      `SELECT id, focus_id, thread_id, commitment_type, title, status,
              due_on, cadence_days, sensitive, review_poked_on, created_at, updated_at
       FROM commitments WHERE id = ?`,
      [id]
    )
    if (!row) throw new ModelNotFoundError('Commitment', id)
    const application = this.scopeApplications.get({ type: 'commitment', id })
    if (application.effectiveScopeId === null) return []
    const scopeId = application.effectiveScopeId
    const cadenceDays = row.cadence_days === null ? null : Number(row.cadence_days)
    return this.scopes.effectiveSubjects(scopeId, date).map((subject) => {
      const latest = this.database.get<LatestUpdateRow>(
        `SELECT recorded_on, state FROM updates
         WHERE commitment_id = ? AND scope_id = ? AND subject_id = ?
         ORDER BY recorded_on DESC, id DESC LIMIT 1`,
        [id, scopeId, subject.id]
      )
      const lastUpdateDate = latest?.recorded_on ?? null
      const poke = this.database.get<{ reviewed_on: string }>(
        `SELECT reviewed_on FROM commitment_review_cell_pokes
         WHERE commitment_id = ? AND scope_id = ? AND subject_id = ? AND reviewed_on <= ?`,
        [id, scopeId, subject.id, date]
      )
      const nextUpdateDate = cadenceDays === null
        ? null
        : addDays(lastUpdateDate ?? row.created_at.slice(0, 10), cadenceDays)
      return {
        scopeId,
        subjectId: subject.id,
        subject,
        state: (latest?.state as HealthState | undefined) ?? 'none',
        lastReviewDate: latestDate(lastUpdateDate, poke?.reviewed_on ?? null),
        lastUpdateDate,
        nextUpdateDate,
        needsUpdate:
          row.status === 'active' && nextUpdateDate !== null && nextUpdateDate <= date
      }
    })
  }

  private materializeOrNull(id: number, asOf: string): CommitmentRecord | null {
    assertId(id, 'commitment')
    const row = this.database.get<CommitmentRow>(
      `SELECT id, focus_id, thread_id, commitment_type, title, status,
              due_on, cadence_days, sensitive, review_poked_on, created_at, updated_at
       FROM commitments WHERE id = ?`,
      [id]
    )
    if (!row) return null
    const cadenceDays = row.cadence_days === null ? null : Number(row.cadence_days)
    const application = this.scopeApplications.get({ type: 'commitment', id })
    const cells = application.effectiveScopeId === null ? [] : this.scopeMatrix(id, asOf)
    const latest = application.effectiveScopeId === null
      ? this.database.get<LatestUpdateRow>(
          `SELECT recorded_on, state FROM updates
           WHERE commitment_id = ? AND scope_id IS NULL
           ORDER BY recorded_on DESC, id DESC LIMIT 1`,
          [id]
        )
      : undefined
    const lastUpdateDate = application.effectiveScopeId === null
      ? (latest?.recorded_on ?? null)
      : cells.reduce<string | null>(
          (mostRecent, cell) =>
            cell.lastUpdateDate !== null &&
            (mostRecent === null || cell.lastUpdateDate > mostRecent)
              ? cell.lastUpdateDate
              : mostRecent,
          null
        )
    const nextUpdateDate = application.effectiveScopeId === null
      ? (cadenceDays === null
          ? null
          : addDays(lastUpdateDate ?? row.created_at.slice(0, 10), cadenceDays))
      : cells.reduce<string | null>(
          (next, cell) =>
            cell.nextUpdateDate !== null && (next === null || cell.nextUpdateDate < next)
              ? cell.nextUpdateDate
              : next,
          null
        )

    return {
      id: Number(row.id),
      parent: commitmentParentFromRow(row),
      type: row.commitment_type as CommitmentType,
      title: row.title,
      status: row.status as CommitmentStatus,
      state: application.effectiveScopeId === null
        ? ((latest?.state as HealthState | undefined) ?? 'none')
        : calculateHealth(cells.map((cell) => cell.state)),
      dueDate: row.due_on,
      cadenceDays,
      lastReviewDate: latestDate(
        row.review_poked_on,
        application.effectiveScopeId === null
          ? lastUpdateDate
          : cells.reduce<string | null>(
              (latestReview, cell) => latestDate(latestReview, cell.lastReviewDate),
              null
            )
      ),
      lastUpdateDate,
      nextUpdateDate,
      needsUpdate: application.effectiveScopeId === null
        ? row.status === 'active' && nextUpdateDate !== null && nextUpdateDate <= asOf
        : cells.some((cell) => cell.needsUpdate),
      sensitive: Boolean(row.sensitive),
      notes: this.notes.list({ type: 'commitment', id: Number(row.id) }),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private listFor(column: 'focus_id' | 'thread_id', id: number, asOf: string): CommitmentSnapshot[] {
    assertId(id, column === 'focus_id' ? 'focus' : 'thread')
    const date = normalizeDate(asOf, 'asOf')
    return this.database
      .all<{ id: number }>(`SELECT id FROM commitments WHERE ${column} = ? ORDER BY id`, [id])
      .map(({ id: commitmentId }) => this.materialize(Number(commitmentId), date))
  }

  private assertParentExists(parent: CommitmentParent): void {
    const table = parent.type === 'focus' ? 'focuses' : 'threads'
    const row = this.database.get<ExistsRow>(`SELECT 1 AS found FROM ${table} WHERE id = ?`, [
      parent.id
    ])
    if (!row) throw new ModelNotFoundError(parent.type === 'focus' ? 'Focus' : 'Thread', parent.id)
  }

  private focusIdForParent(parent: CommitmentParent): number {
    if (parent.type === 'focus') return parent.id
    const row = this.database.get<{ focus_id: number }>(
      'SELECT focus_id FROM threads WHERE id = ?',
      [parent.id]
    )
    if (!row) throw new ModelNotFoundError('Thread', parent.id)
    return Number(row.focus_id)
  }

  private count(table: 'updates' | 'todos' | 'notes', column: 'commitment_id', id: number): number {
    return Number(this.database.get<CountRow>(
      `SELECT count(*) AS count FROM ${table} WHERE ${column} = ?`,
      [id]
    )?.count ?? 0)
  }
}

export class UpdateModel extends BaseModel<UpdateRecord> {
  constructor(
    private readonly repository: UpdateRepository,
    record: UpdateRecord
  ) {
    super(repository, record)
  }

  toSnapshot(): UpdateSnapshot {
    return structuredClone(this.record)
  }

  update(input: EditUpdateInput): this {
    this.assertPersisted()
    const next = {
      date: normalizeDate(input.date ?? this.record.date, 'update date'),
      observation: normalizeObservation(input.observation ?? this.record.observation),
      state: normalizeState(input.state ?? this.record.state),
      sensitive: input.sensitive === undefined
        ? this.record.sensitive
        : normalizeSensitive(input.sensitive, 'sensitive')
    }
    this.repository.updateRecord(this.id, next)
    return this.refresh()
  }
}

export class UpdateRepository extends BaseRepository<UpdateRecord, UpdateModel> {
  private readonly scopeApplications: ScopeApplicationRepository
  private readonly scopes: ScopeRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.scopeApplications = new ScopeApplicationRepository(database)
    this.scopes = new ScopeRepository(database)
  }

  protected instantiate(record: UpdateRecord): UpdateModel {
    return new UpdateModel(this, record)
  }

  create(input: CreateUpdateInput, now = new Date()): UpdateModel {
    const [focusId, threadId, commitmentId] = updateParentColumns(input.parent)
    this.assertParentExists(input.parent)
    const date = normalizeDate(input.date ?? today(now), 'update date')
    const scope = this.scopeCellForCreate(input.parent, input.scope, date)
    const result = this.database.run(
      `INSERT INTO updates (
         focus_id, thread_id, commitment_id, scope_id, subject_id,
         recorded_on, observation, state, sensitive, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        focusId,
        threadId,
        commitmentId,
        scope?.scopeId ?? null,
        scope?.subjectId ?? null,
        date,
        normalizeObservation(input.observation),
        normalizeState(input.state),
        normalizeSensitive(input.sensitive, 'sensitive') ? 1 : 0,
        timestamp(now),
        timestamp(now)
      ]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): UpdateRecord | null {
    assertId(id, 'update')
    const row = this.database.get<UpdateRow>(
      `SELECT id, focus_id, thread_id, commitment_id, scope_id, subject_id, recorded_on,
              observation, state, sensitive, created_at, updated_at
       FROM updates WHERE id = ?`,
      [id]
    )
    return row ? this.fromRow(row) : null
  }

  listForFocus(focusId: number): UpdateSnapshot[] {
    return this.listFor('focus_id', focusId)
  }

  listForThread(threadId: number): UpdateSnapshot[] {
    return this.listFor('thread_id', threadId)
  }

  listForCommitment(commitmentId: number): UpdateSnapshot[] {
    return this.listFor('commitment_id', commitmentId)
  }

  updateRecord(id: number, input: Required<EditUpdateInput>): void {
    assertId(id, 'update')
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Update', id)
    if (current.scope) {
      this.assertEffectiveMember(current.scope, input.date)
    }
    const result = this.database.run(
      `UPDATE updates
       SET recorded_on = ?, observation = ?, state = ?, sensitive = ?, updated_at = ?
       WHERE id = ?`,
      [input.date, input.observation, input.state, input.sensitive ? 1 : 0, timestamp(), id]
    )
    if (result.changes === 0) throw new ModelNotFoundError('Update', id)
  }

  delete(id: number): boolean {
    assertId(id, 'update')
    return this.database.run('DELETE FROM updates WHERE id = ?', [id]).changes > 0
  }

  private listFor(column: 'focus_id' | 'thread_id' | 'commitment_id', id: number): UpdateSnapshot[] {
    assertId(id, column.replace('_id', ''))
    return this.database
      .all<UpdateRow>(
        `SELECT id, focus_id, thread_id, commitment_id, scope_id, subject_id, recorded_on,
                observation, state, sensitive, created_at, updated_at
         FROM updates WHERE ${column} = ? ORDER BY recorded_on, id`,
        [id]
      )
      .map((row) => this.fromRow(row))
  }

  private fromRow(row: UpdateRow): UpdateRecord {
    return {
      id: Number(row.id),
      parent: updateParentFromRow(row),
      date: row.recorded_on,
      observation: row.observation,
      state: row.state as HealthState,
      sensitive: Boolean(row.sensitive),
      scope: row.scope_id === null
        ? null
        : { scopeId: Number(row.scope_id), subjectId: Number(row.subject_id) },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private assertParentExists(parent: UpdateParent): void {
    const table =
      parent.type === 'focus'
        ? 'focuses'
        : parent.type === 'thread'
          ? 'threads'
          : 'commitments'
    const row = this.database.get<ExistsRow>(`SELECT 1 AS found FROM ${table} WHERE id = ?`, [
      parent.id
    ])
    if (!row) {
      const name = parent.type[0].toUpperCase() + parent.type.slice(1)
      throw new ModelNotFoundError(name, parent.id)
    }
  }

  private scopeCellForCreate(
    parent: UpdateParent,
    requested: UpdateScopeCell | null | undefined,
    on: string
  ): UpdateScopeCell | null {
    const owner = scopeOwnerForUpdateParent(parent)
    if (!owner) {
      if (requested) {
        throw new ModelValidationError('a direct Focus Update cannot use a Scope cell')
      }
      return null
    }
    const application = this.scopeApplications.get(owner)
    if (application.effectiveScopeId === null) {
      if (requested) {
        throw new ModelValidationError('an Open parent cannot receive a scoped Update')
      }
      return null
    }
    if (!requested) {
      if (
        parent.type === 'thread' &&
        this.scopes.effectiveSubjects(application.effectiveScopeId, on).length === 0
      ) {
        return null
      }
      throw new ModelValidationError(
        'a scoped Thread or Commitment Update requires a Scope and Subject cell'
      )
    }
    assertId(requested.scopeId, 'scope id')
    assertId(requested.subjectId, 'subject id')
    if (requested.scopeId !== application.effectiveScopeId) {
      throw new ModelValidationError(
        'Update Scope must match the parent’s effective Scope'
      )
    }
    this.assertEffectiveMember(requested, on)
    return { scopeId: requested.scopeId, subjectId: requested.subjectId }
  }

  private assertEffectiveMember(scope: UpdateScopeCell, on: string): void {
    if (!this.scopes.isEffectiveMember(scope.scopeId, scope.subjectId, on)) {
      throw new ModelValidationError(
        `Subject ${scope.subjectId} is not an effective member of Scope ${scope.scopeId} on ${on}`
      )
    }
  }
}
