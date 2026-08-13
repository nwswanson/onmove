import {
  ROUTINE_ISSUE_FOLLOW_UP_TYPES,
  ROUTINE_RUN_ITEM_RESOLUTIONS,
  type AttestRoutineRunItemInput,
  type CommitmentParent,
  type CreateRoutineInput,
  type RoutineIssueFollowUpType,
  type RoutineReviewRunSnapshot,
  type RoutineRunItemResolution,
  type RoutineRunItemSnapshot,
  type RoutineScopeSnapshot,
  type RoutineSnapshot,
  type RoutineStatus,
  type RoutineTemplateItemInput,
  type RoutineTemplateSnapshot,
  type UpdateRoutineInput
} from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelNotFoundError, ModelValidationError } from './model'
import { ScopeRepository } from './scope-model'
import type { SqliteAdapter } from './sqlite-adapter'

interface RoutineRow {
  id: number
  focus_id: number | null
  thread_id: number | null
  title: string
  sensitive: number
  needs_attestation: number
  cadence_days: number
  anchor_on: string
  schedule_effective_on: string
  scope_id: number | null
  current_template_version: number
  created_at: string
  updated_at: string
}

interface TemplateVersionRow {
  id: number
  version: number
  effective_at: string
}

interface TemplateItemRow {
  id: number
  position: number
  inspection: string
  required: number
}

interface RunRow {
  id: number
  scheduled_on: string
  review_window_ends_on: string
  template_version: number
  scope_id: number | null
  scope_name: string | null
  scope_snapshot_json: string
  completed_at: string | null
  created_at: string
}

interface CellRow {
  id: number
  subject_id: number | null
  subject_name: string | null
  completed_at: string | null
}

interface RunItemRow {
  id: number
  run_item_id: number
  position: number
  inspection: string
  required: number
  resolution: string
  attested_at: string | null
  note: string
  issue_id: number | null
  issue_description: string | null
  issue_follow_up_type: string | null
  issue_created_at: string | null
}

interface CountRow {
  count: number
}

interface RunOwnerRow {
  routine_id: number
  run_id: number
  cell_id: number
  completed_at: string | null
  resolution: string
  attested_at: string | null
  note: string
}

interface CellOwnerRow {
  routine_id: number
  run_id: number
  completed_at: string | null
}

function assertId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError(`${label} id must be a positive integer`)
  }
}

function normalizeText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ModelValidationError(`${label} cannot be empty`)
  }
  return value.trim()
}

function normalizeDays(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ModelValidationError(`${label} must be a positive whole number of days`)
  }
  return value
}

function normalizeDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ModelValidationError(`${label} must use YYYY-MM-DD`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ModelValidationError(`${label} must be a real calendar date`)
  }
  return value
}

function localDate(now = new Date()): string {
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

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000
  ))
}

function timestamp(now = new Date()): string {
  return now.toISOString()
}

function parentColumns(parent: CommitmentParent): [number | null, number | null] {
  assertId(parent.id, parent.type)
  return parent.type === 'focus' ? [parent.id, null] : [null, parent.id]
}

function parentFromRow(row: Pick<RoutineRow, 'focus_id' | 'thread_id'>): CommitmentParent {
  return row.focus_id === null
    ? { type: 'thread', id: Number(row.thread_id) }
    : { type: 'focus', id: Number(row.focus_id) }
}

function normalizeChecklist(checklist: readonly RoutineTemplateItemInput[]): Array<{
  inspection: string
  required: boolean
}> {
  if (!Array.isArray(checklist) || checklist.length === 0) {
    throw new ModelValidationError('Routine checklist must contain at least one inspection')
  }
  const items = checklist.map((item) => ({
    inspection: normalizeText(item.inspection, 'Routine inspection'),
    required: item.required ?? true
  }))
  if (items.some(({ required }) => typeof required !== 'boolean')) {
    throw new ModelValidationError('Routine inspection required must be a boolean')
  }
  if (!items.some(({ required }) => required)) {
    throw new ModelValidationError('Routine checklist must contain at least one required inspection')
  }
  return items
}

export class RoutineModel extends BaseModel<RoutineSnapshot> {
  constructor(
    private readonly repository: RoutineRepository,
    record: RoutineSnapshot
  ) {
    super(repository, record)
  }

  snapshot(asOf?: string): RoutineSnapshot {
    this.assertPersisted()
    this.record = this.repository.materialize(this.id, asOf)
    return structuredClone(this.record)
  }

  update(input: UpdateRoutineInput, now = new Date()): this {
    this.assertPersisted()
    return this.replace(this.repository.update(this.id, input, now))
  }
}

/**
 * Owns the Routine implementation of Commitment. Tracking Commitments never
 * enter this repository, and Routine records never enter the tracking adapter.
 */
export class RoutineRepository extends BaseRepository<RoutineSnapshot, RoutineModel> {
  private readonly scopes: ScopeRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.scopes = new ScopeRepository(database)
  }

  protected instantiate(record: RoutineSnapshot): RoutineModel {
    return new RoutineModel(this, record)
  }

  create(input: CreateRoutineInput, now = new Date()): RoutineModel {
    const [focusId, threadId] = parentColumns(input.parent)
    this.assertParent(input.parent)
    const name = normalizeText(input.name, 'Routine name')
    const cadenceDays = normalizeDays(input.cadenceDays, 'Routine cadence')
    const anchorDate = normalizeDate(input.anchorDate ?? localDate(now), 'Routine anchor date')
    const scopeId = input.scopeId ?? null
    this.assertScope(scopeId, input.parent)
    const checklist = normalizeChecklist(input.checklist)
    if (input.sensitive !== undefined && typeof input.sensitive !== 'boolean') {
      throw new ModelValidationError('Routine sensitive must be a boolean')
    }
    if (input.needsAttestation !== undefined && typeof input.needsAttestation !== 'boolean') {
      throw new ModelValidationError('Routine needs attestation must be a boolean')
    }
    const createdAt = timestamp(now)

    const id = this.database.transaction(() => {
      const commitment = this.database.run(
        `INSERT INTO commitments (
           focus_id, thread_id, legacy_due_type, commitment_type, behavior_type, title, status,
           due_on, cadence_days, review_frequency_days, needs_review, sensitive,
           created_at, updated_at
         ) VALUES (?, ?, 'ongoing', 'tracking', 'routine', ?, 'active', NULL, NULL, 7, 0, ?, ?, ?)`,
        [focusId, threadId, name, input.sensitive ? 1 : 0, createdAt, createdAt]
      )
      const routineId = commitment.lastInsertRowid
      this.database.run(
        `INSERT INTO routine_definitions (
           commitment_id, cadence_days, anchor_on, schedule_effective_on, scope_id,
           current_template_version, needs_attestation, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          routineId,
          cadenceDays,
          anchorDate,
          anchorDate,
          scopeId,
          input.needsAttestation === false ? 0 : 1,
          createdAt,
          createdAt
        ]
      )
      this.insertTemplate(routineId, 1, checklist, createdAt)
      return routineId
    })
    return this.instantiate(this.materialize(id, localDate(now)))
  }

  find(id: number): RoutineSnapshot | null {
    return this.materializeOrNull(id, localDate())
  }

  materialize(id: number, asOf = localDate()): RoutineSnapshot {
    const value = this.materializeOrNull(id, normalizeDate(asOf, 'Routine projection date'))
    if (!value) throw new ModelNotFoundError('Routine', id)
    return value
  }

  list(asOf = localDate()): RoutineSnapshot[] {
    const date = normalizeDate(asOf, 'Routine projection date')
    return this.database
      .all<{ id: number }>(
        `SELECT commitment.id
         FROM commitments commitment
         JOIN routine_definitions routine ON routine.commitment_id = commitment.id
         WHERE commitment.behavior_type = 'routine'
         ORDER BY lower(commitment.title), commitment.id`
      )
      .map(({ id }) => this.materialize(Number(id), date))
  }

  update(id: number, input: UpdateRoutineInput, now = new Date()): RoutineSnapshot {
    const current = this.materialize(id, localDate(now))
    const row = this.requireRow(id)
    const parent = current.parent
    const name = input.name === undefined
      ? current.name
      : normalizeText(input.name, 'Routine name')
    const cadenceDays = input.cadenceDays === undefined
      ? current.cadenceDays
      : normalizeDays(input.cadenceDays, 'Routine cadence')
    const anchorDate = input.anchorDate === undefined
      ? current.anchorDate
      : normalizeDate(input.anchorDate, 'Routine anchor date')
    const scopeId = input.scopeId === undefined ? row.scope_id : input.scopeId
    this.assertScope(scopeId, parent)
    if (input.sensitive !== undefined && typeof input.sensitive !== 'boolean') {
      throw new ModelValidationError('Routine sensitive must be a boolean')
    }
    if (input.needsAttestation !== undefined && typeof input.needsAttestation !== 'boolean') {
      throw new ModelValidationError('Routine needs attestation must be a boolean')
    }
    const checklist = input.checklist === undefined ? null : normalizeChecklist(input.checklist)
    const changedAt = timestamp(now)
    const scheduleChanged = cadenceDays !== current.cadenceDays || anchorDate !== current.anchorDate

    this.database.transaction(() => {
      this.database.run(
        `UPDATE commitments SET title = ?, sensitive = ?, updated_at = ?
         WHERE id = ? AND behavior_type = 'routine'`,
        [name, (input.sensitive ?? current.sensitive) ? 1 : 0, changedAt, id]
      )
      const nextVersion = checklist === null ? row.current_template_version : row.current_template_version + 1
      this.database.run(
        `UPDATE routine_definitions
         SET cadence_days = ?, anchor_on = ?, schedule_effective_on = ?, scope_id = ?,
             current_template_version = ?, needs_attestation = ?, updated_at = ?
         WHERE commitment_id = ?`,
        [
          cadenceDays,
          anchorDate,
          scheduleChanged ? localDate(now) : row.schedule_effective_on,
          scopeId,
          nextVersion,
          (input.needsAttestation ?? current.needsAttestation) ? 1 : 0,
          changedAt,
          id
        ]
      )
      if (checklist !== null) this.insertTemplate(id, nextVersion, checklist, changedAt)
    })
    return this.materialize(id, localDate(now))
  }

  attestCellItem(
    attestationId: number,
    input: AttestRoutineRunItemInput,
    now = new Date()
  ): RoutineSnapshot {
    assertId(attestationId, 'Routine Run cell attestation')
    if (!ROUTINE_RUN_ITEM_RESOLUTIONS.includes(input.resolution)) {
      throw new ModelValidationError(`unsupported Routine attestation: ${input.resolution}`)
    }
    if (input.note !== undefined && typeof input.note !== 'string') {
      throw new ModelValidationError('Routine item note must be text')
    }
    const issueMutation = input.issueFound !== undefined ||
      input.issueDescription !== undefined || input.issueFollowUpType !== undefined
    const followUpType = input.issueFollowUpType ?? 'none'
    if (issueMutation && !ROUTINE_ISSUE_FOLLOW_UP_TYPES.includes(followUpType)) {
      throw new ModelValidationError(`unsupported Routine issue follow-up: ${followUpType}`)
    }
    const owner = this.database.get<RunOwnerRow>(
      `SELECT run.routine_id, run.id AS run_id, cell.id AS cell_id,
              cell.completed_at, attestation.resolution, attestation.attested_at,
              attestation.note
       FROM routine_review_cell_attestations attestation
       JOIN routine_review_cells cell ON cell.id = attestation.cell_id
       JOIN routine_review_runs run ON run.id = cell.run_id
       WHERE attestation.id = ?`,
      [attestationId]
    )
    if (!owner) throw new ModelNotFoundError('Routine Run cell attestation', attestationId)
    if (owner.completed_at !== null) {
      throw new ModelValidationError('Finalized Routine Run Subject cells cannot be changed')
    }
    if (issueMutation && input.issueFound !== true && followUpType !== 'none') {
      throw new ModelValidationError('Routine issue follow-up requires Issue found')
    }
    const changedAt = timestamp(now)
    const note = input.note ?? owner.note
    const resolutionChanged = input.resolution !== owner.resolution
    const attestedAt = input.resolution === 'pending'
      ? null
      : resolutionChanged
        ? changedAt
        : owner.attested_at

    this.database.transaction(() => {
      this.database.run(
        `UPDATE routine_review_cell_attestations
         SET resolution = ?, attested_at = ?, note = ?
         WHERE id = ?`,
        [input.resolution, attestedAt, note, attestationId]
      )
      if (issueMutation && input.issueFound === true) {
        this.database.run(
          `INSERT INTO routine_review_cell_issues (
             attestation_id, description, follow_up_type, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (attestation_id) DO UPDATE SET
             description = excluded.description,
             follow_up_type = excluded.follow_up_type,
             updated_at = excluded.updated_at`,
          [attestationId, input.issueDescription?.trim() ?? '', followUpType, changedAt, changedAt]
        )
      } else if (issueMutation) {
        this.database.run(
          'DELETE FROM routine_review_cell_issues WHERE attestation_id = ?',
          [attestationId]
        )
      }
      this.database.run(
        `UPDATE commitments SET updated_at = ?
         WHERE id = ? AND behavior_type = 'routine'`,
        [changedAt, Number(owner.routine_id)]
      )
    })
    return this.materialize(Number(owner.routine_id), localDate(now))
  }

  finalizeCell(cellId: number, now = new Date()): RoutineSnapshot {
    assertId(cellId, 'Routine Run Subject cell')
    const owner = this.database.get<CellOwnerRow>(
      `SELECT run.routine_id, run.id AS run_id, cell.completed_at
       FROM routine_review_cells cell
       JOIN routine_review_runs run ON run.id = cell.run_id
       WHERE cell.id = ?`,
      [cellId]
    )
    if (!owner) throw new ModelNotFoundError('Routine Run Subject cell', cellId)
    if (owner.completed_at !== null) {
      return this.materialize(Number(owner.routine_id), localDate(now))
    }
    const pendingRequired = Number(this.database.get<CountRow>(
      `SELECT count(*) AS count
       FROM routine_review_cell_attestations attestation
       JOIN routine_review_run_items item ON item.id = attestation.run_item_id
       WHERE attestation.cell_id = ?
         AND item.required = 1 AND attestation.resolution = 'pending'`,
      [cellId]
    )?.count ?? 0)
    if (pendingRequired > 0) {
      throw new ModelValidationError(
        'Every required Routine inspection must be attested or not applicable before finalizing'
      )
    }
    const changedAt = timestamp(now)
    this.database.transaction(() => {
      this.database.run(
        'UPDATE routine_review_cells SET completed_at = ? WHERE id = ? AND completed_at IS NULL',
        [changedAt, cellId]
      )
      const incompleteCells = Number(this.database.get<CountRow>(
        `SELECT count(*) AS count FROM routine_review_cells
         WHERE run_id = ? AND completed_at IS NULL`,
        [owner.run_id]
      )?.count ?? 0)
      if (incompleteCells === 0) {
        this.database.run(
          'UPDATE routine_review_runs SET completed_at = ? WHERE id = ? AND completed_at IS NULL',
          [changedAt, owner.run_id]
        )
      }
      this.database.run(
        `UPDATE commitments SET updated_at = ?
         WHERE id = ? AND behavior_type = 'routine'`,
        [changedAt, Number(owner.routine_id)]
      )
    })
    return this.materialize(Number(owner.routine_id), localDate(now))
  }

  delete(id: number): boolean {
    assertId(id, 'Routine')
    return this.database.run(
      "DELETE FROM commitments WHERE id = ? AND behavior_type = 'routine'",
      [id]
    ).changes > 0
  }

  private materializeOrNull(id: number, asOf: string): RoutineSnapshot | null {
    assertId(id, 'Routine')
    const row = this.row(id)
    if (!row) return null
    this.ensureScheduledRuns(row, asOf)
    const template = this.template(id, row.current_template_version)
    const runs = this.database.all<RunRow>(
      `SELECT id, scheduled_on, review_window_ends_on, template_version, scope_id,
              scope_name, scope_snapshot_json, completed_at, created_at
       FROM routine_review_runs WHERE routine_id = ?
       ORDER BY scheduled_on DESC, id DESC`,
      [id]
    ).map((run) => this.runSnapshot(run))
    const currentRun = runs[0] ?? null
    const latestCompleted = runs.find(({ completionDate }) => completionDate !== null) ?? null
    const status = this.deriveStatus(row, currentRun, latestCompleted, asOf)
    const nextReviewDate = currentRun?.completionDate === null
      ? currentRun.scheduledDate
      : this.nextScheduledDate(row, asOf)

    return {
      id: Number(row.id),
      parent: parentFromRow(row),
      type: 'routine',
      name: row.title,
      sensitive: Boolean(row.sensitive),
      needsAttestation: Boolean(row.needs_attestation),
      cadenceDays: Number(row.cadence_days),
      anchorDate: row.anchor_on,
      scope: this.currentScope(row.scope_id, asOf),
      status,
      nextReviewDate,
      nextScheduledDate: this.nextScheduledDate(row, asOf),
      overdueDays:
        currentRun?.completionDate === null ? daysBetween(currentRun.scheduledDate, asOf) : 0,
      template,
      currentRun,
      previousRuns: currentRun === null ? runs : runs.filter(({ id: runId }) => runId !== currentRun.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  private row(id: number): RoutineRow | null {
    return this.database.get<RoutineRow>(
      `SELECT commitment.id, commitment.focus_id, commitment.thread_id, commitment.title,
              commitment.sensitive, routine.needs_attestation, routine.cadence_days, routine.anchor_on,
              routine.schedule_effective_on, routine.scope_id,
              routine.current_template_version, commitment.created_at, commitment.updated_at
       FROM commitments commitment
       JOIN routine_definitions routine ON routine.commitment_id = commitment.id
       WHERE commitment.id = ? AND commitment.behavior_type = 'routine'`,
      [id]
    ) ?? null
  }

  private requireRow(id: number): RoutineRow {
    const row = this.row(id)
    if (!row) throw new ModelNotFoundError('Routine', id)
    return row
  }

  private template(routineId: number, version: number): RoutineTemplateSnapshot {
    const row = this.database.get<TemplateVersionRow>(
      `SELECT id, version, effective_at FROM routine_template_versions
       WHERE routine_id = ? AND version = ?`,
      [routineId, version]
    )
    if (!row) throw new ModelValidationError('Routine template version is missing')
    return {
      version: Number(row.version),
      effectiveAt: row.effective_at,
      items: this.database.all<TemplateItemRow>(
        `SELECT id, position, inspection, required FROM routine_template_items
         WHERE template_version_id = ? ORDER BY position`,
        [row.id]
      ).map((item) => ({
        id: Number(item.id),
        position: Number(item.position),
        inspection: item.inspection,
        required: Boolean(item.required)
      }))
    }
  }

  private insertTemplate(
    routineId: number,
    version: number,
    checklist: readonly { inspection: string; required: boolean }[],
    effectiveAt: string
  ): void {
    const result = this.database.run(
      `INSERT INTO routine_template_versions (routine_id, version, effective_at, created_at)
       VALUES (?, ?, ?, ?)`,
      [routineId, version, effectiveAt, effectiveAt]
    )
    checklist.forEach((item, position) => {
      this.database.run(
        `INSERT INTO routine_template_items (
           template_version_id, position, inspection, required
         ) VALUES (?, ?, ?, ?)`,
        [result.lastInsertRowid, position, item.inspection, item.required ? 1 : 0]
      )
    })
  }

  private ensureScheduledRuns(row: RoutineRow, asOf: string): void {
    let scheduled = row.anchor_on
    let iterations = 0
    while (scheduled < row.schedule_effective_on) {
      scheduled = addDays(scheduled, Number(row.cadence_days))
      if (++iterations > 10_000) {
        throw new ModelValidationError('Routine schedule exceeds the supported history')
      }
    }
    while (scheduled <= asOf) {
      this.ensureRun(row, scheduled)
      scheduled = addDays(scheduled, Number(row.cadence_days))
      if (++iterations > 10_000) {
        throw new ModelValidationError('Routine schedule exceeds the supported history')
      }
    }
  }

  private ensureRun(row: RoutineRow, scheduledDate: string): void {
    if (this.database.get<{ id: number }>(
      'SELECT id FROM routine_review_runs WHERE routine_id = ? AND scheduled_on = ?',
      [row.id, scheduledDate]
    )) return
    const templateVersion = this.database.get<TemplateVersionRow>(
      `SELECT id, version, effective_at FROM routine_template_versions
       WHERE routine_id = ? AND substr(effective_at, 1, 10) <= ?
       ORDER BY version DESC LIMIT 1`,
      [row.id, scheduledDate]
    ) ?? this.database.get<TemplateVersionRow>(
      `SELECT id, version, effective_at FROM routine_template_versions
       WHERE routine_id = ? ORDER BY version ASC LIMIT 1`,
      [row.id]
    )
    if (!templateVersion) throw new ModelValidationError('Routine template version is missing')
    const scope = this.currentScope(row.scope_id, scheduledDate)
    const createdAt = timestamp()
    this.database.transaction(() => {
      const inserted = this.database.run(
        `INSERT OR IGNORE INTO routine_review_runs (
           routine_id, scheduled_on, review_window_ends_on, template_version_id,
           template_version, scope_id, scope_name, scope_snapshot_json, completed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
          row.id,
          scheduledDate,
          addDays(scheduledDate, Number(row.cadence_days)),
          templateVersion.id,
          templateVersion.version,
          scope?.id ?? null,
          scope?.name ?? null,
          JSON.stringify(scope?.subjects ?? []),
          createdAt
        ]
      )
      if (inserted.changes === 0) return
      const items = this.database.all<TemplateItemRow>(
        `SELECT id, position, inspection, required FROM routine_template_items
         WHERE template_version_id = ? ORDER BY position`,
        [templateVersion.id]
      )
      const runItemIds: number[] = []
      for (const item of items) {
        const runItem = this.database.run(
          `INSERT INTO routine_review_run_items (
             run_id, template_item_id, position, inspection, required, resolution, attested_at
           ) VALUES (?, ?, ?, ?, ?, 'pending', NULL)`,
          [inserted.lastInsertRowid, item.id, item.position, item.inspection, item.required]
        )
        runItemIds.push(runItem.lastInsertRowid)
      }
      const subjects = scope?.subjects.length ? scope.subjects : [null]
      for (const subject of subjects) {
        const cell = this.database.run(
          `INSERT INTO routine_review_cells (
             run_id, subject_id, subject_name, completed_at, created_at
           ) VALUES (?, ?, ?, NULL, ?)`,
          [inserted.lastInsertRowid, subject?.id ?? null, subject?.name ?? null, createdAt]
        )
        for (const runItemId of runItemIds) {
          this.database.run(
            `INSERT INTO routine_review_cell_attestations (
               cell_id, run_item_id, resolution, attested_at
             ) VALUES (?, ?, 'pending', NULL)`,
            [cell.lastInsertRowid, runItemId]
          )
        }
      }
    })
  }

  private runSnapshot(row: RunRow): RoutineReviewRunSnapshot {
    const cells = this.database.all<CellRow>(
      `SELECT id, subject_id, subject_name, completed_at
       FROM routine_review_cells WHERE run_id = ?
       ORDER BY subject_name COLLATE NOCASE, id`,
      [row.id]
    ).map((cell) => {
      const items = this.database.all<RunItemRow>(
        `SELECT attestation.id, item.id AS run_item_id, item.position, item.inspection,
              item.required, attestation.resolution, attestation.attested_at,
              attestation.note,
              issue.id AS issue_id,
              issue.description AS issue_description,
              issue.follow_up_type AS issue_follow_up_type,
              issue.created_at AS issue_created_at
         FROM routine_review_cell_attestations attestation
         JOIN routine_review_run_items item ON item.id = attestation.run_item_id
         LEFT JOIN routine_review_cell_issues issue
           ON issue.attestation_id = attestation.id
         WHERE attestation.cell_id = ? ORDER BY item.position`,
        [cell.id]
      ).map((item) => this.runItemSnapshot(item))
      const required = items.filter((item) => item.required)
      return {
        id: Number(cell.id),
        subject: cell.subject_id === null
          ? null
          : { id: Number(cell.subject_id), name: cell.subject_name as string },
        completionDate: cell.completed_at?.slice(0, 10) ?? null,
        completedLate:
          cell.completed_at !== null && cell.completed_at.slice(0, 10) >= row.review_window_ends_on,
        progress: {
          complete: required.filter(({ resolution }) => resolution !== 'pending').length,
          required: required.length
        },
        items
      }
    })
    const scopeSubjects = JSON.parse(row.scope_snapshot_json) as Array<{ id: number; name: string }>
    const required = cells.reduce((total, cell) => total + cell.progress.required, 0)
    const complete = cells.reduce((total, cell) => total + cell.progress.complete, 0)
    return {
      id: Number(row.id),
      scheduledDate: row.scheduled_on,
      reviewWindowEndsDate: row.review_window_ends_on,
      completionDate: row.completed_at?.slice(0, 10) ?? null,
      completedLate:
        row.completed_at !== null && row.completed_at.slice(0, 10) >= row.review_window_ends_on,
      templateVersion: Number(row.template_version),
      scope: row.scope_name === null
        ? null
        : { id: Number(row.scope_id), name: row.scope_name, subjects: scopeSubjects },
      progress: {
        complete,
        required
      },
      cells,
      items: cells[0]?.items ?? []
    }
  }

  private runItemSnapshot(row: RunItemRow): RoutineRunItemSnapshot {
    return {
      id: Number(row.id),
      runItemId: Number(row.run_item_id),
      position: Number(row.position),
      inspection: row.inspection,
      required: Boolean(row.required),
      resolution: row.resolution as RoutineRunItemResolution,
      attestedAt: row.attested_at,
      note: row.note,
      issue: row.issue_id === null
        ? null
        : {
            id: Number(row.issue_id),
            description: row.issue_description ?? '',
            followUpType: (row.issue_follow_up_type ?? 'none') as RoutineIssueFollowUpType,
            createdAt: row.issue_created_at as string
          }
    }
  }

  private currentScope(scopeId: number | null, on: string): RoutineScopeSnapshot | null {
    if (scopeId === null) return null
    const scope = this.scopes.find(Number(scopeId))
    if (!scope) return null
    return {
      id: scope.id,
      name: scope.name,
      subjects: this.scopes.effectiveSubjects(scope.id, on).map(({ id, name }) => ({ id, name }))
    }
  }

  private deriveStatus(
    row: RoutineRow,
    currentRun: RoutineReviewRunSnapshot | null,
    latestCompleted: RoutineReviewRunSnapshot | null,
    asOf: string
  ): RoutineStatus {
    if (!row.needs_attestation) return 'green'
    if (currentRun === null || currentRun.completionDate !== null) return 'green'
    const lapsedBaseline = latestCompleted?.scheduledDate ?? row.anchor_on
    if (asOf >= addDays(lapsedBaseline, Number(row.cadence_days) * 2)) return 'red'
    return currentRun.scheduledDate < asOf ? 'yellow' : 'green'
  }

  private nextScheduledDate(row: RoutineRow, asOf: string): string {
    let next = row.anchor_on
    let iterations = 0
    while (next <= asOf || next < row.schedule_effective_on) {
      next = addDays(next, Number(row.cadence_days))
      if (++iterations > 10_000) {
        throw new ModelValidationError('Routine schedule exceeds the supported history')
      }
    }
    return next
  }

  private assertParent(parent: CommitmentParent): void {
    const table = parent.type === 'focus' ? 'focuses' : 'threads'
    if (!this.database.get<{ found: number }>(
      `SELECT 1 AS found FROM ${table} WHERE id = ?`,
      [parent.id]
    )) {
      throw new ModelNotFoundError(parent.type === 'focus' ? 'Focus' : 'Thread', parent.id)
    }
  }

  private assertScope(scopeId: number | null | undefined, parent: CommitmentParent): void {
    if (scopeId === null || scopeId === undefined) return
    assertId(scopeId, 'Scope')
    const scope = this.scopes.find(scopeId)
    if (!scope) throw new ModelNotFoundError('Scope', scopeId)
    const focusId = parent.type === 'focus'
      ? parent.id
      : Number(this.database.get<{ focus_id: number }>(
          'SELECT focus_id FROM threads WHERE id = ?',
          [parent.id]
        )?.focus_id)
    if (scope.focusId !== focusId) {
      throw new ModelValidationError('Routine Scope must belong to its Focus')
    }
  }
}
