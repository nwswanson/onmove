import type {
  CreateItemInput,
  CreateRelationInput,
  ItemSnapshot,
  JsonObject,
  RelationSnapshot,
  SetItemStatusInput,
  StatusTransition
} from '../../shared/contracts'
import {
  BaseModel,
  BaseRepository,
  ModelNotFoundError,
  ModelValidationError
} from './model'
import type { SqliteAdapter } from './sqlite-adapter'
import { FocusRepository } from './focus'
import { CommitmentRepository, ThreadRepository, UpdateRepository } from './work-model'

type RelationRecord = RelationSnapshot

interface RelationRow {
  id: number
  name: string
  meta_json: string
  created_at: string
  updated_at: string
}

interface ItemRecord {
  id: number
  parentId: number | null
  relationId: number | null
  currentStatus: string | null
  statusChangedAt: string | null
  meta: JsonObject
  createdAt: string
  updatedAt: string
}

interface ItemRow {
  id: number
  parent_id: number | null
  relation_id: number | null
  current_status: string | null
  status_changed_at: string | null
  meta_json: string
  created_at: string
  updated_at: string
}

interface TransitionRow {
  id: number
  item_id: number
  from_status: string | null
  to_status: string | null
  changed_at: string
  meta_json: string
}

interface MaterializedItemRow extends ItemRow {
  relation_name: string | null
  relation_meta_json: string | null
  relation_created_at: string | null
  relation_updated_at: string | null
  transition_id: number | null
  transition_from_status: string | null
  transition_to_status: string | null
  transition_changed_at: string | null
  transition_meta_json: string | null
  transition_count: number
}

interface ExistsRow {
  found: number
}

function assertId(id: number, field = 'id'): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ModelValidationError(`${field} must be a positive integer`)
  }
}

function normalizeRequiredText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ModelValidationError(`${field} cannot be empty`)
  }
  return value.trim()
}

function normalizeStatus(value: string | null): string | null {
  return value === null ? null : normalizeRequiredText(value, 'status')
}

function encodeMeta(meta: JsonObject | undefined): string {
  const candidate = meta ?? {}
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new ModelValidationError('meta must be a JSON object')
  }

  try {
    const encoded = JSON.stringify(candidate)
    const decoded = JSON.parse(encoded) as unknown
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('not an object')
    }
    return encoded
  } catch {
    throw new ModelValidationError('meta must contain only JSON-compatible values')
  }
}

function decodeMeta(encoded: string): JsonObject {
  return JSON.parse(encoded) as JsonObject
}

function timestamp(): string {
  return new Date().toISOString()
}

function relationFromRow(row: RelationRow): RelationRecord {
  return {
    id: Number(row.id),
    name: row.name,
    meta: decodeMeta(row.meta_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function itemFromRow(row: ItemRow): ItemRecord {
  return {
    id: Number(row.id),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    relationId: row.relation_id === null ? null : Number(row.relation_id),
    currentStatus: row.current_status,
    statusChangedAt: row.status_changed_at,
    meta: decodeMeta(row.meta_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function transitionFromRow(row: TransitionRow): StatusTransition {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    from: row.from_status,
    to: row.to_status,
    changedAt: row.changed_at,
    meta: decodeMeta(row.meta_json)
  }
}

export class RelationModel extends BaseModel<RelationRecord> {
  constructor(
    private readonly repository: RelationRepository,
    record: RelationRecord
  ) {
    super(repository, record)
  }

  get name(): string {
    return this.record.name
  }

  get meta(): JsonObject {
    return structuredClone(this.record.meta)
  }

  rename(name: string): this {
    return this.replace(this.repository.update(this.id, { name }))
  }

  updateMeta(meta: JsonObject): this {
    return this.replace(this.repository.update(this.id, { meta }))
  }

  toSnapshot(): RelationSnapshot {
    return structuredClone(this.record)
  }
}

export class RelationRepository extends BaseRepository<RelationRecord, RelationModel> {
  constructor(private readonly database: SqliteAdapter) {
    super()
  }

  protected instantiate(record: RelationRecord): RelationModel {
    return new RelationModel(this, record)
  }

  create(input: CreateRelationInput): RelationModel {
    const now = timestamp()
    const result = this.database.run(
      `INSERT INTO relations (name, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [normalizeRequiredText(input.name, 'relation name'), encodeMeta(input.meta), now, now]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): RelationRecord | null {
    assertId(id)
    const row = this.database.get<RelationRow>(
      `SELECT id, name, meta_json, created_at, updated_at
       FROM relations WHERE id = ?`,
      [id]
    )
    return row ? relationFromRow(row) : null
  }

  update(id: number, changes: { name?: string; meta?: JsonObject }): RelationRecord {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Relation', id)

    this.database.run(
      `UPDATE relations SET name = ?, meta_json = ?, updated_at = ? WHERE id = ?`,
      [
        changes.name === undefined
          ? current.name
          : normalizeRequiredText(changes.name, 'relation name'),
        encodeMeta(changes.meta ?? current.meta),
        timestamp(),
        id
      ]
    )
    return this.find(id) as RelationRecord
  }

  delete(id: number): boolean {
    assertId(id)
    return this.database.run('DELETE FROM relations WHERE id = ?', [id]).changes > 0
  }
}

export class ItemModel extends BaseModel<ItemRecord> {
  constructor(
    private readonly repository: ItemRepository,
    record: ItemRecord
  ) {
    super(repository, record)
  }

  get parentId(): number | null {
    return this.record.parentId
  }

  get relationId(): number | null {
    return this.record.relationId
  }

  get currentStatus(): string | null {
    return this.record.currentStatus
  }

  get meta(): JsonObject {
    return structuredClone(this.record.meta)
  }

  moveTo(parentId: number | null): this {
    return this.replace(this.repository.move(this.id, parentId))
  }

  setRelation(relationId: number | null): this {
    return this.replace(this.repository.setRelation(this.id, relationId))
  }

  setStatus(input: SetItemStatusInput): this {
    return this.replace(this.repository.setStatus(this.id, input))
  }

  updateMeta(meta: JsonObject): this {
    return this.replace(this.repository.updateMeta(this.id, meta))
  }

  statusHistory(): StatusTransition[] {
    return this.repository.statusHistory(this.id)
  }

  materialize(): ItemSnapshot {
    const snapshot = this.repository.materialize(this.id)
    if (!snapshot) throw new ModelNotFoundError('Item', this.id)
    return snapshot
  }
}

export class ItemRepository extends BaseRepository<ItemRecord, ItemModel> {
  constructor(private readonly database: SqliteAdapter) {
    super()
  }

  protected instantiate(record: ItemRecord): ItemModel {
    return new ItemModel(this, record)
  }

  create(input: CreateItemInput = {}): ItemModel {
    if (input.parentId !== null && input.parentId !== undefined) {
      assertId(input.parentId, 'parentId')
      if (!this.find(input.parentId)) throw new ModelNotFoundError('Parent item', input.parentId)
    }
    if (input.relationId !== null && input.relationId !== undefined) {
      assertId(input.relationId, 'relationId')
      this.assertRelationExists(input.relationId)
    }

    const now = timestamp()
    const result = this.database.run(
      `INSERT INTO items (
         parent_id, relation_id, current_status, status_meta_json,
         meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.parentId ?? null,
        input.relationId ?? null,
        normalizeStatus(input.status ?? null),
        encodeMeta(input.statusMeta),
        encodeMeta(input.meta),
        now,
        now
      ]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): ItemRecord | null {
    assertId(id)
    const row = this.database.get<ItemRow>(
      `SELECT id, parent_id, relation_id, current_status, status_changed_at,
              meta_json, created_at, updated_at
       FROM items WHERE id = ?`,
      [id]
    )
    return row ? itemFromRow(row) : null
  }

  delete(id: number): boolean {
    assertId(id)
    return this.database.run('DELETE FROM items WHERE id = ?', [id]).changes > 0
  }

  move(id: number, parentId: number | null): ItemRecord {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Item', id)

    if (parentId !== null) {
      assertId(parentId, 'parentId')
      const invalidParent = this.database.get<ExistsRow>(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM items WHERE id = ?
           UNION ALL
           SELECT child.id FROM items child
           JOIN subtree ON child.parent_id = subtree.id
         )
         SELECT 1 AS found FROM subtree WHERE id = ? LIMIT 1`,
        [id, parentId]
      )
      if (invalidParent) {
        throw new ModelValidationError('an item cannot be moved beneath itself or a descendant')
      }

      if (!this.find(parentId)) throw new ModelNotFoundError('Parent item', parentId)
    }

    this.database.run('UPDATE items SET parent_id = ?, updated_at = ? WHERE id = ?', [
      parentId,
      timestamp(),
      id
    ])
    return this.find(id) as ItemRecord
  }

  setRelation(id: number, relationId: number | null): ItemRecord {
    if (!this.find(id)) throw new ModelNotFoundError('Item', id)
    if (relationId !== null) {
      assertId(relationId, 'relationId')
      this.assertRelationExists(relationId)
    }

    this.database.run('UPDATE items SET relation_id = ?, updated_at = ? WHERE id = ?', [
      relationId,
      timestamp(),
      id
    ])
    return this.find(id) as ItemRecord
  }

  setStatus(id: number, input: SetItemStatusInput): ItemRecord {
    if (!this.find(id)) throw new ModelNotFoundError('Item', id)

    this.database.run(
      `UPDATE items
       SET current_status = ?, status_meta_json = ?, updated_at = ?
       WHERE id = ?`,
      [normalizeStatus(input.status), encodeMeta(input.meta), timestamp(), id]
    )
    return this.find(id) as ItemRecord
  }

  updateMeta(id: number, meta: JsonObject): ItemRecord {
    if (!this.find(id)) throw new ModelNotFoundError('Item', id)
    this.database.run('UPDATE items SET meta_json = ?, updated_at = ? WHERE id = ?', [
      encodeMeta(meta),
      timestamp(),
      id
    ])
    return this.find(id) as ItemRecord
  }

  statusHistory(id: number): StatusTransition[] {
    if (!this.find(id)) throw new ModelNotFoundError('Item', id)
    return this.database
      .all<TransitionRow>(
        `SELECT id, item_id, from_status, to_status, changed_at, meta_json
         FROM status_transitions WHERE item_id = ? ORDER BY id`,
        [id]
      )
      .map(transitionFromRow)
  }

  materialize(id: number): ItemSnapshot | null {
    assertId(id)
    const rows = this.database.all<MaterializedItemRow>(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM items WHERE id = ?
         UNION ALL
         SELECT child.id FROM items child
         JOIN subtree ON child.parent_id = subtree.id
       )
       SELECT
         item.id,
         item.parent_id,
         item.relation_id,
         item.current_status,
         item.status_changed_at,
         item.meta_json,
         item.created_at,
         item.updated_at,
         relation.name AS relation_name,
         relation.meta_json AS relation_meta_json,
         relation.created_at AS relation_created_at,
         relation.updated_at AS relation_updated_at,
         transition.id AS transition_id,
         transition.from_status AS transition_from_status,
         transition.to_status AS transition_to_status,
         transition.changed_at AS transition_changed_at,
         transition.meta_json AS transition_meta_json,
         (
           SELECT count(*) FROM status_transitions count_transition
           WHERE count_transition.item_id = item.id
         ) AS transition_count
       FROM items item
       JOIN subtree ON subtree.id = item.id
       LEFT JOIN relations relation ON relation.id = item.relation_id
       LEFT JOIN status_transitions transition ON transition.id = (
         SELECT latest.id FROM status_transitions latest
         WHERE latest.item_id = item.id ORDER BY latest.id DESC LIMIT 1
       )
       ORDER BY item.id`,
      [id]
    )
    if (rows.length === 0) return null

    const snapshots = new Map<number, ItemSnapshot>()
    for (const row of rows) {
      const relation: RelationSnapshot | null =
        row.relation_id === null
          ? null
          : {
              id: Number(row.relation_id),
              name: row.relation_name as string,
              meta: decodeMeta(row.relation_meta_json as string),
              createdAt: row.relation_created_at as string,
              updatedAt: row.relation_updated_at as string
            }
      const lastTransition: StatusTransition | null =
        row.transition_id === null
          ? null
          : {
              id: Number(row.transition_id),
              itemId: Number(row.id),
              from: row.transition_from_status,
              to: row.transition_to_status,
              changedAt: row.transition_changed_at as string,
              meta: decodeMeta(row.transition_meta_json as string)
            }

      snapshots.set(Number(row.id), {
        id: Number(row.id),
        parentId: row.parent_id === null ? null : Number(row.parent_id),
        relationId: row.relation_id === null ? null : Number(row.relation_id),
        relation,
        meta: decodeMeta(row.meta_json),
        status: {
          current: row.current_status,
          previous: lastTransition?.from ?? null,
          changedAt: row.status_changed_at,
          transitionCount: Number(row.transition_count),
          lastTransition
        },
        items: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    }

    for (const snapshot of snapshots.values()) {
      if (snapshot.id === id || snapshot.parentId === null) continue
      snapshots.get(snapshot.parentId)?.items.push(snapshot)
    }
    return snapshots.get(id) ?? null
  }

  private assertRelationExists(id: number): void {
    const relation = this.database.get<ExistsRow>(
      'SELECT 1 AS found FROM relations WHERE id = ?',
      [id]
    )
    if (!relation) throw new ModelNotFoundError('Relation', id)
  }
}

export class DomainStore {
  readonly relations: RelationRepository
  readonly items: ItemRepository
  readonly focuses: FocusRepository
  readonly threads: ThreadRepository
  readonly commitments: CommitmentRepository
  readonly updates: UpdateRepository

  constructor(database: SqliteAdapter) {
    this.relations = new RelationRepository(database)
    this.items = new ItemRepository(database)
    this.focuses = new FocusRepository(database)
    this.threads = new ThreadRepository(database)
    this.commitments = new CommitmentRepository(database)
    this.updates = new UpdateRepository(database)
  }
}
