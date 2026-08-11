import {
  SCOPE_MEMBERSHIP_EFFECTS,
  SCOPE_MODES,
  SCOPE_SOURCE_TYPES,
  type AddFocusScopeSubjectInput,
  type CreateScopeInput,
  type CreateScopeMembershipInput,
  type CreateSubjectInput,
  type EndScopeMembershipInput,
  type FocusScopeSnapshot,
  type ScopeApplicationSnapshot,
  type ScopeApplicationState,
  type ScopeApplicationTransition,
  type ScopeMembershipEffect,
  type ScopeMembershipSnapshot,
  type ScopeMode,
  type ScopeOwner,
  type ScopeSnapshot,
  type ScopeSourceType,
  type SetScopeApplicationInput,
  type SubjectSnapshot,
  type ThreadScopeSnapshot,
  type UpdateScopeInput,
  type UpdateSubjectInput
} from '../../shared/contracts'
import { BaseModel, BaseRepository, ModelNotFoundError, ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'

interface SubjectRow {
  id: number
  kind: string
  name: string
  description: string | null
  external_key: string | null
  sensitive: number
  created_at: string
  updated_at: string
}

interface ScopeRow {
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

interface ScopeMembershipRow {
  id: number
  scope_id: number
  subject_id: number
  effect: string
  effective_from: string
  effective_until: string | null
  created_at: string
}

interface ApplicationRow {
  mode: string
  scope_id: number | null
  updated_at: string
}

interface ApplicationTransitionRow {
  id: number
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  from_mode: string | null
  from_scope_id: number | null
  to_mode: string
  to_scope_id: number | null
  changed_at: string
}

interface ThreadOwnerRow {
  focus_id: number
}

interface CommitmentOwnerRow {
  focus_id: number | null
  thread_id: number | null
  thread_focus_id: number | null
}

interface ExistsRow {
  found: number
}

function assertId(id: number, field: string): void {
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

function normalizeOptionalText(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined) return null
  const normalized = value.trim()
  if (normalized.length === 0) throw new ModelValidationError(`${field} cannot be empty`)
  return normalized
}

function normalizeSensitive(value: boolean | undefined, field: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new ModelValidationError(`${field} must be a boolean`)
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

function timestamp(now = new Date()): string {
  return now.toISOString()
}

function subjectFromRow(row: SubjectRow): SubjectSnapshot {
  return {
    id: Number(row.id),
    kind: row.kind,
    name: row.name,
    description: row.description,
    externalKey: row.external_key,
    sensitive: Boolean(row.sensitive),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function scopeFromRow(row: ScopeRow): ScopeSnapshot {
  return {
    id: Number(row.id),
    focusId: Number(row.focus_id),
    name: row.name,
    dimension: row.dimension,
    sourceType: row.source_type as ScopeSourceType,
    baseScopeId: row.base_scope_id === null ? null : Number(row.base_scope_id),
    derivedRelationship: row.derived_relationship,
    contextSubjectId:
      row.context_subject_id === null ? null : Number(row.context_subject_id),
    sensitive: Boolean(row.sensitive),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function membershipFromRow(row: ScopeMembershipRow): ScopeMembershipSnapshot {
  return {
    id: Number(row.id),
    scopeId: Number(row.scope_id),
    subjectId: Number(row.subject_id),
    effect: row.effect as ScopeMembershipEffect,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    createdAt: row.created_at
  }
}

function applicationState(mode: string, scopeId: number | null): ScopeApplicationState {
  return {
    mode: mode as ScopeMode,
    scopeId: scopeId === null ? null : Number(scopeId)
  }
}

function applicationTransitionFromRow(row: ApplicationTransitionRow): ScopeApplicationTransition {
  const owner: ScopeOwner = row.focus_id !== null
    ? { type: 'focus', id: Number(row.focus_id) }
    : row.thread_id !== null
      ? { type: 'thread', id: Number(row.thread_id) }
      : { type: 'commitment', id: Number(row.commitment_id) }
  return {
    id: Number(row.id),
    owner,
    from: row.from_mode === null
      ? null
      : applicationState(row.from_mode, row.from_scope_id),
    to: applicationState(row.to_mode, row.to_scope_id),
    changedAt: row.changed_at
  }
}

export class SubjectModel extends BaseModel<SubjectSnapshot> {
  constructor(
    private readonly repository: SubjectRepository,
    record: SubjectSnapshot
  ) {
    super(repository, record)
  }

  get name(): string {
    return this.record.name
  }

  update(input: UpdateSubjectInput): this {
    return this.replace(this.repository.update(this.id, input))
  }

  toSnapshot(): SubjectSnapshot {
    return structuredClone(this.record)
  }
}

export class SubjectRepository extends BaseRepository<SubjectSnapshot, SubjectModel> {
  constructor(private readonly database: SqliteAdapter) {
    super()
  }

  protected instantiate(record: SubjectSnapshot): SubjectModel {
    return new SubjectModel(this, record)
  }

  create(input: CreateSubjectInput, now = new Date()): SubjectModel {
    const createdAt = timestamp(now)
    const result = this.database.run(
      `INSERT INTO subjects (
         kind, name, description, external_key, sensitive, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizeRequiredText(input.kind ?? 'generic', 'subject kind'),
        normalizeRequiredText(input.name, 'subject name'),
        input.description ?? null,
        normalizeOptionalText(input.externalKey, 'subject external key'),
        normalizeSensitive(input.sensitive, 'subject sensitive') ? 1 : 0,
        createdAt,
        createdAt
      ]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): SubjectSnapshot | null {
    assertId(id, 'subject id')
    const row = this.database.get<SubjectRow>(
      `SELECT id, kind, name, description, external_key, sensitive, created_at, updated_at
       FROM subjects WHERE id = ?`,
      [id]
    )
    return row ? subjectFromRow(row) : null
  }

  list(): SubjectSnapshot[] {
    return this.database
      .all<SubjectRow>(
        `SELECT id, kind, name, description, external_key, sensitive, created_at, updated_at
         FROM subjects ORDER BY kind, name, id`
      )
      .map(subjectFromRow)
  }

  update(id: number, input: UpdateSubjectInput): SubjectSnapshot {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Subject', id)
    this.database.run(
      `UPDATE subjects
       SET kind = ?, name = ?, description = ?, external_key = ?, sensitive = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.kind === undefined
          ? current.kind
          : normalizeRequiredText(input.kind, 'subject kind'),
        input.name === undefined
          ? current.name
          : normalizeRequiredText(input.name, 'subject name'),
        input.description === undefined ? current.description : input.description,
        input.externalKey === undefined
          ? current.externalKey
          : normalizeOptionalText(input.externalKey, 'subject external key'),
        input.sensitive === undefined
          ? (current.sensitive ? 1 : 0)
          : (normalizeSensitive(input.sensitive, 'subject sensitive') ? 1 : 0),
        timestamp(),
        id
      ]
    )
    return this.find(id) as SubjectSnapshot
  }

  delete(id: number): boolean {
    assertId(id, 'subject id')
    const referenced = this.database.get<ExistsRow>(
      `SELECT 1 AS found
       WHERE EXISTS (SELECT 1 FROM scope_memberships WHERE subject_id = ?)
          OR EXISTS (SELECT 1 FROM scopes WHERE context_subject_id = ?)
          OR EXISTS (SELECT 1 FROM updates WHERE subject_id = ?)
          OR EXISTS (SELECT 1 FROM todos WHERE subject_id = ?)
          OR EXISTS (SELECT 1 FROM todo_subject_completions WHERE subject_id = ?)`,
      [id, id, id, id, id]
    )
    if (referenced) {
      throw new ModelValidationError(
        `Subject ${id} cannot be deleted while Scope or Update history references it`
      )
    }
    return this.database.run('DELETE FROM subjects WHERE id = ?', [id]).changes > 0
  }
}

export class ScopeModel extends BaseModel<ScopeSnapshot> {
  constructor(
    private readonly repository: ScopeRepository,
    record: ScopeSnapshot
  ) {
    super(repository, record)
  }

  get name(): string {
    return this.record.name
  }

  update(input: UpdateScopeInput): this {
    return this.replace(this.repository.update(this.id, input))
  }

  effectiveSubjects(on?: string): SubjectSnapshot[] {
    return this.repository.effectiveSubjects(this.id, on)
  }

  toSnapshot(): ScopeSnapshot {
    return structuredClone(this.record)
  }
}

export class ScopeRepository extends BaseRepository<ScopeSnapshot, ScopeModel> {
  private readonly subjects: SubjectRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.subjects = new SubjectRepository(database)
  }

  protected instantiate(record: ScopeSnapshot): ScopeModel {
    return new ScopeModel(this, record)
  }

  create(input: CreateScopeInput, now = new Date()): ScopeModel {
    assertId(input.focusId, 'focus id')
    this.assertExists('focuses', input.focusId, 'Focus')
    const sourceType = this.normalizeSourceType(input.sourceType)
    const baseScopeId = input.baseScopeId ?? null
    const definition = this.validateDefinition({
      focusId: input.focusId,
      dimension: normalizeRequiredText(input.dimension, 'scope dimension'),
      sourceType,
      baseScopeId,
      derivedRelationship: input.derivedRelationship ?? null,
      contextSubjectId: input.contextSubjectId ?? null
    })
    const createdAt = timestamp(now)
    const result = this.database.run(
      `INSERT INTO scopes (
         focus_id, name, dimension, source_type, base_scope_id,
         derived_relationship, context_subject_id, sensitive, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.focusId,
        normalizeRequiredText(input.name, 'scope name'),
        definition.dimension,
        definition.sourceType,
        definition.baseScopeId,
        definition.derivedRelationship,
        definition.contextSubjectId,
        normalizeSensitive(input.sensitive, 'scope sensitive') ? 1 : 0,
        createdAt,
        createdAt
      ]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): ScopeSnapshot | null {
    assertId(id, 'scope id')
    const row = this.database.get<ScopeRow>(
      `SELECT id, focus_id, name, dimension, source_type, base_scope_id,
              derived_relationship, context_subject_id, sensitive, created_at, updated_at
       FROM scopes WHERE id = ?`,
      [id]
    )
    return row ? scopeFromRow(row) : null
  }

  listForFocus(focusId: number): ScopeSnapshot[] {
    assertId(focusId, 'focus id')
    return this.database
      .all<ScopeRow>(
        `SELECT id, focus_id, name, dimension, source_type, base_scope_id,
                derived_relationship, context_subject_id, sensitive, created_at, updated_at
         FROM scopes WHERE focus_id = ? ORDER BY dimension, name, id`,
        [focusId]
      )
      .map(scopeFromRow)
  }

  update(id: number, input: UpdateScopeInput): ScopeSnapshot {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Scope', id)
    const nextDimension = input.dimension === undefined
      ? current.dimension
      : normalizeRequiredText(input.dimension, 'scope dimension')
    if (nextDimension !== current.dimension) {
      const usedAsBase = this.database.get<ExistsRow>(
        'SELECT 1 AS found FROM scopes WHERE base_scope_id = ? LIMIT 1',
        [id]
      )
      if (usedAsBase) {
        throw new ModelValidationError(
          'a Scope dimension cannot change while another Scope uses it as a base'
        )
      }
    }
    const definition = this.validateDefinition(
      {
        focusId: current.focusId,
        dimension: nextDimension,
        sourceType: current.sourceType,
        baseScopeId: input.baseScopeId === undefined ? current.baseScopeId : input.baseScopeId,
        derivedRelationship:
          input.derivedRelationship === undefined
            ? current.derivedRelationship
            : input.derivedRelationship,
        contextSubjectId:
          input.contextSubjectId === undefined
            ? current.contextSubjectId
            : input.contextSubjectId
      },
      id
    )
    const structureChanged =
      definition.dimension !== current.dimension ||
      definition.baseScopeId !== current.baseScopeId ||
      definition.derivedRelationship !== current.derivedRelationship ||
      definition.contextSubjectId !== current.contextSubjectId
    if (structureChanged && this.hasDurableUse(id)) {
      throw new ModelValidationError(
        'Scope structure cannot change after membership, applicability, or history exists; create a new Scope instead'
      )
    }
    this.database.run(
      `UPDATE scopes
       SET name = ?, dimension = ?, base_scope_id = ?, derived_relationship = ?,
           context_subject_id = ?, sensitive = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name === undefined
          ? current.name
          : normalizeRequiredText(input.name, 'scope name'),
        definition.dimension,
        definition.baseScopeId,
        definition.derivedRelationship,
        definition.contextSubjectId,
        input.sensitive === undefined
          ? (current.sensitive ? 1 : 0)
          : (normalizeSensitive(input.sensitive, 'scope sensitive') ? 1 : 0),
        timestamp(),
        id
      ]
    )
    return this.find(id) as ScopeSnapshot
  }

  effectiveSubjects(scopeId: number, on = today()): SubjectSnapshot[] {
    const date = normalizeDate(on, 'effective date')
    const subjectIds = this.resolveEffectiveSubjectIds(scopeId, date, new Set())
    return [...subjectIds]
      .map((id) => this.subjects.find(id))
      .filter((subject): subject is SubjectSnapshot => subject !== null)
      .sort((left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.name.localeCompare(right.name) ||
        left.id - right.id
      )
  }

  isEffectiveMember(scopeId: number, subjectId: number, on: string): boolean {
    assertId(subjectId, 'subject id')
    return this.resolveEffectiveSubjectIds(
      scopeId,
      normalizeDate(on, 'effective date'),
      new Set()
    ).has(subjectId)
  }

  delete(id: number): boolean {
    assertId(id, 'scope id')
    const historical = this.database.get<ExistsRow>(
      `SELECT 1 AS found
       WHERE EXISTS (SELECT 1 FROM updates WHERE scope_id = ?)
          OR EXISTS (SELECT 1 FROM todos WHERE scope_id = ?)
          OR EXISTS (
            SELECT 1 FROM scope_application_transitions
            WHERE from_scope_id = ? OR to_scope_id = ?
          )`,
      [id, id, id, id]
    )
    if (historical) {
      throw new ModelValidationError(
        `Scope ${id} cannot be deleted while Update or applicability history references it`
      )
    }
    return this.database.run('DELETE FROM scopes WHERE id = ?', [id]).changes > 0
  }

  private hasDurableUse(id: number): boolean {
    return Boolean(this.database.get<ExistsRow>(
      `SELECT 1 AS found
       WHERE EXISTS (SELECT 1 FROM scope_memberships WHERE scope_id = ?)
          OR EXISTS (SELECT 1 FROM updates WHERE scope_id = ?)
          OR EXISTS (SELECT 1 FROM todos WHERE scope_id = ?)
          OR EXISTS (SELECT 1 FROM scopes WHERE base_scope_id = ?)
          OR EXISTS (SELECT 1 FROM focus_scope_applications WHERE scope_id = ?)
          OR EXISTS (SELECT 1 FROM thread_scope_applications WHERE scope_id = ?)
          OR EXISTS (SELECT 1 FROM commitment_scope_applications WHERE scope_id = ?)
          OR EXISTS (
            SELECT 1 FROM scope_application_transitions
            WHERE from_scope_id = ? OR to_scope_id = ?
          )`,
      [id, id, id, id, id, id, id, id, id]
    ))
  }

  private normalizeSourceType(value: ScopeSourceType | undefined): ScopeSourceType {
    const sourceType = value ?? 'explicit'
    if (!SCOPE_SOURCE_TYPES.includes(sourceType)) {
      throw new ModelValidationError(`unsupported scope source type: ${sourceType}`)
    }
    return sourceType
  }

  private validateDefinition(
    definition: {
      focusId: number
      dimension: string
      sourceType: ScopeSourceType
      baseScopeId: number | null
      derivedRelationship: string | null
      contextSubjectId: number | null
    },
    currentScopeId?: number
  ): typeof definition {
    const baseScopeId = definition.baseScopeId
    if (baseScopeId !== null) {
      assertId(baseScopeId, 'base scope id')
      if (baseScopeId === currentScopeId) {
        throw new ModelValidationError('a Scope cannot use itself as its base')
      }
      const base = this.find(baseScopeId)
      if (!base) throw new ModelNotFoundError('Scope', baseScopeId)
      if (base.focusId !== definition.focusId) {
        throw new ModelValidationError('a base Scope must belong to the same Focus')
      }
      if (base.dimension !== definition.dimension) {
        throw new ModelValidationError('a base Scope must use the same dimension')
      }
      if (currentScopeId !== undefined) this.assertNoBaseCycle(currentScopeId, baseScopeId)
    }

    if (definition.sourceType === 'explicit') {
      if (definition.derivedRelationship !== null || definition.contextSubjectId !== null) {
        throw new ModelValidationError(
          'an explicit Scope cannot declare a derived relationship or context Subject'
        )
      }
      return { ...definition, baseScopeId }
    }

    const derivedRelationship = normalizeRequiredText(
      definition.derivedRelationship ?? '',
      'derived relationship'
    )
    const contextSubjectId = definition.contextSubjectId
    if (contextSubjectId === null) {
      throw new ModelValidationError('a derived Scope requires a context Subject')
    }
    assertId(contextSubjectId, 'context subject id')
    if (!this.subjects.find(contextSubjectId)) {
      throw new ModelNotFoundError('Subject', contextSubjectId)
    }
    return {
      ...definition,
      baseScopeId,
      derivedRelationship,
      contextSubjectId
    }
  }

  private assertNoBaseCycle(scopeId: number, baseScopeId: number): void {
    const visited = new Set<number>([scopeId])
    let candidate: number | null = baseScopeId
    while (candidate !== null) {
      if (visited.has(candidate)) {
        throw new ModelValidationError('Scope base relationships cannot contain a cycle')
      }
      visited.add(candidate)
      candidate = this.find(candidate)?.baseScopeId ?? null
    }
  }

  private resolveEffectiveSubjectIds(
    scopeId: number,
    on: string,
    path: Set<number>
  ): Set<number> {
    const scope = this.find(scopeId)
    if (!scope) throw new ModelNotFoundError('Scope', scopeId)
    if (path.has(scopeId)) {
      throw new ModelValidationError('Scope base relationships cannot contain a cycle')
    }
    const nextPath = new Set(path).add(scopeId)
    const result = scope.baseScopeId === null
      ? new Set<number>()
      : this.resolveEffectiveSubjectIds(scope.baseScopeId, on, nextPath)
    const memberships = this.database.all<ScopeMembershipRow>(
      `SELECT id, scope_id, subject_id, effect, effective_from, effective_until, created_at
       FROM scope_memberships
       WHERE scope_id = ?
         AND effective_from <= ?
         AND (effective_until IS NULL OR effective_until > ?)
       ORDER BY id`,
      [scopeId, on, on]
    )
    for (const membership of memberships.filter(({ effect }) => effect === 'include')) {
      const subjectId = Number(membership.subject_id)
      result.add(subjectId)
    }
    for (const membership of memberships.filter(({ effect }) => effect === 'exclude')) {
      result.delete(Number(membership.subject_id))
    }
    return result
  }

  private assertExists(table: 'focuses', id: number, modelName: string): void {
    const row = this.database.get<ExistsRow>(
      `SELECT 1 AS found FROM ${table} WHERE id = ?`,
      [id]
    )
    if (!row) throw new ModelNotFoundError(modelName, id)
  }
}

export class ScopeMembershipModel extends BaseModel<ScopeMembershipSnapshot> {
  constructor(
    private readonly repository: ScopeMembershipRepository,
    record: ScopeMembershipSnapshot
  ) {
    super(repository, record)
  }

  toSnapshot(): ScopeMembershipSnapshot {
    return structuredClone(this.record)
  }

  end(input: EndScopeMembershipInput): this {
    return this.replace(this.repository.end(this.id, input))
  }
}

export class ScopeMembershipRepository extends BaseRepository<
  ScopeMembershipSnapshot,
  ScopeMembershipModel
> {
  private readonly scopes: ScopeRepository
  private readonly subjects: SubjectRepository

  constructor(private readonly database: SqliteAdapter) {
    super()
    this.scopes = new ScopeRepository(database)
    this.subjects = new SubjectRepository(database)
  }

  protected instantiate(record: ScopeMembershipSnapshot): ScopeMembershipModel {
    return new ScopeMembershipModel(this, record)
  }

  create(input: CreateScopeMembershipInput, now = new Date()): ScopeMembershipModel {
    assertId(input.scopeId, 'scope id')
    assertId(input.subjectId, 'subject id')
    if (!this.scopes.find(input.scopeId)) throw new ModelNotFoundError('Scope', input.scopeId)
    if (!this.subjects.find(input.subjectId)) {
      throw new ModelNotFoundError('Subject', input.subjectId)
    }
    const effect = input.effect ?? 'include'
    if (!SCOPE_MEMBERSHIP_EFFECTS.includes(effect)) {
      throw new ModelValidationError(`unsupported Scope membership effect: ${effect}`)
    }
    const effectiveFrom = normalizeDate(input.effectiveFrom ?? today(now), 'effectiveFrom')
    const effectiveUntil = input.effectiveUntil === null || input.effectiveUntil === undefined
      ? null
      : normalizeDate(input.effectiveUntil, 'effectiveUntil')
    if (effectiveUntil !== null && effectiveUntil <= effectiveFrom) {
      throw new ModelValidationError('effectiveUntil must be after effectiveFrom')
    }
    const overlap = this.database.get<ExistsRow>(
      `SELECT 1 AS found FROM scope_memberships
       WHERE scope_id = ? AND subject_id = ? AND effect = ?
         AND effective_from < COALESCE(?, '9999-12-31')
         AND (effective_until IS NULL OR effective_until > ?)
       LIMIT 1`,
      [input.scopeId, input.subjectId, effect, effectiveUntil, effectiveFrom]
    )
    if (overlap) {
      throw new ModelValidationError(
        'Scope membership intervals with the same effect cannot overlap'
      )
    }
    const result = this.database.run(
      `INSERT INTO scope_memberships (
         scope_id, subject_id, effect, effective_from, effective_until, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [input.scopeId, input.subjectId, effect, effectiveFrom, effectiveUntil, timestamp(now)]
    )
    return this.requireModel(result.lastInsertRowid)
  }

  find(id: number): ScopeMembershipSnapshot | null {
    assertId(id, 'Scope membership id')
    const row = this.database.get<ScopeMembershipRow>(
      `SELECT id, scope_id, subject_id, effect, effective_from, effective_until, created_at
       FROM scope_memberships WHERE id = ?`,
      [id]
    )
    return row ? membershipFromRow(row) : null
  }

  listForScope(scopeId: number): ScopeMembershipSnapshot[] {
    assertId(scopeId, 'scope id')
    return this.database
      .all<ScopeMembershipRow>(
        `SELECT id, scope_id, subject_id, effect, effective_from, effective_until, created_at
         FROM scope_memberships WHERE scope_id = ? ORDER BY effective_from, id`,
        [scopeId]
      )
      .map(membershipFromRow)
  }

  end(id: number, input: EndScopeMembershipInput): ScopeMembershipSnapshot {
    const current = this.find(id)
    if (!current) throw new ModelNotFoundError('Scope membership', id)
    const effectiveUntil = normalizeDate(input.effectiveUntil, 'effectiveUntil')
    if (effectiveUntil <= current.effectiveFrom) {
      throw new ModelValidationError('effectiveUntil must be after effectiveFrom')
    }
    const overlap = this.database.get<ExistsRow>(
      `SELECT 1 AS found FROM scope_memberships
       WHERE id <> ? AND scope_id = ? AND subject_id = ? AND effect = ?
         AND effective_from < ?
         AND (effective_until IS NULL OR effective_until > ?)
       LIMIT 1`,
      [
        id,
        current.scopeId,
        current.subjectId,
        current.effect,
        effectiveUntil,
        current.effectiveFrom
      ]
    )
    if (overlap) {
      throw new ModelValidationError(
        'ending this Scope membership would overlap another interval with the same effect'
      )
    }
    return this.database.transaction(() => {
      this.database.run(
        'UPDATE scope_memberships SET effective_until = ? WHERE id = ?',
        [effectiveUntil, id]
      )
      const updateDates = this.database.all<{ recorded_on: string }>(
        `SELECT DISTINCT recorded_on FROM updates
         WHERE scope_id = ? AND subject_id = ? ORDER BY recorded_on`,
        [current.scopeId, current.subjectId]
      )
      const invalidDate = updateDates.find(({ recorded_on: recordedOn }) =>
        !this.scopes.isEffectiveMember(current.scopeId, current.subjectId, recordedOn)
      )
      if (invalidDate) {
        throw new ModelValidationError(
          `Scope membership change would invalidate scoped Update history on ${invalidDate.recorded_on}`
        )
      }
      return this.find(id) as ScopeMembershipSnapshot
    })
  }

  delete(id: number): boolean {
    assertId(id, 'Scope membership id')
    const current = this.find(id)
    if (!current) return false
    const historical = this.database.get<ExistsRow>(
      `SELECT 1 AS found
       WHERE EXISTS (
         SELECT 1 FROM updates WHERE scope_id = ? AND subject_id = ?
       ) OR EXISTS (
         SELECT 1 FROM todos WHERE scope_id = ? AND subject_id = ?
       ) OR EXISTS (
         SELECT 1 FROM scope_application_transitions
         WHERE from_scope_id = ? OR to_scope_id = ?
       )`,
      [
        current.scopeId,
        current.subjectId,
        current.scopeId,
        current.subjectId,
        current.scopeId,
        current.scopeId
      ]
    )
    if (historical) {
      throw new ModelValidationError(
        'Scope membership cannot be deleted after scoped Update, Todo, or applicability history exists; end it instead'
      )
    }
    return this.database.run('DELETE FROM scope_memberships WHERE id = ?', [id]).changes > 0
  }
}

export class ScopeApplicationRepository {
  private readonly scopes: ScopeRepository

  constructor(private readonly database: SqliteAdapter) {
    this.scopes = new ScopeRepository(database)
  }

  get(owner: ScopeOwner): ScopeApplicationSnapshot {
    return this.resolve(owner, new Set())
  }

  history(owner: ScopeOwner): ScopeApplicationTransition[] {
    const ownerKey = this.ownerKey(owner)
    return this.database
      .all<ApplicationTransitionRow>(
        `SELECT id, focus_id, thread_id, commitment_id,
                from_mode, from_scope_id, to_mode, to_scope_id, changed_at
         FROM scope_application_transitions
         WHERE ${ownerKey.idColumn} = ? ORDER BY id`,
        [owner.id]
      )
      .map(applicationTransitionFromRow)
  }

  set(owner: ScopeOwner, input: SetScopeApplicationInput, now = new Date()): ScopeApplicationSnapshot {
    const ownerKey = this.ownerKey(owner)
    const mode = input.mode
    if (!SCOPE_MODES.includes(mode)) {
      throw new ModelValidationError(`unsupported Scope mode: ${mode}`)
    }
    if (owner.type === 'focus' && mode === 'inherited') {
      throw new ModelValidationError('a Focus cannot inherit Scope')
    }
    if (owner.type === 'commitment') {
      throw new ModelValidationError(
        'a Commitment cannot define Scope; Thread-owned Commitments derive their Thread Scope'
      )
    }

    const scopeId = input.scopeId ?? null
    if (mode === 'open' || mode === 'inherited') {
      if (scopeId !== null) {
        throw new ModelValidationError(`${mode} Scope mode cannot declare a Scope id`)
      }
    } else {
      if (scopeId === null) {
        throw new ModelValidationError(`${mode} Scope mode requires a Scope id`)
      }
      assertId(scopeId, 'scope id')
      const scope = this.scopes.find(scopeId)
      if (!scope) throw new ModelNotFoundError('Scope', scopeId)
      if (scope.focusId !== ownerKey.focusId) {
        throw new ModelValidationError('a Scope application must use a Scope owned by its Focus')
      }
      if (scope.sourceType !== mode) {
        throw new ModelValidationError(
          `${mode} Scope mode requires a ${mode} Scope definition`
        )
      }
    }

    const current = this.get(owner)
    if (current.mode === mode && current.declaredScopeId === scopeId) return current

    const result = this.database.run(
      `UPDATE ${ownerKey.table}
       SET mode = ?, scope_id = ?, updated_at = ?
       WHERE ${ownerKey.idColumn} = ?`,
      [mode, scopeId, timestamp(now), owner.id]
    )
    if (result.changes === 0) throw new ModelNotFoundError(ownerKey.modelName, owner.id)
    return this.get(owner)
  }

  private resolve(owner: ScopeOwner, path: Set<string>): ScopeApplicationSnapshot {
    const ownerKey = this.ownerKey(owner)
    const token = `${owner.type}:${owner.id}`
    if (path.has(token)) throw new ModelValidationError('Scope inheritance cannot contain a cycle')
    const row = this.database.get<ApplicationRow>(
      `SELECT mode, scope_id, updated_at FROM ${ownerKey.table}
       WHERE ${ownerKey.idColumn} = ?`,
      [owner.id]
    )
    if (!row) throw new ModelNotFoundError(ownerKey.modelName, owner.id)
    const mode = row.mode as ScopeMode
    if (mode !== 'inherited') {
      return {
        owner,
        mode,
        declaredScopeId: row.scope_id === null ? null : Number(row.scope_id),
        effectiveScopeId: row.scope_id === null ? null : Number(row.scope_id),
        inheritedFrom: null,
        updatedAt: row.updated_at
      }
    }
    const parent = this.parentOwner(owner)
    if (!parent) throw new ModelValidationError('a Focus cannot inherit Scope')
    const inherited = this.resolve(parent, new Set(path).add(token))
    return {
      owner,
      mode,
      declaredScopeId: null,
      effectiveScopeId: inherited.effectiveScopeId,
      inheritedFrom: parent,
      updatedAt: row.updated_at
    }
  }

  private ownerKey(owner: ScopeOwner): {
    table: string
    idColumn: string
    modelName: string
    focusId: number
  } {
    assertId(owner.id, `${owner.type} id`)
    if (owner.type === 'focus') {
      const exists = this.database.get<ExistsRow>(
        'SELECT 1 AS found FROM focuses WHERE id = ?',
        [owner.id]
      )
      if (!exists) throw new ModelNotFoundError('Focus', owner.id)
      return {
        table: 'focus_scope_applications',
        idColumn: 'focus_id',
        modelName: 'Focus',
        focusId: owner.id
      }
    }
    if (owner.type === 'thread') {
      const row = this.database.get<ThreadOwnerRow>(
        'SELECT focus_id FROM threads WHERE id = ?',
        [owner.id]
      )
      if (!row) throw new ModelNotFoundError('Thread', owner.id)
      return {
        table: 'thread_scope_applications',
        idColumn: 'thread_id',
        modelName: 'Thread',
        focusId: Number(row.focus_id)
      }
    }
    const row = this.database.get<CommitmentOwnerRow>(
      `SELECT commitment.focus_id, commitment.thread_id, thread.focus_id AS thread_focus_id
       FROM commitments commitment
       LEFT JOIN threads thread ON thread.id = commitment.thread_id
       WHERE commitment.id = ?`,
      [owner.id]
    )
    if (!row) throw new ModelNotFoundError('Commitment', owner.id)
    return {
      table: 'commitment_scope_applications',
      idColumn: 'commitment_id',
      modelName: 'Commitment',
      focusId: Number(row.focus_id ?? row.thread_focus_id)
    }
  }

  private parentOwner(owner: ScopeOwner): ScopeOwner | null {
    if (owner.type === 'focus') return null
    if (owner.type === 'thread') {
      return { type: 'focus', id: this.ownerKey(owner).focusId }
    }
    const row = this.database.get<CommitmentOwnerRow>(
      `SELECT commitment.focus_id, commitment.thread_id, thread.focus_id AS thread_focus_id
       FROM commitments commitment
       LEFT JOIN threads thread ON thread.id = commitment.thread_id
       WHERE commitment.id = ?`,
      [owner.id]
    )
    if (!row) throw new ModelNotFoundError('Commitment', owner.id)
    return row.thread_id === null
      ? { type: 'focus', id: Number(row.focus_id) }
      : { type: 'thread', id: Number(row.thread_id) }
  }
}

/**
 * A narrow aggregate boundary for the Focus-level Scope editor. It keeps the
 * renderer from coordinating Subjects, memberships, and applications as three
 * independent writes.
 */
export class FocusScopeRepository {
  private readonly subjects: SubjectRepository
  private readonly scopes: ScopeRepository
  private readonly memberships: ScopeMembershipRepository
  private readonly applications: ScopeApplicationRepository

  constructor(private readonly database: SqliteAdapter) {
    this.subjects = new SubjectRepository(database)
    this.scopes = new ScopeRepository(database)
    this.memberships = new ScopeMembershipRepository(database)
    this.applications = new ScopeApplicationRepository(database)
  }

  get(focusId: number, on = today()): FocusScopeSnapshot {
    assertId(focusId, 'focus id')
    const application = this.applications.get({ type: 'focus', id: focusId })
    return {
      focusId,
      mode: application.mode as Exclude<ScopeMode, 'inherited'>,
      scopeId: application.effectiveScopeId,
      subjects: application.effectiveScopeId === null
        ? []
        : this.scopes.effectiveSubjects(application.effectiveScopeId, on)
    }
  }

  addSubject(
    focusId: number,
    input: AddFocusScopeSubjectInput,
    now = new Date()
  ): FocusScopeSnapshot {
    const name = normalizeRequiredText(input.name, 'subject name')
    const on = today(now)
    return this.database.transaction(() => {
      const subject = this.subjects.list().find(
        (candidate) => candidate.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
      ) ?? this.subjects.create({ name }, now).toSnapshot()
      let application = this.applications.get({ type: 'focus', id: focusId })
      let scopeId = application.effectiveScopeId

      if (scopeId === null) {
        scopeId = this.scopes.create({
          focusId,
          name: 'Focus subjects',
          dimension: 'subject'
        }, now).id
        this.memberships.create({ scopeId, subjectId: subject.id, effectiveFrom: on }, now)
        application = this.applications.set(
          { type: 'focus', id: focusId },
          { mode: 'explicit', scopeId },
          now
        )
      } else if (!this.scopes.isEffectiveMember(scopeId, subject.id, on)) {
        this.restoreSubject(scopeId, subject.id, on, now)
      }

      return this.get(application.owner.id, on)
    })
  }

  /** Ensures canonical Subjects are present without creating duplicate identities. */
  ensureSubjects(
    focusId: number,
    subjectIds: readonly number[],
    now = new Date()
  ): FocusScopeSnapshot {
    const on = today(now)
    return this.database.transaction(() => {
      const ids = [...new Set(subjectIds)]
      for (const subjectId of ids) {
        assertId(subjectId, 'subject id')
        if (!this.subjects.find(subjectId)) throw new ModelNotFoundError('Subject', subjectId)
      }
      const application = this.applications.get({ type: 'focus', id: focusId })
      let scopeId = application.effectiveScopeId
      if (scopeId === null && ids.length > 0) {
        scopeId = this.scopes.create({
          focusId,
          name: 'Focus subjects',
          dimension: 'subject'
        }, now).id
      }
      if (scopeId !== null) {
        for (const subjectId of ids) {
          if (!this.scopes.isEffectiveMember(scopeId, subjectId, on)) {
            this.restoreSubject(scopeId, subjectId, on, now)
          }
        }
      }
      if (application.effectiveScopeId === null && scopeId !== null) {
        this.applications.set(
          { type: 'focus', id: focusId },
          { mode: 'explicit', scopeId },
          now
        )
      }
      return this.get(focusId, on)
    })
  }

  removeSubject(focusId: number, subjectId: number, now = new Date()): FocusScopeSnapshot {
    assertId(subjectId, 'subject id')
    const on = today(now)
    return this.database.transaction(() => {
      const application = this.applications.get({ type: 'focus', id: focusId })
      const scopeId = application.effectiveScopeId
      if (scopeId === null || !this.scopes.isEffectiveMember(scopeId, subjectId, on)) {
        return this.get(focusId, on)
      }

      const activeInclude = this.memberships.listForScope(scopeId).find((membership) =>
        membership.subjectId === subjectId &&
        membership.effect === 'include' &&
        membership.effectiveFrom <= on &&
        (membership.effectiveUntil === null || membership.effectiveUntil > on)
      )

      if (activeInclude?.effectiveFrom === on) {
        this.assertCellHasNoUpdates(scopeId, subjectId)
        this.database.run('DELETE FROM scope_memberships WHERE id = ?', [activeInclude.id])
      } else if (activeInclude) {
        this.memberships.end(activeInclude.id, { effectiveUntil: on })
      }

      if (this.scopes.isEffectiveMember(scopeId, subjectId, on)) {
        this.memberships.create({
          scopeId,
          subjectId,
          effect: 'exclude',
          effectiveFrom: on
        }, now)
      }
      this.assertCellUpdatesRemainEffective(scopeId, subjectId)
      return this.get(focusId, on)
    })
  }

  private restoreSubject(scopeId: number, subjectId: number, on: string, now: Date): void {
    const memberships = this.memberships.listForScope(scopeId)
    const activeExclusion = memberships.find((membership) =>
      membership.subjectId === subjectId &&
      membership.effect === 'exclude' &&
      membership.effectiveFrom <= on &&
      (membership.effectiveUntil === null || membership.effectiveUntil > on)
    )

    if (activeExclusion?.effectiveFrom === on) {
      // A same-day add/remove cycle is a correction. No scoped Update can have
      // been valid inside the exclusion, so removing it expands rather than
      // rewrites attributable history.
      this.database.run('DELETE FROM scope_memberships WHERE id = ?', [activeExclusion.id])
    } else if (activeExclusion) {
      this.memberships.end(activeExclusion.id, { effectiveUntil: on })
    }

    if (this.scopes.isEffectiveMember(scopeId, subjectId, on)) return
    const nextInclude = memberships
      .filter((membership) =>
        membership.subjectId === subjectId &&
        membership.effect === 'include' &&
        membership.effectiveFrom > on
      )
      .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))[0]
    this.memberships.create({
      scopeId,
      subjectId,
      effectiveFrom: on,
      effectiveUntil: nextInclude?.effectiveFrom ?? null
    }, now)
  }

  private assertCellHasNoUpdates(scopeId: number, subjectId: number): void {
    const update = this.database.get<ExistsRow>(
      'SELECT 1 AS found FROM updates WHERE scope_id = ? AND subject_id = ? LIMIT 1',
      [scopeId, subjectId]
    )
    if (update) {
      throw new ModelValidationError(
        'Subject cannot be removed because scoped Update history depends on this membership'
      )
    }
  }

  private assertCellUpdatesRemainEffective(scopeId: number, subjectId: number): void {
    const invalidUpdate = this.database
      .all<{ recorded_on: string }>(
        `SELECT DISTINCT recorded_on FROM updates
         WHERE scope_id = ? AND subject_id = ? ORDER BY recorded_on`,
        [scopeId, subjectId]
      )
      .find(({ recorded_on: recordedOn }) =>
        !this.scopes.isEffectiveMember(scopeId, subjectId, recordedOn)
      )
    if (invalidUpdate) {
      throw new ModelValidationError(
        `Subject removal would invalidate scoped Update history on ${invalidUpdate.recorded_on}`
      )
    }
  }
}

/**
 * Coordinates Thread-local applicability without mutating a Scope shared by
 * the Focus or another consumer. Each customization is a new overlay Scope;
 * returning to the Focus is an application change, not destructive cleanup.
 */
export class ThreadScopeRepository {
  private readonly subjects: SubjectRepository
  private readonly scopes: ScopeRepository
  private readonly memberships: ScopeMembershipRepository
  private readonly applications: ScopeApplicationRepository

  constructor(private readonly database: SqliteAdapter) {
    this.subjects = new SubjectRepository(database)
    this.scopes = new ScopeRepository(database)
    this.memberships = new ScopeMembershipRepository(database)
    this.applications = new ScopeApplicationRepository(database)
  }

  get(threadId: number, on = today()): ThreadScopeSnapshot {
    const thread = this.requireThread(threadId)
    const application = this.applications.get({ type: 'thread', id: threadId })
    const focusApplication = this.applications.get({ type: 'focus', id: thread.focus_id })
    return {
      threadId,
      focusId: thread.focus_id,
      mode: application.mode,
      scopeId: application.effectiveScopeId,
      subjects: application.effectiveScopeId === null
        ? []
        : this.scopes.effectiveSubjects(application.effectiveScopeId, on),
      focusSubjects: focusApplication.effectiveScopeId === null
        ? []
        : this.scopes.effectiveSubjects(focusApplication.effectiveScopeId, on)
    }
  }

  addSubject(
    threadId: number,
    input: AddFocusScopeSubjectInput,
    now = new Date()
  ): ThreadScopeSnapshot {
    const name = normalizeRequiredText(input.name, 'subject name')
    const on = today(now)
    return this.database.transaction(() => {
      const current = this.get(threadId, on)
      const subject = this.subjects.list().find(
        (candidate) => candidate.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
      ) ?? this.subjects.create({ name }, now).toSnapshot()
      if (current.subjects.some(({ id }) => id === subject.id)) return current

      const scope = this.createOverlay(threadId, current, now)
      this.memberships.create({
        scopeId: scope.id,
        subjectId: subject.id,
        effect: 'include',
        effectiveFrom: on
      }, now)
      this.applications.set(
        { type: 'thread', id: threadId },
        { mode: 'explicit', scopeId: scope.id },
        now
      )
      return this.get(threadId, on)
    })
  }

  /**
   * Widens one Thread context in a single overlay/application transition. This
   * is used by confirmed Commitment moves that carry canonical Subjects the
   * destination does not yet cover.
   */
  ensureSubjects(
    threadId: number,
    subjectIds: readonly number[],
    now = new Date()
  ): ThreadScopeSnapshot {
    const on = today(now)
    return this.database.transaction(() => {
      const current = this.get(threadId, on)
      const currentIds = new Set(current.subjects.map(({ id }) => id))
      const missing = [...new Set(subjectIds)].filter((subjectId) => {
        assertId(subjectId, 'subject id')
        return !currentIds.has(subjectId)
      })
      if (missing.length === 0) return current

      for (const subjectId of missing) {
        if (!this.subjects.find(subjectId)) throw new ModelNotFoundError('Subject', subjectId)
      }
      const scope = this.createOverlay(threadId, current, now)
      for (const subjectId of missing) {
        this.memberships.create({
          scopeId: scope.id,
          subjectId,
          effect: 'include',
          effectiveFrom: on
        }, now)
      }
      this.applications.set(
        { type: 'thread', id: threadId },
        { mode: 'explicit', scopeId: scope.id },
        now
      )
      return this.get(threadId, on)
    })
  }

  removeSubject(threadId: number, subjectId: number, now = new Date()): ThreadScopeSnapshot {
    assertId(subjectId, 'subject id')
    const on = today(now)
    return this.database.transaction(() => {
      const current = this.get(threadId, on)
      if (
        current.scopeId === null ||
        !current.subjects.some(({ id }) => id === subjectId)
      ) return current

      const scope = this.createOverlay(threadId, current, now)
      this.memberships.create({
        scopeId: scope.id,
        subjectId,
        effect: 'exclude',
        effectiveFrom: on
      }, now)
      this.applications.set(
        { type: 'thread', id: threadId },
        { mode: 'explicit', scopeId: scope.id },
        now
      )
      return this.get(threadId, on)
    })
  }

  customize(threadId: number, now = new Date()): ThreadScopeSnapshot {
    const on = today(now)
    return this.database.transaction(() => {
      const current = this.get(threadId, on)
      if (current.mode === 'explicit') return current

      const scope = this.createOverlay(threadId, current, now)
      this.applications.set(
        { type: 'thread', id: threadId },
        { mode: 'explicit', scopeId: scope.id },
        now
      )
      return this.get(threadId, on)
    })
  }

  followFocus(threadId: number, now = new Date()): ThreadScopeSnapshot {
    return this.database.transaction(() => {
      this.requireThread(threadId)
      this.applications.set(
        { type: 'thread', id: threadId },
        { mode: 'inherited' },
        now
      )
      return this.get(threadId, today(now))
    })
  }

  private createOverlay(
    threadId: number,
    current: ThreadScopeSnapshot,
    now: Date
  ): ScopeModel {
    const thread = this.requireThread(threadId)
    const base = current.scopeId === null ? null : this.scopes.find(current.scopeId)
    return this.scopes.create({
      focusId: thread.focus_id,
      name: `${thread.title} subjects`,
      dimension: base?.dimension ?? 'subject',
      baseScopeId: base?.id ?? null
    }, now)
  }

  private requireThread(threadId: number): { focus_id: number; title: string } {
    assertId(threadId, 'thread id')
    const thread = this.database.get<{ focus_id: number; title: string }>(
      'SELECT focus_id, title FROM threads WHERE id = ?',
      [threadId]
    )
    if (!thread) throw new ModelNotFoundError('Thread', threadId)
    return { focus_id: Number(thread.focus_id), title: thread.title }
  }
}
