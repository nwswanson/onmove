import {
  CANVAS_ENTITY_KINDS,
  HEALTH_STATES,
  type CanvasEntityDetails,
  type AddCanvasEntityReferenceInput,
  type CanvasEntityKind,
  type CanvasEntityReferenceSnapshot,
  type CanvasEntitySnapshot,
  type CanvasSnapshot,
  type CanvasSummarySnapshot,
  type JsonObject,
  type SaveCanvasDocumentInput
} from '../../shared/contracts'
import { richTextPlainText } from '../../shared/rich-text-value'
import { ModelNotFoundError, ModelValidationError } from './model'
import type { RoutineRepository } from './routine-model'
import type { SqliteAdapter } from './sqlite-adapter'

interface CanvasRow {
  id: number
  name: string
  data_json: string | null
  revision: number
  created_at: string
  updated_at: string
}

interface CanvasReferenceRow {
  canvas_id: number
  element_id: string
  entity_type: string
  entity_id: number
  cached_title: string
  cached_status: string | null
  cached_context: string
  entity_created_at: string
  effective_sensitive: number
  missing_since: string | null
  created_at: string
  updated_at: string
}

interface EntityRow {
  id: number
  title: string
  status: string | null
  focus_title: string
  thread_title: string | null
  commitment_title: string | null
  subject_name: string | null
  effective_sensitive: number
  created_at: string
  updated_at: string
  due_on?: string | null
  review_frequency_days?: number | null
  needs_review?: number | null
  last_update_date?: string | null
  state?: string | null
  content?: string | null
  completed_at?: string | null
  shared_across_subjects?: number | null
}

const CANVAS_COLUMNS = 'id, name, data_json, revision, created_at, updated_at'
const REFERENCE_COLUMNS = `canvas_id, element_id, entity_type, entity_id,
  cached_title, cached_status, cached_context, entity_created_at, effective_sensitive,
  missing_since, created_at, updated_at`

function assertId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError(`${label} id must be a positive integer`)
  }
}

function normalizeElementId(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new ModelValidationError('Canvas element id must be a valid Excalidraw element id')
  }
  return value
}

function normalizeKind(value: string): CanvasEntityKind {
  if (!CANVAS_ENTITY_KINDS.includes(value as CanvasEntityKind)) {
    throw new ModelValidationError(`Unsupported Canvas entity type: ${value}`)
  }
  return value as CanvasEntityKind
}

function encodeDocument(data: JsonObject): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ModelValidationError('Canvas data must be a JSON object')
  }
  try {
    const encoded = JSON.stringify(data)
    const decoded = JSON.parse(encoded) as unknown
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error()
    return encoded
  } catch {
    throw new ModelValidationError('Canvas data must contain only JSON-compatible values')
  }
}

function summaryFromRow(row: CanvasRow): CanvasSummarySnapshot {
  return {
    id: Number(row.id),
    name: row.name,
    revision: Number(row.revision),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function contextFromRow(row: EntityRow): string {
  const segments = [row.focus_title, row.thread_title, row.commitment_title]
    .filter((value): value is string => Boolean(value))
  const base = segments.join(' › ')
  return row.subject_name ? `${base} [${row.subject_name}]` : base
}

function entityFromRow(
  type: CanvasEntityKind,
  row: EntityRow,
  details: CanvasEntityDetails = {}
): CanvasEntitySnapshot {
  return {
    target: { type, id: Number(row.id) },
    title: row.title,
    status: row.status,
    context: contextFromRow(row),
    details,
    effectiveSensitive: Boolean(row.effective_sensitive),
    createdAt: row.created_at
  }
}

function referenceFromCache(row: CanvasReferenceRow): CanvasEntityReferenceSnapshot {
  return {
    elementId: row.element_id,
    target: {
      type: normalizeKind(row.entity_type),
      id: Number(row.entity_id)
    },
    title: row.cached_title,
    status: row.cached_status,
    context: row.cached_context,
    details: {},
    effectiveSensitive: Boolean(row.effective_sensitive),
    createdAt: row.entity_created_at,
    deleted: row.missing_since !== null,
    deletedAt: row.missing_since
  }
}

function healthState(value: string | null | undefined): CanvasEntityDetails['state'] {
  return HEALTH_STATES.includes(value as (typeof HEALTH_STATES)[number])
    ? value as CanvasEntityDetails['state']
    : undefined
}

function contentPreview(value: string | null | undefined): string | null {
  if (!value) return null
  const plain = richTextPlainText(value).replace(/\s+/g, ' ').trim()
  if (!plain) return null
  return plain.length <= 180 ? plain : `${plain.slice(0, 179)}…`
}

function timestamp(): string {
  return new Date().toISOString()
}

/**
 * Owns Canvas identity/document persistence and durable references to live
 * domain records. Excalidraw geometry remains opaque; entity meaning never does.
 */
export class CanvasRepository {
  constructor(
    private readonly database: SqliteAdapter,
    private readonly routines: RoutineRepository
  ) {}

  list(): CanvasSummarySnapshot[] {
    return this.database
      .all<CanvasRow>(`SELECT ${CANVAS_COLUMNS} FROM canvases ORDER BY id`)
      .map(summaryFromRow)
  }

  get(id: number): CanvasSnapshot {
    assertId(id, 'Canvas')
    const row = this.database.get<CanvasRow>(
      `SELECT ${CANVAS_COLUMNS} FROM canvases WHERE id = ?`,
      [id]
    )
    if (!row) throw new ModelNotFoundError('Canvas', id)

    const live = new Map(
      this.listEntities().map((entity) => [
        `${entity.target.type}:${entity.target.id}:${entity.createdAt}`,
        entity
      ])
    )
    const references = this.database.all<CanvasReferenceRow>(
      `SELECT ${REFERENCE_COLUMNS}
       FROM canvas_entity_references
       WHERE canvas_id = ?
       ORDER BY created_at, element_id`,
      [id]
    )

    const now = timestamp()
    const hydrated = this.database.transaction(() => references.map((reference) => {
      const target = {
        type: normalizeKind(reference.entity_type),
        id: Number(reference.entity_id)
      }
      const current = live.get(`${target.type}:${target.id}:${reference.entity_created_at}`)
      if (!current) {
        if (reference.missing_since === null) {
          this.database.run(
            `UPDATE canvas_entity_references
             SET missing_since = ?, updated_at = ?
             WHERE canvas_id = ? AND element_id = ?`,
            [now, now, id, reference.element_id]
          )
          reference.missing_since = now
        }
        return referenceFromCache(reference)
      }

      this.database.run(
        `UPDATE canvas_entity_references
         SET cached_title = ?, cached_status = ?, cached_context = ?,
             effective_sensitive = ?, missing_since = NULL, updated_at = ?
         WHERE canvas_id = ? AND element_id = ?`,
        [
          current.title,
          current.status,
          current.context,
          current.effectiveSensitive ? 1 : 0,
          now,
          id,
          reference.element_id
        ]
      )
      return {
        ...current,
        elementId: reference.element_id,
        deleted: false,
        deletedAt: null
      }
    }))

    return {
      ...summaryFromRow(row),
      data: row.data_json ? JSON.parse(row.data_json) as JsonObject : null,
      references: hydrated
    }
  }

  listEntities(): CanvasEntitySnapshot[] {
    const threads = this.database.all<EntityRow>(`
      SELECT thread.id, thread.title, thread.status,
             focus.title AS focus_title,
             NULL AS thread_title,
             NULL AS commitment_title,
             NULL AS subject_name, thread.created_at, thread.updated_at,
             thread.due_on, thread.review_frequency_days, thread.needs_review,
             (
               SELECT update_record.recorded_on FROM updates update_record
               WHERE update_record.thread_id = thread.id
               ORDER BY update_record.recorded_on DESC, update_record.id DESC LIMIT 1
             ) AS last_update_date,
             (
               SELECT update_record.state FROM updates update_record
               WHERE update_record.thread_id = thread.id
               ORDER BY update_record.recorded_on DESC, update_record.id DESC LIMIT 1
             ) AS state,
             (thread.sensitive OR focus.sensitive) AS effective_sensitive
      FROM threads thread
      JOIN focuses focus ON focus.id = thread.focus_id
    `).map((row) => entityFromRow('thread', row, {
      dueDate: row.due_on ?? null,
      state: healthState(row.state),
      reviewFrequencyDays: row.review_frequency_days ?? null,
      needsReview: Boolean(row.needs_review),
      lastUpdateDate: row.last_update_date ?? null,
      updatedAt: row.updated_at
    }))

    const commitmentRows = this.database.all<EntityRow>(`
      SELECT commitment.id, commitment.title, commitment.status,
             focus.title AS focus_title,
             thread.title AS thread_title,
             NULL AS commitment_title,
             NULL AS subject_name, commitment.created_at, commitment.updated_at,
             commitment.due_on, commitment.review_frequency_days, commitment.needs_review,
             (
               SELECT update_record.recorded_on FROM updates update_record
               WHERE update_record.commitment_id = commitment.id
               ORDER BY update_record.recorded_on DESC, update_record.id DESC LIMIT 1
             ) AS last_update_date,
             (
               SELECT update_record.state FROM updates update_record
               WHERE update_record.commitment_id = commitment.id
               ORDER BY update_record.recorded_on DESC, update_record.id DESC LIMIT 1
             ) AS state,
             (commitment.sensitive OR focus.sensitive OR
               COALESCE(thread.sensitive, 0)) AS effective_sensitive
      FROM commitments commitment
      LEFT JOIN threads thread ON thread.id = commitment.thread_id
      JOIN focuses focus ON focus.id = COALESCE(commitment.focus_id, thread.focus_id)
      WHERE commitment.behavior_type = 'tracking'
    `)
    const commitments = commitmentRows.map((row) => entityFromRow('commitment', row, {
      dueDate: row.due_on ?? null,
      state: healthState(row.state),
      reviewFrequencyDays: row.review_frequency_days ?? null,
      needsReview: Boolean(row.needs_review),
      lastUpdateDate: row.last_update_date ?? null,
      updatedAt: row.updated_at
    }))

    const routineById = new Map(this.routines.list().map((routine) => [routine.id, routine]))
    const routines = this.database.all<EntityRow>(`
      SELECT commitment.id, commitment.title, 'green' AS status,
             focus.title AS focus_title,
             thread.title AS thread_title,
             NULL AS commitment_title,
             NULL AS subject_name, commitment.created_at, commitment.updated_at,
             (commitment.sensitive OR focus.sensitive OR
               COALESCE(thread.sensitive, 0)) AS effective_sensitive
      FROM commitments commitment
      JOIN routine_definitions routine ON routine.commitment_id = commitment.id
      LEFT JOIN threads thread ON thread.id = commitment.thread_id
      JOIN focuses focus ON focus.id = COALESCE(commitment.focus_id, thread.focus_id)
      WHERE commitment.behavior_type = 'routine'
    `).map((row) => {
      const routine = routineById.get(Number(row.id))
      return entityFromRow('routine', {
        ...row,
        status: routine?.status ?? 'green'
      }, {
        nextReviewDate: routine?.nextReviewDate ?? null,
        nextScheduledDate: routine?.nextScheduledDate ?? null,
        needsReview: routine?.needsAttestation ?? false,
        scheduleWeekdays: routine?.scheduleWeekdays ?? [],
        progress: routine?.currentRun?.progress ?? null,
        updatedAt: row.updated_at
      })
    })

    const notes = this.database.all<EntityRow>(`
      SELECT note.id, note.title, NULL AS status,
             focus.title AS focus_title,
             thread.title AS thread_title,
             commitment.title AS commitment_title,
             NULL AS subject_name, note.created_at, note.updated_at, note.content,
             (focus.sensitive OR COALESCE(thread.sensitive, 0) OR
               COALESCE(commitment.sensitive, 0)) AS effective_sensitive
      FROM notes note
      LEFT JOIN commitments commitment ON commitment.id = note.commitment_id
      LEFT JOIN threads thread ON thread.id = COALESCE(
        note.thread_id,
        commitment.thread_id
      )
      JOIN focuses focus ON focus.id = COALESCE(
        note.focus_id,
        thread.focus_id,
        commitment.focus_id
      )
    `).map((row) => entityFromRow('note', row, {
      preview: contentPreview(row.content),
      updatedAt: row.updated_at
    }))

    const todos = this.database.all<EntityRow>(`
      SELECT todo.id, todo.name AS title,
             CASE WHEN todo.done = 1 THEN 'done' ELSE 'open' END AS status,
             focus.title AS focus_title,
             thread.title AS thread_title,
             commitment.title AS commitment_title,
             subject.name AS subject_name, todo.created_at, todo.updated_at,
             todo.due_on, todo.completed_at, todo.shared_across_subjects,
             (focus.sensitive OR COALESCE(thread.sensitive, 0) OR
               COALESCE(commitment.sensitive, 0) OR
               COALESCE(subject.sensitive, 0)) AS effective_sensitive
      FROM todos todo
      LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
      LEFT JOIN threads thread ON thread.id = COALESCE(
        todo.thread_id,
        commitment.thread_id
      )
      JOIN focuses focus ON focus.id = COALESCE(
        todo.focus_id,
        thread.focus_id,
        commitment.focus_id
      )
      LEFT JOIN subjects subject ON subject.id = todo.subject_id
    `).map((row) => entityFromRow('todo', row, {
      dueDate: row.due_on ?? null,
      subjectName: row.subject_name,
      sharedAcrossSubjects: Boolean(row.shared_across_subjects),
      completedAt: row.completed_at ?? null,
      updatedAt: row.updated_at
    }))

    return [...threads, ...commitments, ...notes, ...routines, ...todos].sort((left, right) =>
      left.target.type.localeCompare(right.target.type) ||
      left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }) ||
      left.target.id - right.target.id)
  }

  addEntityReference(
    canvasId: number,
    input: AddCanvasEntityReferenceInput
  ): CanvasEntityReferenceSnapshot {
    assertId(canvasId, 'Canvas')
    assertId(input.target.id, input.target.type)
    const elementId = normalizeElementId(input.elementId)
    const targetType = normalizeKind(input.target.type)
    if (!this.database.get('SELECT 1 AS found FROM canvases WHERE id = ?', [canvasId])) {
      throw new ModelNotFoundError('Canvas', canvasId)
    }
    const entity = this.listEntities().find(({ target }) =>
      target.type === targetType && target.id === input.target.id)
    if (!entity) throw new ModelNotFoundError(`Canvas ${targetType}`, input.target.id)
    const existing = this.database.get<CanvasReferenceRow>(
      `SELECT ${REFERENCE_COLUMNS}
       FROM canvas_entity_references
       WHERE canvas_id = ? AND entity_type = ? AND entity_id = ?
         AND entity_created_at = ?`,
      [canvasId, targetType, input.target.id, entity.createdAt]
    )
    if (existing) {
      throw new ModelValidationError(`${entity.title} is already on this Canvas`)
    }

    const now = timestamp()
    this.database.run(
      `INSERT INTO canvas_entity_references (
         canvas_id, element_id, entity_type, entity_id, cached_title,
         cached_status, cached_context, entity_created_at, effective_sensitive, missing_since,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        canvasId,
        elementId,
        targetType,
        input.target.id,
        entity.title,
        entity.status,
        entity.context,
        entity.createdAt,
        entity.effectiveSensitive ? 1 : 0,
        now,
        now
      ]
    )
    return {
      ...entity,
      elementId,
      deleted: false,
      deletedAt: null
    }
  }

  saveDocument(canvasId: number, input: SaveCanvasDocumentInput): CanvasSummarySnapshot {
    assertId(canvasId, 'Canvas')
    const data = encodeDocument(input.data)
    if (!Array.isArray(input.entityElementIds)) {
      throw new ModelValidationError('Canvas entity element ids must be an array')
    }
    const elementIds = input.entityElementIds.map(normalizeElementId)
    if (new Set(elementIds).size !== elementIds.length) {
      throw new ModelValidationError('Canvas entity element ids must be unique')
    }
    const now = timestamp()
    this.database.transaction(() => {
      const result = this.database.run(
        `UPDATE canvases
         SET data_json = ?, revision = revision + 1, updated_at = ?
         WHERE id = ?`,
        [data, now, canvasId]
      )
      if (result.changes === 0) throw new ModelNotFoundError('Canvas', canvasId)

      if (elementIds.length === 0) {
        this.database.run(
          'DELETE FROM canvas_entity_references WHERE canvas_id = ?',
          [canvasId]
        )
      } else {
        const placeholders = elementIds.map(() => '?').join(', ')
        this.database.run(
          `DELETE FROM canvas_entity_references
           WHERE canvas_id = ? AND element_id NOT IN (${placeholders})`,
          [canvasId, ...elementIds]
        )
      }
    })
    const row = this.database.get<CanvasRow>(
      `SELECT ${CANVAS_COLUMNS} FROM canvases WHERE id = ?`,
      [canvasId]
    ) as CanvasRow
    return summaryFromRow(row)
  }
}
