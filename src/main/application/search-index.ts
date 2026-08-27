import { richTextPlainText } from '../../shared/rich-text-value'
import { entityReference } from '../../shared/entity-reference'
import type { OnMoveAccessPolicy } from './access-policy'
import type { SqlValue, SqliteAdapter } from '../data/sqlite-adapter'

export const SEARCH_ENTITY_TYPES = [
  'focus',
  'thread',
  'commitment',
  'routine',
  'update',
  'todo',
  'note',
  'subject'
] as const
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number]

export type SearchSortField = 'relevance' | 'date' | 'createdAt' | 'updatedAt'
export type SearchSortDirection = 'asc' | 'desc'
export type SearchLifecycleMode = 'current' | 'closed' | 'all'
export type SearchTerminalStatus = 'done' | 'cancelled'
export type SearchLifecycleStatus = 'active' | 'paused' | SearchTerminalStatus
export type SearchEffectiveLifecycle = 'current' | 'closed' | 'not_applicable'

export interface SearchLifecycleQuery {
  mode: SearchLifecycleMode
  /** Narrows the closed portion of the search; omitted means both terminal statuses. */
  terminalStatuses?: readonly SearchTerminalStatus[]
}

export interface SearchLocalDateRange {
  from?: string
  to?: string
}

export interface SearchPageCursor {
  sortValue: string | number
  sourceKey: string
}

export interface SearchQuery {
  /** Null performs a queryless structured listing; FTS is used only for non-null text. */
  text: string | null
  kinds?: readonly SearchEntityType[]
  /** Null and omission are both explicitly global; callers must opt into narrowing. */
  focusId?: number | null
  threadId?: number | null
  subjectId?: number | null
  /** Inclusive semantic local-date range (Update date or entity due date). */
  date?: SearchLocalDateRange
  /** Inclusive local-calendar range applied to the stored creation instant. */
  createdAt?: SearchLocalDateRange
  /** Inclusive local-calendar range applied to the stored modification instant. */
  updatedAt?: SearchLocalDateRange
  /** IANA timezone used to turn createdAt/updatedAt local dates into UTC boundaries. */
  timeZone?: string
  /** Omission searches current work. Closed work must be requested intentionally. */
  lifecycle?: SearchLifecycleQuery
  sort?: { field: SearchSortField; direction: SearchSortDirection }
  cursor?: SearchPageCursor | null
  limit?: number
  /** Retained for internal compatibility; MCP pagination uses cursors. */
  offset?: number
}

export interface SearchPage {
  items: SearchResult[]
  itemCursors: SearchPageCursor[]
  hasMore: boolean
  nextCursor: SearchPageCursor | null
  /** Increments whenever the durable search projection is rebuilt. */
  generation: number
  lifecycle: {
    mode: SearchLifecycleMode
    terminalStatuses: SearchTerminalStatus[]
    /** True only when otherwise-matching, authorized closed records were excluded. */
    closedMatchesAvailable: boolean
    /** Exact indexed-title match among the excluded closed records. */
    closedExactTitleMatchAvailable: boolean
    /** Exact indexed-title match anywhere in the selected current partition. */
    currentExactTitleMatchAvailable: boolean
  }
}

export interface SearchHierarchyReference {
  focus: { id: number; code: string; title: string } | null
  thread: { id: number; code: string; title: string } | null
  commitment: { id: number; code: string; title: string } | null
}

export interface SearchPathSegment {
  type: SearchEntityType
  id: number
  code: string
  title: string
}

export interface SearchRecommendedWriteTarget {
  reference: { type: SearchEntityType; id: number }
  code: string
  field: string
  tool: string | null
  requiresReadBeforeWrite: boolean
}

export interface SearchLifecycleLineageReference {
  id: number
  status: SearchLifecycleStatus
}

export interface SearchLifecycleLineage {
  focus: SearchLifecycleLineageReference | null
  thread: SearchLifecycleLineageReference | null
  commitment: SearchLifecycleLineageReference | null
}

export interface SearchLifecycleClosureReference {
  type: keyof SearchLifecycleLineage
  id: number
  status: SearchTerminalStatus
}

export interface SearchLifecycleClosure {
  /** The result itself is terminal. */
  explicit: SearchTerminalStatus | null
  /** Every terminal owner, nearest or otherwise; complete lineage remains available below. */
  inherited: SearchLifecycleClosureReference[]
}

export interface SearchResultLifecycle {
  /** Routine health is separate; Routine results therefore have no direct lifecycle status. */
  directStatus: SearchLifecycleStatus | null
  effective: SearchEffectiveLifecycle
  lineage: SearchLifecycleLineage
  /** Null means no explicit or inherited terminal lifecycle applies. */
  closure: SearchLifecycleClosure | null
}

export interface SearchResult {
  reference: { type: SearchEntityType; id: number }
  uri: string
  field: string
  title: string
  contextPath: string[]
  /** Complete owner chain; this is required primary-match metadata and is never optional projection. */
  hierarchy: SearchHierarchyReference
  containingThread: { id: number; code: string; title: string } | null
  subject: { id: number; code: string; name: string } | null
  path: { display: string; complete: true; segments: SearchPathSegment[] }
  recommendedWriteTarget: SearchRecommendedWriteTarget
  lifecycle: SearchResultLifecycle
  snippet: string
  rank: number
  effectiveSensitive: boolean
  date: string | null
  createdAt: string
  updatedAt: string
}

interface IndexSourceRow {
  id: number
  title: string
  body: string | null
  field_name: string
  focus_id: number | null
  thread_id: number | null
  commitment_id: number | null
  subject_id: number | null
  scope_id: number | null
  direct_sensitive: number
  status: string | null
  state: string | null
  due_on: string | null
  created_at: string
  updated_at: string
}

interface SearchRow {
  entity_type: SearchEntityType
  entity_id: number
  field_name: string
  title: string
  focus_id: number | null
  focus_title: string | null
  thread_id: number | null
  thread_title: string | null
  commitment_id: number | null
  commitment_title: string | null
  commitment_behavior_type: string | null
  document_status: string | null
  focus_status: string | null
  thread_status: string | null
  commitment_status: string | null
  subject_id: number | null
  subject_name: string | null
  snippet: string
  rank: number
  effective_sensitive: number
  date_value: string | null
  created_at: string
  updated_at: string
  source_key: string
  sort_value: string | number
}

function writeTool(type: SearchEntityType, field: string): {
  tool: string | null
  requiresReadBeforeWrite: boolean
} {
  if (type === 'note') {
    return { tool: 'onmove.patch_note_text', requiresReadBeforeWrite: true }
  }
  if (type === 'update') {
    return {
      tool: field === 'observation' ? 'onmove.patch_rich_text' : 'onmove.update_update',
      requiresReadBeforeWrite: field === 'observation'
    }
  }
  if (type === 'focus') {
    return {
      tool: field === 'description' ? 'onmove.patch_rich_text' : 'onmove.update_focus',
      requiresReadBeforeWrite: field === 'description'
    }
  }
  if (type === 'thread') return { tool: 'onmove.update_thread', requiresReadBeforeWrite: false }
  if (type === 'commitment') {
    return { tool: 'onmove.update_commitment', requiresReadBeforeWrite: false }
  }
  if (type === 'routine') return { tool: 'onmove.update_routine', requiresReadBeforeWrite: false }
  if (type === 'todo') return { tool: 'onmove.update_todo', requiresReadBeforeWrite: false }
  return { tool: null, requiresReadBeforeWrite: false }
}

function plainText(value: string | null): string {
  return richTextPlainText(value ?? '').replace(/\s+/gu, ' ').trim()
}

function compactSnippet(value: string | null): string {
  const text = plainText(value)
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

function sourceKey(type: SearchEntityType, id: number, field: string): string {
  return `${type}:${id}:${field}`
}

function resourceUri(type: SearchEntityType, id: number): string {
  if (type === 'update' || type === 'todo' || type === 'note') return `onmove://${type}/${id}`
  return `onmove://${type}/${id}`
}

const SEARCH_STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by',
  'did', 'do', 'does', 'doing', 'for', 'from', 'had', 'has', 'have', 'how',
  'going', 'i', 'in', 'is', 'it', 'its', 'locate', 'me', 'my', 'of', 'on', 'or', 'our',
  'find', 'search', 'show',
  's', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your'
])

const SEARCH_CONTAINER_WORDS = new Set([
  'focus', 'focuses', 'thread', 'threads', 'commitment', 'commitments',
  'routine', 'routines', 'update', 'updates', 'todo', 'todos', 'note', 'notes',
  'subject', 'subjects'
])

function ftsExpression(text: string): string | null {
  const tokens = (text.normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? [])
    // unicode61 does not index punctuation-only tokens such as "___". Route those searches to
    // the literal fallback instead of issuing a valid-looking MATCH expression that cannot hit.
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
  const literalTokens = tokens.map((token) => token.toLocaleLowerCase()).slice(0, 24)
  const normalized = [...new Set(literalTokens)]
  // Natural-language discovery requests commonly wrap the useful entity name in generic prose
  // ("what has Michael been doing"). Removing only a conservative stop-word set retains that
  // name as the primary FTS term without introducing opaque semantic ranking.
  const meaningful = normalized.filter((token) => !SEARCH_STOP_WORDS.has(token))
  // In requests such as "find the rollout note about the Thread", the entity noun describes
  // where evidence lives rather than text that must appear in the container title. Preserve it
  // only when it is the sole useful term.
  const evidenceTerms = meaningful.filter((token) => !SEARCH_CONTAINER_WORDS.has(token))
  const unique = (evidenceTerms.length > 0
    ? evidenceTerms
    : meaningful.length > 0 ? meaningful : normalized).slice(0, 24)
  if (unique.length === 0) return null
  const discovery = unique
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' OR ')
  if (literalTokens.length < 2) return discovery

  // Preserve literal title adjacency before applying natural-language stop-word reduction. Short
  // identity suffixes are meaningful in names such as Project A, including wrapper requests such
  // as "what's going on with Project A". Only pairs containing a retained discovery term become
  // candidates, so generic stop-word pairs do not broaden the result set on their own.
  const identityTerms = new Set(unique)
  const titlePhrases = literalTokens.slice(0, -1).flatMap((token, index) => {
    const pair = [token, literalTokens[index + 1]]
    return pair.some((entry) => identityTerms.has(entry))
      ? [`title : "${pair.join(' ')}"`]
      : []
  })
  const literalPhrase = `"${literalTokens.join(' ')}"`
  const literalBranches = [
    `title : ${literalPhrase}`,
    `body : ${literalPhrase}`,
    ...titlePhrases
  ]
  return [...new Set([...literalBranches, discovery])].join(' OR ')
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const SEARCH_LIFECYCLE_MODES = ['current', 'closed', 'all'] as const
export const SEARCH_TERMINAL_STATUSES = ['done', 'cancelled'] as const

/** Stable Unicode identity used only for exact-title comparison, never fuzzy ranking. */
export function normalizeSearchTitle(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

function normalizedLifecycle(query: SearchLifecycleQuery | undefined): {
  mode: SearchLifecycleMode
  terminalStatuses: SearchTerminalStatus[]
} {
  const mode = query?.mode ?? 'current'
  if (!SEARCH_LIFECYCLE_MODES.includes(mode)) {
    throw new TypeError('search lifecycle.mode must be current, closed, or all')
  }
  const requested = query?.terminalStatuses ?? SEARCH_TERMINAL_STATUSES
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new TypeError('search lifecycle.terminalStatuses must contain done or cancelled')
  }
  if (requested.some((status) => !SEARCH_TERMINAL_STATUSES.includes(status))) {
    throw new TypeError('search lifecycle.terminalStatuses must contain only done or cancelled')
  }
  const selected = new Set(requested)
  return {
    mode,
    terminalStatuses: SEARCH_TERMINAL_STATUSES.filter((status) => selected.has(status))
  }
}

function closedLifecycleExpression(statuses: readonly SearchTerminalStatus[]): {
  sql: string
  parameters: SqlValue[]
} {
  const columns = ['document.status', 'focus.status', 'thread.status', 'commitment.status']
  const placeholders = statuses.map(() => '?').join(', ')
  return {
    sql: `(${columns.map((column) =>
      `COALESCE(${column}, '') IN (${placeholders})`).join(' OR ')})`,
    parameters: columns.flatMap(() => statuses)
  }
}

const ANY_CLOSED_LIFECYCLE = `(
  COALESCE(document.status, '') IN ('done', 'cancelled') OR
  COALESCE(focus.status, '') IN ('done', 'cancelled') OR
  COALESCE(thread.status, '') IN ('done', 'cancelled') OR
  COALESCE(commitment.status, '') IN ('done', 'cancelled')
)`

function lifecycleStatus(value: string | null): SearchLifecycleStatus | null {
  return value !== null && (
    value === 'active' || value === 'paused' || value === 'done' || value === 'cancelled'
  ) ? value : null
}

function lifecycleLineage(
  id: number | null,
  status: string | null
): SearchLifecycleLineageReference | null {
  const normalized = lifecycleStatus(status)
  return id === null || normalized === null ? null : { id: Number(id), status: normalized }
}

function terminalLifecycleStatus(
  value: SearchLifecycleStatus | null | undefined
): SearchTerminalStatus | null {
  return value === 'done' || value === 'cancelled' ? value : null
}

export function deriveSearchLifecycleClosure(
  directStatus: SearchLifecycleStatus | null,
  lineage: SearchLifecycleLineage,
  selfLineageType: keyof SearchLifecycleLineage | null
): SearchLifecycleClosure | null {
  const explicit = terminalLifecycleStatus(directStatus)
  const inherited = (['focus', 'thread', 'commitment'] as const).flatMap((type) => {
    if (type === selfLineageType) return []
    const owner = lineage[type]
    const status = terminalLifecycleStatus(owner?.status)
    return owner && status ? [{ type, id: owner.id, status }] : []
  })
  return explicit || inherited.length > 0 ? { explicit, inherited } : null
}

function assertLocalDate(value: string, field: string): void {
  if (!LOCAL_DATE_PATTERN.test(value)) throw new TypeError(`${field} must use YYYY-MM-DD`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) throw new TypeError(`${field} must be a real local calendar date`)
}

function nextLocalDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + 1))
  return date.toISOString().slice(0, 10)
}

function localMidnightUtc(value: string, timeZone: string): string {
  assertLocalDate(value, 'date range boundary')
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    })
  } catch {
    throw new TypeError(`timeZone must be a valid IANA timezone; received ${timeZone}`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const desired = Date.UTC(year, month - 1, day)
  let candidate = desired
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value: part }) => [type, Number(part)])) as Record<string, number>
    const represented = Date.UTC(
      parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second
    )
    const correction = desired - represented
    candidate += correction
    if (correction === 0) break
  }
  return new Date(candidate).toISOString()
}

function validateRange(range: SearchLocalDateRange | undefined, field: string): void {
  if (!range) return
  if (range.from !== undefined) assertLocalDate(range.from, `${field}.from`)
  if (range.to !== undefined) assertLocalDate(range.to, `${field}.to`)
  if (range.from && range.to && range.from > range.to) {
    throw new TypeError(`${field}.from must not be after ${field}.to`)
  }
}

/** Durable, migration-backed FTS5 projection over every user-authored text surface. */
export class SearchIndexRepository {
  constructor(private readonly database: SqliteAdapter) {}

  /** MCP writes call this defensively in addition to table-level dirty triggers. */
  invalidate(): void {
    this.database.run('UPDATE search_index_state SET dirty = 1 WHERE singleton = 1')
  }

  synchronize(now = new Date()): boolean {
    const dirty = this.database.get<{ dirty: number }>(
      'SELECT dirty FROM search_index_state WHERE singleton = 1'
    )
    if (!dirty || dirty.dirty === 0) return false

    this.database.transaction(() => {
      this.database.run('DELETE FROM search_documents')
      this.insertRows('focus', this.focusRows())
      this.insertRows('thread', this.threadRows())
      const commitments = this.commitmentRows()
      this.insertRows('commitment', commitments.filter(({ field_name }) => field_name !== 'routine'))
      this.insertRows('routine', commitments.filter(({ field_name }) => field_name === 'routine'))
      this.insertRows('update', this.updateRows())
      this.insertRows('todo', this.todoRows())
      this.insertRows('note', this.noteRows())
      this.insertRows('subject', this.subjectRows())
      this.database.run(
        `UPDATE search_index_state
         SET dirty = 0, indexed_at = ?, generation = generation + 1
         WHERE singleton = 1`,
        [now.toISOString()]
      )
    })
    return true
  }

  search(query: SearchQuery, access: OnMoveAccessPolicy): SearchResult[] {
    return this.searchPage(query, access).items
  }

  searchPage(query: SearchQuery, access: OnMoveAccessPolicy): SearchPage {
    if (query.text !== null && (typeof query.text !== 'string' || query.text.trim().length === 0)) {
      throw new TypeError('search text cannot be empty; use null for queryless listing')
    }
    if (query.text !== null && query.text.length > 1_000) {
      throw new TypeError('search text must be at most 1000 characters')
    }
    const limit = query.limit ?? 25
    const offset = query.offset ?? 0
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('search limit must be between 1 and 100')
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) {
      throw new TypeError('search offset must be between 0 and 10000')
    }
    const kinds = query.kinds ?? []
    if (kinds.some((kind) => !SEARCH_ENTITY_TYPES.includes(kind))) {
      throw new TypeError('search kinds contain an unsupported entity type')
    }
    const lifecycle = normalizedLifecycle(query.lifecycle)
    validateRange(query.date, 'date')
    validateRange(query.createdAt, 'createdAt')
    validateRange(query.updatedAt, 'updatedAt')
    const timeZone = query.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
    // Validate even when only semantic dates are filtered so the applied contract is deterministic.
    localMidnightUtc('2000-01-01', timeZone)
    const sort = query.sort ?? (query.text === null
      ? { field: 'updatedAt' as const, direction: 'desc' as const }
      : { field: 'relevance' as const, direction: 'asc' as const })
    if (query.text === null && sort.field === 'relevance') {
      throw new TypeError('sort.field=relevance requires a non-null text query')
    }
    this.assertExistingFilter('focus', query.focusId)
    this.assertExistingFilter('thread', query.threadId)
    this.assertExistingFilter('subject', query.subjectId)
    this.synchronize()

    const textSearch = query.text !== null
    const ftsQuery = textSearch ? ftsExpression(query.text as string) : null
    const ftsSearch = ftsQuery !== null
    const literalSearch = textSearch && !ftsSearch
    const fromParameters: SqlValue[] = literalSearch ? [(query.text as string).trim()] : []
    const conditions: string[] = []
    const parameters: SqlValue[] = []
    if (ftsSearch) {
      conditions.push('search_documents_fts MATCH ?')
      parameters.push(ftsQuery)
    } else if (literalSearch) {
      conditions.push(`(
        instr(document.title, search_input.literal) > 0 OR
        instr(document.body, search_input.literal) > 0
      )`)
    }
    if (query.focusId !== undefined && query.focusId !== null) {
      conditions.push('document.focus_id = ?')
      parameters.push(query.focusId)
    }
    if (query.threadId !== undefined && query.threadId !== null) {
      conditions.push('document.thread_id = ?')
      parameters.push(query.threadId)
    }
    if (query.subjectId !== undefined && query.subjectId !== null) {
      conditions.push('document.subject_id = ?')
      parameters.push(query.subjectId)
    }
    if (kinds.length > 0) {
      conditions.push(`document.entity_type IN (${kinds.map(() => '?').join(', ')})`)
      parameters.push(...kinds)
    }
    if (query.date?.from) {
      conditions.push('document.due_on >= ?')
      parameters.push(query.date.from)
    }
    if (query.date?.to) {
      conditions.push('document.due_on <= ?')
      parameters.push(query.date.to)
    }
    const appendInstantRange = (
      column: 'created_at' | 'updated_at',
      range: SearchLocalDateRange | undefined
    ): void => {
      if (range?.from) {
        conditions.push(`document.${column} >= ?`)
        parameters.push(localMidnightUtc(range.from, timeZone))
      }
      if (range?.to) {
        conditions.push(`document.${column} < ?`)
        parameters.push(localMidnightUtc(nextLocalDate(range.to), timeZone))
      }
    }
    appendInstantRange('created_at', query.createdAt)
    appendInstantRange('updated_at', query.updatedAt)
    const sensitivity = `MAX(
      document.direct_sensitive,
      COALESCE(focus.sensitive, 0), COALESCE(thread.sensitive, 0),
      COALESCE(commitment.sensitive, 0), COALESCE(subject.sensitive, 0),
      COALESCE(scope.sensitive, 0)
    )`
    if (access.sensitiveContent === 'deny') conditions.push(`${sensitivity} = 0`)
    const permissionJoins = access.permissionPolicy
      ? `JOIN mcp_permission_defaults permission_default
           ON permission_default.resource_type = document.entity_type
         LEFT JOIN mcp_focus_permission_overrides permission_focus_all
           ON permission_focus_all.focus_id = document.focus_id
          AND permission_focus_all.resource_type = 'all'
         LEFT JOIN mcp_focus_permission_overrides permission_focus_resource
           ON permission_focus_resource.focus_id = document.focus_id
          AND permission_focus_resource.resource_type = document.entity_type
         LEFT JOIN mcp_thread_permission_overrides permission_thread_all
           ON permission_thread_all.thread_id = document.thread_id
          AND permission_thread_all.resource_type = 'all'
         LEFT JOIN mcp_thread_permission_overrides permission_thread_resource
           ON permission_thread_resource.thread_id = document.thread_id
          AND permission_thread_resource.resource_type = document.entity_type
         JOIN mcp_permission_defaults permission_subject_default
           ON permission_subject_default.resource_type = 'subject'
         LEFT JOIN mcp_focus_permission_overrides permission_subject_focus_all
           ON permission_subject_focus_all.focus_id = document.focus_id
          AND permission_subject_focus_all.resource_type = 'all'
         LEFT JOIN mcp_focus_permission_overrides permission_subject_focus
           ON permission_subject_focus.focus_id = document.focus_id
          AND permission_subject_focus.resource_type = 'subject'
         LEFT JOIN mcp_thread_permission_overrides permission_subject_thread_all
           ON permission_subject_thread_all.thread_id = document.thread_id
          AND permission_subject_thread_all.resource_type = 'all'
         LEFT JOIN mcp_thread_permission_overrides permission_subject_thread
           ON permission_subject_thread.thread_id = document.thread_id
          AND permission_subject_thread.resource_type = 'subject'`
      : ''
    if (access.permissionPolicy) {
      conditions.push(`COALESCE(
        permission_thread_resource.can_view,
        permission_thread_all.can_view,
        permission_focus_resource.can_view,
        permission_focus_all.can_view,
        permission_default.can_view
      ) = 1`)
      conditions.push(`(
        document.subject_id IS NULL OR COALESCE(
          permission_subject_thread.can_view,
          permission_subject_thread_all.can_view,
          permission_subject_focus.can_view,
          permission_subject_focus_all.can_view,
          permission_subject_default.can_view
        ) = 1
      )`)
    }
    // Lifecycle is a structural candidate boundary. Apply it in SQL before relevance is computed
    // or result slots are allocated, so similarly named closed work cannot crowd current work.
    const nonLifecycleConditions = [...conditions]
    const nonLifecycleParameters = [...parameters]
    const selectedClosed = closedLifecycleExpression(lifecycle.terminalStatuses)
    if (lifecycle.mode === 'current') {
      conditions.push(`NOT ${ANY_CLOSED_LIFECYCLE}`)
    } else if (lifecycle.mode === 'closed') {
      conditions.push(selectedClosed.sql)
      parameters.push(...selectedClosed.parameters)
    } else if (lifecycle.terminalStatuses.length < SEARCH_TERMINAL_STATUSES.length) {
      conditions.push(`(NOT ${ANY_CLOSED_LIFECYCLE} OR ${selectedClosed.sql})`)
      parameters.push(...selectedClosed.parameters)
    }
    const relevance = ftsSearch
      ? 'bm25(search_documents_fts, 4.0, 1.0)'
      : literalSearch
        ? `CASE
             WHEN document.title = search_input.literal THEN -3.0
             WHEN instr(document.title, search_input.literal) > 0 THEN -2.0
             ELSE -1.0
           END`
        : '0'
    const sortExpression = sort.field === 'relevance'
      ? relevance
      : sort.field === 'date'
        ? "COALESCE(document.due_on, '')"
        : sort.field === 'createdAt'
          ? 'document.created_at'
          : 'document.updated_at'
    if (query.cursor) {
      if (typeof query.cursor.sourceKey !== 'string' || query.cursor.sourceKey.length === 0) {
        throw new TypeError('search cursor sourceKey is invalid')
      }
      const comparison = sort.direction === 'asc' ? '>' : '<'
      conditions.push(
        `(${sortExpression} ${comparison} ? OR ` +
        `(${sortExpression} = ? AND document.source_key > ?))`
      )
      parameters.push(
        query.cursor.sortValue as SqlValue,
        query.cursor.sortValue as SqlValue,
        query.cursor.sourceKey
      )
    }
    parameters.push(limit + 1, offset)
    const snippet = ftsSearch
      // Let FTS choose the matching title/body column so the excerpt is evidence for the hit.
      ? "snippet(search_documents_fts, -1, '', '', ' … ', 24)"
      : literalSearch
        ? `CASE
             WHEN instr(document.title, search_input.literal) > 0 THEN document.title
             WHEN length(document.body) > 200 THEN substr(document.body, 1, 199) || '…'
             ELSE document.body
           END`
      : `CASE
           WHEN length(document.body) > 200 THEN substr(document.body, 1, 199) || '…'
           ELSE document.body
         END`
    const from = ftsSearch
      ? `search_documents_fts
         JOIN search_documents document ON document.id = search_documents_fts.rowid`
      : literalSearch
        ? `search_documents document
           CROSS JOIN (SELECT ? AS literal) search_input`
      : 'search_documents document'
    const matchedField = ftsSearch
      ? `CASE
           WHEN highlight(search_documents_fts, 0, char(1), char(2)) <> document.title
             THEN CASE document.entity_type
               WHEN 'todo' THEN 'name'
               WHEN 'routine' THEN 'name'
               WHEN 'subject' THEN 'name'
               ELSE 'title'
             END
           ELSE document.field_name
         END`
      : literalSearch
        ? `CASE
             WHEN instr(document.title, search_input.literal) > 0
               THEN CASE document.entity_type
                 WHEN 'todo' THEN 'name'
                 WHEN 'routine' THEN 'name'
                 WHEN 'subject' THEN 'name'
                 ELSE 'title'
               END
             ELSE document.field_name
           END`
      : 'document.field_name'
    let closedMatchesAvailable = false
    let closedExactTitleMatchAvailable = false
    let currentExactTitleMatchAvailable = false
    if (lifecycle.mode === 'current') {
      const availabilityFrom = `FROM ${from}
        LEFT JOIN focuses focus ON focus.id = document.focus_id
        LEFT JOIN threads thread ON thread.id = document.thread_id
        LEFT JOIN commitments commitment ON commitment.id = document.commitment_id
        LEFT JOIN subjects subject ON subject.id = document.subject_id
        LEFT JOIN scopes scope ON scope.id = document.scope_id
        ${permissionJoins}`
      const availabilityConditions = [...nonLifecycleConditions, selectedClosed.sql]
      const availabilityParameters = [
        ...fromParameters,
        ...nonLifecycleParameters,
        ...selectedClosed.parameters
      ]
      closedMatchesAvailable = Boolean(this.database.get<{ found: number }>(
        `SELECT 1 AS found ${availabilityFrom}
         WHERE ${availabilityConditions.join(' AND ')} LIMIT 1`,
        availabilityParameters
      ))
      if (closedMatchesAvailable && query.text !== null) {
        closedExactTitleMatchAvailable = Boolean(this.database.get<{ found: number }>(
          `SELECT 1 AS found ${availabilityFrom}
           WHERE ${[...availabilityConditions,
             'document.normalized_title = ?'].join(' AND ')} LIMIT 1`,
          [...availabilityParameters, normalizeSearchTitle(query.text)]
        ))
      }
      if (query.text !== null) {
        currentExactTitleMatchAvailable = Boolean(this.database.get<{ found: number }>(
          `SELECT 1 AS found ${availabilityFrom}
           WHERE ${[...nonLifecycleConditions,
             `NOT ${ANY_CLOSED_LIFECYCLE}`,
             'document.normalized_title = ?'].join(' AND ')} LIMIT 1`,
          [
            ...fromParameters,
            ...nonLifecycleParameters,
            normalizeSearchTitle(query.text)
          ]
        ))
      }
    }
    const rows = this.database.all<SearchRow>(
      `SELECT document.entity_type, document.entity_id, ${matchedField} AS field_name,
              CASE WHEN document.entity_type = 'update'
                THEN COALESCE(commitment.title, thread.title, 'Update')
                ELSE document.title
              END AS title,
              document.focus_id, focus.title AS focus_title,
              document.thread_id, thread.title AS thread_title,
              document.commitment_id, commitment.title AS commitment_title,
              commitment.behavior_type AS commitment_behavior_type,
              document.status AS document_status, focus.status AS focus_status,
              thread.status AS thread_status, commitment.status AS commitment_status,
              document.subject_id, subject.name AS subject_name,
              ${snippet} AS snippet, ${relevance} AS rank,
              ${sensitivity} AS effective_sensitive,
              document.due_on AS date_value, document.created_at, document.updated_at,
              document.source_key, ${sortExpression} AS sort_value
       FROM ${from}
       LEFT JOIN focuses focus ON focus.id = document.focus_id
       LEFT JOIN threads thread ON thread.id = document.thread_id
       LEFT JOIN commitments commitment ON commitment.id = document.commitment_id
       LEFT JOIN subjects subject ON subject.id = document.subject_id
       LEFT JOIN scopes scope ON scope.id = document.scope_id
       ${permissionJoins}
       ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY ${sortExpression} ${sort.direction.toUpperCase()}, document.source_key ASC
       LIMIT ? OFFSET ?`,
      [...fromParameters, ...parameters]
    )
    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const last = pageRows.at(-1)
    const state = this.database.get<{ generation: number }>(
      'SELECT generation FROM search_index_state WHERE singleton = 1'
    )
    if (!state) throw new Error('search index state is unavailable')
    return {
      items: this.projectRows(pageRows),
      itemCursors: pageRows.map((row) => ({
        sortValue: row.sort_value,
        sourceKey: row.source_key
      })),
      hasMore,
      nextCursor: hasMore && last
        ? { sortValue: last.sort_value, sourceKey: last.source_key }
        : null,
      generation: Number(state.generation),
      lifecycle: {
        mode: lifecycle.mode,
        terminalStatuses: lifecycle.terminalStatuses,
        closedMatchesAvailable,
        closedExactTitleMatchAvailable,
        currentExactTitleMatchAvailable
      }
    }
  }

  private projectRows(rows: readonly SearchRow[]): SearchResult[] {
    return rows.map((row) => {
      const id = Number(row.entity_id)
      const type = row.entity_type
      const field = row.field_name === 'routine' ? 'template' : row.field_name
      const routineOwner = row.commitment_id === null || row.commitment_behavior_type !== 'routine'
        ? null
        : {
            type: 'routine' as const,
            id: Number(row.commitment_id),
            code: entityReference('routine', Number(row.commitment_id)),
            title: row.commitment_title as string
          }
      const hierarchy: SearchHierarchyReference = {
        focus: row.focus_id === null
          ? null
          : {
              id: Number(row.focus_id),
              code: entityReference('focus', Number(row.focus_id)),
              title: row.focus_title as string
            },
        thread: row.thread_id === null
          ? null
          : {
              id: Number(row.thread_id),
              code: entityReference('thread', Number(row.thread_id)),
              title: row.thread_title as string
            },
        commitment: row.commitment_id === null || routineOwner
          ? null
          : {
              id: Number(row.commitment_id),
              code: entityReference('commitment', Number(row.commitment_id)),
              title: row.commitment_title as string
            }
      }
      const subject = row.subject_id === null
        ? null
        : {
            id: Number(row.subject_id),
            code: entityReference('subject', Number(row.subject_id)),
            name: row.subject_name as string
          }
      const ancestors: SearchPathSegment[] = [
        hierarchy.focus && { type: 'focus', ...hierarchy.focus },
        hierarchy.thread && { type: 'thread', ...hierarchy.thread },
        hierarchy.commitment && { type: 'commitment', ...hierarchy.commitment },
        routineOwner
      ].filter((entry): entry is SearchPathSegment => entry !== null)
      if (subject && type !== 'subject') {
        ancestors.push({ type: 'subject', id: subject.id, code: subject.code, title: subject.name })
      }
      const code = entityReference(type, id)
      const entityTitle = type === 'update' ? 'Update' : row.title
      const segments = ancestors.some((segment) => segment.type === type && segment.id === id)
        ? ancestors
        : [...ancestors, { type, id, code, title: entityTitle }]
      const writable = writeTool(type, field)
      const writableField = type === 'note' ? 'content' : field
      const lineage = {
        focus: lifecycleLineage(row.focus_id, row.focus_status),
        thread: lifecycleLineage(row.thread_id, row.thread_status),
        commitment: lifecycleLineage(row.commitment_id, row.commitment_status)
      }
      // Routines deliberately keep operational health separate from lifecycle. Their backing
      // Commitment can still make the effective result closed through the structural lineage.
      const directStatus = type === 'routine' ? null : lifecycleStatus(row.document_status)
      const selfLineageType = type === 'focus' || type === 'thread' || type === 'commitment'
        ? type
        : null
      const closure = deriveSearchLifecycleClosure(directStatus, lineage, selfLineageType)
      const effective: SearchEffectiveLifecycle = closure
        ? 'closed'
        : directStatus === null && Object.values(lineage).every((entry) => entry === null)
          ? 'not_applicable'
          : 'current'
      return {
        reference: { type, id },
        uri: resourceUri(type, id),
        field,
        title: row.title,
        contextPath: [row.focus_title, row.thread_title, row.commitment_title]
          .filter((value): value is string => Boolean(value)),
        hierarchy,
        containingThread: hierarchy.thread,
        subject,
        path: {
          display: segments.map((segment) => `${segment.title} (${segment.code})`).join(' > '),
          complete: true,
          segments
        },
        recommendedWriteTarget: {
          reference: { type, id },
          code,
          field: writableField,
          ...writable
        },
        lifecycle: { directStatus, effective, lineage, closure },
        snippet: compactSnippet(row.snippet),
        rank: Number(row.rank),
        effectiveSensitive: Boolean(row.effective_sensitive),
        date: row.date_value,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    })
  }

  private assertExistingFilter(
    type: 'focus' | 'thread' | 'subject',
    id: number | null | undefined
  ): void {
    if (id === null || id === undefined) return
    const table = type === 'focus' ? 'focuses' : type === 'thread' ? 'threads' : 'subjects'
    const exists = this.database.get<{ found: number }>(
      `SELECT 1 AS found FROM ${table} WHERE id = ?`,
      [id]
    )
    if (!exists) {
      throw new TypeError(
        `${type.toUpperCase()}_NOT_FOUND: ${type[0].toUpperCase()}${type.slice(1)} ${id} ` +
        'does not exist. Remove this scope filter or use a valid ID returned by OnMove.'
      )
    }
  }

  private insertRows(type: SearchEntityType, rows: readonly IndexSourceRow[]): void {
    for (const row of rows) {
      const field = row.field_name === 'routine' ? 'template' : row.field_name
      this.database.run(
        `INSERT INTO search_documents (
           source_key, entity_type, entity_id, field_name, title, normalized_title, body,
           focus_id, thread_id, commitment_id, subject_id, scope_id,
           direct_sensitive, status, state, due_on, review_due, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          sourceKey(type, Number(row.id), field), type, Number(row.id), field,
          type === 'update' ? '' : row.title,
          normalizeSearchTitle(type === 'update' ? '' : row.title), plainText(row.body),
          row.focus_id, row.thread_id,
          row.commitment_id, row.subject_id, row.scope_id,
          row.direct_sensitive, row.status, row.state, row.due_on,
          row.created_at, row.updated_at
        ]
      )
    }
  }

  private focusRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT id, title, description AS body, 'description' AS field_name,
              id AS focus_id, NULL AS thread_id, NULL AS commitment_id,
              NULL AS subject_id, NULL AS scope_id, sensitive AS direct_sensitive,
              status, NULL AS state, due_on, created_at, updated_at
       FROM focuses`
    )
  }

  private threadRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT thread.id, thread.title, '' AS body, 'title' AS field_name,
              thread.focus_id, thread.id AS thread_id, NULL AS commitment_id,
              NULL AS subject_id, application.scope_id,
              thread.sensitive AS direct_sensitive, thread.status,
              NULL AS state, thread.due_on, thread.created_at, thread.updated_at
       FROM threads thread
       LEFT JOIN thread_scope_applications application ON application.thread_id = thread.id`
    )
  }

  private commitmentRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT commitment.id, commitment.title,
              CASE WHEN commitment.behavior_type = 'routine' THEN COALESCE((
                SELECT group_concat(item.inspection, char(10))
                FROM routine_definitions definition
                JOIN routine_template_versions version
                  ON version.routine_id = definition.commitment_id
                 AND version.version = definition.current_template_version
                JOIN routine_template_items item ON item.template_version_id = version.id
                WHERE definition.commitment_id = commitment.id
                ORDER BY item.position
              ), '') ELSE '' END AS body,
              CASE WHEN commitment.behavior_type = 'routine' THEN 'routine' ELSE 'title' END AS field_name,
              thread.focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              NULL AS subject_id, application.scope_id,
              commitment.sensitive AS direct_sensitive, commitment.status,
              NULL AS state, commitment.due_on, commitment.created_at, commitment.updated_at
       FROM commitments commitment
       JOIN threads thread ON thread.id = commitment.thread_id
       LEFT JOIN commitment_scope_applications application
         ON application.commitment_id = commitment.id`
    )
  }

  private updateRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT update_record.id,
              CASE WHEN commitment.id IS NULL THEN thread.title ELSE commitment.title END AS title,
              update_record.observation AS body, 'observation' AS field_name,
              thread.focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              update_record.subject_id, update_record.scope_id,
              update_record.sensitive AS direct_sensitive, NULL AS status,
              update_record.state, update_record.recorded_on AS due_on,
              update_record.created_at, update_record.updated_at
       FROM updates update_record
       LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
       JOIN threads thread ON thread.id = COALESCE(update_record.thread_id, commitment.thread_id)`
    )
  }

  private todoRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT todo.id, todo.name AS title, todo.name AS body, 'name' AS field_name,
              thread.focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              todo.subject_id, todo.scope_id, 0 AS direct_sensitive,
              CASE WHEN todo.done = 1 THEN 'done' ELSE 'active' END AS status,
              NULL AS state, todo.due_on, todo.created_at, todo.updated_at
       FROM todos todo
       LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
       JOIN threads thread ON thread.id = COALESCE(todo.thread_id, commitment.thread_id)`
    )
  }

  private noteRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT note.id, note.title, note.content AS body, 'content' AS field_name,
              focus.id AS focus_id, thread.id AS thread_id, commitment.id AS commitment_id,
              NULL AS subject_id, NULL AS scope_id, 0 AS direct_sensitive,
              NULL AS status, NULL AS state, NULL AS due_on,
              note.created_at, note.updated_at
       FROM notes note
       LEFT JOIN commitments commitment ON commitment.id = note.commitment_id
       LEFT JOIN threads thread ON thread.id = COALESCE(note.thread_id, commitment.thread_id)
       JOIN focuses focus ON focus.id = COALESCE(note.focus_id, thread.focus_id)`
    )
  }

  private subjectRows(): IndexSourceRow[] {
    return this.database.all<IndexSourceRow>(
      `SELECT id, name AS title, description AS body, 'description' AS field_name,
              NULL AS focus_id, NULL AS thread_id, NULL AS commitment_id,
              id AS subject_id, NULL AS scope_id, sensitive AS direct_sensitive,
              NULL AS status, NULL AS state, NULL AS due_on, created_at, updated_at
       FROM subjects`
    )
  }
}
