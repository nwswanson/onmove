import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { AppDatabase } from '../main/database'
import {
  NoteRevisionConflictError,
  NoteTextDisappearedError,
  RichTextDisappearedError,
  RichTextRevisionConflictError,
  SemanticTargetValidationError,
  ScopeTargetValidationError,
  type ApplicationEntityPathResolution,
  type ApplicationHierarchyPath,
  type ApplicationRichTextReference,
  type ApplicationResolvedTargetCandidate,
  type ApplicationSemanticTargetPath,
  type ApplicationThreadReparentPlan
} from '../main/application/services'
import {
  SEARCH_ENTITY_TYPES,
  SEARCH_TERMINAL_STATUSES,
  type SearchLocalDateRange,
  type SearchLifecycleMode,
  type SearchLifecycleQuery,
  type SearchPageCursor,
  type SearchEntityType,
  type SearchQuery,
  type SearchResult,
  type SearchSortDirection,
  type SearchSortField,
  type SearchTerminalStatus
} from '../main/application/search-index'
import type {
  RetrievalAppliedStrategy,
  RetrievalPage,
  RetrievalRequest
} from '../main/application/retrieval-service'
import type {
  McpRetrievalMode,
  McpUiContextSnapshot,
  RichTextDocumentSnapshot
} from '../shared/contracts'
import {
  entityReference,
  parseEntityReference,
  type EntityReferenceKind
} from '../shared/entity-reference'
import { onMoveMarkdownEntityLink } from '../shared/onmove-url'
import {
  ONMOVE_RICH_TEXT_MARKS,
  OnMoveRichTextPatchError,
  OnMoveRichTextValidationError,
  assertOnMoveRichTextDocument,
  onMoveRichTextDocumentSchema as richTextDocumentSchema,
  type OnMoveRichTextDocument,
  type OnMoveRichTextMark
} from '../shared/rich-text-document'

export interface OnMoveMcpServerOptions {
  /** Called after a committed MCP mutation so the live application can refresh its windows. */
  onMutation?: () => void
  /** Called with committed rich-text state so open editors can apply an external revision. */
  onRichTextMutation?: (document: RichTextDocumentSnapshot) => void
  /** Read only for an explicit scope.mode=current search; never an implicit default filter. */
  getCurrentUiContext?: () => McpUiContextSnapshot
  /** Shared by protocol instances belonging to one running endpoint. */
  rejectedCallTracker?: RejectedCallTracker
  /** Shared UUID handles for search cursors across protocol connections. */
  searchContinuationStore?: SearchContinuationStore
  /** Shared UUID handles for retrieval cursors across protocol connections. */
  retrievalContinuationStore?: RetrievalContinuationStore
}

export interface SearchScopeInput {
  mode: 'all' | 'focus' | 'thread' | 'subject' | 'current'
  focusId?: number | null
  threadId?: number | null
  subjectId?: number | null
}

export interface AppliedSearchScope {
  requestedMode: SearchScopeInput['mode']
  mode: SearchScopeInput['mode']
  focusId: number | null
  threadId: number | null
  subjectId: number | null
  source: 'default' | 'explicit' | 'current-ui'
  description: string
}

interface McpDiagnostics {
  appliedScope: AppliedSearchScope
  warnings: string[]
  appliedKinds?: SearchEntityType[] | 'all'
  resultCount?: number
  hierarchyPathCount?: number
  hierarchyPathTotal?: number
  subjectUseCount?: number
  resolutionStatus?: 'resolved' | 'ambiguous' | 'not_found'
  candidateCount?: number
}

const HIERARCHY_NOTATION_GUIDE = {
  object: '{ focus?: string, thread: string, commitment?: string, subject?: string }',
  example: {
    thread: 'Team management',
    commitment: '1:1s',
    subject: 'Michael'
  },
  display: 'Team management > 1:1s[Michael]',
  semantics:
    'Focus is the optional top-level area; Thread is its workstream; Commitment is optional ' +
    'tracked work inside the Thread; Subject is the exact Scope cell. A Subject in brackets ' +
    'must be preserved as subject attribution on create_update.'
} as const

const EMPTY_UI_CONTEXT: McpUiContextSnapshot = { focusId: null, subjectId: null }
const GLOBAL_SCOPE: AppliedSearchScope = {
  requestedMode: 'all',
  mode: 'all',
  focusId: null,
  threadId: null,
  subjectId: null,
  source: 'default',
  description: 'Global search across the visible OnMove workspace.'
}

const idSchema = z.number().int().positive()
  .describe('A positive OnMove database ID. Use the ID for the named entity type, not a child record ID.')
const entityCodeSchema = z.string().min(2).max(32).refine(
  (value) => parseEntityReference(value) !== null,
  'Use a public OnMove entity code such as #F2, #T4, #C7, #R3, #U90, #TD11, #N5, or #S8.'
).describe(
  'A canonical public OnMove code shown in the app and returned by MCP. The # prefix and uppercase letters are canonical; lookup tolerates lowercase or an omitted #.'
)
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
  .describe('A local calendar date in YYYY-MM-DD form.')
const pageSchema = {
  limit: z.number().int().min(1).max(100).optional()
    .describe('Maximum results to return, from 1 through 100.'),
  offset: z.number().int().min(0).max(10_000).optional()
    .describe('Zero-based result offset for pagination.')
}

const searchScopeSchema = z.object({
  mode: z.enum(['all', 'focus', 'thread', 'subject', 'current']).describe(
    'all searches the entire visible workspace; focus searches one Focus hierarchy; thread searches one Thread and its children; subject searches records attributed to one Subject; current explicitly uses the current OnMove UI Focus and Subject selection.'
  ),
  focusId: idSchema.nullable().optional().describe(
    'The ID of a Focus, OnMove\'s top-level area of work. Used only when mode is focus. Null or omitted never narrows the search.'
  ),
  threadId: idSchema.nullable().optional().describe(
    'The ID of a Thread, a workstream inside a Focus. Used only when mode is thread. For follow-up discovery, preserve a previously returned Thread ID instead of replacing it with a broad text query.'
  ),
  subjectId: idSchema.nullable().optional().describe(
    'The ID of a canonical Subject used in scoped work. Used only when mode is subject. Null or omitted never narrows the search.'
  )
}).nullable().optional().describe(
  'An explicit named search scope. Null or omitted means mode=all; the current UI is never used implicitly. For follow-ups, preserve the Subject, Thread, or Focus scope returned by the prior result and broaden only when the user requests wider results.'
)

interface SearchProjectionInput {
  hierarchy: boolean
  subjects: boolean
  scopes: boolean
}

type AppliedSearchLifecycle = Required<{
  mode: SearchLifecycleMode
  terminalStatuses: SearchTerminalStatus[]
}>

const DEFAULT_SEARCH_LIFECYCLE: AppliedSearchLifecycle = {
  mode: 'current',
  terminalStatuses: [...SEARCH_TERMINAL_STATUSES]
}

function normalizeSearchLifecycle(
  lifecycle: SearchLifecycleQuery | undefined,
  defaultMode: SearchLifecycleMode = DEFAULT_SEARCH_LIFECYCLE.mode
): AppliedSearchLifecycle {
  const selected = new Set(
    lifecycle?.terminalStatuses ?? DEFAULT_SEARCH_LIFECYCLE.terminalStatuses
  )
  return {
    mode: lifecycle?.mode ?? defaultMode,
    terminalStatuses: SEARCH_TERMINAL_STATUSES.filter((status) => selected.has(status))
  }
}

function validAppliedSearchLifecycle(value: unknown): value is AppliedSearchLifecycle {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AppliedSearchLifecycle>
  return (
    ['current', 'closed', 'all'].includes(candidate.mode as string) &&
    Array.isArray(candidate.terminalStatuses) &&
    candidate.terminalStatuses.length > 0 &&
    candidate.terminalStatuses.every((status) => SEARCH_TERMINAL_STATUSES.includes(status)) &&
    new Set(candidate.terminalStatuses).size === candidate.terminalStatuses.length
  )
}

function encodeLifecycleToken(lifecycle: AppliedSearchLifecycle): string {
  const mode = lifecycle.mode === 'current' ? 'u' : lifecycle.mode === 'closed' ? 'h' : 'a'
  const statuses = [
    lifecycle.terminalStatuses.includes('done') ? 'd' : '',
    lifecycle.terminalStatuses.includes('cancelled') ? 'x' : ''
  ].join('')
  return `${mode}:${statuses}`
}

function decodeLifecycleToken(value: unknown): AppliedSearchLifecycle | null {
  if (typeof value !== 'string') return null
  const [modeCode, statusCodes, extra] = value.split(':')
  if (extra !== undefined || !modeCode || !['d', 'x', 'dx'].includes(statusCodes)) return null
  const terminalStatuses: SearchTerminalStatus[] = [
    ...(statusCodes.includes('d') ? ['done' as const] : []),
    ...(statusCodes.includes('x') ? ['cancelled' as const] : [])
  ]
  const mode = modeCode === 'u' ? 'current' : modeCode === 'h' ? 'closed' :
    modeCode === 'a' ? 'all' : null
  return mode === null ? null : { mode, terminalStatuses }
}

interface SearchLifecycleAvailability extends AppliedSearchLifecycle {
  closedMatchesAvailable: boolean
  closedExactTitleMatchAvailable: boolean
  currentExactTitleMatchAvailable: boolean
}

interface SearchLifecycleCoverage {
  closedMatchesAvailable: boolean
  closedExactTitleMatchAvailable: boolean
  wideningRecommended: boolean
  nextAction: string | null
}

function lifecycleCoverage(
  availability: SearchLifecycleAvailability,
  recordCount: number
): SearchLifecycleCoverage {
  const wideningRecommended = availability.mode === 'current' && (
    (recordCount === 0 && availability.closedMatchesAvailable) ||
    (availability.closedExactTitleMatchAvailable &&
      !availability.currentExactTitleMatchAvailable)
  )
  return {
    closedMatchesAvailable: availability.closedMatchesAvailable,
    closedExactTitleMatchAvailable: availability.closedExactTitleMatchAvailable,
    wideningRecommended,
    nextAction: wideningRecommended
      ? 'Repeat the same initial tool request with lifecycle.mode=closed to inspect history, or lifecycle.mode=all to compare current and closed work. Do not modify or reuse a continuation token.'
      : null
  }
}

interface SearchContinuationPayload {
  version: 5
  origin:
    | { type: 'global' }
    | { type: 'entity'; kind: SearchEntityType }
  text: string | null
  query: Pick<SearchQuery, 'focusId' | 'threadId' | 'subjectId'>
  appliedScope: AppliedSearchScope
  kinds?: SearchEntityType[]
  date?: SearchLocalDateRange
  createdAt?: SearchLocalDateRange
  updatedAt?: SearchLocalDateRange
  timeZone: string
  sort: { field: SearchSortField; direction: SearchSortDirection }
  lifecycle: AppliedSearchLifecycle
  projection: SearchProjectionInput
  pageSize: number
  maxBytes: number
  indexGeneration: number
  /** Null is valid only for a preconfigured first page emitted by another MCP tool. */
  cursor: SearchPageCursor | null
}

const SEARCH_CONTINUATION_PREFIX = 'onmove-search-v5.'
const SEARCH_CONTINUATION_SECRET = randomBytes(32)
const CONTINUATION_HANDLE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SEARCH_CONTINUATION_TTL_MS = 3 * 60 * 60 * 1_000
const SEARCH_CONTINUATION_MAXIMUM_ENTRIES = 1_024

interface SearchContinuationStoreEntry {
  signedToken: string
  expiresAt: number
}

export interface SearchContinuationStoreOptions {
  ttlMs?: number
  maximumEntries?: number
  now?: () => number
}

/**
 * Keeps complete signed cursors server-side and gives MCP clients short UUID
 * handles. The store is shared by every protocol connection on one running
 * app, bounded in size, and intentionally reset when the MCP endpoint stops.
 */
export class SearchContinuationStore {
  private readonly entries = new Map<string, SearchContinuationStoreEntry>()
  private readonly ttlMs: number
  private readonly maximumEntries: number
  private readonly now: () => number

  constructor(options: SearchContinuationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? SEARCH_CONTINUATION_TTL_MS
    this.maximumEntries = options.maximumEntries ?? SEARCH_CONTINUATION_MAXIMUM_ENTRIES
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1) {
      throw new TypeError('Search continuation ttlMs must be a positive integer')
    }
    if (!Number.isSafeInteger(this.maximumEntries) || this.maximumEntries < 1) {
      throw new TypeError('Search continuation maximumEntries must be a positive integer')
    }
  }

  issue(signedToken: string): string {
    const now = this.now()
    this.prune(now)
    const handle = randomUUID()
    this.entries.set(handle, { signedToken, expiresAt: now + this.ttlMs })
    while (this.entries.size > this.maximumEntries) {
      this.entries.delete(this.entries.keys().next().value as string)
    }
    return handle
  }

  resolve(value: string): string {
    const handle = value.replace(/\s/gu, '').toLocaleLowerCase()
    if (!CONTINUATION_HANDLE_PATTERN.test(handle)) {
      throw new TypeError(
        'SEARCH_CONTINUATION_INVALID: continuationToken must be the UUID handle returned by ' +
        'the preceding OnMove search page. Copy only that handle; inserted whitespace is tolerated.'
      )
    }
    const entry = this.entries.get(handle)
    if (!entry) {
      throw new TypeError(
        'SEARCH_CONTINUATION_EXPIRED_OR_UNKNOWN: This UUID handle is unavailable. Search ' +
        'continuation handles expire after 3 hours and when the OnMove MCP server restarts. ' +
        'Restart the original search with its criteria.'
      )
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(handle)
      throw new TypeError(
        'SEARCH_CONTINUATION_EXPIRED: This UUID handle expired after 3 hours. Restart the ' +
        'original search with its criteria.'
      )
    }
    return entry.signedToken
  }

  private prune(now: number): void {
    for (const [handle, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(handle)
    }
  }
}

function encodeSearchContinuation(payload: SearchContinuationPayload): string {
  const { lifecycle, ...rest } = payload
  const encoded = Buffer.from(JSON.stringify({
    ...rest,
    l: encodeLifecycleToken(lifecycle)
  }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', SEARCH_CONTINUATION_SECRET)
    .update(encoded)
    .digest('base64url')
  return `${SEARCH_CONTINUATION_PREFIX}${encoded}.${signature}`
}

function decodeSearchContinuation(token: string): SearchContinuationPayload {
  if (!token.startsWith(SEARCH_CONTINUATION_PREFIX) || token.length > 8_192) {
    throw new TypeError('continuationToken is not a valid OnMove search continuation token')
  }
  try {
    const signed = token.slice(SEARCH_CONTINUATION_PREFIX.length)
    const separator = signed.lastIndexOf('.')
    if (separator <= 0) throw new Error('missing continuation signature')
    const encoded = signed.slice(0, separator)
    const received = Buffer.from(signed.slice(separator + 1), 'base64url')
    const expected = createHmac('sha256', SEARCH_CONTINUATION_SECRET)
      .update(encoded)
      .digest()
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new Error('invalid continuation signature')
    }
    const raw = JSON.parse(Buffer.from(
      encoded,
      'base64url'
    ).toString('utf8')) as Partial<SearchContinuationPayload> & { l?: unknown }
    const lifecycle = decodeLifecycleToken(raw.l)
    const parsed = { ...raw, lifecycle } as Partial<SearchContinuationPayload>
    const query = parsed.query
    const appliedScope = parsed.appliedScope
    if (
      parsed.version !== 5 || !parsed.origin || !query || !appliedScope || !parsed.projection ||
      !parsed.sort || parsed.cursor === undefined ||
      !validAppliedSearchLifecycle(lifecycle) ||
      (typeof parsed.text !== 'string' && parsed.text !== null) ||
      !['all', 'focus', 'thread', 'subject', 'current'].includes(appliedScope.mode) ||
      !['relevance', 'date', 'createdAt', 'updatedAt'].includes(parsed.sort.field) ||
      !['asc', 'desc'].includes(parsed.sort.direction) ||
      typeof parsed.timeZone !== 'string' || parsed.timeZone.length === 0 ||
      !Number.isSafeInteger(parsed.pageSize) || Number(parsed.pageSize) < 1 ||
      Number(parsed.pageSize) > 25 || !Number.isSafeInteger(parsed.maxBytes) ||
      Number(parsed.maxBytes) < 8_192 || Number(parsed.maxBytes) > 131_072 ||
      !Number.isSafeInteger(parsed.indexGeneration) || Number(parsed.indexGeneration) < 0 ||
      (parsed.cursor !== null && (
        typeof parsed.cursor.sourceKey !== 'string' || parsed.cursor.sourceKey.length === 0 ||
        !['string', 'number'].includes(typeof parsed.cursor.sortValue)
      ))
    ) throw new Error('invalid continuation payload')
    if (
      !['global', 'entity'].includes(parsed.origin.type) ||
      (parsed.origin.type === 'entity' && !SEARCH_ENTITY_TYPES.includes(parsed.origin.kind))
    ) throw new Error('invalid continuation origin')
    if (
      parsed.origin.type === 'entity' && (
        typeof parsed.text !== 'string' || parsed.text.trim().length === 0 ||
        parsed.kinds?.length !== 1 || parsed.kinds[0] !== parsed.origin.kind
      )
    ) throw new Error('invalid entity continuation origin')
    for (const value of [query.focusId, query.threadId, query.subjectId]) {
      if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new Error('invalid continuation scope')
      }
    }
    if (parsed.kinds?.some((kind) => !SEARCH_ENTITY_TYPES.includes(kind))) {
      throw new Error('invalid continuation kinds')
    }
    return parsed as SearchContinuationPayload
  } catch {
    throw new TypeError('continuationToken is invalid or incompatible; start a new search')
  }
}

type RetrievalCursor = NonNullable<RetrievalRequest['cursor']>
type RetrievalContinuationRequest = Omit<RetrievalRequest, 'cursor' | 'limit'>

interface RetrievalContinuationPayload {
  version: 2
  serverNonce: string
  request: RetrievalContinuationRequest
  cursor: RetrievalCursor
  pageSize: number
  maxBytes: number
  lexicalGeneration: number
  semanticGeneration: number | null
  retrievalMode: McpRetrievalMode
  appliedStrategy: RetrievalAppliedStrategy
  fallbackReason: string | null
  accessFingerprint: string
}

const RETRIEVAL_CONTINUATION_PREFIX = 'onmove-retrieval-v2.'
const RETRIEVAL_CONTINUATION_TTL_MS = 3 * 60 * 60 * 1_000
const RETRIEVAL_CONTINUATION_MAXIMUM_ENTRIES = 1_024
const CONTINUATION_HANDLE_SIZE_PLACEHOLDER = '00000000-0000-4000-8000-000000000000'

function encodeRetrievalContinuation(payload: RetrievalContinuationPayload): string {
  const { lifecycle, ...request } = payload.request
  const encoded = Buffer.from(JSON.stringify({
    ...payload,
    request: { ...request, l: encodeLifecycleToken(normalizeSearchLifecycle(lifecycle)) }
  }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', SEARCH_CONTINUATION_SECRET)
    .update(`${RETRIEVAL_CONTINUATION_PREFIX}${encoded}`)
    .digest('base64url')
  return `${RETRIEVAL_CONTINUATION_PREFIX}${encoded}.${signature}`
}

function decodeRetrievalContinuation(
  token: string,
  expectedServerNonce: string
): RetrievalContinuationPayload {
  if (!token.startsWith(RETRIEVAL_CONTINUATION_PREFIX) || token.length > 8_192) {
    throw new TypeError('continuationToken is not a valid OnMove retrieval continuation token')
  }
  try {
    const signed = token.slice(RETRIEVAL_CONTINUATION_PREFIX.length)
    const separator = signed.lastIndexOf('.')
    if (separator <= 0) throw new Error('missing continuation signature')
    const encoded = signed.slice(0, separator)
    const received = Buffer.from(signed.slice(separator + 1), 'base64url')
    const expected = createHmac('sha256', SEARCH_CONTINUATION_SECRET)
      .update(`${RETRIEVAL_CONTINUATION_PREFIX}${encoded}`)
      .digest()
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new Error('invalid continuation signature')
    }
    const raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as
      Partial<RetrievalContinuationPayload> & {
        request?: Partial<RetrievalContinuationRequest> & { l?: unknown }
      }
    const lifecycle = decodeLifecycleToken(raw.request?.l)
    const request = { ...(raw.request ?? {}) }
    delete request.l
    const parsed = {
      ...raw,
      request: { ...request, lifecycle }
    } as Partial<RetrievalContinuationPayload>
    if (
      parsed.version !== 2 || parsed.serverNonce !== expectedServerNonce ||
      !parsed.request || typeof parsed.request !== 'object' ||
      !validAppliedSearchLifecycle(lifecycle) ||
      !parsed.cursor || typeof parsed.cursor !== 'object' ||
      !Number.isSafeInteger(parsed.pageSize) || Number(parsed.pageSize) < 1 ||
      Number(parsed.pageSize) > 25 || !Number.isSafeInteger(parsed.maxBytes) ||
      Number(parsed.maxBytes) < 8_192 || Number(parsed.maxBytes) > 131_072 ||
      !Number.isSafeInteger(parsed.lexicalGeneration) || Number(parsed.lexicalGeneration) < 0 ||
      (parsed.semanticGeneration !== null && (
        !Number.isSafeInteger(parsed.semanticGeneration) || Number(parsed.semanticGeneration) < 0
      )) ||
      !['classic', 'enhanced'].includes(parsed.retrievalMode as string) ||
      !['structured', 'lexical', 'hybrid'].includes(parsed.appliedStrategy as string) ||
      (parsed.fallbackReason !== null && typeof parsed.fallbackReason !== 'string') ||
      typeof parsed.accessFingerprint !== 'string' || parsed.accessFingerprint.length === 0
    ) throw new Error('invalid continuation payload')
    return parsed as RetrievalContinuationPayload
  } catch {
    throw new TypeError('continuationToken is invalid or incompatible; start a new retrieval')
  }
}

export type RetrievalContinuationStoreOptions = SearchContinuationStoreOptions

/**
 * Keeps signed retrieval state inside the running endpoint and exposes only
 * short UUID handles. Its nonce is shared with every protocol connection that
 * shares this store, and both disappear when the endpoint restarts.
 */
export class RetrievalContinuationStore {
  private readonly entries = new Map<string, SearchContinuationStoreEntry>()
  private readonly ttlMs: number
  private readonly maximumEntries: number
  private readonly now: () => number
  private readonly nonce = randomBytes(16).toString('base64url')

  constructor(options: RetrievalContinuationStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? RETRIEVAL_CONTINUATION_TTL_MS
    this.maximumEntries = options.maximumEntries ?? RETRIEVAL_CONTINUATION_MAXIMUM_ENTRIES
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1) {
      throw new TypeError('Retrieval continuation ttlMs must be a positive integer')
    }
    if (!Number.isSafeInteger(this.maximumEntries) || this.maximumEntries < 1) {
      throw new TypeError('Retrieval continuation maximumEntries must be a positive integer')
    }
  }

  serverNonce(): string {
    return this.nonce
  }

  issue(signedToken: string): string {
    const now = this.now()
    this.prune(now)
    const handle = randomUUID()
    this.entries.set(handle, { signedToken, expiresAt: now + this.ttlMs })
    while (this.entries.size > this.maximumEntries) {
      this.entries.delete(this.entries.keys().next().value as string)
    }
    return handle
  }

  resolve(value: string): string {
    const handle = value.replace(/\s/gu, '').toLocaleLowerCase()
    if (!CONTINUATION_HANDLE_PATTERN.test(handle)) {
      throw new TypeError(
        'RETRIEVAL_CONTINUATION_INVALID: continuationToken must be the UUID handle returned by ' +
        'the preceding OnMove retrieval page. Copy only that handle; inserted whitespace is tolerated.'
      )
    }
    const entry = this.entries.get(handle)
    if (!entry) {
      throw new TypeError(
        'RETRIEVAL_CONTINUATION_EXPIRED_OR_UNKNOWN: This UUID handle is unavailable. Retrieval ' +
        'continuation handles expire after 3 hours and when the OnMove MCP server restarts. ' +
        'Restart onmove.retrieve with its original criteria.'
      )
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(handle)
      throw new TypeError(
        'RETRIEVAL_CONTINUATION_EXPIRED: This UUID handle expired after 3 hours. Restart ' +
        'onmove.retrieve with its original criteria.'
      )
    }
    return entry.signedToken
  }

  private prune(now: number): void {
    for (const [handle, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(handle)
    }
  }
}

function plainRichTextDocument(text: string): OnMoveRichTextDocument {
  return {
    version: 1,
    blocks: text === ''
      ? []
      : [{ type: 'paragraph', children: [{ type: 'text', text }] }]
  }
}

type RichTextWriteTool =
  | 'onmove.create_focus'
  | 'onmove.create_update'
  | 'onmove.update_note'
  | 'onmove.update_rich_text'

class RichTextToolInputError extends Error {
  constructor(
    readonly tool: RichTextWriteTool,
    readonly code: 'missing_rich_text' | 'invalid_rich_text',
    message: string,
    readonly validationIssue?: OnMoveRichTextValidationError['issue']
  ) {
    super(message)
    this.name = 'RichTextToolInputError'
  }
}

function normalizedRichTextToolInput(
  tool: RichTextWriteTool,
  input: { richText?: unknown },
  required: boolean
): OnMoveRichTextDocument | undefined {
  const value = input.richText
  if (value === undefined) {
    if (!required) return undefined
    throw new RichTextToolInputError(
      tool,
      'missing_rich_text',
      tool === 'onmove.update_note'
        ? `${tool} requires richText. Copy note.richText from onmove.get_note_by_id and submit it as richText.`
        : `${tool} requires richText. Copy the field's returned richText document and submit it as richText.`
    )
  }
  try {
    return assertOnMoveRichTextDocument(value)
  } catch (error) {
    throw new RichTextToolInputError(
      tool,
      'invalid_rich_text',
      `${tool} received invalid richText: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof OnMoveRichTextValidationError ? error.issue : undefined
    )
  }
}

type McpErrorResult = {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function payloadFeatures(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) payloadFeatures(entry, result)
    return result
  }
  if (!value || typeof value !== 'object') return result
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'type' && typeof entry === 'string') result.add(`type:${JSON.stringify(entry)}`)
    if (key === 'tag' && entry === true) result.add('tag:true')
    payloadFeatures(entry, result)
  }
  return result
}

/** Keeps a stuck client from receiving the same generic rejection indefinitely. */
export class RejectedCallTracker {
  private static readonly maximumEntries = 256
  private readonly counts = new Map<string, number>()

  rejected(
    tool: string,
    input: unknown,
    errorCode: string,
    response: McpErrorResult
  ): McpErrorResult {
    const key = `${tool}\n${errorCode}\n${stableJson(input)}`
    const previousCount = this.counts.get(key) ?? 0
    if (previousCount > 0) this.counts.delete(key)
    const count = previousCount + 1
    this.counts.set(key, count)
    if (this.counts.size > RejectedCallTracker.maximumEntries) {
      this.counts.delete(this.counts.keys().next().value as string)
    }
    if (count < 3) return response
    const features = [...payloadFeatures(input)]
    const featureText = features.length > 0
      ? ` The payload still contains ${features.join(' and ')}.`
      : ''
    const warning =
      `This is the ${count === 3 ? 'third' : `${count}th`} identical rejected request. ` +
      `The arguments and validation error ${errorCode} have not changed.${featureText} ` +
      'Change the fields identified by recovery before retrying; do not resend this payload.'
    const recovery = record(response.structuredContent.recovery) ?? {}
    return {
      ...response,
      content: response.content.map((entry, index) => index === 0
        ? { ...entry, text: `${entry.text}\n${warning}` }
        : entry),
      structuredContent: {
        ...response.structuredContent,
        recovery: {
          ...recovery,
          duplicateInvalidCall: { count, warning }
        }
      }
    }
  }
}

function diagnosticsScope(scope: AppliedSearchScope = GLOBAL_SCOPE): McpDiagnostics {
  return { appliedScope: scope, warnings: [] }
}

const RICH_TEXT_OMITTED_WARNING =
  'Lossless rich text was omitted to keep this read compact. Rich fields are rendered as ' +
  'Markdown (legacy plain text remains unchanged). Request includeRichText=true only immediately ' +
  'before a full structural replacement that must preserve exact links and formatting; localized ' +
  'semantic patches do not require the full document.'

interface UpdateWriteGuide {
  tool: 'onmove.create_update'
  parent: { type: 'thread' | 'commitment'; id: number }
  attributionMode: 'unscoped' | 'subject'
  subjectRequired: boolean
  allowedSubjects: Array<{ id: number; name: string }>
  semanticPath: ApplicationSemanticTargetPath
  instruction: string
  requestExample: Record<string, unknown>
}

interface TodoWriteGuide {
  tool: 'onmove.create_todo'
  parent: { type: 'thread' | 'commitment'; id: number }
  allowedAttributions: Array<'unscoped' | 'subject' | 'all-subjects'>
  allowedSubjects: Array<{ id: number; name: string }>
  instruction: string
  requestExamples: Record<string, Record<string, unknown>>
}

interface UpdateNoteWriteGuide {
  tool: 'onmove.update_note'
  noteId: number
  expectedRevision: number
  instruction: string
  requestExample: {
    id: number
    expectedRevision: number
    richText: OnMoveRichTextDocument
    clear?: boolean
  }
}

interface PatchNoteTextWriteGuide {
  tool: 'onmove.patch_note_text'
  noteId: number
  expectedRevision: number
  instruction: string
  requestExample: {
    id: number
    expectedRevision: number
    findText: string
    replaceText: string
  }
}

interface NoteWriteGuide {
  patchNoteText: PatchNoteTextWriteGuide
  updateNote: UpdateNoteWriteGuide
}

type RichTextFieldTarget =
  | { type: 'focus-description'; focusId: number }
  | { type: 'update-observation'; updateId: number }

interface RichTextFieldWriteGuide {
  patchRichText: {
    tool: 'onmove.patch_rich_text'
    target: RichTextFieldTarget
    expectedRevision: number
    instruction: string
    requestExample: Record<string, unknown>
  }
  updateRichText: {
    tool: 'onmove.update_rich_text'
    target: RichTextFieldTarget
    expectedRevision: number
    instruction: string
    requestExample: Record<string, unknown>
  }
}

function applicationRichTextReference(target: RichTextFieldTarget): ApplicationRichTextReference {
  return target.type === 'focus-description'
    ? { type: 'focus', id: target.focusId, field: 'description' }
    : { type: 'update', id: target.updateId, field: 'observation' }
}

function richTextFieldWriteGuide(
  target: RichTextFieldTarget,
  expectedRevision: number
): RichTextFieldWriteGuide {
  const label = target.type === 'focus-description' ? 'Focus description' : 'Update observation'
  return {
    patchRichText: {
      tool: 'onmove.patch_rich_text',
      target,
      expectedRevision,
      instruction:
        `Prefer this tool for a localized ${label} wording or formatting change. Send the ` +
        'revision just read and exact findText; surrounding structure, links, colors, and ' +
        'unspecified marks remain unchanged.',
      requestExample: {
        target,
        expectedRevision,
        findText: 'hello world',
        replaceText: 'hi there'
      }
    },
    updateRichText: {
      tool: 'onmove.update_rich_text',
      target,
      expectedRevision,
      instruction:
        `Use full-document replacement only for structural ${label} edits. Copy the returned ` +
        'richText document, edit it, and submit it with the revision just read. If richText is ' +
        'absent, re-query the record with includeRichText=true first. If populated ' +
        'text is intentionally being emptied, also send clear=true.',
      requestExample: {
        target,
        expectedRevision,
        richText: plainRichTextDocument(`Replacement ${label.toLocaleLowerCase()}.`)
      }
    }
  }
}

function withUpdateRichTextWriteGuide(value: unknown): unknown {
  const update = record(value)
  if (!update || !Number.isSafeInteger(update.id) ||
      !Number.isSafeInteger(update.observationRevision)) return value
  return {
    ...update,
    observationWriteGuide: richTextFieldWriteGuide(
      { type: 'update-observation', updateId: Number(update.id) },
      Number(update.observationRevision)
    )
  }
}

function withEmbeddedUpdateRichTextWriteGuides(value: unknown): unknown {
  const context = record(value)
  if (!context || !Array.isArray(context.updates)) return value
  return {
    ...context,
    updates: context.updates.map(withUpdateRichTextWriteGuide)
  }
}

function withUpdateContextWriteGuide(value: unknown): unknown {
  const context = record(value)
  if (!context || !('update' in context)) return value
  return { ...context, update: withUpdateRichTextWriteGuide(context.update) }
}

function withFocusDescriptionWriteGuide(value: unknown): unknown {
  const context = record(value)
  const reference = record(context?.reference)
  const entity = record(context?.entity)
  if (reference?.type !== 'focus' || !Number.isSafeInteger(reference.id) ||
      !entity || !Number.isSafeInteger(entity.descriptionRevision) ||
      !('descriptionRichText' in entity)) return value
  return {
    ...context,
    entity: {
      ...entity,
      descriptionWriteGuide: richTextFieldWriteGuide(
        { type: 'focus-description', focusId: Number(reference.id) },
        Number(entity.descriptionRevision)
      )
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function subjectRecord(value: unknown): { id: number; name: string } | null {
  const candidate = record(value)
  return candidate && Number.isSafeInteger(candidate.id) && typeof candidate.name === 'string'
    ? { id: Number(candidate.id), name: candidate.name }
    : null
}

function contextWriteTarget(value: unknown): {
  parent: { type: 'thread' | 'commitment'; id: number }
  scopeId: number | null
  allowedSubjects: Array<{ id: number; name: string }>
} | null {
  const context = record(value)
  const reference = record(context?.reference)
  if (
    !context || !reference ||
    (reference.type !== 'thread' && reference.type !== 'commitment') ||
    !Number.isSafeInteger(reference.id)
  ) return null
  const parent = { type: reference.type, id: Number(reference.id) } as const
  const scope = record(context.scope)
  const candidates = parent.type === 'thread'
    ? (Array.isArray(scope?.subjects) ? scope.subjects : [])
    : (Array.isArray(scope?.cells)
        ? scope.cells.map((cell) => record(cell)?.subject)
        : [])
  return {
    parent,
    scopeId: typeof scope?.scopeId === 'number' ? scope.scopeId : null,
    allowedSubjects: [...new Map(candidates.flatMap((candidate) => {
      const subject = subjectRecord(candidate)
      return subject ? [[subject.id, subject] as const] : []
    })).values()]
  }
}

function semanticPathFromContext(
  value: unknown,
  subject: { id: number; name: string } | null = null
): ApplicationSemanticTargetPath | null {
  const context = record(value)
  if (!context || !Array.isArray(context.contextPath)) return null
  const entries = context.contextPath.map(record).filter((entry): entry is Record<string, unknown> =>
    entry !== null)
  const focus = entries.find((entry) => entry.type === 'focus')
  const thread = entries.find((entry) => entry.type === 'thread')
  const commitment = entries.find((entry) => entry.type === 'commitment')
  if (!thread || !Number.isSafeInteger(thread.id) || typeof thread.title !== 'string') return null
  return {
    ...(focus && Number.isSafeInteger(focus.id) && typeof focus.title === 'string'
      ? { focus: { id: Number(focus.id), title: focus.title } }
      : {}),
    thread: { id: Number(thread.id), title: thread.title },
    ...(commitment && Number.isSafeInteger(commitment.id) && typeof commitment.title === 'string'
      ? { commitment: { id: Number(commitment.id), title: commitment.title } }
      : {}),
    ...(subject ? { subject } : {})
  }
}

function updateWriteGuide(value: unknown): UpdateWriteGuide | null {
  const target = contextWriteTarget(value)
  if (!target) return null
  const { parent, scopeId, allowedSubjects } = target
  const baseSemanticPath = semanticPathFromContext(value)
  if (!baseSemanticPath) return null
  const subjectRequired = scopeId !== null && allowedSubjects.length > 0
  if (!subjectRequired) {
    return {
      tool: 'onmove.create_update',
      parent,
      attributionMode: 'unscoped',
      subjectRequired: false,
      allowedSubjects: [],
      semanticPath: baseSemanticPath,
      instruction:
        `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id} accepts an ` +
        'unscoped Update. Omit subjectId or use attribution.mode="unscoped".',
      requestExample: {
        parent,
        attribution: { mode: 'unscoped' },
        semanticPath: baseSemanticPath,
        richText: plainRichTextDocument('Write the Update observation here.')
      }
    }
  }
  return {
    tool: 'onmove.create_update',
    parent,
    attributionMode: 'subject',
    subjectRequired: true,
    allowedSubjects,
    semanticPath: { ...baseSemanticPath, subject: allowedSubjects[0] },
    instruction:
      `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id} is scoped. ` +
      'Choose exactly one allowed Subject and use attribution.mode="subject".',
    requestExample: {
      parent,
      attribution: { mode: 'subject', subjectId: allowedSubjects[0].id },
      semanticPath: { ...baseSemanticPath, subject: allowedSubjects[0] },
      richText: plainRichTextDocument('Write the Update observation here.')
    }
  }
}

function todoWriteGuide(value: unknown): TodoWriteGuide | null {
  const target = contextWriteTarget(value)
  if (!target) return null
  const { parent, scopeId, allowedSubjects } = target
  if (scopeId === null || allowedSubjects.length === 0) {
    return {
      tool: 'onmove.create_todo',
      parent,
      allowedAttributions: ['unscoped'],
      allowedSubjects: [],
      instruction:
        `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id} accepts an ` +
        'unscoped Todo. Omit attribution or use attribution.mode="unscoped".',
      requestExamples: {
        unscoped: {
          parent,
          attribution: { mode: 'unscoped' },
          name: 'Describe the action.'
        }
      }
    }
  }
  return {
    tool: 'onmove.create_todo',
    parent,
    allowedAttributions: ['subject', 'all-subjects'],
    allowedSubjects,
    instruction:
      `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id} is scoped. ` +
      'Choose one allowed Subject for an individual Todo, or all-subjects for one shared Todo ' +
      'with independently completable Subject cells.',
    requestExamples: {
      subject: {
        parent,
        attribution: { mode: 'subject', subjectId: allowedSubjects[0].id },
        name: 'Describe the action.'
      },
      allSubjects: {
        parent,
        attribution: { mode: 'all-subjects' },
        name: 'Describe the shared action.'
      }
    }
  }
}

function withWriteGuide(value: unknown): unknown {
  const decorated = withEmbeddedUpdateRichTextWriteGuides(value)
  const context = record(decorated)
  const createUpdate = updateWriteGuide(value)
  const createTodo = todoWriteGuide(value)
  return context && createUpdate && createTodo
    ? { ...context, writeGuide: { createUpdate, createTodo } }
    : decorated
}

function noteWriteGuide(value: unknown): NoteWriteGuide | null {
  const context = record(value)
  const reference = record(context?.reference)
  const note = record(context?.note)
  if (
    reference?.type !== 'note' || !Number.isSafeInteger(reference.id) ||
    !note || !Number.isSafeInteger(note.revision)
  ) return null
  const noteId = Number(reference.id)
  const expectedRevision = Number(note.revision)
  return {
    patchNoteText: {
      tool: 'onmove.patch_note_text',
      noteId,
      expectedRevision,
      instruction:
        'Prefer this tool for a localized wording or formatting change. Send the revision just ' +
        'read, an exact findText, and replaceText and/or mark changes; unspecified rich-text ' +
        'structure and formatting remain unchanged.',
      requestExample: {
        id: noteId,
        expectedRevision,
        findText: 'hello world',
        replaceText: 'hi there'
      }
    },
    updateNote: {
      tool: 'onmove.update_note',
      noteId,
      expectedRevision,
      instruction:
        'Use full-document replacement only for structural edits. Send the revision just read as ' +
        'expectedRevision. A stale revision is rejected; read the Note again and reconcile before ' +
        'retrying. If note.richText is absent, re-query with includeRichText=true before replacing ' +
        'the document. Copy note.richText, edit it, and submit it as richText; note.content is a ' +
        'read-only Markdown projection. If a populated Note is intentionally being emptied, ' +
        'also send clear=true.',
      requestExample: {
        id: noteId,
        expectedRevision,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{ type: 'text', text: 'Replacement Note content.' }]
          }]
        }
      }
    }
  }
}

function withNoteWriteGuide(value: unknown): unknown {
  const context = record(value)
  const writeGuide = noteWriteGuide(value)
  return context && writeGuide
    ? { ...context, writeGuide }
    : value
}

function withEmbeddedNoteWriteGuides(value: unknown): unknown {
  const context = record(value)
  if (!context || !Array.isArray(context.notes)) return value
  return {
    ...context,
    notes: context.notes.map((entry) => {
      const note = record(entry)
      if (!note || !Number.isSafeInteger(note.id) || !('richText' in note)) return entry
      const writeGuide = noteWriteGuide({
        reference: { type: 'note', id: note.id },
        note
      })
      return writeGuide ? { ...note, writeGuide } : note
    })
  }
}

function withoutNoteRichText(value: unknown): unknown {
  const context = record(value)
  const note = record(context?.note)
  if (!context || !note) return value
  const summary = { ...note }
  delete summary.richText
  return { ...context, note: summary }
}

function resolveSearchScope(
  input: SearchScopeInput | null | undefined,
  currentUiContext: McpUiContextSnapshot
): { query: Pick<SearchQuery, 'focusId' | 'threadId' | 'subjectId'>; diagnostics: McpDiagnostics } {
  const requested = input ?? { mode: 'all' }
  const warnings: string[] = []
  const explicitFocusId = requested.focusId ?? null
  const explicitThreadId = requested.threadId ?? null
  const explicitSubjectId = requested.subjectId ?? null

  if (requested.mode === 'all') {
    if (explicitFocusId !== null || explicitThreadId !== null || explicitSubjectId !== null) {
      warnings.push('scope.mode is all, so focusId, threadId, and subjectId were ignored.')
    }
    return {
      query: { focusId: null, threadId: null, subjectId: null },
      diagnostics: {
        appliedScope: {
          ...GLOBAL_SCOPE,
          source: input === null || input === undefined ? 'default' : 'explicit'
        },
        warnings
      }
    }
  }

  if (requested.mode === 'focus') {
    if (explicitFocusId === null) {
      warnings.push('scope.mode was focus but focusId was null or omitted, so the search was global.')
      return {
        query: { focusId: null, threadId: null, subjectId: null },
        diagnostics: {
          appliedScope: { ...GLOBAL_SCOPE, requestedMode: 'focus', source: 'explicit' },
          warnings
        }
      }
    }
    if (explicitThreadId !== null) warnings.push('threadId was ignored because scope.mode is focus.')
    if (explicitSubjectId !== null) warnings.push('subjectId was ignored because scope.mode is focus.')
    const appliedScope: AppliedSearchScope = {
      requestedMode: 'focus', mode: 'focus', focusId: explicitFocusId, threadId: null,
      subjectId: null,
      source: 'explicit', description: `Search within Focus ${explicitFocusId} and its descendants.`
    }
    return {
      query: { focusId: explicitFocusId, threadId: null, subjectId: null },
      diagnostics: { appliedScope, warnings }
    }
  }

  if (requested.mode === 'thread') {
    if (explicitThreadId === null) {
      warnings.push('scope.mode was thread but threadId was null or omitted, so the search was global.')
      return {
        query: { focusId: null, threadId: null, subjectId: null },
        diagnostics: {
          appliedScope: { ...GLOBAL_SCOPE, requestedMode: 'thread', source: 'explicit' },
          warnings
        }
      }
    }
    if (explicitFocusId !== null) warnings.push('focusId was ignored because scope.mode is thread.')
    if (explicitSubjectId !== null) warnings.push('subjectId was ignored because scope.mode is thread.')
    const appliedScope: AppliedSearchScope = {
      requestedMode: 'thread', mode: 'thread', focusId: null, threadId: explicitThreadId,
      subjectId: null, source: 'explicit',
      description: `Search within Thread ${explicitThreadId} and its children.`
    }
    return {
      query: { focusId: null, threadId: explicitThreadId, subjectId: null },
      diagnostics: { appliedScope, warnings }
    }
  }

  if (requested.mode === 'subject') {
    if (explicitSubjectId === null) {
      warnings.push('scope.mode was subject but subjectId was null or omitted, so the search was global.')
      return {
        query: { focusId: null, threadId: null, subjectId: null },
        diagnostics: {
          appliedScope: { ...GLOBAL_SCOPE, requestedMode: 'subject', source: 'explicit' },
          warnings
        }
      }
    }
    if (explicitFocusId !== null) warnings.push('focusId was ignored because scope.mode is subject.')
    if (explicitThreadId !== null) warnings.push('threadId was ignored because scope.mode is subject.')
    const appliedScope: AppliedSearchScope = {
      requestedMode: 'subject', mode: 'subject', focusId: null, threadId: null,
      subjectId: explicitSubjectId,
      source: 'explicit', description: `Search records attributed to Subject ${explicitSubjectId}.`
    }
    return {
      query: { focusId: null, threadId: null, subjectId: explicitSubjectId },
      diagnostics: { appliedScope, warnings }
    }
  }

  if (explicitFocusId !== null || explicitThreadId !== null || explicitSubjectId !== null) {
    warnings.push('focusId, threadId, and subjectId were ignored because scope.mode=current reads the live OnMove UI selection.')
  }
  const focusId = currentUiContext.focusId ?? null
  const subjectId = currentUiContext.subjectId ?? null
  const description = focusId === null && subjectId === null
    ? 'The current UI has no selected Focus or Subject, so this search is global.'
    : `Search within the current UI context${focusId === null ? '' : ` Focus ${focusId}`}${subjectId === null ? '' : `, Subject ${subjectId}`}.`
  if (focusId === null && subjectId === null) {
    warnings.push('scope.mode=current found no selected Focus or Subject; the search was global.')
  }
  const appliedScope: AppliedSearchScope = {
    requestedMode: 'current',
    mode: focusId === null && subjectId === null ? 'all' : 'current',
    focusId,
    threadId: null,
    subjectId,
    source: 'current-ui', description
  }
  return { query: { focusId, threadId: null, subjectId }, diagnostics: { appliedScope, warnings } }
}

function result(value: unknown, diagnostics: McpDiagnostics = diagnosticsScope()): {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const decoratedValue = withEntityCodes(value)
  const structuredContent = decoratedValue && typeof decoratedValue === 'object' &&
      !Array.isArray(decoratedValue)
    ? { ...(decoratedValue as Record<string, unknown>), diagnostics }
    : { items: decoratedValue, diagnostics }
  const textContent = withEntityMarkdownLinks(structuredContent)
  return {
    // MCP clients commonly retain both content and structuredContent. Compact JSON avoids
    // needlessly doubling whitespace in the model context while preserving identical data.
    content: [{ type: 'text', text: JSON.stringify(textContent) }],
    structuredContent
  }
}

const RETRIEVAL_PRIVATE_FIELDS = new Set([
  'rank',
  'sourceKey',
  'providerRank',
  'providerScore'
])

/** Keeps retrieval provider internals and lossless documents out of the public MCP contract. */
function retrievalSafeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(retrievalSafeValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (RETRIEVAL_PRIVATE_FIELDS.has(key) || key.toLocaleLowerCase().includes('richtext')) return []
    return [[key, retrievalSafeValue(child)]]
  }))
}

const ENTITY_REFERENCE_KINDS = new Set<EntityReferenceKind>([
  'focus', 'thread', 'commitment', 'routine', 'update', 'todo', 'note', 'subject'
])

function entityKind(value: unknown): EntityReferenceKind | null {
  return typeof value === 'string' && ENTITY_REFERENCE_KINDS.has(value as EntityReferenceKind)
    ? value as EntityReferenceKind
    : null
}

function entityDisplayName(
  current: Record<string, unknown>,
  explicitEntity: Record<string, unknown> | null,
  discoverySubject: Record<string, unknown> | null,
  kind: EntityReferenceKind
): string {
  const entity = record(current.entity)
  const note = record(current.note)
  const candidates = [
    current.title,
    current.name,
    entity?.title,
    entity?.name,
    explicitEntity?.title,
    explicitEntity?.name,
    discoverySubject?.name,
    note?.title
  ]
  const name = candidates.find((candidate) =>
    typeof candidate === 'string' && candidate.trim().length > 0)
  return typeof name === 'string'
    ? name
    : kind === 'todo' ? 'Todo' : `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`
}

/** Adds public codes at the schema-validated MCP structured-content boundary. */
function withEntityCodes(value: unknown, key: string | null = null): unknown {
  if (Array.isArray(value)) return value.map((item) => withEntityCodes(item, key))
  const current = record(value)
  if (!current) return value

  const decorated = Object.fromEntries(
    Object.entries(current).map(([childKey, childValue]) => [
      childKey,
      withEntityCodes(childValue, childKey)
    ])
  )
  const reference = record(current.reference) ?? record(current.source)
  const referencedKind = entityKind(reference?.type)
  const structuralKind = 'subjectCompletions' in current && 'sort' in current && 'done' in current
    ? 'todo'
    : 'observation' in current && 'date' in current && 'state' in current
      ? 'update'
      : null
  const explicitKind = key !== 'reference' && key !== 'parent' && key !== 'contextPath'
    ? entityKind(current.type) ?? entityKind(current.kind)
    : null
  const hierarchy = record(current.hierarchy)
  const explicitEntity = explicitKind
    ? record(current[explicitKind]) ?? record(hierarchy?.[explicitKind])
    : null
  const discoverySubject = key === 'namedSubjectDiscovery' ? record(current.subject) : null
  const inferredKind = referencedKind ?? structuralKind ?? explicitKind ??
    (discoverySubject ? 'subject' : null)
  const id = Number(reference?.id ?? current.id ?? explicitEntity?.id ?? discoverySubject?.id)
  if (inferredKind && Number.isSafeInteger(id) && id > 0) {
    decorated.code = entityReference(inferredKind, id)
  }
  return decorated
}

/**
 * Enriches only the model-facing text copy. Tool output schemas remain stable
 * while a single primary coded result still supplies a ready clickable link.
 */
function withEntityMarkdownLinks(value: unknown, eligible = true): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => withEntityMarkdownLinks(item, false))
  }
  const current = record(value)
  if (!current) return value
  const decorated = Object.fromEntries(
    Object.entries(current).map(([key, child]) => [key, withEntityMarkdownLinks(child, false)])
  )
  if (!eligible) return decorated
  const parsed = typeof current.code === 'string' ? parseEntityReference(current.code) : null
  if (!parsed) return decorated
  const explicitEntity = record(current.entity)
  const discoverySubject = record(current.subject)
  decorated.markdownLink = onMoveMarkdownEntityLink(
    parsed.kind,
    parsed.id,
    entityDisplayName(current, explicitEntity, discoverySubject, parsed.kind)
  )
  return decorated
}

/** Measures the complete MCP tool result, including duplicated text and structured payloads. */
function resultPayloadBytes(value: unknown, diagnostics: McpDiagnostics): number {
  return Buffer.byteLength(JSON.stringify(result(value, diagnostics)), 'utf8')
}

function entityReadDiagnostics(value: unknown): McpDiagnostics {
  const context = record(value)
  const warnings = Array.isArray(context?.warnings)
    ? context.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return { ...diagnosticsScope(), warnings }
}

function compactEntityReadDiagnostics(value: unknown): McpDiagnostics {
  const diagnostics = entityReadDiagnostics(value)
  return { ...diagnostics, warnings: [...diagnostics.warnings, RICH_TEXT_OMITTED_WARNING] }
}

function richTextInputErrorResult(error: RichTextToolInputError): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const example = plainRichTextDocument('Write rich text here.')
  const pointer = error.validationIssue
    ? `/richText${error.validationIssue.pointer === '/'
        ? ''
        : error.validationIssue.pointer}`
    : '/richText'
  const structuredContent = {
    error: {
      code: error.code,
      tool: error.tool,
      field: 'richText',
      pointer,
      ...(error.validationIssue
        ? {
            received: error.validationIssue.received,
            correction: error.validationIssue.correction
          }
        : {}),
      message: error.message
    },
    recovery: {
      preferredField: 'richText',
      supportedMarks: ONMOVE_RICH_TEXT_MARKS,
      acceptedMarkAliases: { 'highlight-yellow': 'highlight' },
      instruction:
        error.validationIssue
          ? `Change the node at ${pointer} to the supplied correction before retrying. ` +
            'Do not resend the unchanged payload.'
          : 'Send the complete version=1 document under richText. marks is an array using bold, ' +
            'italic, underline, strikethrough, or highlight. highlight is the yellow highlighter; ' +
            'highlight-yellow is accepted and canonicalized to highlight.',
      example: error.validationIssue
        ? { pointer, value: error.validationIssue.correction }
        : { richText: example }
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.message}\n${structuredContent.recovery.instruction}` }],
    structuredContent
  }
}

function resource(uri: URL, value: unknown): {
  contents: Array<{ uri: string; mimeType: string; text: string }>
} {
  return {
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(
        (() => {
          const decorated = withEntityCodes(value)
          return decorated && typeof decorated === 'object' && !Array.isArray(decorated)
            ? { ...(decorated as Record<string, unknown>), diagnostics: diagnosticsScope() }
            : { items: decorated, diagnostics: diagnosticsScope() }
        })(),
        null,
        2
      )
    }]
  }
}

function found<T>(value: T | null): T {
  if (value === null) throw new Error('The requested OnMove record was not found.')
  return value
}

function variableId(value: string | string[] | undefined): number {
  const normalized = Array.isArray(value) ? value[0] : value
  const id = Number(normalized)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('The requested OnMove record was not found.')
  }
  return id
}

interface CreateUpdateToolInput {
  parent: { type: 'thread' | 'commitment'; id: number }
  attribution?: null | { mode: 'unscoped' } | { mode: 'subject'; subjectId: number }
  semanticPath?: ApplicationSemanticTargetPath
  /** Backward-compatible shorthand. Prefer attribution. */
  subjectId?: number | null
  date?: string
  richText?: OnMoveRichTextDocument
  state?: 'red' | 'yellow' | 'green' | 'none'
  sensitive?: boolean
}

interface ReparentThreadToolInput {
  id: number
  destinationFocusId: number
  plannedFromFocusId: number
  confirmedScopeSubjectIds: number[]
}

function threadReparentPlanErrorResult(
  input: ReparentThreadToolInput,
  plan: ApplicationThreadReparentPlan,
  code: 'THREAD_REPARENT_PLAN_STALE' | 'THREAD_REPARENT_CONFIRMATION_REQUIRED'
): McpErrorResult {
  const stale = code === 'THREAD_REPARENT_PLAN_STALE'
  const message = stale
    ? 'The Thread owner changed after the supplied plan. Do not guess the current source Focus.'
    : 'The supplied Scope Subject confirmation does not exactly match the current move plan.'
  const structuredContent = {
    error: {
      code,
      message,
      received: input,
      currentStatus: plan.status
    },
    currentPlan: withEntityCodes(plan),
    recovery: {
      inspect: {
        tool: 'onmove.plan_thread_reparent',
        arguments: { id: input.id, destinationFocusId: input.destinationFocusId }
      },
      retry: plan.nextAction,
      instruction: plan.status === 'confirmation-required'
        ? 'Review and confirm the listed destination Focus Scope additions with the user, then copy retry.arguments exactly.'
        : 'Copy retry.arguments exactly. Do not reuse the rejected source Focus or Subject IDs.'
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `${code}: ${message}\nSafe recovery: ${JSON.stringify(plan.nextAction)}`
    }],
    structuredContent
  }
}

function semanticTargetErrorResult(
  error: SemanticTargetValidationError,
  tool: 'onmove.create_update' | 'onmove.reparent_update',
  input: Record<string, unknown>
): McpErrorResult {
  const path = error.issue.semanticPath
  const expectedParent = path.commitment
    ? { type: 'commitment' as const, id: path.commitment.id }
    : { type: 'thread' as const, id: path.thread.id }
  const expectedAttribution = path.subject
    ? { mode: 'subject' as const, subjectId: path.subject.id }
    : { mode: 'unscoped' as const }
  const corrected = tool === 'onmove.create_update'
    ? { ...input, parent: expectedParent, attribution: expectedAttribution, semanticPath: path }
    : {
        ...input,
        destination: {
          ...(record(input.destination) ?? {}),
          parent: expectedParent,
          attribution: expectedAttribution,
          semanticPath: path
        }
      }
  delete (corrected as Record<string, unknown>).subjectId
  const resolutionArguments = {
    ...(path.focus ? { focus: { id: path.focus.id } } : {}),
    thread: { id: path.thread.id },
    ...(path.commitment
      ? { commitment: { id: path.commitment.id } }
      : {}),
    ...(path.subject
      ? { subject: { id: path.subject.id } }
      : {})
  }
  const structuredContent = {
    error: { ...error.issue, message: error.message },
    recovery: {
      inspect: { tool: 'onmove.resolve_work_target', arguments: resolutionArguments },
      retry: { tool, arguments: corrected },
      instruction:
        'Resolve the semantic path if it may be stale, then preserve its exact parent and ' +
        'Subject attribution. Never retry this request as unscoped when semanticPath has a Subject.'
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `${error.issue.code}: ${error.message}\nSuggested safe retry: ` +
        JSON.stringify(structuredContent.recovery.retry)
    }],
    structuredContent
  }
}

interface CreateTodoToolInput {
  parent: { type: 'thread' | 'commitment'; id: number }
  attribution?: null |
    { mode: 'unscoped' } |
    { mode: 'subject'; subjectId: number } |
    { mode: 'all-subjects' }
  /** Backward-compatible shorthand. Prefer attribution. */
  subjectId?: number | null
  /** Backward-compatible shorthand. Prefer attribution. */
  sharedAcrossSubjects?: boolean
  name: string
  dueDate?: string | null
}

function normalizedUpdateSubject(input: CreateUpdateToolInput): number | undefined {
  const legacySubjectId = input.subjectId ?? undefined
  if (!input.attribution) return legacySubjectId
  if (input.attribution.mode === 'unscoped') {
    if (legacySubjectId !== undefined) {
      throw new Error(
        'attribution.mode="unscoped" conflicts with subjectId. Remove subjectId and retry.'
      )
    }
    return undefined
  }
  if (legacySubjectId !== undefined && legacySubjectId !== input.attribution.subjectId) {
    throw new Error(
      'attribution.subjectId conflicts with the top-level subjectId. Use attribution only.'
    )
  }
  return input.attribution.subjectId
}

function normalizedTodoAttribution(input: CreateTodoToolInput): {
  subjectId?: number
  sharedAcrossSubjects?: boolean
} {
  const legacySubjectId = input.subjectId ?? undefined
  const legacyShared = input.sharedAcrossSubjects
  if (!input.attribution) {
    return { subjectId: legacySubjectId, sharedAcrossSubjects: legacyShared }
  }
  if (input.attribution.mode === 'unscoped') {
    if (legacySubjectId !== undefined || legacyShared === true) {
      throw new Error(
        'attribution.mode="unscoped" conflicts with subjectId or sharedAcrossSubjects.'
      )
    }
    return {}
  }
  if (input.attribution.mode === 'all-subjects') {
    if (legacySubjectId !== undefined || legacyShared === false) {
      throw new Error(
        'attribution.mode="all-subjects" conflicts with subjectId or sharedAcrossSubjects=false.'
      )
    }
    return { sharedAcrossSubjects: true }
  }
  if (legacyShared === true) {
    throw new Error('attribution.mode="subject" conflicts with sharedAcrossSubjects=true.')
  }
  if (legacySubjectId !== undefined && legacySubjectId !== input.attribution.subjectId) {
    throw new Error(
      'attribution.subjectId conflicts with the top-level subjectId. Use attribution only.'
    )
  }
  return { subjectId: input.attribution.subjectId }
}

function scopeTargetErrorResult(
  error: ScopeTargetValidationError,
  input: CreateUpdateToolInput,
  guide: UpdateWriteGuide | null
): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const base: Record<string, unknown> = { ...input }
  delete base.subjectId
  delete base.attribution
  const unscoped = error.issue.code === 'open_parent_cannot_target_subject' ||
    error.issue.code === 'empty_scope_cannot_target_subject'
  const retryArguments = unscoped
    ? { ...base, attribution: { mode: 'unscoped' } }
    : guide?.allowedSubjects.length === 1
      ? {
          ...base,
          attribution: { mode: 'subject', subjectId: guide.allowedSubjects[0].id }
        }
      : null
  const recovery = {
    inspect: {
      tool: `onmove.get_${error.issue.parent.type}_by_id`,
      arguments: { id: error.issue.parent.id },
      path: 'writeGuide.createUpdate'
    },
    allowedSubjects: guide?.allowedSubjects ?? [],
    retry: retryArguments === null
      ? null
      : { tool: 'onmove.create_update', arguments: retryArguments }
  }
  const structuredContent = {
    error: { code: error.issue.code, message: error.message, target: error.issue },
    recovery,
    diagnostics: diagnosticsScope()
  }
  const retryText = retryArguments === null
    ? 'Inspect the parent and choose one allowed Subject before retrying.'
    : `Suggested retry: ${JSON.stringify(recovery.retry)}`
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.message}\n${retryText}` }],
    structuredContent
  }
}

function todoScopeTargetErrorResult(
  error: ScopeTargetValidationError,
  input: CreateTodoToolInput,
  guide: TodoWriteGuide | null
): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const base: Record<string, unknown> = { ...input }
  delete base.subjectId
  delete base.sharedAcrossSubjects
  delete base.attribution
  const unscoped = [
    'open_parent_cannot_target_subject',
    'empty_scope_cannot_target_subject',
    'open_parent_cannot_share_across_subjects',
    'empty_scope_cannot_share_across_subjects'
  ].includes(error.issue.code)
  const retryArguments = unscoped
    ? { ...base, attribution: { mode: 'unscoped' } }
    : guide?.allowedSubjects.length === 1
      ? {
          ...base,
          attribution: { mode: 'subject', subjectId: guide.allowedSubjects[0].id }
        }
      : null
  const recovery = {
    inspect: {
      tool: `onmove.get_${error.issue.parent.type}_by_id`,
      arguments: { id: error.issue.parent.id },
      path: 'writeGuide.createTodo'
    },
    allowedAttributions: guide?.allowedAttributions ?? [],
    allowedSubjects: guide?.allowedSubjects ?? [],
    retry: retryArguments === null
      ? null
      : { tool: 'onmove.create_todo', arguments: retryArguments }
  }
  const structuredContent = {
    error: { code: error.issue.code, message: error.message, target: error.issue },
    recovery,
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: retryArguments === null
        ? `${error.message}\nInspect the parent and choose one allowed Todo attribution.`
        : `${error.message}\nSuggested retry: ${JSON.stringify(recovery.retry)}`
    }],
    structuredContent
  }
}

function reparentScopeTargetErrorResult(
  error: ScopeTargetValidationError,
  input: {
    id: number
    destination: {
      parent: { type: 'thread' | 'commitment'; id: number }
      attribution?: CreateUpdateToolInput['attribution']
      semanticPath?: ApplicationSemanticTargetPath
    }
  },
  guide: UpdateWriteGuide | null
): McpErrorResult {
  const subjectAttribution = guide?.allowedSubjects.length === 1
    ? { mode: 'subject' as const, subjectId: guide.allowedSubjects[0].id }
    : null
  const unscoped = error.issue.code === 'open_parent_cannot_target_subject' ||
    error.issue.code === 'empty_scope_cannot_target_subject'
  const attribution = unscoped ? { mode: 'unscoped' as const } : subjectAttribution
  const retry = attribution === null
    ? null
    : {
        tool: 'onmove.reparent_update',
        arguments: {
          id: input.id,
          destination: { ...input.destination, attribution }
        }
      }
  const structuredContent = {
    error: { code: error.issue.code, message: error.message, target: error.issue },
    recovery: {
      inspect: {
        tool: `onmove.get_${error.issue.parent.type}_by_id`,
        arguments: { id: error.issue.parent.id },
        path: 'writeGuide.createUpdate'
      },
      allowedSubjects: guide?.allowedSubjects ?? [],
      retry
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: retry
        ? `${error.message}\nSuggested reparent retry: ${JSON.stringify(retry)}`
        : `${error.message}\nInspect the destination and choose one allowed Subject before retrying the move.`
    }],
    structuredContent
  }
}

function noteRevisionConflictResult(error: NoteRevisionConflictError): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const structuredContent = {
    error: {
      code: 'note_revision_conflict',
      noteId: error.issue.noteId,
      expectedRevision: error.issue.expectedRevision,
      currentRevision: error.issue.currentRevision,
      parent: error.issue.parent,
      message: error.message
    },
    recovery: {
      inspect: {
        tool: 'onmove.get_note_by_id',
        arguments: { id: error.issue.noteId, includeRichText: true }
      },
      retry: null
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `${error.message} Read the Note again, reconcile the new content, and retry with ` +
        'the newly returned revision. The server will not guess how to merge text.'
    }],
    structuredContent
  }
}

function noteTextDisappearedResult(
  error: NoteTextDisappearedError,
  tool: 'onmove.update_note' | 'onmove.patch_note_text',
  retryArguments: Record<string, unknown>
): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const retry = { tool, arguments: { ...retryArguments, clear: true } }
  const structuredContent = {
    error: {
      ...error.issue,
      message: error.message
    },
    recovery: {
      inspect: { tool: 'onmove.get_note_by_id', arguments: { id: error.issue.noteId } },
      instruction:
        'The existing Note contains readable text. Confirm that clearing it is intentional, then retry the same request with clear=true.',
      retry
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `${error.issue.code}: ${error.message}\n` +
        `Intentional clear retry: ${JSON.stringify(retry)}`
    }],
    structuredContent
  }
}

function noteTextPatchErrorResult(
  error: OnMoveRichTextPatchError,
  input: { id: number; expectedRevision: number; findText: string }
): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const instruction = error.code === 'NOTE_TEXT_AMBIGUOUS'
    ? `Retry with occurrence set to a number from 1 through ${error.matchCount}.`
    : error.code === 'NOTE_TEXT_NOT_FOUND'
      ? 'Read the Note again and use an exact case-sensitive text run from note.content.'
      : error.message
  const structuredContent = {
    error: {
      code: error.code,
      noteId: input.id,
      expectedRevision: input.expectedRevision,
      findText: input.findText,
      matchCount: error.matchCount,
      message: error.message
    },
    recovery: {
      inspect: { tool: 'onmove.get_note_by_id', arguments: { id: input.id } },
      instruction
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${error.code}: ${error.message}\n${instruction}` }],
    structuredContent
  }
}

function richTextInspectRequest(target: RichTextFieldTarget): {
  tool: 'onmove.get_focus_by_id' | 'onmove.get_update_by_id'
  arguments: Record<string, unknown>
} {
  return target.type === 'focus-description'
    ? { tool: 'onmove.get_focus_by_id', arguments: { id: target.focusId, includeRichText: true } }
    : {
        tool: 'onmove.get_update_by_id',
        arguments: { id: target.updateId, includeRichText: true }
      }
}

function richTextRevisionConflictResult(
  error: RichTextRevisionConflictError,
  target: RichTextFieldTarget
): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const structuredContent = {
    error: {
      code: 'rich_text_revision_conflict',
      target,
      expectedRevision: error.issue.expectedRevision,
      currentRevision: error.issue.currentRevision,
      message: error.message
    },
    recovery: {
      inspect: richTextInspectRequest(target),
      retry: null,
      instruction:
        'Read the field again, reconcile its current content, and retry with the newly returned revision.'
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `${error.message} Read the field again and retry with its current revision. ` +
        'The server will not guess how to merge text.'
    }],
    structuredContent
  }
}

function richTextDisappearedResult(
  error: RichTextDisappearedError,
  tool: 'onmove.update_rich_text' | 'onmove.patch_rich_text',
  target: RichTextFieldTarget,
  retryArguments: Record<string, unknown>
): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const retry = { tool, arguments: { ...retryArguments, clear: true } }
  const structuredContent = {
    error: { ...error.issue, target, message: error.message },
    recovery: {
      inspect: richTextInspectRequest(target),
      instruction:
        'The existing field contains readable text. Confirm that clearing it is intentional, then retry the same request with clear=true.',
      retry
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `${error.issue.code}: ${error.message}\n` +
        `Intentional clear retry: ${JSON.stringify(retry)}`
    }],
    structuredContent
  }
}

function richTextPatchErrorResult(
  error: OnMoveRichTextPatchError,
  input: { target: RichTextFieldTarget; expectedRevision: number; findText: string }
): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const code = error.code.replace(/^NOTE_TEXT/u, 'RICH_TEXT')
  const instruction = error.code === 'NOTE_TEXT_AMBIGUOUS'
    ? `Retry with occurrence set to a number from 1 through ${error.matchCount}.`
    : error.code === 'NOTE_TEXT_NOT_FOUND'
      ? 'Read the field again and use exact case-sensitive text from its Markdown projection.'
      : error.message
  const structuredContent = {
    error: {
      code,
      target: input.target,
      expectedRevision: input.expectedRevision,
      findText: input.findText,
      matchCount: error.matchCount,
      message: error.message
    },
    recovery: {
      inspect: richTextInspectRequest(input.target),
      instruction
    },
    diagnostics: diagnosticsScope()
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${error.message}\n${instruction}` }],
    structuredContent
  }
}

function decorateResolvedTarget(
  database: AppDatabase,
  candidate: ApplicationResolvedTargetCandidate,
  access: ReturnType<AppDatabase['mcpSettings']['accessPolicy']>
): Record<string, unknown> {
  const context = candidate.parent.type === 'thread'
    ? database.queries.getThread(candidate.parent.id, access)
    : database.queries.getCommitment(candidate.parent.id, access)
  const createUpdate = updateWriteGuide(context)
  const createTodo = todoWriteGuide(context)
  const semanticPath: ApplicationSemanticTargetPath = {
    focus: candidate.hierarchy.focus,
    thread: candidate.hierarchy.thread,
    ...(candidate.hierarchy.commitment
      ? { commitment: candidate.hierarchy.commitment }
      : {}),
    ...(candidate.subject ? { subject: candidate.subject } : {})
  }
  const notation = {
    focus: candidate.hierarchy.focus.title,
    thread: candidate.hierarchy.thread.title,
    ...(candidate.hierarchy.commitment
      ? { commitment: candidate.hierarchy.commitment.title }
      : {}),
    ...(candidate.subject ? { subject: candidate.subject.name } : {})
  }
  const relativePath = [
    candidate.hierarchy.thread.title,
    candidate.hierarchy.commitment?.title
  ].filter((value): value is string => Boolean(value))
  if (candidate.subject) {
    relativePath[relativePath.length - 1] =
      `${relativePath.at(-1)}[${candidate.subject.name}]`
  }
  const recommendedUpdateRequest = candidate.subject
    ? {
        tool: 'onmove.create_update',
        arguments: {
          parent: candidate.parent,
          attribution: { mode: 'subject', subjectId: candidate.subject.id },
          semanticPath
        }
      }
    : createUpdate?.attributionMode === 'unscoped'
      ? {
          tool: 'onmove.create_update',
          arguments: {
            parent: candidate.parent,
            attribution: { mode: 'unscoped' },
            semanticPath
          }
        }
      : null
  const recommendedTodoRequest = candidate.subject
    ? {
        tool: 'onmove.create_todo',
        arguments: {
          parent: candidate.parent,
          attribution: { mode: 'subject', subjectId: candidate.subject.id }
        }
      }
    : createTodo?.allowedAttributions.length === 1 &&
        createTodo.allowedAttributions[0] === 'unscoped'
      ? {
          tool: 'onmove.create_todo',
          arguments: { parent: candidate.parent, attribution: { mode: 'unscoped' } }
        }
      : null
  return {
    ...candidate,
    notation,
    displayPath: relativePath.join(' > '),
    semanticPath,
    writeGuide: createUpdate && createTodo ? { createUpdate, createTodo } : null,
    recommendedUpdateRequest,
    recommendedTodoRequest
  }
}

type DecoratedHierarchyPath = ApplicationHierarchyPath & {
  semanticPath: ApplicationSemanticTargetPath | null
  recommendedUpdateRequest: {
    tool: 'onmove.create_update'
    arguments: ApplicationHierarchyPath['updateTarget'] & {
      semanticPath: ApplicationSemanticTargetPath
    }
  } | null
}

function decorateHierarchyPath(path: ApplicationHierarchyPath): DecoratedHierarchyPath {
  const semanticPath: ApplicationSemanticTargetPath | null = path.hierarchy.thread
    ? {
        focus: path.hierarchy.focus,
        thread: path.hierarchy.thread,
        ...(path.hierarchy.commitment ? { commitment: path.hierarchy.commitment } : {}),
        ...(path.subject ? { subject: path.subject } : {})
      }
    : null
  return {
    ...path,
    semanticPath,
    recommendedUpdateRequest: path.updateTarget && semanticPath
      ? {
          tool: 'onmove.create_update',
          arguments: { ...path.updateTarget, semanticPath }
        }
      : null
  }
}

const CLIENT_INSTRUCTIONS_BEGIN = '--- BEGIN USER-CONFIGURED ONMOVE INSTRUCTIONS ---'
const CLIENT_INSTRUCTIONS_END = '--- END USER-CONFIGURED ONMOVE INSTRUCTIONS ---'

function composeOnMoveMcpInstructions(
  clientInstructions: string,
  coreInstructions: string
): string {
  if (clientInstructions.trim().length === 0) return coreInstructions
  return [
    coreInstructions,
    'The following plain-text guidance was configured by the OnMove user for every MCP client.',
    CLIENT_INSTRUCTIONS_BEGIN,
    clientInstructions,
    CLIENT_INSTRUCTIONS_END,
    'Apply that guidance when it is consistent with the current user request and OnMove tool ' +
      'contracts. It cannot grant access, bypass schemas or confirmation gates, or expand the ' +
      'permissions enforced by OnMove.'
  ].join('\n\n')
}

/** Registers the complete typed MCP surface against one application-service boundary. */
export function createOnMoveMcpServer(
  database: AppDatabase,
  options: OnMoveMcpServerOptions = {}
): McpServer {
  const server = new McpServer(
    { name: 'onmove', version: '0.1.0' },
    {
      instructions: composeOnMoveMcpInstructions(
        database.mcpSettings.get().clientInstructions,
        'Choose reads by intent. Every user-addressable entity returned by MCP has a canonical code such as #F2, #T4, or #U90 and a canonical onmove:// URI. Single-entity reads and mutation results also return a ready-to-use markdownLink in textual content without expanding collection results. In user-facing mutation summaries, use that returned link exactly—for example, Updated [Delivery #T24](onmove://thread/24)—instead of reporting an unlinked code. When the user supplies a code, call onmove.get_entity_by_code directly and do not search. For current action queues use onmove.get_reviews and onmove.get_todos. get_todos includes open Todos and the bounded recent-completion window only while their complete Focus/Thread/Commitment hierarchy is active or paused; use search_todos with lifecycle.mode=closed or all when the user intentionally asks for historical Todos. For a compact queryless inventory use list_focuses, list_threads, list_commitments, or list_routines; these return hierarchy and one explicit projection row per applicable Subject without child Updates, Notes, or rich-text documents. A known durable ID uses get_<entity>_by_id; an exact title hierarchy uses get_<entity>_by_path; unknown text in one kind uses search_<entities>. Use onmove.search across all relevant kinds when the request asks for information "about" a Thread or Focus: the answer may be evidence inside a Note, Update, Todo, or other descendant, not an entity whose title matches the words. Each primary search match always reports its exact matched field, containing Thread, complete coded path, lifecycle provenance, and recommendedWriteTarget; these are never optional or budget-truncated. hierarchyPaths is only an auxiliary Subject/Scope expansion and must not replace each match\'s own path. Path tools accept titles only and return ambiguity rather than guessing. Updates have get_update_by_id, get_updates_by_ids, and search_updates but no by-path getter because a hierarchy path is not unique. Compact reads render rich fields as Markdown and omit lossless richText. Search never returns lossless rich text. Request includeRichText=true on one known entity only immediately before a full structural replacement. Use onmove.retrieve after exact hierarchy IDs are known when evidence must stay inside an explicit workspace, Focus, asserted Focus/Thread, and optional canonical Subject intersection, or when provider-neutral enhanced retrieval is useful. Context IDs are operational identity boundaries: semantic relevance can rank evidence inside them but must never disambiguate an entity, select a sibling context, or choose a write target. Search and retrieve resolve an omitted lifecycle from OnMove Settings: current active/paused lineage by default, or all current and closed work when Include closed work in MCP results is enabled. Explicit lifecycle.mode=current, closed, or all always overrides that preference. Every hit reports direct status, effective lifecycle, complete lineage, and explicit closure provenance identifying direct versus parent-inherited closure. Never silently treat excluded history as current; when lifecycleCoverage.wideningRecommended is true, repeat the same initial request exactly as directed by lifecycleCoverage.nextAction. The legacy onmove.search, onmove.continue_search, and every onmove.search_<kind> tool remain available for initial cross-kind discovery, exact lexical search, queryless structured listing, and Subject hierarchy projection. Send the user\'s specific entity/Subject name as text, or send text=null with kinds for a queryless list; omit scope for global visibility. Initial search tools never accept continuationToken. Natural-language wrappers retain meaningful entity terms. Date, createdAt, and updatedAt are structured local-date ranges, never full-text terms. Projection controls auxiliary Subject/Scope expansion, not required primary hierarchy. Inspect projections.*.complete before treating auxiliary paths or Subject uses as exhaustive. For another page call onmove.continue_search with only the returned non-null UUID continuationToken. The running app keeps the complete signed query server-side; the UUID expires after 3 hours or an MCP server restart, and inserted whitespace is tolerated. Never invent a UUID. If SEARCH_CURSOR_STALE or SEARCH_CONTINUATION_EXPIRED_OR_UNKNOWN is returned, restart the original search tool with its criteria. When a request names a Subject, preserve it as the primary filter, inspect namedSubjectDiscovery and subjectUses, and treat attributed uses as authoritative. If searchStatus.sufficient or doNotBroaden is true, stop global discovery and fetch returned IDs or continue only inside the returned boundary. Use onmove.review_subject for a compact person/entity situation inside one Thread. Paths use {thread:"Team management",commitment:"1:1s",subject:"Michael"}, displayed as Team management > 1:1s[Michael]. Preserve bracketed Subject attribution on create_update. Use onmove.resolve_work_target for semantic scoped-write planning. Before mutations inspect writeGuide. Use onmove.reparent_update to repair wrong Update placement. To move a Thread between Focuses, call onmove.plan_thread_reparent first, inspect its Scope effects, then copy its exact nextAction arguments into onmove.reparent_thread. Delete only after the user explicitly asks for and confirms the exact target; onmove.delete_entity requires confirm=true and may cascade through owned descendants. Inspect diagnostics and warnings. OnMove Settings controls sensitive access, the omitted lifecycle default, and independent View/Edit/Delete grants by resource, Focus, and Thread.'
      )
    }
  )
  const policy = () => database.mcpSettings.accessPolicy()
  const configuredDefaultLifecycleMode = (): SearchLifecycleMode =>
    database.mcpSettings.get().includeClosedByDefault ? 'all' : 'current'
  const resolveInitialLifecycle = (
    lifecycle: SearchLifecycleQuery | undefined
  ): AppliedSearchLifecycle => normalizeSearchLifecycle(
    lifecycle,
    configuredDefaultLifecycleMode()
  )
  const searchContinuationStore = options.searchContinuationStore ?? new SearchContinuationStore()
  const issueSearchContinuation = (payload: SearchContinuationPayload): string =>
    searchContinuationStore.issue(encodeSearchContinuation(payload))
  const resolveSearchContinuation = (handle: string): SearchContinuationPayload =>
    decodeSearchContinuation(searchContinuationStore.resolve(handle))
  const retrievalContinuationStore = options.retrievalContinuationStore ??
    new RetrievalContinuationStore()
  const retrievalServerNonce = retrievalContinuationStore.serverNonce()
  const issueRetrievalContinuation = (payload: RetrievalContinuationPayload): string =>
    retrievalContinuationStore.issue(encodeRetrievalContinuation(payload))
  const resolveRetrievalContinuation = (handle: string): RetrievalContinuationPayload =>
    decodeRetrievalContinuation(
      retrievalContinuationStore.resolve(handle),
      retrievalServerNonce
    )
  const retrievalEnvironment = () => {
    const settings = database.mcpSettings.get()
    const access = {
      sensitiveContent: settings.allowSensitive ? 'allow' as const : 'deny' as const,
      mutations: settings.allowMutations ? 'allow' as const : 'read-only' as const,
      permissionPolicy: settings.permissionPolicy
    }
    const accessFingerprint = createHmac('sha256', SEARCH_CONTINUATION_SECRET)
      .update(`onmove-retrieval-access-v1:${JSON.stringify(access)}`)
      .digest('base64url')
    return { access, accessFingerprint, retrievalMode: settings.retrievalMode }
  }
  const notifyMutation = (): void => {
    // Source-table triggers already invalidate the projection. This explicit MCP boundary makes
    // that guarantee resilient if a future command writes through a new persistence path.
    database.queries.searchIndex.invalidate()
    options.onMutation?.()
  }
  const rejectedCalls = options.rejectedCallTracker ?? new RejectedCallTracker()
  const rejected = (
    tool: string,
    input: unknown,
    code: string,
    response: McpErrorResult
  ): McpErrorResult => rejectedCalls.rejected(tool, input, code, response)
  const mutationResult = <T>(operation: () => T): ReturnType<typeof result> => {
    const value = operation()
    notifyMutation()
    return result(value)
  }
  const entityPathResult = (
    resolution: ApplicationEntityPathResolution,
    includeRichText: boolean
  ): ReturnType<typeof result> => {
    const candidates = resolution.candidates.map((candidate) => {
      const decorated = withWriteGuide(candidate)
      return candidate.reference.type === 'focus' && includeRichText
        ? withFocusDescriptionWriteGuide(withEmbeddedNoteWriteGuides(decorated))
        : decorated
    })
    const warnings = resolution.status === 'ambiguous'
      ? ['Multiple exact hierarchy paths matched. Add the optional Focus title; do not guess.']
      : resolution.status === 'not_found'
        ? ['No visible entity matched this exact hierarchy path. Use the matching search tool for discovery.']
        : candidates.flatMap((candidate) => {
            const context = record(candidate)
            return Array.isArray(context?.warnings)
              ? context.warnings.filter((warning): warning is string => typeof warning === 'string')
              : []
          })
    if (!includeRichText && resolution.status === 'resolved') {
      warnings.push(RICH_TEXT_OMITTED_WARNING)
    }
    return result({
      status: resolution.status,
      requested: resolution.requested,
      target: resolution.status === 'resolved' ? candidates[0] : null,
      candidates
    }, {
      ...diagnosticsScope(),
      warnings,
      resolutionStatus: resolution.status,
      candidateCount: candidates.length
    })
  }

  server.registerTool(
    'onmove.get_entity_by_code',
    {
      title: 'Get an OnMove entity by public code',
      description: 'Resolve a user-visible code such as #T4 or #U90 directly to its exact visible record. This is deterministic ID lookup, not text search. The prefix selects the entity kind, so never search after the user provides a valid code.',
      inputSchema: z.strictObject({
        code: entityCodeSchema,
        includeRichText: z.boolean().optional().describe(
          'Defaults to false and renders rich fields as Markdown. Set true only immediately before replacing a complete Focus description, Update observation, or Note document.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ code, includeRichText }) => {
      const parsed = parseEntityReference(code)
      if (!parsed) throw new TypeError('The public OnMove entity code is invalid.')
      const include = includeRichText === true
      let context: unknown
      if (parsed.kind === 'focus') {
        const focus = found(database.queries.getFocus(parsed.id, policy(), {
          includeRichText: include
        }))
        context = include
          ? withFocusDescriptionWriteGuide(withEmbeddedNoteWriteGuides(focus))
          : focus
      } else if (parsed.kind === 'thread') {
        context = withWriteGuide(found(database.queries.getThread(
          parsed.id, policy(), { includeRichText: include }
        )))
      } else if (parsed.kind === 'commitment') {
        context = withWriteGuide(found(database.queries.getCommitment(
          parsed.id, policy(), { includeRichText: include }
        )))
      } else if (parsed.kind === 'routine') {
        context = withWriteGuide(found(database.queries.getRoutine(parsed.id, policy())))
      } else if (parsed.kind === 'update') {
        context = withUpdateContextWriteGuide(found(database.queries.getUpdate(
          parsed.id, policy(), { includeRichText: include }
        )))
      } else if (parsed.kind === 'note') {
        context = withNoteWriteGuide(found(database.queries.getNote(
          parsed.id, policy(), { includeRichText: include }
        )))
      } else if (parsed.kind === 'todo') {
        context = found(database.queries.getTodo(parsed.id, policy()))
      } else {
        context = found(database.queries.getSubject(parsed.id, policy()))
      }
      const richTextCapable = ['focus', 'thread', 'commitment', 'update', 'note']
        .includes(parsed.kind)
      return result(context, !include && richTextCapable
        ? compactEntityReadDiagnostics(context)
        : entityReadDiagnostics(context))
    }
  )

  server.registerTool(
    'onmove.list_focuses',
    {
      title: 'List OnMove focuses',
      description: 'Compact queryless inventory of visible Focus records. Returns hierarchy, lifecycle metadata, and at most a 200-character plain-text description breadcrumb; never returns Threads, Updates, Notes, or rich-text documents.',
      inputSchema: z.strictObject({
        statuses: z.array(z.enum(['active', 'paused', 'done', 'cancelled'])).optional().describe(
          'Optional Focus lifecycle filter. Omit to include every visible lifecycle state.'
        ),
        includeBreadcrumb: z.boolean().optional().describe(
          'Defaults true. When false, omit the bounded plain-text Focus description breadcrumb.'
        ),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => result(database.queries.listFocuses(input, policy()))
  )

  server.registerTool(
    'onmove.list_threads',
    {
      title: 'List OnMove threads',
      description: 'Compact queryless inventory of visible Threads. Returns full Focus → Thread hierarchy and one clearly marked row per current Subject projection. Unscoped and empty-scope Threads remain explicit. Never returns child Commitments, Routines, Updates, Todos, Notes, or rich-text documents.',
      inputSchema: z.strictObject({
        focusId: idSchema.optional().describe(
          'Optional owning Focus ID. Omit to list Threads across every visible Focus.'
        ),
        statuses: z.array(z.enum(['active', 'paused', 'done', 'cancelled'])).optional().describe(
          'Optional Thread lifecycle filter. Omit to include every visible lifecycle state.'
        ),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => result(database.queries.listThreads(input, policy()))
  )

  server.registerTool(
    'onmove.list_commitments',
    {
      title: 'List OnMove commitments',
      description: 'Compact queryless inventory of visible tracking Commitments. Returns Focus → Thread → Commitment hierarchy and one clearly marked row per current Subject projection. Never returns Updates, Todos, Notes, or rich-text documents.',
      inputSchema: z.strictObject({
        focusId: idSchema.optional().describe(
          'Optional owning Focus ID. Omit to list Commitments across every visible Focus.'
        ),
        threadId: idSchema.optional().describe(
          'Optional owning Thread ID. Omit to list Commitments across every visible Thread.'
        ),
        statuses: z.array(z.enum(['active', 'paused', 'done', 'cancelled'])).optional().describe(
          'Optional Commitment lifecycle filter. Omit to include every visible lifecycle state.'
        ),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => result(database.queries.listCommitments(input, policy()))
  )

  server.registerTool(
    'onmove.get_focus_by_id',
    {
      title: 'Get an OnMove focus by ID',
      description: 'Read one visible Focus, a top-level area containing Threads. The default compact response renders rich fields as Markdown. Set includeRichText=true only immediately before full structural replacement to return the lossless Focus description and directly owned Notes.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Focus\'s own positive ID, available as searchResult.hierarchy.focus.id.'
        ),
        includeRichText: z.boolean().optional().describe(
          'Defaults to false. Set true only immediately before full structural replacement; ordinary reading, review, and semantic patches should use compact Markdown.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id, includeRichText }) => {
      const context = found(database.queries.getFocus(
        id,
        policy(),
        { includeRichText: includeRichText === true }
      ))
      const output = includeRichText
        ? withFocusDescriptionWriteGuide(withEmbeddedNoteWriteGuides(context))
        : context
      return result(output, includeRichText
        ? entityReadDiagnostics(output)
        : compactEntityReadDiagnostics(output))
    }
  )

  for (const [name, title, entityDescription, idDescription, getter] of [
    [
      'onmove.get_thread_by_id', 'Get an OnMove thread by ID',
      'Thread, a workstream inside one Focus containing Commitments, Updates, Todos, Routines, and a Note',
      'The Thread\'s own positive ID. When search matched an Update, Note, Todo, or Commitment, use searchResult.hierarchy.thread.id—not searchResult.reference.id.',
      (id: number, includeRichText: boolean) => database.queries.getThread(
        id, policy(), { includeRichText }
      )
    ],
    [
      'onmove.get_commitment_by_id', 'Get an OnMove commitment by ID',
      'Commitment, a tracked obligation inside one Thread',
      'The Commitment\'s own positive ID, available as searchResult.hierarchy.commitment.id when the match belongs to one.',
      (id: number, includeRichText: boolean) => database.queries.getCommitment(
        id, policy(), { includeRichText }
      )
    ]
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: `Read one visible ${entityDescription} with its resolved hierarchy, Scope, direct evidence, Todos, and Note. This is an ID lookup, not a text search. It defaults to compact Markdown; set includeRichText=true only immediately before full structural replacement. Unsupported rich-text structures produce warnings and never discard the rest of the entity response.`,
        inputSchema: z.strictObject({
          id: idSchema.describe(idDescription),
          includeRichText: z.boolean().optional().describe(
            'Defaults to false and renders rich fields as Markdown. Set true only immediately before full structural replacement; discovery, summarization, and semantic patches should leave it false.'
          )
        }),
        annotations: { readOnlyHint: true }
      },
      async ({ id, includeRichText }) => {
        const context = found(getter(id, includeRichText === true))
        const output = withWriteGuide(context)
        return result(output, includeRichText
          ? entityReadDiagnostics(output)
          : compactEntityReadDiagnostics(output))
      }
    )
  }

  server.registerTool(
    'onmove.get_note_by_id',
    {
      title: 'Get an OnMove note by ID',
      description: 'Read one visible Note by its own ID. The default compact response renders content as Markdown and omits the lossless document. Set includeRichText=true only immediately before full structural replacement.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Note\'s own positive ID from searchResult.reference.id or a parent context\'s notes array.'
        ),
        includeRichText: z.boolean().optional().describe(
          'Defaults to false. Set true only when immediately replacing the complete rich-text document; searching, reading, summarizing, and semantic patches should leave it false.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id, includeRichText }) => {
      const context = withNoteWriteGuide(found(database.queries.getNote(
        id, policy(), { includeRichText: includeRichText === true }
      )))
      return result(context, includeRichText
        ? entityReadDiagnostics(context)
        : compactEntityReadDiagnostics(context))
    }
  )

  server.registerTool(
    'onmove.get_update_by_id',
    {
      title: 'Get an OnMove update by ID',
      description: 'Read one visible Update by its own ID with hierarchy and Scope/Subject attribution. The default compact response renders observation as Markdown and omits the lossless document. Set includeRichText=true only immediately before full structural replacement.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Update\'s own positive ID from searchResult.reference.id or a parent context\'s updates array.'
        ),
        includeRichText: z.boolean().optional().describe(
          'Defaults to false. Set true only when immediately replacing the complete rich-text document; ordinary reading and semantic patches should leave it false.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id, includeRichText }) => {
      const context = withUpdateContextWriteGuide(found(database.queries.getUpdate(
        id, policy(), { includeRichText: includeRichText === true }
      )))
      return result(context, includeRichText
        ? entityReadDiagnostics(context)
        : compactEntityReadDiagnostics(context))
    }
  )

  server.registerTool(
    'onmove.get_updates_by_ids',
    {
      title: 'Get multiple OnMove updates',
      description: 'Read Updates by their own IDs in one bounded call. Markdown is the default; lossless rich text is omitted. A hard byte budget may defer trailing IDs into omittedIds so a bulk lookup cannot consume the client context window.',
      inputSchema: z.strictObject({
        ids: z.array(idSchema).min(1).max(50).describe(
          'One to 50 Update IDs from searchResult.reference.id, subjectUses, review_subject, or parent update arrays.'
        ),
        includeRichText: z.boolean().optional().describe(
          'Defaults to false. Set true only when immediately replacing every requested document; prefer one get_update_by_id(includeRichText=true) for an actual edit.'
        ),
        maxBytes: z.number().int().min(4_096).max(131_072).optional().describe(
          'Hard UTF-8 response budget. Defaults to 32768 bytes. IDs that do not fit are returned in omittedIds for a later bounded request.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ ids, includeRichText, maxBytes }) => {
      const budget = maxBytes ?? 32_768
      const contexts = database.queries.getUpdates(
        ids, policy(), { includeRichText: includeRichText === true }
      )
      const candidates = contexts.items.map(withUpdateContextWriteGuide)
      const items: unknown[] = []
      const omittedIds: number[] = []
      const warnings = contexts.items.flatMap((context) => context.warnings ?? [])
      if (!includeRichText) warnings.push(RICH_TEXT_OMITTED_WARNING)
      for (const candidate of candidates) {
        const reference = record(record(candidate)?.reference)
        const id = Number(reference?.id)
        const trial = {
          items: [...items, candidate],
          unavailableIds: contexts.unavailableIds,
          omittedIds,
          hasMore: false,
          budget: { maxBytes: budget }
        }
        if (Buffer.byteLength(JSON.stringify(trial), 'utf8') + 2_048 <= budget) {
          items.push(candidate)
        } else if (Number.isSafeInteger(id)) {
          omittedIds.push(id)
        }
      }
      if (omittedIds.length > 0) {
        warnings.push(
          `${omittedIds.length} Update ID(s) were omitted to honor maxBytes. ` +
          'Request those omittedIds in a later call; use a larger maxBytes only when necessary.'
        )
      }
      const response = {
        items,
        unavailableIds: contexts.unavailableIds,
        omittedIds,
        hasMore: omittedIds.length > 0,
        budget: {
          maxBytes: budget,
          returnedItems: items.length,
          omittedItems: omittedIds.length
        }
      }
      return result(response, {
        ...diagnosticsScope(), warnings, resultCount: items.length
      })
    }
  )

  server.registerTool(
    'onmove.get_routine_by_id',
    {
      title: 'Get an OnMove routine by ID',
      description: 'Read one visible Routine by its durable ID. Use search_routines or get_routine_by_path when the ID is unknown.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The Routine\'s own positive ID from a Routine search or parent context.')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => result(withWriteGuide(found(database.queries.getRoutine(id, policy()))))
  )

  const exactPathTitleSchema = (label: string, example: string) => z.string().min(1).describe(
    `Exact case-insensitive ${label} title. Example: ${example}. Paths use titles only; use the corresponding get-by-ID tool for an ID.`
  )
  const includePathRichTextSchema = z.boolean().optional().describe(
    'Defaults to false and returns Markdown. Set true only immediately before a full structural replacement; ordinary reads and semantic patches should leave it false.'
  )

  server.registerTool(
    'onmove.get_focus_by_path',
    {
      title: 'Get an OnMove focus by path',
      description: 'Read a Focus from its exact title path. Duplicate exact titles return ambiguity rather than being guessed.',
      inputSchema: z.strictObject({
        focusTitle: exactPathTitleSchema('Focus', 'Project Atlas'),
        includeRichText: includePathRichTextSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ focusTitle, includeRichText }) => entityPathResult(
      database.queries.getEntityByPath({ type: 'focus', focusTitle }, policy(), {
        includeRichText: includeRichText === true
      }),
      includeRichText === true
    )
  )

  server.registerTool(
    'onmove.get_thread_by_path',
    {
      title: 'Get an OnMove thread by path',
      description: 'Read a Thread from an exact optional Focus title and required Thread title. Omit focusTitle only when the Thread title is globally unique.',
      inputSchema: z.strictObject({
        focusTitle: exactPathTitleSchema('Focus', 'Project Atlas').optional(),
        threadTitle: exactPathTitleSchema('Thread', 'Sprint execution'),
        includeRichText: includePathRichTextSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ focusTitle, threadTitle, includeRichText }) => entityPathResult(
      database.queries.getEntityByPath({
        type: 'thread',
        ...(focusTitle === undefined ? {} : { focusTitle }),
        threadTitle
      }, policy(), { includeRichText: includeRichText === true }),
      includeRichText === true
    )
  )

  server.registerTool(
    'onmove.get_commitment_by_path',
    {
      title: 'Get an OnMove commitment by path',
      description: 'Read a tracking Commitment from its exact Focus → Thread → Commitment path. Omit focusTitle only when the remaining path is unique.',
      inputSchema: z.strictObject({
        focusTitle: exactPathTitleSchema('Focus', 'Project Atlas').optional(),
        threadTitle: exactPathTitleSchema('Thread', 'Sprint execution'),
        commitmentTitle: exactPathTitleSchema('Commitment', 'Improve ticket quality'),
        includeRichText: includePathRichTextSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ focusTitle, threadTitle, commitmentTitle, includeRichText }) => entityPathResult(
      database.queries.getEntityByPath({
        type: 'commitment',
        ...(focusTitle === undefined ? {} : { focusTitle }),
        threadTitle,
        commitmentTitle
      }, policy(), { includeRichText: includeRichText === true }),
      includeRichText === true
    )
  )

  server.registerTool(
    'onmove.get_routine_by_path',
    {
      title: 'Get an OnMove routine by path',
      description: 'Read a Routine from its exact Focus → Thread → Routine path. Omit focusTitle only when the remaining path is unique.',
      inputSchema: z.strictObject({
        focusTitle: exactPathTitleSchema('Focus', 'Project Atlas').optional(),
        threadTitle: exactPathTitleSchema('Thread', 'Sprint execution'),
        routineTitle: exactPathTitleSchema('Routine', 'Weekly risk inspection')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ focusTitle, threadTitle, routineTitle }) => entityPathResult(
      database.queries.getEntityByPath({
        type: 'routine',
        ...(focusTitle === undefined ? {} : { focusTitle }),
        threadTitle,
        routineTitle
      }, policy()),
      false
    )
  )

  server.registerTool(
    'onmove.list_routines',
    {
      title: 'List OnMove routines',
      description: 'Compact queryless inventory of visible recurring attestation Routines. Returns Focus → Thread → Routine hierarchy, one clearly marked row per current Subject projection, derived status, schedule, and bounded progress metadata. Never returns checklist text, Run history, evidence, Updates, Notes, or rich-text documents.',
      inputSchema: z.strictObject({
        focusId: idSchema.optional().describe(
          'Optional owning Focus ID. Omit to list Routines across every visible Focus.'
        ),
        threadId: idSchema.optional().describe(
          'Optional owning Thread ID. Omit to list Routines across every visible Thread.'
        ),
        statuses: z.array(z.enum(['green', 'yellow', 'red'])).optional().describe(
          'Optional derived Routine status filter: green=current, yellow=overdue, red=lapsed.'
        ),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => result(database.queries.listRoutines(input, policy()))
  )

  for (const [name, title, getter] of [
    ['onmove.get_reviews', 'Get review queue', (asOf?: string) => database.queries.getReviews(policy(), asOf)],
    ['onmove.get_due', 'Get due work', (asOf?: string) => database.queries.getDue(policy(), asOf)]
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: `Read the current visible ${name.endsWith('reviews') ? 'review queue' : 'due-date projection'}.`,
        inputSchema: z.object({ asOf: dateSchema.optional() }),
        annotations: { readOnlyHint: true }
      },
      async ({ asOf }) => result(getter(asOf))
    )
  }

  server.registerTool(
    'onmove.get_todos',
    {
      title: 'Get OnMove todos',
      description: 'Read the current actionable Todo projection: every open Todo and the bounded recently completed window whose complete Focus, Thread, and optional Commitment hierarchy remains active or paused. Todos beneath done/cancelled work are retained but excluded. To inspect that history intentionally, call onmove.search_todos with lifecycle.mode=closed or all.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true }
    },
    async () => result(database.queries.getTodos(policy()))
  )

  server.registerTool(
    'onmove.list_tags',
    {
      title: 'List OnMove tags',
      description: 'List canonical tags after effective-sensitivity filtering and count recomputation.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true }
    },
    async () => result(database.queries.listTags(policy()))
  )

  server.registerTool(
    'onmove.get_tag_uses',
    {
      title: 'Get OnMove tag uses',
      description: 'Read bounded plain-text uses for one canonical tag.',
      inputSchema: z.object({
        name: z.string().min(1).describe('The canonical lowercase tag name without the leading @.'),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ name, limit, offset }) =>
      result(database.queries.getTagUses(name, policy(), limit, offset))
  )

  const localDateRangeSchema = z.strictObject({
    from: dateSchema.optional().describe('Inclusive first local calendar date.'),
    to: dateSchema.optional().describe('Inclusive last local calendar date.')
  }).refine(({ from, to }) => from !== undefined || to !== undefined, {
    message: 'A local-date range requires from, to, or both.'
  }).describe('Inclusive local-date range. Supply from, to, or both in YYYY-MM-DD form.')
  const searchProjectionSchema = z.strictObject({
    hierarchy: z.boolean().optional().describe(
      'Primary matches always include their complete hierarchy. Set this only to request auxiliary hierarchy browsing for Subject/Scope discovery; ordinary text matches do not need it.'
    ),
    subjects: z.boolean().optional().describe(
      'Include Subject attribution, authoritative subjectUses, and named Subject applicability paths.'
    ),
    scopes: z.boolean().optional().describe(
      'Include bounded Scope metadata on applicable Subject paths.'
    )
  }).optional().describe(
    'Optional auxiliary projections. Every primary match always retains its exact matched field, complete path, canonical codes, containing Thread, and recommended write target. Search never returns lossless rich-text documents.'
  )
  const searchPageSchema = z.strictObject({
    size: z.number().int().min(1).max(25).optional().describe(
      'Maximum records in this page. Defaults to 10 and never exceeds 25.'
    ),
    maxBytes: z.number().int().min(8_192).max(131_072).optional().describe(
      'Hard UTF-8 budget for the complete MCP tool result, including both text and structuredContent. Defaults to 32768; the minimum practical envelope is 8192. Oversized auxiliary projections are removed before records.'
    )
  }).optional()

  const entitySearchProjectionSchema = z.strictObject({
    hierarchy: z.boolean().optional().describe(
      'Accepted for compatibility. Complete primary hierarchy is always returned and cannot be disabled.'
    ),
    subjects: z.boolean().optional().describe(
      'Include direct canonical Subject attribution on matching records when present.'
    )
  }).optional().describe(
    'Optional Subject metadata request. Complete primary hierarchy is mandatory and never removed for response budgeting.'
  )
  const searchLifecycleSchema = z.strictObject({
    mode: z.enum(['current', 'closed', 'all']).describe(
      'current searches active/paused operational lineage only; closed searches records that are done/cancelled themselves or descend from done/cancelled work; all searches both. An explicit mode overrides the persisted default.'
    ),
    terminalStatuses: z.array(z.enum(SEARCH_TERMINAL_STATUSES)).min(1).max(2).optional().describe(
      'Optional closed-status selection for mode=closed or the closed portion of mode=all. Omission includes both done and cancelled. This never changes current mode.'
    )
  }).optional().describe(
    'Structural lifecycle eligibility applied before lexical or semantic ranking. On omission, mode is current unless the user enabled Include closed work in MCP results, in which case it is all. Inspect appliedQuery.lifecycle for the resolved mode; results never widen silently.'
  )
  const entitySearchSchema = z.strictObject({
    text: z.string().min(1).max(1_000).describe(
      'The literal text to discover within this entity kind. For another page, call onmove.continue_search with the returned token instead of repeating this request.'
    ),
    scope: searchScopeSchema,
    lifecycle: searchLifecycleSchema,
    date: localDateRangeSchema.optional(),
    createdAt: localDateRangeSchema.optional(),
    updatedAt: localDateRangeSchema.optional(),
    timeZone: z.string().min(1).optional().describe(
      'IANA timezone for createdAt and updatedAt local-calendar boundaries.'
    ),
    sort: z.strictObject({
      field: z.enum(['relevance', 'date', 'createdAt', 'updatedAt']),
      direction: z.enum(['asc', 'desc'])
    }).optional(),
    projection: entitySearchProjectionSchema,
    page: searchPageSchema
  })

  // Thread discovery is intentionally relevance-only. A Thread is a durable
  // container whose creation or modification day usually has no relationship
  // to the evidence an agent is trying to locate. Keeping calendar inputs out
  // of this specialized schema prevents accidental empty-result constraints;
  // the generic onmove.search remains available for intentional date queries.
  const threadEntitySearchSchema = entitySearchSchema.omit({
    date: true,
    createdAt: true,
    updatedAt: true,
    timeZone: true,
    sort: true
  })

  const globalSearchSchema = z.strictObject({
    text: z.string().min(1).max(1_000).nullable().optional().describe(
      'Non-null uses full-text search. Null or omitted is queryless list mode and returns records selected by kinds, scope, and date filters.'
    ),
    kinds: z.array(z.enum(SEARCH_ENTITY_TYPES)).min(1).max(8).optional().describe(
      'Record kinds to return: focus, thread, commitment, routine, update, todo, note, subject. Omit for all kinds.'
    ),
    scope: searchScopeSchema,
    lifecycle: searchLifecycleSchema,
    date: localDateRangeSchema.optional().describe(
      'Filter the semantic local date: Update recorded date, or due date for dated Focuses, Threads, Commitments, and Todos. Timezone does not shift this field.'
    ),
    createdAt: localDateRangeSchema.optional().describe(
      'Filter creation instants by inclusive local calendar dates in timeZone.'
    ),
    updatedAt: localDateRangeSchema.optional().describe(
      'Filter modification instants by inclusive local calendar dates in timeZone.'
    ),
    timeZone: z.string().min(1).optional().describe(
      'IANA timezone for createdAt and updatedAt boundaries, such as America/Chicago. Defaults to the running app timezone.'
    ),
    sort: z.strictObject({
      field: z.enum(['relevance', 'date', 'createdAt', 'updatedAt']).describe(
        'relevance requires non-null text; queryless listing defaults to updatedAt.'
      ),
      direction: z.enum(['asc', 'desc']).describe('Stable primary sort direction.')
    }).optional(),
    projection: searchProjectionSchema,
    page: searchPageSchema
  })

  const searchReferenceOutputSchema = z.strictObject({
    type: z.enum(SEARCH_ENTITY_TYPES),
    id: z.number().int().positive()
  })
  const searchEntityReferenceOutputSchema = z.strictObject({
    id: z.number().int().positive(),
    title: z.string()
  }).nullable()
  const searchPrimaryEntityReferenceOutputSchema = z.strictObject({
    id: z.number().int().positive(),
    code: z.string(),
    title: z.string()
  }).nullable()
  const searchPathSegmentOutputSchema = z.strictObject({
    type: z.enum(SEARCH_ENTITY_TYPES),
    id: z.number().int().positive(),
    code: z.string(),
    title: z.string()
  })
  const lifecycleStatusOutputSchema = z.enum(['active', 'paused', 'done', 'cancelled'])
  const terminalLifecycleStatusOutputSchema = z.enum(SEARCH_TERMINAL_STATUSES)
  const lifecycleLineageReferenceOutputSchema = z.strictObject({
    id: z.number().int().positive(),
    status: lifecycleStatusOutputSchema
  }).nullable()
  const searchLifecycleResultOutputSchema = z.strictObject({
    directStatus: lifecycleStatusOutputSchema.nullable(),
    effective: z.enum(['current', 'closed', 'not_applicable']),
    lineage: z.strictObject({
      focus: lifecycleLineageReferenceOutputSchema,
      thread: lifecycleLineageReferenceOutputSchema,
      commitment: lifecycleLineageReferenceOutputSchema
    }),
    closure: z.strictObject({
      explicit: terminalLifecycleStatusOutputSchema.nullable(),
      inherited: z.array(z.strictObject({
        type: z.enum(['focus', 'thread', 'commitment']),
        id: z.number().int().positive(),
        code: z.string(),
        status: terminalLifecycleStatusOutputSchema
      }))
    }).nullable()
  })
  const searchRecordOutputSchema = z.looseObject({
    reference: searchReferenceOutputSchema,
    uri: z.string(),
    field: z.string(),
    code: z.string(),
    title: z.string(),
    snippet: z.string().max(200),
    rank: z.number(),
    effectiveSensitive: z.boolean(),
    date: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lifecycle: searchLifecycleResultOutputSchema,
    contextPath: z.array(z.string()),
    hierarchy: z.strictObject({
      focus: searchPrimaryEntityReferenceOutputSchema,
      thread: searchPrimaryEntityReferenceOutputSchema,
      commitment: searchPrimaryEntityReferenceOutputSchema
    }),
    containingThread: searchPrimaryEntityReferenceOutputSchema,
    subject: z.strictObject({
      id: z.number().int().positive(),
      code: z.string(),
      name: z.string()
    }).nullable(),
    path: z.strictObject({
      display: z.string(),
      complete: z.literal(true),
      segments: z.array(searchPathSegmentOutputSchema)
    }),
    recommendedWriteTarget: z.strictObject({
      reference: searchReferenceOutputSchema,
      code: z.string(),
      field: z.string(),
      tool: z.string().nullable(),
      requiresReadBeforeWrite: z.boolean()
    })
  })
  const searchStatusOutputSchema = z.strictObject({
    sufficient: z.boolean(),
    doNotBroaden: z.boolean(),
    targetSelectionReady: z.boolean(),
    reason: z.string(),
    nextAction: z.string()
  })
  const appliedLifecycleOutputSchema = z.strictObject({
    mode: z.enum(['current', 'closed', 'all']),
    terminalStatuses: z.array(z.enum(SEARCH_TERMINAL_STATUSES)).min(1).max(2)
  })
  const lifecycleCoverageOutputSchema = z.strictObject({
    closedMatchesAvailable: z.boolean(),
    closedExactTitleMatchAvailable: z.boolean(),
    wideningRecommended: z.boolean(),
    nextAction: z.string().nullable()
  })
  const searchBudgetOutputSchema = z.strictObject({
    maxBytes: z.number().int(),
    responseBytes: z.number().int(),
    structuredBytes: z.number().int(),
    estimatedToolResultBytes: z.number().int(),
    recordsTruncated: z.boolean(),
    projectionTruncated: z.boolean()
  })
  const diagnosticsOutputSchema = z.looseObject({
    appliedScope: z.object({
      requestedMode: z.enum(['all', 'focus', 'thread', 'subject', 'current']),
      mode: z.enum(['all', 'focus', 'thread', 'subject', 'current']),
      focusId: z.number().int().positive().nullable(),
      threadId: z.number().int().positive().nullable(),
      subjectId: z.number().int().positive().nullable(),
      source: z.enum(['default', 'explicit', 'current-ui']),
      description: z.string()
    }),
    warnings: z.array(z.string())
  })
  const appliedRangeOutputSchema = z.strictObject({
    from: dateSchema.optional(),
    to: dateSchema.optional()
  }).nullable()
  const appliedSortOutputSchema = z.strictObject({
    field: z.enum(['relevance', 'date', 'createdAt', 'updatedAt']),
    direction: z.enum(['asc', 'desc'])
  })
  const appliedProjectionOutputSchema = z.strictObject({
    hierarchy: z.boolean(),
    subjects: z.boolean(),
    scopes: z.boolean().optional()
  })
  const appliedQueryOutputSchema = z.strictObject({
    text: z.string().nullable(),
    kinds: z.union([z.literal('all'), z.array(z.enum(SEARCH_ENTITY_TYPES))]).optional(),
    kind: z.enum(SEARCH_ENTITY_TYPES).optional(),
    date: appliedRangeOutputSchema,
    createdAt: appliedRangeOutputSchema,
    updatedAt: appliedRangeOutputSchema,
    timeZone: z.string(),
    sort: appliedSortOutputSchema,
    lifecycle: appliedLifecycleOutputSchema,
    projection: appliedProjectionOutputSchema
  })
  const entitySearchOutputSchema = z.object({
    records: z.array(searchRecordOutputSchema),
    hasMore: z.boolean(),
    continuationToken: z.string().uuid().nullable(),
    searchStatus: searchStatusOutputSchema,
    lifecycleCoverage: lifecycleCoverageOutputSchema,
    appliedQuery: appliedQueryOutputSchema,
    budget: searchBudgetOutputSchema,
    diagnostics: diagnosticsOutputSchema
  })
  const projectionCompletenessOutputSchema = z.strictObject({
    requested: z.boolean(),
    returned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
    complete: z.boolean(),
    truncatedByBudget: z.boolean()
  })
  const hierarchyPathOutputSchema = z.looseObject({
    kind: z.enum(['focus', 'thread', 'commitment', 'subject']),
    displayPath: z.string(),
    relativePath: z.string(),
    lifecycle: searchLifecycleResultOutputSchema,
    hierarchy: z.strictObject({
      focus: searchEntityReferenceOutputSchema.unwrap(),
      thread: searchEntityReferenceOutputSchema,
      commitment: searchEntityReferenceOutputSchema
    }),
    subject: z.strictObject({ id: z.number().int().positive(), name: z.string() }).nullable(),
    scope: z.looseObject({
      id: z.number().int().positive(),
      name: z.string(),
      dimension: z.string(),
      applicationMode: z.string()
    }).nullable().optional(),
    semanticPath: z.looseObject({}).nullable(),
    recommendedUpdateRequest: z.unknown().nullable()
  })
  const namedSubjectDiscoveryOutputSchema = z.looseObject({
    subject: z.strictObject({
      id: z.number().int().positive(),
      code: z.string(),
      name: z.string()
    }),
    applicablePaths: z.array(hierarchyPathOutputSchema),
    reviewContexts: z.array(z.unknown())
  })
  const hierarchyNotationOutputSchema = z.strictObject({
    object: z.string(),
    example: z.strictObject({
      thread: z.string(),
      commitment: z.string(),
      subject: z.string()
    }),
    display: z.string(),
    semantics: z.string()
  })
  const globalSearchOutputSchema = z.object({
    items: z.array(searchRecordOutputSchema),
    subjectUses: z.array(searchRecordOutputSchema),
    namedSubjectDiscovery: z.array(namedSubjectDiscoveryOutputSchema),
    hierarchyPaths: z.array(hierarchyPathOutputSchema),
    hierarchyNotation: hierarchyNotationOutputSchema.optional(),
    projections: z.strictObject({
      primary: projectionCompletenessOutputSchema,
      subjectUses: projectionCompletenessOutputSchema,
      hierarchy: projectionCompletenessOutputSchema
    }),
    searchStatus: searchStatusOutputSchema,
    lifecycleCoverage: lifecycleCoverageOutputSchema,
    hasMore: z.boolean(),
    continuationToken: z.string().uuid().nullable(),
    appliedQuery: appliedQueryOutputSchema,
    budget: searchBudgetOutputSchema,
    diagnostics: diagnosticsOutputSchema
  })
  const retrievalBoundarySchema = z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('workspace').describe(
        'Search the complete visible workspace. This must be explicit; retrieval never inherits the current UI.'
      )
    }),
    z.strictObject({
      type: z.literal('focus'),
      focusId: idSchema.describe('The exact Focus boundary returned by OnMove.')
    }),
    z.strictObject({
      type: z.literal('thread'),
      focusId: idSchema.describe(
        'The asserted owning Focus. Retrieval rejects a Thread that is no longer inside this Focus.'
      ),
      threadId: idSchema.describe('The exact Thread boundary returned by OnMove.')
    })
  ])
  const retrievalContextSchema = z.strictObject({
    boundary: retrievalBoundarySchema,
    subjectId: idSchema.optional().describe(
      'Optional canonical Subject intersection. This selects durable attribution history inside the boundary; it is never treated as a fuzzy semantic label.'
    )
  }).describe(
    'Required identity context. Every supplied hierarchy and Subject identifier is intersected; none is silently ignored. A closed boundary remains valid when lifecycle.mode=closed or all.'
  )
  const retrievalInputSchema = z.strictObject({
    text: z.string().min(1).max(1_000).nullable().optional().describe(
      'Text to retrieve. Null or omission performs a structured listing inside the required context.'
    ),
    context: retrievalContextSchema,
    lifecycle: searchLifecycleSchema,
    kinds: z.array(z.enum(SEARCH_ENTITY_TYPES)).min(1).max(8).optional(),
    date: localDateRangeSchema.optional(),
    createdAt: localDateRangeSchema.optional(),
    updatedAt: localDateRangeSchema.optional(),
    timeZone: z.string().min(1).optional().describe(
      'IANA timezone for createdAt and updatedAt local-calendar boundaries.'
    ),
    strategy: z.enum(['auto', 'lexical', 'hybrid']).optional().describe(
      'Provider-neutral retrieval strategy. auto uses the best currently available safe strategy.'
    ),
    onUnavailable: z.enum(['fallback', 'error']).optional().describe(
      'fallback uses a safe available strategy and reports why; error rejects an unavailable requested strategy.'
    ),
    diversifyBy: z.enum(['none', 'lineage']).optional().describe(
      'lineage limits corporate-language crowding by diversifying across operational owner paths.'
    ),
    page: searchPageSchema
  })
  const retrievalMatchOutputSchema = z.strictObject({
    channels: z.array(z.enum(['structured', 'lexical', 'semantic'])),
    lexicalRank: z.number().int().positive().nullable(),
    semanticRank: z.number().int().positive().nullable(),
    semanticSimilarity: z.number().nullable(),
    fusedScore: z.number().nullable(),
    lineageKey: z.string().min(1)
  })
  const retrievalRecordOutputSchema = searchRecordOutputSchema
    .omit({ rank: true })
    .extend({ match: retrievalMatchOutputSchema })
    .strict()
  const retrievalAppliedQueryOutputSchema = z.strictObject({
    text: z.string().nullable(),
    context: retrievalContextSchema,
    kinds: z.union([z.literal('all'), z.array(z.enum(SEARCH_ENTITY_TYPES))]),
    date: appliedRangeOutputSchema,
    createdAt: appliedRangeOutputSchema,
    updatedAt: appliedRangeOutputSchema,
    timeZone: z.string(),
    lifecycle: appliedLifecycleOutputSchema,
    strategy: z.enum(['auto', 'lexical', 'hybrid']),
    onUnavailable: z.enum(['fallback', 'error']),
    diversifyBy: z.enum(['none', 'lineage'])
  })
  const retrievalOutputSchema = z.object({
    items: z.array(retrievalRecordOutputSchema),
    retrieval: z.strictObject({
      mode: z.enum(['classic', 'enhanced']),
      requestedStrategy: z.enum(['auto', 'lexical', 'hybrid']),
      appliedStrategy: z.enum(['structured', 'lexical', 'hybrid']),
      fallbackReason: z.string().nullable()
    }),
    freshness: z.strictObject({
      lexicalGeneration: z.number().int().nonnegative(),
      semanticGeneration: z.number().int().nonnegative().nullable(),
      semanticCoverage: z.number().min(0).max(1).nullable(),
      semanticState: z.enum(['current', 'stale', 'unavailable'])
    }),
    lifecycleCoverage: lifecycleCoverageOutputSchema,
    hasMore: z.boolean(),
    continuationToken: z.string().uuid().nullable(),
    appliedQuery: retrievalAppliedQueryOutputSchema,
    budget: searchBudgetOutputSchema,
    diagnostics: diagnosticsOutputSchema
  })
  type EntitySearchInput = z.infer<typeof entitySearchSchema>
  type RetrievalInput = z.infer<typeof retrievalInputSchema>
  const runEntitySearch = (
    kind: SearchEntityType,
    input: EntitySearchInput,
    continuation: SearchContinuationPayload | null = null
  ): ReturnType<typeof result> => {
    if (continuation) {
      if (continuation.origin.type !== 'entity' || continuation.origin.kind !== kind) {
        throw new TypeError(`continuationToken belongs to a different entity search, not ${kind}`)
      }
    }
    const resolved = continuation
      ? {
          query: continuation.query,
          diagnostics: {
            appliedScope: continuation.appliedScope,
            warnings: []
          }
        }
      : resolveSearchScope(input.scope, options.getCurrentUiContext?.() ?? EMPTY_UI_CONTEXT)
    const text = continuation?.text ?? input.text
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new TypeError('text is required for the initial entity search')
    }
    const date = continuation?.date ?? input.date
    const createdAt = continuation?.createdAt ?? input.createdAt
    const updatedAt = continuation?.updatedAt ?? input.updatedAt
    const timeZone = continuation?.timeZone ?? input.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
    const sort = continuation?.sort ?? input.sort ?? {
      field: 'relevance' as const,
      direction: 'asc' as const
    }
    const lifecycle = continuation?.lifecycle ?? resolveInitialLifecycle(input.lifecycle)
    const projection: SearchProjectionInput = continuation?.projection ?? {
      hierarchy: true,
      subjects: true,
      scopes: false
    }
    const pageSize = continuation?.pageSize ?? input.page?.size ?? 10
    const maxBytes = continuation?.maxBytes ?? input.page?.maxBytes ?? 32_768
    const access = policy()
    const searched = database.queries.searchPage({
      text,
      kinds: [kind],
      date,
      createdAt,
      updatedAt,
      timeZone,
      lifecycle,
      sort,
      cursor: continuation?.cursor,
      limit: pageSize,
      ...resolved.query
    }, access)
    if (continuation && continuation.indexGeneration !== searched.generation) {
      throw new TypeError(
        'SEARCH_CURSOR_STALE: OnMove data changed after this search page was created. ' +
        'Restart the original entity search; do not reuse the stale token.'
      )
    }
    const warnings = [...resolved.diagnostics.warnings]
    const cursors = [...searched.itemCursors]
    let records = searched.items.map((match) => ({ ...match }))
    let recordsTruncated = false
    const projectionTruncated = false
    const continuationFor = (cursor: SearchPageCursor | null): string | null => cursor
      ? issueSearchContinuation({
          version: 5,
          origin: { type: 'entity', kind },
          text,
          query: resolved.query,
          appliedScope: resolved.diagnostics.appliedScope,
          kinds: [kind],
          ...(date ? { date } : {}),
          ...(createdAt ? { createdAt } : {}),
          ...(updatedAt ? { updatedAt } : {}),
          timeZone,
          sort,
          lifecycle,
          projection,
          pageSize,
          maxBytes,
          indexGeneration: searched.generation,
          cursor
        })
      : null
    const response = (): Record<string, unknown> => {
      const hasMore = searched.hasMore || recordsTruncated
      const hasMatches = records.length > 0
      const coverage = lifecycleCoverage(searched.lifecycle, records.length)
      return {
        records,
        hasMore,
        continuationToken: hasMore ? continuationFor(cursors.at(-1) ?? null) : null,
        searchStatus: {
          sufficient: hasMatches && !hasMore && !coverage.wideningRecommended,
          doNotBroaden: hasMatches && !hasMore && !coverage.wideningRecommended,
          targetSelectionReady: hasMatches && records.every((record) =>
            record.path && (record.path as { complete?: unknown }).complete === true),
          reason: coverage.wideningRecommended
            ? 'Current lifecycle results are not sufficient because matching closed history was excluded.'
            : hasMore
            ? 'Another stable page remains for this entity-specific search.'
            : hasMatches
              ? `The complete visible ${kind} search was returned.`
              : `No visible ${kind} records matched the search criteria.`,
          nextAction: coverage.nextAction ?? (hasMore
            ? 'Call onmove.continue_search with only this continuationToken.'
            : hasMatches
              ? 'Stop discovery and use the returned record IDs.'
              : 'Adjust the text or applied filters, use a compact list tool when available, or resolve a known code, ID, or exact path.')
        },
        lifecycleCoverage: coverage,
        appliedQuery: {
          text,
          kind,
          date: date ?? null,
          createdAt: createdAt ?? null,
          updatedAt: updatedAt ?? null,
          timeZone,
          sort,
          lifecycle,
          projection: {
            hierarchy: projection.hierarchy,
            subjects: projection.subjects
          }
        },
        budget: {
          maxBytes,
          responseBytes: 0,
          structuredBytes: 0,
          estimatedToolResultBytes: 0,
          recordsTruncated,
          projectionTruncated
        }
      }
    }
    const diagnostics = (): McpDiagnostics => ({
      ...resolved.diagnostics,
      warnings,
      appliedKinds: [kind],
      resultCount: searched.items.length
    })
    const structuredBytes = (): number => Buffer.byteLength(JSON.stringify({
      ...response(), diagnostics: diagnostics()
    }), 'utf8')
    const payloadBytes = (): number => resultPayloadBytes(response(), diagnostics())
    const exceeds = (): boolean => payloadBytes() + 512 > maxBytes
    if (exceeds()) {
      records = records.map((record) => ({
        ...record,
        ...(typeof record.snippet === 'string' && record.snippet.length > 80
          ? { snippet: `${record.snippet.slice(0, 79)}…` }
          : {})
      }))
    }
    while (exceeds() && records.length > 1) {
      records.pop()
      cursors.pop()
      recordsTruncated = true
    }
    if (projectionTruncated) warnings.push('Optional projections reduced for page.maxBytes.')
    if (recordsTruncated) warnings.push('Page shortened for page.maxBytes.')
    const finalResponse = response()
    const budget = finalResponse.budget as Record<string, unknown>
    for (let pass = 0; pass < 4; pass += 1) {
      budget.structuredBytes = structuredBytes()
      budget.estimatedToolResultBytes = resultPayloadBytes(finalResponse, diagnostics())
      budget.responseBytes = budget.estimatedToolResultBytes
    }
    if (Number(budget.estimatedToolResultBytes) > maxBytes) {
      throw new TypeError(`The safe entity search response exceeded page.maxBytes=${maxBytes}`)
    }
    return result(finalResponse, diagnostics())
  }

  const entitySearchTools = [
    ['onmove.search_focuses', 'Search OnMove focuses', 'focus'],
    ['onmove.search_threads', 'Search OnMove threads', 'thread'],
    ['onmove.search_commitments', 'Search OnMove commitments', 'commitment'],
    ['onmove.search_routines', 'Search OnMove routines', 'routine'],
    ['onmove.search_updates', 'Search OnMove updates', 'update'],
    ['onmove.search_notes', 'Search OnMove notes', 'note'],
    ['onmove.search_todos', 'Search OnMove todos', 'todo'],
    ['onmove.search_subjects', 'Search OnMove subjects', 'subject']
  ] as const
  for (const [toolName, title, kind] of entitySearchTools) {
    const inputSchema = kind === 'thread' ? threadEntitySearchSchema : entitySearchSchema
    server.registerTool(
      toolName,
      {
        title,
        description: `Search only visible ${kind} records by text. ${kind === 'thread' ? 'Thread discovery is relevance-only and intentionally has no date, createdAt, updatedAt, timeZone, or date-sort inputs: a Thread may have been created long before its current evidence. Do not constrain Thread discovery to the day mentioned in the user request. Use generic onmove.search only when the user explicitly asks to filter records by a date.' : ''} ${kind === 'note' ? 'Matches Note title plus legacy plain/Markdown and current rich-text content.' : ''} ${kind === 'todo' ? 'A current Todo must be open and have an entirely active/paused owner hierarchy. Use lifecycle.mode=closed or all only for intentionally historical Todo discovery. Use returned Todo IDs with Todo mutation tools.' : kind === 'subject' ? 'Use the canonical Subject ID with Subject-scoped search, review_subject, or resolve_work_target.' : `Use get_${kind}_by_id when an ID is known${['focus', 'thread', 'commitment', 'routine', 'note'].includes(kind) ? ` and get_${kind}_by_path for an exact hierarchy path` : ''}.`} This does not search other entity kinds. An omitted lifecycle follows the user's Include closed work in MCP results setting: current active/paused lineage when off, or all current and closed work when on. An explicit lifecycle.mode overrides the setting. Every result reports lifecycle.closure.explicit and lifecycle.closure.inherited provenance, and lifecycleCoverage reports authorized excluded history without silently widening. If the user asks for evidence "about" a Thread or Focus rather than its title, use onmove.search without narrowing kinds so descendant Notes and Updates can match. Every record retains the exact matched field, complete coded parent path, containing Thread, and recommended write target. Search returns only bounded match snippets—never lossless rich text. Read the selected ID for Markdown; request includeRichText=true there only immediately before a full structural replacement. If hasMore=true, call onmove.continue_search with only the returned token; this initial search tool does not accept continuationToken.`,
        inputSchema,
        outputSchema: entitySearchOutputSchema,
        annotations: { readOnlyHint: true }
      },
      async (input) => runEntitySearch(kind, input)
    )
  }

  type GlobalSearchInput = z.infer<typeof globalSearchSchema>
  const runGlobalSearch = (
    input: GlobalSearchInput,
    continuation: SearchContinuationPayload | null = null
  ): ReturnType<typeof result> => {
      if (continuation?.origin.type === 'entity') {
        throw new TypeError(
          'continuationToken belongs to an entity-specific search, not onmove.search'
        )
      }
      const resolved = continuation
        ? {
            query: continuation.query,
            diagnostics: {
              appliedScope: continuation.appliedScope,
              warnings: []
            }
          }
        : resolveSearchScope(input.scope, options.getCurrentUiContext?.() ?? EMPTY_UI_CONTEXT)
      const normalizedText = continuation?.text ?? input.text ?? null
      const effectiveKinds = continuation?.kinds ?? input.kinds
      const effectiveDate = continuation?.date ?? input.date
      const effectiveCreatedAt = continuation?.createdAt ?? input.createdAt
      const effectiveUpdatedAt = continuation?.updatedAt ?? input.updatedAt
      const effectiveTimeZone = continuation?.timeZone ?? input.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
      const effectiveSort = continuation?.sort ?? input.sort ?? (normalizedText === null
        ? { field: 'updatedAt' as const, direction: 'desc' as const }
        : { field: 'relevance' as const, direction: 'asc' as const })
      const lifecycle = continuation?.lifecycle ?? resolveInitialLifecycle(input.lifecycle)
      const projection: SearchProjectionInput = continuation?.projection ?? {
        hierarchy: input.projection?.hierarchy ?? false,
        subjects: input.projection?.subjects ?? false,
        scopes: input.projection?.scopes ?? false
      }
      const pageSize = continuation?.pageSize ?? input.page?.size ?? 10
      const maxBytes = continuation?.maxBytes ?? input.page?.maxBytes ?? 32_768
      const query: SearchQuery = {
        text: normalizedText,
        kinds: effectiveKinds,
        date: effectiveDate,
        createdAt: effectiveCreatedAt,
        updatedAt: effectiveUpdatedAt,
        timeZone: effectiveTimeZone,
        lifecycle,
        sort: effectiveSort,
        cursor: continuation?.cursor,
        limit: pageSize,
        ...resolved.query
      }
      const access = policy()
      const searched = database.queries.searchPage(query, access)
      if (continuation && continuation.indexGeneration !== searched.generation) {
        throw new TypeError(
          'SEARCH_CURSOR_STALE: OnMove data changed after this search page was created. ' +
          'Restart onmove.search with the original criteria; do not reuse the stale token.'
        )
      }
      const matches = searched.items
      const warnings = [...resolved.diagnostics.warnings]
      const decorateSearchItems = (values: readonly SearchResult[]) => values.map((match) => ({
        ...match
      }))
      const matchedSubjects = !projection.subjects || normalizedText === null
        ? []
        : [...new Map(matches.flatMap((match) => {
            if (match.reference.type !== 'subject') return []
            const subject = match.subject ?? { id: match.reference.id, name: match.title }
            return [[subject.id, subject] as const]
          })).values()].slice(0, pageSize)
      const subjectUsePages = matchedSubjects.map((subject) => ({
        subject,
        page: database.queries.searchPage({
          text: null,
          kinds: SEARCH_ENTITY_TYPES.filter((type) => type !== 'subject'),
          focusId: resolved.query.focusId,
          threadId: resolved.query.threadId,
          subjectId: subject.id,
          date: effectiveDate,
          createdAt: effectiveCreatedAt,
          updatedAt: effectiveUpdatedAt,
          timeZone: effectiveTimeZone,
          sort: { field: 'updatedAt', direction: 'desc' },
          lifecycle,
          limit: pageSize
        }, access)
      }))
      const allSubjectUses = subjectUsePages.flatMap(({ subject, page }) =>
        page.items.map((use) => ({ ...use, matchedSubject: subject })))
      const rawSubjectUses = allSubjectUses.slice(0, pageSize)
      const subjectUsesCompleteBeforeBudget =
        subjectUsePages.every(({ page }) => !page.hasMore) && allSubjectUses.length <= pageSize
      const subjectUseTotal = subjectUsePages.every(({ page }) => !page.hasMore)
        ? allSubjectUses.length
        : null
      let subjectUses = decorateSearchItems(rawSubjectUses)
      const subjectMatched = matchedSubjects.length > 0 || resolved.query.subjectId !== null
      const hierarchyRequested = projection.scopes || (projection.subjects && subjectMatched)
      const hierarchy = hierarchyRequested
        ? database.queries.browseHierarchy({
            text: normalizedText,
            ...resolved.query,
            includeThreads: projection.scopes || projection.subjects,
            includeCommitments: projection.scopes || projection.subjects,
            includeSubjects: projection.subjects,
            includeScopes: projection.scopes,
            lifecycle,
            limit: pageSize,
            offset: 0
          }, matches, access)
        : { paths: [], total: 0 }
      // Subject-attributed paths are the actionable discovery result. Keep them ahead of generic
      // ancestor rows so a tight byte budget never preserves chrome while discarding the target.
      let hierarchyPaths = [...hierarchy.paths]
        .sort((left, right) => Number(right.subject !== null) - Number(left.subject !== null))
        .map(decorateHierarchyPath)
      let namedSubjectDiscovery = matchedSubjects.map((subject) => {
        const applicablePaths = hierarchyPaths.filter((path) =>
          path.subject?.id === subject.id && path.hierarchy.thread !== null)
        const reviewContexts = [...new Map(applicablePaths.flatMap((path) => {
          const thread = path.hierarchy.thread
          if (!thread) return []
          return [[`${path.hierarchy.focus.id}:${thread.id}`, {
            focus: path.hierarchy.focus,
            thread,
            displayPath: `${path.hierarchy.focus.title} > ${thread.title}[${subject.name}]`,
            reviewSubjectRequest: {
              tool: 'onmove.review_subject',
              arguments: {
                focus: { id: path.hierarchy.focus.id },
                thread: { id: thread.id },
                subject: { id: subject.id }
              }
            }
          }] as const]
        })).values()]
        return { subject, applicablePaths, reviewContexts }
      })
      let items: Array<Record<string, unknown>> = decorateSearchItems(matches).map((item) => {
        const reference = item.reference as { type: string; id: number }
        if (reference.type !== 'subject') return item
        const discovery = namedSubjectDiscovery.find(({ subject }) =>
          subject.id === reference.id)
        return discovery ? { ...item, subjectDiscovery: discovery } : item
      })
      const itemCursors = [...searched.itemCursors]
      const initialSubjectUseCount = subjectUses.length
      const initialHierarchyPathCount = hierarchyPaths.length
      const appliedKinds = effectiveKinds?.length ? [...effectiveKinds] : 'all'
      if (matches.length === 0 && (
        resolved.diagnostics.appliedScope.mode !== 'all' || appliedKinds !== 'all' ||
        effectiveDate || effectiveCreatedAt || effectiveUpdatedAt
      )) {
        warnings.push(
          'No records matched the applied structured filters. Retain the named boundary and adjust only the intended date or kind filter.'
        )
      }
      const relevantSubjectUpdates = rawSubjectUses.filter(({ reference }) =>
        reference.type === 'update')
      const subjectScopedResults = resolved.query.subjectId !== null && matches.length > 0
      const authoritativeSubjectResult = rawSubjectUses.length > 0 || subjectScopedResults
      let recordsTruncatedByBudget = false
      let projectionTruncatedByBudget = false

      const continuationFor = (cursor: SearchPageCursor | null): string | null => cursor
        ? issueSearchContinuation({
            version: 5,
            origin: { type: 'global' },
            text: normalizedText,
            query: resolved.query,
            appliedScope: resolved.diagnostics.appliedScope,
            ...(effectiveKinds ? { kinds: [...effectiveKinds] } : {}),
            ...(effectiveDate ? { date: effectiveDate } : {}),
            ...(effectiveCreatedAt ? { createdAt: effectiveCreatedAt } : {}),
            ...(effectiveUpdatedAt ? { updatedAt: effectiveUpdatedAt } : {}),
            timeZone: effectiveTimeZone,
            sort: effectiveSort,
            lifecycle,
            projection,
            pageSize,
            maxBytes,
            indexGeneration: searched.generation,
            cursor
          })
        : null
      const response = (): Record<string, unknown> => {
        const hasMore = searched.hasMore || recordsTruncatedByBudget
        const lastCursor = itemCursors.at(-1) ?? null
        const globalComplete = resolved.diagnostics.appliedScope.mode === 'all' && !hasMore
        const hasMatches = items.length > 0 || authoritativeSubjectResult
        const doNotBroaden = authoritativeSubjectResult || (globalComplete && items.length > 0)
        const hierarchyComplete = !hierarchyRequested || hierarchyPaths.length === hierarchy.total
        const subjectUsesRequested = projection.subjects && matchedSubjects.length > 0
        const subjectUsesComplete = !subjectUsesRequested || (
          subjectUsesCompleteBeforeBudget && subjectUses.length === initialSubjectUseCount
        )
        const auxiliaryComplete = hierarchyComplete && subjectUsesComplete
        const foundSubjectNames = [...new Set(matchedSubjects.map(({ name }) => name))]
        const coverage = lifecycleCoverage(searched.lifecycle, matches.length)
        const searchStatus = {
          sufficient: hasMatches && doNotBroaden && auxiliaryComplete &&
            !coverage.wideningRecommended,
          doNotBroaden: doNotBroaden && !coverage.wideningRecommended,
          targetSelectionReady: items.length > 0 && items.every((item) =>
            item.path && (item.path as { complete?: unknown }).complete === true),
          reason: coverage.wideningRecommended
            ? 'Current lifecycle results are not sufficient because matching closed history was excluded.'
            : !hasMatches
            ? 'No visible records matched the applied text, kind, date, and scope criteria.'
            : !auxiliaryComplete
            ? 'Relevant discovery may be present, but at least one requested auxiliary projection is incomplete. Do not broaden globally; continue within the returned Subject/Focus/Thread boundary or use the matching list/review tool.'
            : authoritativeSubjectResult
            ? relevantSubjectUpdates.length > 0
              ? `Relevant Subject-attributed Updates were found for ${foundSubjectNames.join(', ') || `Subject ${resolved.query.subjectId}`}; subjectUses is authoritative.`
              : 'The requested Subject boundary returned authoritative attributed records.'
            : globalComplete
              ? 'The global structured query is complete; every matching visible record was returned.'
              : 'Another bounded page remains; continue with the returned UUID continuationToken.',
          nextAction: coverage.nextAction ?? (!hasMatches
            ? 'Adjust the text or applied filters, use a compact list tool for inventory, or resolve a known code, ID, or exact path.'
            : !auxiliaryComplete
            ? 'Use scope.mode=subject/focus/thread with the returned ID, onmove.review_subject, or a compact list tool; do not infer completeness from the truncated projection.'
            : doNotBroaden
            ? 'Stop discovery and use the returned record IDs directly.'
            : 'Call onmove.continue_search with only this continuationToken.')
        }
        return {
          items,
          subjectUses,
          namedSubjectDiscovery,
          hierarchyPaths,
          ...(hierarchyRequested ? { hierarchyNotation: HIERARCHY_NOTATION_GUIDE } : {}),
          projections: {
            primary: {
              requested: true,
              returned: items.length,
              total: null,
              complete: !hasMore,
              truncatedByBudget: recordsTruncatedByBudget
            },
            subjectUses: {
              requested: subjectUsesRequested,
              returned: subjectUses.length,
              total: subjectUsesRequested ? subjectUseTotal : 0,
              complete: subjectUsesComplete,
              truncatedByBudget: subjectUses.length < initialSubjectUseCount
            },
            hierarchy: {
              requested: hierarchyRequested,
              returned: hierarchyPaths.length,
              total: hierarchyRequested ? hierarchy.total : 0,
              complete: hierarchyComplete,
              truncatedByBudget: hierarchyPaths.length < initialHierarchyPathCount
            }
          },
          searchStatus,
          lifecycleCoverage: coverage,
          hasMore,
          continuationToken: hasMore ? continuationFor(lastCursor) : null,
          appliedQuery: {
            text: normalizedText,
            kinds: appliedKinds,
            date: effectiveDate ?? null,
            createdAt: effectiveCreatedAt ?? null,
            updatedAt: effectiveUpdatedAt ?? null,
            timeZone: effectiveTimeZone,
            sort: effectiveSort,
            lifecycle,
            projection
          },
          budget: {
            maxBytes,
            responseBytes: 0,
            structuredBytes: 0,
            estimatedToolResultBytes: 0,
            recordsTruncated: recordsTruncatedByBudget,
            projectionTruncated: projectionTruncatedByBudget
          }
        }
      }
      const diagnostics = (): McpDiagnostics => ({
        ...resolved.diagnostics,
        warnings,
        appliedKinds,
        resultCount: matches.length,
        subjectUseCount: rawSubjectUses.length,
        hierarchyPathCount: hierarchyPaths.length,
        hierarchyPathTotal: hierarchy.total
      })
      const structuredBytes = (): number => Buffer.byteLength(JSON.stringify({
        ...response(), diagnostics: diagnostics()
      }), 'utf8')
      const payloadBytes = (): number => resultPayloadBytes(response(), diagnostics())
      // Leave room for final truncation warnings and the decimal byte count itself.
      const exceedsBudget = (): boolean => payloadBytes() + 768 > maxBytes
      while (exceedsBudget() && hierarchyPaths.length > 0) {
        hierarchyPaths = hierarchyPaths.slice(0, -1)
        projectionTruncatedByBudget = true
      }
      while (exceedsBudget() && namedSubjectDiscovery.length > 0) {
        namedSubjectDiscovery = namedSubjectDiscovery.slice(0, -1)
        projectionTruncatedByBudget = true
      }
      while (exceedsBudget() && subjectUses.length > 0) {
        subjectUses = subjectUses.slice(0, -1)
        projectionTruncatedByBudget = true
      }
      if (exceedsBudget() && items.some((item) => 'subjectDiscovery' in item)) {
        items = items.map((item) => {
          const compact = { ...item }
          delete compact.subjectDiscovery
          projectionTruncatedByBudget = true
          return compact
        })
      }
      while (exceedsBudget() && items.length > 1) {
        items = items.slice(0, -1)
        itemCursors.pop()
        recordsTruncatedByBudget = true
      }
      if (exceedsBudget()) {
        items = items.map((item) => ({
          ...item,
          ...(typeof item.snippet === 'string' && item.snippet.length > 80
            ? { snippet: `${item.snippet.slice(0, 79)}…` }
            : {})
        }))
      }
      if (payloadBytes() > maxBytes) {
        throw new TypeError(
          `page.maxBytes=${maxBytes} is too small for one safe result and required diagnostics; ` +
          `at least ${payloadBytes()} bytes are required for this response shape`
        )
      }
      if (projectionTruncatedByBudget) {
        warnings.push('Auxiliary projections reduced for page.maxBytes.')
      }
      if (recordsTruncatedByBudget) {
        warnings.push('Page shortened for page.maxBytes; continue with the UUID token.')
      }
      if (exceedsBudget() && warnings.length > 1) {
        const omittedWarnings = warnings.length - 1
        warnings.splice(
          1,
          omittedWarnings,
          `${omittedWarnings} additional diagnostic warning${omittedWarnings === 1 ? ' was' : 's were'} omitted to honor page.maxBytes.`
        )
      }
      const finalResponse = response()
      const budget = finalResponse.budget as Record<string, unknown>
      for (let pass = 0; pass < 4; pass += 1) {
        budget.structuredBytes = structuredBytes()
        budget.estimatedToolResultBytes = resultPayloadBytes(finalResponse, diagnostics())
        budget.responseBytes = budget.estimatedToolResultBytes
      }
      if (Number(budget.estimatedToolResultBytes) > maxBytes) {
        throw new TypeError(`The safe search response exceeded page.maxBytes=${maxBytes}`)
      }
      return result(finalResponse, diagnostics())
  }

  server.registerTool(
    'onmove.search',
    {
      title: 'Search or list OnMove records',
      description: 'Use for initial FTS discovery, queryless structured listing, and cross-kind hierarchy browsing. Send text for language search, or text=null with kinds to list records without FTS. An omitted lifecycle follows the user\'s Include closed work in MCP results setting: current active/paused lineage when off, or all current and closed work when on. An explicit lifecycle.mode overrides the setting, and lifecycle filtering happens before ranking. Every result and auxiliary path reports lifecycle.closure.explicit and lifecycle.closure.inherited provenance. lifecycleCoverage reports authorized closed matches that were excluded and gives an exact retry when widening is recommended; results never widen silently. A request for information "about" a Thread/Focus should search all relevant kinds because the match may live in descendant Notes, Updates, Todos, or Routines rather than the container title. Note search covers title, current rich text, legacy Markdown, and legacy plain text. Every primary match includes its exact matched field, complete canonical-code path, containing Thread, and recommended write target; required primary metadata is never budget-truncated. hierarchyPaths is reserved for bounded auxiliary Subject/Scope expansion and is not duplicated for ordinary matches. Search returns bounded match snippets only—never lossless rich-text documents. Use the selected entity getter for Markdown and request includeRichText=true there only before a structural replacement. Date filters are database predicates, never search terms. Responses identify primary and auxiliary projection completeness, enforce a complete tool-result byte budget, and return a short UUID continuationToken only when another primary page exists. The complete signed cursor stays in the running app for 3 hours. To fetch that page call onmove.continue_search; never attach a token to this initial-search tool or repeat the search body with it.',
      inputSchema: globalSearchSchema,
      outputSchema: globalSearchOutputSchema,
      annotations: { readOnlyHint: true }
    },
    async (input) => runGlobalSearch(input)
  )

  server.registerTool(
    'onmove.continue_search',
    {
      title: 'Continue an OnMove search',
      description: 'Fetch exactly one next page from any OnMove search tool. Pass only the non-null UUID continuationToken returned by the preceding page. The running app stores the originating search, filters, lifecycle policy, scope, projection, sort, page budget, index generation, and stable cursor for 3 hours. Do not repeat or modify the search body. Copy the UUID; whitespace inserted into it is tolerated. Never invent a UUID. Restart the original search if the handle expired or the MCP server restarted.',
      inputSchema: z.strictObject({
        continuationToken: z.string().min(1).max(4_096).describe(
          'Required UUID handle returned by an OnMove search response with hasMore=true. It expires after 3 hours or an MCP server restart. Copy only this value; inserted whitespace is tolerated. No search criteria belong in this request.'
        )
      }),
      outputSchema: z.union([globalSearchOutputSchema, entitySearchOutputSchema]),
      annotations: { readOnlyHint: true }
    },
    async ({ continuationToken }) => {
      const continuation = resolveSearchContinuation(continuationToken)
      if (continuation.origin.type === 'global') {
        return runGlobalSearch({}, continuation)
      }
      if (typeof continuation.text !== 'string' || continuation.text.trim().length === 0) {
        throw new TypeError('continuationToken contains an invalid entity-search query')
      }
      return runEntitySearch(
        continuation.origin.kind,
        { text: continuation.text },
        continuation
      )
    }
  )

  const normalizeRetrievalRequest = (input: RetrievalInput): RetrievalContinuationRequest => ({
    text: input.text ?? null,
    context: input.context,
    lifecycle: resolveInitialLifecycle(input.lifecycle),
    ...(input.kinds ? { kinds: input.kinds } : {}),
    ...(input.date ? { date: input.date } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    strategy: input.strategy ?? 'auto',
    onUnavailable: input.onUnavailable ?? 'fallback',
    diversifyBy: input.diversifyBy ?? 'lineage'
  } as RetrievalContinuationRequest)

  const retrievalDiagnosticsScope = (
    context: RetrievalContinuationRequest['context']
  ): AppliedSearchScope => {
    const boundary = context.boundary
    const subjectId = context.subjectId ?? null
    if (boundary.type === 'focus') {
      return {
        requestedMode: 'focus', mode: 'focus', focusId: boundary.focusId,
        threadId: null, subjectId, source: 'explicit',
        description: `Retrieve inside Focus ${boundary.focusId}${subjectId === null ? '' : ` intersected with Subject ${subjectId}`}.`
      }
    }
    if (boundary.type === 'thread') {
      return {
        requestedMode: 'thread', mode: 'thread', focusId: boundary.focusId,
        threadId: boundary.threadId, subjectId, source: 'explicit',
        description: `Retrieve inside Focus ${boundary.focusId}, Thread ${boundary.threadId}${subjectId === null ? '' : `, and Subject ${subjectId}`}.`
      }
    }
    if (subjectId !== null) {
      return {
        requestedMode: 'subject', mode: 'subject', focusId: null,
        threadId: null, subjectId, source: 'explicit',
        description: `Retrieve Subject ${subjectId} attribution across the visible workspace.`
      }
    }
    return { ...GLOBAL_SCOPE, source: 'explicit' }
  }

  const runRetrieval = async (
    input: RetrievalInput | null,
    continuation: RetrievalContinuationPayload | null = null
  ): Promise<ReturnType<typeof result>> => {
    if (!continuation && !input) throw new TypeError('retrieval input is required')
    const request = continuation?.request ?? normalizeRetrievalRequest(input as RetrievalInput)
    const pageSize = continuation?.pageSize ?? input?.page?.size ?? 10
    const maxBytes = continuation?.maxBytes ?? input?.page?.maxBytes ?? 32_768
    const environment = retrievalEnvironment()
    if (continuation && (
      continuation.retrievalMode !== environment.retrievalMode ||
      continuation.accessFingerprint !== environment.accessFingerprint
    )) {
      throw new TypeError(
        'RETRIEVAL_CURSOR_STALE: OnMove retrieval mode or access settings changed after this ' +
        'page was created. Restart onmove.retrieve with the original criteria.'
      )
    }
    const continuationStrategy = continuation?.appliedStrategy === 'hybrid'
      ? 'hybrid'
      : continuation?.appliedStrategy === 'lexical'
        ? 'lexical'
        : request.strategy
    let retrieved: RetrievalPage
    try {
      retrieved = await database.queries.retrievePage({
        ...request,
        strategy: continuationStrategy,
        ...(continuation?.appliedStrategy === 'hybrid'
          ? { onUnavailable: 'error' as const }
          : {}),
        cursor: continuation?.cursor ?? null,
        limit: pageSize
      }, environment.access, environment.retrievalMode)
    } catch (error) {
      if (!continuation) throw error
      throw new TypeError(
        'RETRIEVAL_CURSOR_STALE: The retrieval context or applied strategy is no longer ' +
        'available. Restart onmove.retrieve with the original criteria.',
        { cause: error }
      )
    }
    if (continuation && (
      continuation.lexicalGeneration !== retrieved.lexicalGeneration ||
      continuation.semanticGeneration !== retrieved.semanticGeneration ||
      continuation.appliedStrategy !== retrieved.appliedStrategy ||
      retrieved.retrievalMode !== environment.retrievalMode
    )) {
      throw new TypeError(
        'RETRIEVAL_CURSOR_STALE: OnMove data or retrieval indexes changed after this page was ' +
        'created. Restart onmove.retrieve with the original criteria.'
      )
    }

    let items = retrieved.items.map((item) =>
      retrievalSafeValue(item) as Record<string, unknown>)
    const coverage = lifecycleCoverage(retrieved.lifecycle, retrieved.items.length)
    const itemCursors = [...retrieved.itemCursors]
    let recordsTruncated = false
    const warnings = [
      ...(continuation?.fallbackReason
        ? [continuation.fallbackReason]
        : retrieved.fallbackReason ? [retrieved.fallbackReason] : []),
      ...(coverage.wideningRecommended && coverage.nextAction
        ? [`Closed lifecycle matches were excluded. ${coverage.nextAction}`]
        : [])
    ]
    const appliedScope = retrievalDiagnosticsScope(request.context)
    const diagnostics = (): McpDiagnostics => ({
      appliedScope,
      warnings,
      appliedKinds: request.kinds?.length ? [...request.kinds] : 'all',
      resultCount: items.length
    })
    const continuationFor = (cursor: RetrievalCursor | null): string | null => cursor
      ? issueRetrievalContinuation({
          version: 2,
          serverNonce: retrievalServerNonce,
          request,
          cursor,
          pageSize,
          maxBytes,
          lexicalGeneration: retrieved.lexicalGeneration,
          semanticGeneration: retrieved.semanticGeneration,
          retrievalMode: retrieved.retrievalMode,
          appliedStrategy: retrieved.appliedStrategy,
          fallbackReason: continuation?.fallbackReason ?? retrieved.fallbackReason,
          accessFingerprint: environment.accessFingerprint
        })
      : null
    const response = (issueContinuation = false): Record<string, unknown> => {
      const hasMore = retrieved.hasMore || recordsTruncated
      const lastCursor = itemCursors.at(-1) ?? null
      if (hasMore && !lastCursor) {
        throw new TypeError('Retrieval reported another page without a stable item cursor')
      }
      return {
        items,
        retrieval: {
          mode: retrieved.retrievalMode,
          requestedStrategy: request.strategy,
          appliedStrategy: retrieved.appliedStrategy,
          fallbackReason: continuation?.fallbackReason ?? retrieved.fallbackReason
        },
        freshness: {
          lexicalGeneration: retrieved.lexicalGeneration,
          semanticGeneration: retrieved.semanticGeneration,
          semanticCoverage: retrieved.semanticCoverage,
          semanticState: retrieved.semanticGeneration === null
            ? 'unavailable'
            : retrieved.semanticGeneration === retrieved.lexicalGeneration
              ? 'current'
              : 'stale'
        },
        lifecycleCoverage: coverage,
        hasMore,
        continuationToken: hasMore
          ? issueContinuation
            ? continuationFor(lastCursor)
            : CONTINUATION_HANDLE_SIZE_PLACEHOLDER
          : null,
        appliedQuery: {
          text: request.text,
          context: request.context,
          kinds: request.kinds?.length ? [...request.kinds] : 'all',
          date: request.date ?? null,
          createdAt: request.createdAt ?? null,
          updatedAt: request.updatedAt ?? null,
          timeZone: request.timeZone,
          lifecycle: request.lifecycle,
          strategy: request.strategy,
          onUnavailable: request.onUnavailable,
          diversifyBy: request.diversifyBy
        },
        budget: {
          maxBytes,
          responseBytes: 0,
          structuredBytes: 0,
          estimatedToolResultBytes: 0,
          recordsTruncated,
          projectionTruncated: false
        }
      }
    }
    const payloadBytes = (): number => resultPayloadBytes(response(), diagnostics())
    const exceedsBudget = (): boolean => payloadBytes() + 512 > maxBytes
    if (exceedsBudget()) {
      items = items.map((item) => ({
        ...item,
        ...(typeof item.snippet === 'string' && item.snippet.length > 80
          ? { snippet: `${item.snippet.slice(0, 79)}…` }
          : {})
      }))
    }
    while (exceedsBudget() && items.length > 1) {
      items.pop()
      itemCursors.pop()
      recordsTruncated = true
    }
    if (recordsTruncated) {
      warnings.push(
        'Page shortened for page.maxBytes; continue with the UUID continuation handle.'
      )
    }
    const finalResponse = response(true)
    const budget = finalResponse.budget as Record<string, unknown>
    for (let pass = 0; pass < 4; pass += 1) {
      budget.structuredBytes = Buffer.byteLength(JSON.stringify({
        ...finalResponse,
        diagnostics: diagnostics()
      }), 'utf8')
      budget.estimatedToolResultBytes = resultPayloadBytes(finalResponse, diagnostics())
      budget.responseBytes = budget.estimatedToolResultBytes
    }
    if (Number(budget.estimatedToolResultBytes) > maxBytes) {
      throw new TypeError(
        `page.maxBytes=${maxBytes} is too small for one safe retrieval result and required diagnostics`
      )
    }
    return result(finalResponse, diagnostics())
  }

  server.registerTool(
    'onmove.retrieve',
    {
      title: 'Retrieve OnMove evidence in an exact operational context',
      description:
        'Retrieve visible records inside one explicit workspace, Focus, or asserted Focus/Thread ' +
        'boundary, optionally intersected with one canonical Subject. IDs are operational identity: ' +
        'resolve names or public codes first, and never substitute a semantically similar sibling. ' +
        'An omitted lifecycle follows the user\'s Include closed work in MCP results setting: ' +
        'current active/paused lineage when off, or all current and closed work when on. An explicit ' +
        'lifecycle.mode overrides the setting, and filtering happens before lexical/vector ranking. ' +
        'Every result reports lifecycle.closure.explicit and lifecycle.closure.inherited provenance, ' +
        'while lifecycleCoverage reports authorized excluded history and never widens ' +
        'silently. ' +
        'The result is provider-neutral and reports the requested/applied strategy, fallback, index ' +
        'freshness and complete hierarchy provenance. When another page exists, it returns a short ' +
        'UUID continuationToken while the complete signed state remains in the running app for 3 hours. Retrieval returns ' +
        'bounded excerpts only, never lossless rich text. Call onmove.continue_retrieval for another page.',
      inputSchema: retrievalInputSchema,
      outputSchema: retrievalOutputSchema,
      annotations: { readOnlyHint: true }
    },
    async (input) => runRetrieval(input)
  )

  server.registerTool(
    'onmove.continue_retrieval',
    {
      title: 'Continue an OnMove retrieval',
      description:
        'Fetch exactly one next retrieval page. Pass only the non-null UUID continuationToken ' +
        'returned by onmove.retrieve or this tool. The running app keeps the complete signed context, ' +
        'filters, strategy, byte budget, lifecycle policy, access fingerprint, retrieval mode, index ' +
        'generations, and stable cursor for 3 hours. Copy the UUID; inserted whitespace is tolerated. ' +
        'Never invent a UUID. Do not repeat or modify the retrieval request. Restart onmove.retrieve ' +
        'if the handle expired or the MCP server restarted.',
      inputSchema: z.strictObject({
        continuationToken: z.string().min(1).max(4_096).describe(
          'The exact UUID handle returned by an OnMove retrieval response with hasMore=true. It expires after 3 hours or an MCP server restart. Copy only this value; inserted whitespace is tolerated.'
        )
      }),
      outputSchema: retrievalOutputSchema,
      annotations: { readOnlyHint: true }
    },
    async ({ continuationToken }) => runRetrieval(
      null,
      resolveRetrievalContinuation(continuationToken)
    )
  )

  const entitySelectorSchema = (entity: string, example: string) => z.strictObject({
    id: idSchema.optional().describe(
      `Optional ${entity} ID. Prefer an ID from search hierarchy metadata when already known. ` +
      'Provide either id or title, not both.'
    ),
    title: z.string().min(1).optional().describe(
      `Optional exact ${entity} title, matched case-insensitively. Example: ${example}. ` +
      'Provide either id or title, not both.'
    )
  }).refine(({ id, title }) => id !== undefined || title !== undefined, {
    message: `${entity} selector requires id or title`
  }).refine(({ id, title }) => id === undefined || title === undefined, {
    message: `${entity} selector conflict: provide either id or title, not both`
  }).describe(
    `Choose exactly one ${entity} selector form: {id: positiveInteger} OR {title: exactName}.`
  )
  const subjectSelectorSchema = z.xor([
    z.strictObject({
      id: idSchema.describe(
        'The canonical Subject ID from Scope data, namedSubjectDiscovery, or a prior result.'
      )
    }),
    z.strictObject({
      name: z.string().min(1).describe(
        'The exact Subject name, matched case-insensitively. Example: Person Y.'
      )
    })
  ], 'Subject selector conflict: provide either id or name, not both').describe(
    'Choose exactly one canonical Subject selector form: {id: positiveInteger} OR {name: exactName}.'
  )
  server.registerTool(
    'onmove.resolve_work_target',
    {
      title: 'Resolve an OnMove hierarchy target',
      description: 'Resolve a Thread → Commitment → Subject path in hierarchy order before creating an Update or Todo. Exact punctuation-bearing titles such as 1:1 are preserved, duplicate names are returned as ambiguity rather than guessed, and Subjects are limited to the target\'s current effective Scope.',
      inputSchema: z.object({
        focus: entitySelectorSchema('Focus', 'Leadership portfolio').optional().describe(
          'Optional top-level Focus constraint. Add it when Thread names are duplicated.'
        ),
        thread: entitySelectorSchema('Thread', 'Team').describe(
          'Required Thread workstream selector; resolution starts here inside any optional Focus.'
        ),
        commitment: entitySelectorSchema('Commitment', '1:1').optional().describe(
          'Optional Commitment selector resolved only among children of the matched Thread.'
        ),
        subject: subjectSelectorSchema.optional().describe(
          'Optional Subject selector resolved only among the target parent\'s currently applicable Subjects.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => {
      const access = policy()
      const resolution = database.queries.resolveTarget(input, access)
      const candidates = resolution.candidates.map((candidate) =>
        decorateResolvedTarget(database, candidate, access))
      const parentCandidates = resolution.parentCandidates.map((candidate) =>
        decorateResolvedTarget(database, candidate, access))
      const threadCandidates = resolution.threadCandidates.map((candidate) => ({
        ...candidate,
        retrySelectors: {
          focus: { id: candidate.hierarchy.focus.id },
          thread: { id: candidate.hierarchy.thread.id }
        }
      }))
      const warnings: string[] = []
      if (resolution.status === 'ambiguous') {
        warnings.push(
          'Multiple hierarchy targets matched. Add a Focus selector or use an ID at an ambiguous level; do not guess.'
        )
      } else if (resolution.status === 'not_found' && parentCandidates.length > 0) {
        warnings.push(
          'The hierarchy matched, but the requested Subject is not currently applicable. Choose a Subject from parentCandidates.allowedSubjects or update Scope in OnMove.'
        )
      } else if (resolution.status === 'not_found' && threadCandidates.length > 0) {
        warnings.push(
          'No exact Thread title matched. threadCandidates contains safe shorthand matches. ' +
          'Retry with exactly one returned Thread ID; candidates are suggestions, not an automatic resolution.'
        )
      } else if (resolution.status === 'not_found') {
        warnings.push(
          'No visible hierarchy target matched. Retry with exact names or IDs; use onmove.search to discover hierarchy candidates.'
        )
      }
      return result({
        status: resolution.status,
        requested: resolution.requested,
        hierarchyNotation: HIERARCHY_NOTATION_GUIDE,
        target: resolution.status === 'resolved' ? candidates[0] : null,
        candidates,
        threadCandidates,
        ...(resolution.status === 'not_found' && parentCandidates.length > 0
          ? { parentCandidates }
          : {})
      }, {
        ...diagnosticsScope(),
        warnings,
        resolutionStatus: resolution.status,
        candidateCount: candidates.length
      })
    }
  )

  server.registerTool(
    'onmove.review_subject',
    {
      title: 'Review one Subject in one OnMove Thread',
      description: 'Resolve a named Subject inside a named Thread and return one compact current-situation view: Subject-attributed Updates sorted by updatedAt, open Subject Todos, and open applicable Commitments with their Subject-cell state. Use this instead of separate searches for a person, Thread label, Updates, Todos, and Commitments. A resolved response is sufficient and must stop discovery; fetch returned IDs directly.',
      inputSchema: z.strictObject({
        subject: subjectSelectorSchema.describe(
          'The exact canonical Subject to review. Prefer a returned Subject ID; otherwise provide the person or entity name exactly as the user named it.'
        ),
        thread: entitySelectorSchema('Thread', '1:1s').describe(
          'The Thread that bounds this review. This prevents same-named Subjects or generic labels from pulling records from unrelated workstreams.'
        ),
        focus: entitySelectorSchema('Focus', 'Team management').optional().describe(
          'Optional Focus constraint for duplicate Thread titles. Preserve the named Focus from prior hierarchy discovery when available.'
        ),
        limit: z.number().int().min(1).max(50).optional().describe(
          'Maximum Updates, open Todos, and open Commitments in each compact section. Defaults to 10.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => {
      const reviewed = database.queries.reviewSubject(input, policy())
      const threadCandidates = reviewed.threadCandidates.map((candidate) => {
        const subject = candidate.applicableSubjects.length === 1
          ? candidate.applicableSubjects[0]
          : null
        return {
          ...candidate,
          recommendedReviewRequest: subject
            ? {
                tool: 'onmove.review_subject',
                arguments: {
                  focus: { id: candidate.hierarchy.focus.id },
                  thread: { id: candidate.hierarchy.thread.id },
                  subject: { id: subject.id }
                }
              }
            : null
        }
      })
      const warnings: string[] = []
      if (reviewed.status === 'ambiguous') {
        warnings.push(
          'Multiple Subject/Thread paths matched. Add the Focus ID or use returned Subject and Thread IDs; do not broaden globally.'
        )
      } else if (reviewed.status === 'not_found' && threadCandidates.length > 0) {
        warnings.push(
          'No exact Thread title matched. threadCandidates contains safe shorthand title ' +
          'matches. Retry with one returned Thread ID; do not treat a suggestion as resolved.'
        )
      } else if (reviewed.status === 'not_found') {
        warnings.push(
          'The Subject is not currently applicable to the selected Thread. Verify the exact hierarchy path before broadening.'
        )
      }
      const reviewSearchGeneration = reviewed.review
        ? database.queries.searchPage({
            text: null,
            focusId: reviewed.review.hierarchy.focus.id,
            threadId: reviewed.review.hierarchy.thread.id,
            subjectId: reviewed.review.subject.id,
            kinds: ['update', 'todo', 'commitment'],
            lifecycle: DEFAULT_SEARCH_LIFECYCLE,
            sort: { field: 'updatedAt', direction: 'desc' },
            limit: 1
          }, policy()).generation
        : null
      const continuationToken = reviewed.review && reviewSearchGeneration !== null
        ? issueSearchContinuation({
            version: 5,
            origin: { type: 'global' },
            text: null,
            query: {
              focusId: reviewed.review.hierarchy.focus.id,
              threadId: reviewed.review.hierarchy.thread.id,
              subjectId: reviewed.review.subject.id
            },
            appliedScope: {
              requestedMode: 'subject',
              mode: 'subject',
              focusId: reviewed.review.hierarchy.focus.id,
              threadId: reviewed.review.hierarchy.thread.id,
              subjectId: reviewed.review.subject.id,
              source: 'explicit',
              description:
                `Subject ${reviewed.review.subject.id} within Thread ` +
                `${reviewed.review.hierarchy.thread.id}.`
            },
            kinds: ['update', 'todo', 'commitment'],
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
            sort: { field: 'updatedAt', direction: 'desc' },
            lifecycle: DEFAULT_SEARCH_LIFECYCLE,
            projection: {
              hierarchy: true,
              subjects: true,
              scopes: false
            },
            pageSize: Math.min(input.limit ?? 10, 25),
            maxBytes: 32_768,
            indexGeneration: reviewSearchGeneration,
            cursor: null
          })
        : null
      return result({
        ...reviewed,
        threadCandidates,
        searchStatus: {
          sufficient: reviewed.status === 'resolved',
          doNotBroaden: reviewed.status === 'resolved',
          targetSelectionReady: reviewed.status === 'resolved',
          reason: reviewed.status === 'resolved'
            ? `The requested Subject was resolved within ${reviewed.review?.displayPath}; the returned Updates, Todos, and Commitments are authoritative for this review.`
            : 'No unique Subject/Thread context was resolved.',
          nextAction: reviewed.status === 'resolved'
            ? 'Stop discovery and fetch or mutate the returned record IDs directly.'
            : 'Disambiguate with returned IDs while preserving the named hierarchy.'
        },
        continuationToken
      }, {
        ...diagnosticsScope(),
        warnings,
        resolutionStatus: reviewed.status,
        candidateCount: reviewed.candidates.length,
        resultCount: reviewed.review?.updates.length ?? 0
      })
    }
  )

  const notePathSchema = z.strictObject({
    focusTitle: exactPathTitleSchema('Focus', 'Project Atlas'),
    threadTitle: exactPathTitleSchema('Thread', 'Sprint execution').optional(),
    commitmentTitle: exactPathTitleSchema('Commitment', 'Ticket quality').optional(),
    noteTitle: exactPathTitleSchema('Note', 'Default'),
    includeRichText: z.boolean().optional().describe(
      'Defaults to false. Set true only immediately before a full structural replacement; ordinary reads return Markdown.'
    )
  }).refine(
    ({ threadTitle, commitmentTitle }) => commitmentTitle === undefined || threadTitle !== undefined,
    {
      message: 'A Commitment Note path requires threadTitle.',
      path: ['threadTitle']
    }
  )

  server.registerTool(
    'onmove.get_note_by_path',
    {
      title: 'Get an OnMove note by path',
      description: 'Read one directly owned Note from an exact Focus → optional Thread → optional Commitment → Note title path. This tool accepts titles only; use get_note_by_id for a known ID and search_notes for discovery.',
      inputSchema: notePathSchema,
      annotations: { readOnlyHint: true }
    },
    async ({ focusTitle, threadTitle, commitmentTitle, noteTitle, includeRichText }) => {
      const query = {
        focus: { title: focusTitle },
        ...(threadTitle === undefined ? {} : { thread: { title: threadTitle } }),
        ...(commitmentTitle === undefined
          ? {}
          : { commitment: { title: commitmentTitle } }),
        note: { title: noteTitle }
      }
      const include = includeRichText === true
      const resolution = database.queries.resolveNote(
        query, policy(), { includeRichText: include }
      )
      const candidates = resolution.candidates.map((candidate) => withNoteWriteGuide(
        include ? candidate : withoutNoteRichText(candidate)
      ))
      const warnings = resolution.status === 'ambiguous'
        ? ['Multiple Notes matched this exact hierarchy. Use search_notes to inspect candidates, then get_note_by_id; do not guess.']
        : resolution.status === 'not_found'
          ? ['No directly owned visible Note matched. Check each exact title or use search_notes; this tool never searches descendant Notes implicitly.']
          : []
      if (!include && resolution.status === 'resolved') warnings.push(RICH_TEXT_OMITTED_WARNING)
      return result({
        status: resolution.status,
        requested: {
          focusTitle,
          threadTitle: threadTitle ?? null,
          commitmentTitle: commitmentTitle ?? null,
          noteTitle,
          includeRichText: include
        },
        target: resolution.status === 'resolved' ? candidates[0] : null,
        candidates
      }, {
        ...diagnosticsScope(),
        warnings,
        resolutionStatus: resolution.status,
        candidateCount: candidates.length
      })
    }
  )

  const lifecycleStatusSchema = z.enum(['active', 'paused', 'done', 'cancelled'])
  const optionalDueDateSchema = dateSchema.nullable().optional().describe(
    'Optional due date in YYYY-MM-DD form; null explicitly removes the due date.'
  )
  const threadParentSchema = z.strictObject({
    type: z.literal('thread'),
    id: idSchema.describe('The owning Thread ID from onmove.get_thread_by_id or hierarchy.thread.id.')
  })
  const routineChecklistSchema = z.array(z.strictObject({
    inspection: z.string().min(1).describe('An inspection phrased as a verification or confirmation.'),
    required: z.boolean().optional().describe('Whether this check must be resolved before finalization; defaults to true.')
  })).min(1)

  server.registerTool(
    'onmove.create_focus',
    {
      title: 'Create an OnMove focus',
      description: 'Create a top-level Focus. Its description may be supplied as lossless rich text; a Default Note is created by the model.',
      inputSchema: z.strictObject({
        title: z.string().min(1).describe('The Focus title; duplicate titles are allowed.'),
        richText: richTextDocumentSchema.optional().describe(
          'Optional lossless rich-text Focus description. This is the only description write field.'
        ),
        status: lifecycleStatusSchema.optional(),
        dueDate: optionalDueDateSchema,
        needsReview: z.boolean().default(true).describe(
          'Whether this Focus permits descendant review tracking. Defaults to true.'
        ),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      let richText: OnMoveRichTextDocument | undefined
      try {
        richText = normalizedRichTextToolInput('onmove.create_focus', input, false)
      } catch (error) {
        if (!(error instanceof RichTextToolInputError)) throw error
        return rejected('onmove.create_focus', input, error.code, richTextInputErrorResult(error))
      }
      return mutationResult(() => found(database.queries.getFocus(
        database.commands.createFocus({
          title: input.title,
          descriptionRichText: richText,
          status: input.status,
          dueDate: input.dueDate,
          needsReview: input.needsReview ?? true,
          sensitive: input.sensitive
        }, policy(), server.server.getClientVersion()?.name).id,
        policy(),
        { includeRichText: true }
      )))
    }
  )

  server.registerTool(
    'onmove.update_focus',
    {
      title: 'Edit an OnMove focus',
      description: 'Edit compact Focus metadata. Use onmove.patch_rich_text or onmove.update_rich_text for the description.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The Focus ID.'),
        title: z.string().min(1).optional(),
        status: lifecycleStatusSchema.optional(),
        dueDate: optionalDueDateSchema,
        needsReview: z.boolean().optional(),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ id, ...input }) => mutationResult(() => {
      database.commands.updateFocus(id, input, policy(), server.server.getClientVersion()?.name)
      return found(database.queries.getFocus(id, policy()))
    })
  )

  server.registerTool(
    'onmove.create_thread',
    {
      title: 'Create an OnMove thread',
      description: 'Create a Thread workstream inside one existing Focus. Scope remains inherited/open and can be configured in OnMove.',
      inputSchema: z.strictObject({
        focusId: idSchema.describe('The owning Focus ID.'),
        title: z.string().min(1),
        status: lifecycleStatusSchema.optional(),
        dueDate: optionalDueDateSchema,
        reviewFrequencyDays: z.number().int().positive().default(7),
        needsReview: z.boolean().default(true).describe(
          'Whether this Thread participates in review. Defaults to true.'
        ),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() => {
      const created = database.commands.createThread(
        { ...input, needsReview: input.needsReview ?? true },
        policy(),
        server.server.getClientVersion()?.name
      ) as { id: number }
      return withWriteGuide(found(database.queries.getThread(
        created.id, policy(), { includeRichText: false }
      )))
    })
  )

  server.registerTool(
    'onmove.update_thread',
    {
      title: 'Edit an OnMove thread',
      description: 'Edit Thread title, lifecycle, due date, review cadence, review inclusion, or sensitivity without changing its Scope or parent.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The Thread ID.'),
        title: z.string().min(1).optional(),
        status: lifecycleStatusSchema.optional(),
        dueDate: optionalDueDateSchema,
        reviewFrequencyDays: z.number().int().positive().optional(),
        needsReview: z.boolean().optional(),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ id, ...input }) => mutationResult(() => {
      database.commands.updateThread(id, input, policy(), server.server.getClientVersion()?.name)
      return withWriteGuide(found(database.queries.getThread(
        id, policy(), { includeRichText: false }
      )))
    })
  )

  server.registerTool(
    'onmove.plan_thread_reparent',
    {
      title: 'Plan moving an OnMove Thread to another Focus',
      description: 'Read the complete stale-safe plan before moving a Thread between Focuses. The plan confirms that all owned records move with the Thread without leaking hidden child counts, reports inherited-versus-custom Scope behavior and any Subjects that must be added to the destination Focus, and returns exact arguments for onmove.reparent_thread. This tool never mutates data.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The existing Thread ID returned by discovery or a Thread read.'),
        destinationFocusId: idSchema.describe(
          'The destination Focus ID. A Focus is the top-level workspace that will own the Thread.'
        )
      }),
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async ({ id, destinationFocusId }) => result(found(
      database.queries.planThreadReparent(id, destinationFocusId, policy())
    ))
  )

  server.registerTool(
    'onmove.reparent_thread',
    {
      title: 'Move an OnMove Thread to another Focus',
      description: 'Move one Thread and all of its Commitments, Routines, Updates, Todos, Notes, review evidence, and Scope history to another Focus without recreating them. Call onmove.plan_thread_reparent immediately first and copy its nextAction arguments exactly. The stale source guard and exact Subject confirmation prevent an outdated plan from widening the destination Focus.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The existing Thread ID returned by discovery or the move plan.'),
        destinationFocusId: idSchema.describe(
          'The destination Focus ID returned in the move plan.'
        ),
        plannedFromFocusId: idSchema.describe(
          'The source Focus ID from plan.nextAction.arguments. It rejects a stale move if ownership changed after planning.'
        ),
        confirmedScopeSubjectIds: z.array(idSchema).max(500).default([]).describe(
          'Copy the exact Subject ID array from plan.nextAction.arguments. An empty array is correct only when the plan requires no destination Focus Scope additions.'
        )
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      const currentPlan = found(database.queries.planThreadReparent(
        input.id, input.destinationFocusId, policy()
      ))
      if (input.plannedFromFocusId !== currentPlan.plan.fromFocusId) {
        return rejected(
          'onmove.reparent_thread',
          input,
          'THREAD_REPARENT_PLAN_STALE',
          threadReparentPlanErrorResult(input, currentPlan, 'THREAD_REPARENT_PLAN_STALE')
        )
      }
      const expectedSubjectIds = [...currentPlan.nextAction.arguments.confirmedScopeSubjectIds]
        .sort((left, right) => left - right)
      const receivedSubjectIds = [...new Set(input.confirmedScopeSubjectIds)]
        .sort((left, right) => left - right)
      if (
        expectedSubjectIds.length !== receivedSubjectIds.length ||
        expectedSubjectIds.some((subjectId, index) => subjectId !== receivedSubjectIds[index])
      ) {
        return rejected(
          'onmove.reparent_thread',
          input,
          'THREAD_REPARENT_CONFIRMATION_REQUIRED',
          threadReparentPlanErrorResult(
            input,
            currentPlan,
            'THREAD_REPARENT_CONFIRMATION_REQUIRED'
          )
        )
      }
      const moved = database.commands.reparentThread({
        id: input.id,
        focusId: input.destinationFocusId,
        plannedFromFocusId: input.plannedFromFocusId,
        confirmedScopeSubjectIds: input.confirmedScopeSubjectIds
      }, policy(), server.server.getClientVersion()?.name)
      if (moved.changed) notifyMutation()
      const context = withWriteGuide(found(database.queries.getThread(
        input.id, policy(), { includeRichText: false }
      )))
      return result({
        ...record(context),
        reparenting: {
          changed: moved.changed,
          previousFocusId: moved.previousFocusId,
          destinationFocusId: input.destinationFocusId,
          undo: moved.changed
            ? {
                planTool: 'onmove.plan_thread_reparent',
                arguments: {
                  id: input.id,
                  destinationFocusId: moved.previousFocusId
                },
                instruction: 'Plan the reverse move against current Scope state before undoing.'
              }
            : null
        }
      })
    }
  )

  server.registerTool(
    'onmove.create_commitment',
    {
      title: 'Create an OnMove commitment',
      description: 'Create a tracked Commitment under one Thread. Its effective Subjects always derive from that Thread.',
      inputSchema: z.strictObject({
        parent: threadParentSchema,
        title: z.string().min(1),
        status: lifecycleStatusSchema.optional(),
        dueDate: optionalDueDateSchema,
        cadenceDays: z.number().int().positive().nullable().optional(),
        reviewFrequencyDays: z.number().int().positive().optional(),
        needsReview: z.boolean().default(true).describe(
          'Whether this Commitment participates in review. Defaults to true.'
        ),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() => {
      const created = database.commands.createCommitment({
        ...input,
        needsReview: input.needsReview ?? true,
        type: 'tracking'
      }, policy(), server.server.getClientVersion()?.name) as { id: number }
      return withWriteGuide(found(database.queries.getCommitment(
        created.id, policy(), { includeRichText: false }
      )))
    })
  )

  server.registerTool(
    'onmove.update_commitment',
    {
      title: 'Edit an OnMove commitment',
      description: 'Edit a tracked Commitment without changing its Thread or derived Scope.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The Commitment ID.'),
        title: z.string().min(1).optional(),
        status: lifecycleStatusSchema.optional(),
        dueDate: optionalDueDateSchema,
        cadenceDays: z.number().int().positive().nullable().optional(),
        reviewFrequencyDays: z.number().int().positive().optional(),
        needsReview: z.boolean().optional(),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ id, ...input }) => mutationResult(() => {
      database.commands.updateCommitment(id, input, policy(), server.server.getClientVersion()?.name)
      return withWriteGuide(found(database.queries.getCommitment(
        id, policy(), { includeRichText: false }
      )))
    })
  )

  server.registerTool(
    'onmove.create_routine',
    {
      title: 'Create an OnMove routine',
      description: 'Create a recurring immutable-checklist Routine under one Thread.',
      inputSchema: z.strictObject({
        parent: threadParentSchema,
        name: z.string().min(1),
        scheduleWeekdays: z.array(z.enum([
          'monday', 'tuesday', 'wednesday', 'thursday', 'friday'
        ])).max(5),
        scopeId: idSchema.nullable().optional(),
        sensitive: z.boolean().optional(),
        needsAttestation: z.boolean().optional(),
        checklist: routineChecklistSchema
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() => {
      const created = database.commands.createRoutine(
        input, policy(), server.server.getClientVersion()?.name
      ) as { id: number }
      return found(database.queries.getRoutine(created.id, policy()))
    })
  )

  server.registerTool(
    'onmove.update_routine',
    {
      title: 'Edit an OnMove routine',
      description: 'Edit a Routine definition. A supplied checklist creates a future immutable template version and never rewrites prior Runs.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The Routine ID.'),
        name: z.string().min(1).optional(),
        scheduleWeekdays: z.array(z.enum([
          'monday', 'tuesday', 'wednesday', 'thursday', 'friday'
        ])).max(5).optional(),
        scopeId: idSchema.nullable().optional(),
        sensitive: z.boolean().optional(),
        needsAttestation: z.boolean().optional(),
        checklist: routineChecklistSchema.optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ id, ...input }) => mutationResult(() => {
      database.commands.updateRoutine(id, input, policy(), server.server.getClientVersion()?.name)
      return found(database.queries.getRoutine(id, policy()))
    })
  )

  server.registerTool(
    'onmove.update_update',
    {
      title: 'Edit OnMove update metadata',
      description: 'Edit an Update date, state, or sensitivity. Use rich-text tools for its observation.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The Update ID.'),
        date: dateSchema.optional(),
        state: z.enum(['red', 'yellow', 'green', 'none']).optional(),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() => {
      database.commands.updateUpdate(input, policy(), server.server.getClientVersion()?.name)
      return withUpdateContextWriteGuide(found(database.queries.getUpdate(
        input.id, policy(), { includeRichText: false }
      )))
    })
  )

  const parentSchema = z.object({
    type: z.enum(['thread', 'commitment']).describe(
      'The exact parent entity type: Thread is a Focus workstream; Commitment is a tracked obligation inside a Thread.'
    ),
    id: idSchema.describe(
      'The parent Thread or Commitment\'s own ID. Use the corresponding searchResult.hierarchy ID, not an Update, Todo, or Note ID.'
    )
  })
  const semanticPathEntitySchema = (label: string) => z.strictObject({
    id: idSchema.describe(`The ${label}'s own ID from hierarchy discovery.`),
    title: z.string().min(1).describe(`The ${label}'s readable title from hierarchy discovery.`)
  })
  const semanticPathSchema = z.strictObject({
    focus: semanticPathEntitySchema('Focus').optional(),
    thread: semanticPathEntitySchema('Thread'),
    commitment: semanticPathEntitySchema('Commitment').optional(),
    subject: z.strictObject({
      id: idSchema.describe('The canonical Subject ID for the exact Scope cell.'),
      name: z.string().min(1).describe('The Subject name shown in bracket notation.')
    }).optional()
  }).describe(
    'The explicit hierarchy path copied from search or resolve_work_target. Example: ' +
    '{thread:{id:2,title:"Team management"},commitment:{id:7,title:"1:1s"},' +
    'subject:{id:28,name:"Michael"}} means Team management > 1:1s[Michael]. ' +
    'Required whenever the user names a Subject; the server rejects flattening it to an unscoped or different parent.'
  )
  const updateAttributionSchema = z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('unscoped').describe(
        'Create a general Update on an Open parent or on a Scope with no applicable Subjects.'
      )
    }),
    z.object({
      mode: z.literal('subject').describe(
        'Attribute the Update to exactly one currently applicable Subject cell.'
      ),
      subjectId: idSchema.describe(
        'A Subject ID from writeGuide.createUpdate.allowedSubjects on onmove.get_thread_by_id or onmove.get_commitment_by_id.'
      )
    })
  ]).nullable().optional().describe(
    'Preferred explicit Update attribution. Inspect the parent\'s writeGuide.createUpdate first. Omit or use unscoped for an Open parent; use subject with one allowed Subject for a scoped parent.'
  )
  const todoAttributionSchema = z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('unscoped').describe(
        'Create one general Todo on an Open parent or a Scope with no current Subjects.'
      )
    }),
    z.object({
      mode: z.literal('subject').describe(
        'Create one Todo for exactly one currently applicable Subject.'
      ),
      subjectId: idSchema.describe(
        'A Subject ID from writeGuide.createTodo.allowedSubjects or resolve_work_target.'
      )
    }),
    z.object({
      mode: z.literal('all-subjects').describe(
        'Create one shared Todo with a separately completable cell for every current Subject.'
      )
    })
  ]).nullable().optional().describe(
    'Preferred explicit Todo attribution. Inspect writeGuide.createTodo. Open parents use unscoped; scoped parents use one subject or all-subjects.'
  )
  server.registerTool(
    'onmove.create_update',
    {
      title: 'Create OnMove update',
      description: 'Create an Update (direct evidence) with an optional editor-neutral rich-text document, not edit a Thread record. The parent object identifies the owning Thread or Commitment. Open parents require unscoped attribution and reject Subject IDs; scoped parents require exactly one Subject from the parent\'s writeGuide.createUpdate.allowedSubjects. When the user names a Subject path such as 1:1s[Michael], semanticPath is required and an unscoped or different-parent write is rejected. Call search, resolve_work_target, get_thread_by_id, or get_commitment_by_id first when attribution is uncertain.',
      inputSchema: z.strictObject({
        parent: parentSchema,
        attribution: updateAttributionSchema,
        semanticPath: semanticPathSchema.optional().describe(
          'Copy this from hierarchyPaths[].semanticPath, resolve_work_target.target.semanticPath, or a write guide. Example names {thread:"Team management",commitment:"1:1s",subject:"Michael"} mean Team management > 1:1s[Michael]. It is required when the user request names a scoped Subject destination.'
        ),
        subjectId: idSchema.nullable().optional().describe(
          'Backward-compatible shorthand for attribution.mode="subject". Prefer attribution. Null or omitted means unscoped and is required for an Open parent.'
        ),
        date: dateSchema.optional().describe('The Update\'s recorded date; defaults to today.'),
        richText: richTextDocumentSchema.optional().describe(
          'The only rich-text observation field. Omit it for a blank Update. Use marks:["italic","highlight"] for italic yellow-highlighted text; highlight-yellow is accepted as a mark alias.'
        ),
        state: z.enum(['red', 'yellow', 'green', 'none']).optional().describe(
          'Evidence state; defaults to none.'
        ),
        sensitive: z.boolean().optional().describe(
          'Whether the Update is sensitive; defaults to false and requires MCP sensitive access when true.'
        )
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      let richText: OnMoveRichTextDocument | undefined
      try {
        richText = normalizedRichTextToolInput('onmove.create_update', input, false)
      } catch (error) {
        if (!(error instanceof RichTextToolInputError)) throw error
        return rejected(
          'onmove.create_update', input, error.code, richTextInputErrorResult(error)
        )
      }
      const normalized: CreateUpdateToolInput = {
        parent: input.parent,
        attribution: input.attribution,
        semanticPath: input.semanticPath,
        subjectId: input.subjectId,
        date: input.date,
        richText,
        state: input.state,
        sensitive: input.sensitive
      }
      const subjectId = normalizedUpdateSubject(normalized)
      try {
        return mutationResult(() => withUpdateRichTextWriteGuide(
          database.commands.createUpdate(
            {
              parent: normalized.parent,
              subjectId,
              semanticPath: normalized.semanticPath,
              date: normalized.date,
              document: normalized.richText,
              state: normalized.state,
              sensitive: normalized.sensitive
            },
            policy(),
            server.server.getClientVersion()?.name
          )
        ))
      } catch (error) {
        if (error instanceof SemanticTargetValidationError) {
          return semanticTargetErrorResult(error, 'onmove.create_update', { ...normalized })
        }
        if (!(error instanceof ScopeTargetValidationError)) throw error
        const context = error.issue.parent.type === 'thread'
          ? database.queries.getThread(error.issue.parent.id, policy(), { includeRichText: false })
          : database.queries.getCommitment(error.issue.parent.id, policy(), { includeRichText: false })
        return scopeTargetErrorResult(error, normalized, updateWriteGuide(context))
      }
    }
  )

  server.registerTool(
    'onmove.reparent_update',
    {
      title: 'Move an OnMove update to the correct hierarchy path',
      description: 'Repair an Update created on the wrong Thread, Commitment, or Subject cell without recreating it. The Update keeps its ID, date, state, sensitivity, rich-text observation, revision, and history. The destination follows the same scoped-attribution and semanticPath safeguards as create_update.',
      inputSchema: z.strictObject({
        id: idSchema.describe('The existing Update ID returned by search or get_update_by_id.'),
        destination: z.strictObject({
          parent: parentSchema,
          attribution: updateAttributionSchema,
          semanticPath: semanticPathSchema.optional().describe(
            'The intended destination path from search or resolve_work_target. Include it whenever the correction names a Subject.'
          )
        })
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      const destination: CreateUpdateToolInput = {
        parent: input.destination.parent,
        attribution: input.destination.attribution,
        semanticPath: input.destination.semanticPath
      }
      const subjectId = normalizedUpdateSubject(destination)
      try {
        return mutationResult(() => {
          const moved = database.commands.reparentUpdate({
            id: input.id,
            parent: destination.parent,
            subjectId,
            semanticPath: destination.semanticPath
          }, policy(), server.server.getClientVersion()?.name)
          const context = withUpdateContextWriteGuide(found(
            database.queries.getUpdate(input.id, policy(), { includeRichText: false })
          ))
          return {
            ...record(context),
            reparenting: {
              previous: moved.previous,
              undo: {
                tool: 'onmove.reparent_update',
                arguments: {
                  id: input.id,
                  destination: {
                    parent: moved.previous.parent,
                    attribution: moved.previous.subjectId === null
                      ? { mode: 'unscoped' }
                      : { mode: 'subject', subjectId: moved.previous.subjectId }
                  }
                }
              }
            }
          }
        })
      } catch (error) {
        if (error instanceof SemanticTargetValidationError) {
          return semanticTargetErrorResult(error, 'onmove.reparent_update', input)
        }
        if (!(error instanceof ScopeTargetValidationError)) throw error
        const context = error.issue.parent.type === 'thread'
          ? database.queries.getThread(error.issue.parent.id, policy(), { includeRichText: false })
          : database.queries.getCommitment(error.issue.parent.id, policy(), { includeRichText: false })
        return reparentScopeTargetErrorResult(error, input, updateWriteGuide(context))
      }
    }
  )

  server.registerTool(
    'onmove.create_todo',
    {
      title: 'Create OnMove todo',
      description: 'Create an actionable Todo on a Thread or Commitment. Inspect writeGuide.createTodo from get_thread_by_id, get_commitment_by_id, or resolve_work_target: Open parents use unscoped attribution; scoped parents use one allowed Subject or all-subjects for independently completable Subject cells.',
      inputSchema: z.object({
        parent: parentSchema,
        attribution: todoAttributionSchema,
        subjectId: idSchema.nullable().optional().describe(
          'Backward-compatible shorthand for attribution.mode="subject". Prefer attribution. Null or omitted means unscoped.'
        ),
        sharedAcrossSubjects: z.boolean().optional().describe(
          'Backward-compatible shorthand for attribution.mode="all-subjects". Prefer attribution.'
        ),
        name: z.string().min(1).describe('The concrete action to perform, such as Do X.'),
        dueDate: dateSchema.nullable().optional().describe(
          'Optional Todo due date, or null for no due date.'
        )
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      const normalized: CreateTodoToolInput = input
      const attribution = normalizedTodoAttribution(normalized)
      try {
        return mutationResult(() => database.commands.createTodo({
          parent: normalized.parent,
          ...attribution,
          name: normalized.name,
          dueDate: normalized.dueDate
        }, policy(), server.server.getClientVersion()?.name))
      } catch (error) {
        if (!(error instanceof ScopeTargetValidationError)) throw error
        const context = error.issue.parent.type === 'thread'
          ? database.queries.getThread(error.issue.parent.id, policy(), { includeRichText: false })
          : database.queries.getCommitment(error.issue.parent.id, policy(), { includeRichText: false })
        return todoScopeTargetErrorResult(error, normalized, todoWriteGuide(context))
      }
    }
  )

  server.registerTool(
    'onmove.update_todo',
    {
      title: 'Update OnMove todo',
      description: 'Edit the name, due date, or completion state of a visible Todo.',
      inputSchema: z.object({
        id: idSchema.describe('The Todo\'s own positive ID returned by OnMove Todo data.'),
        name: z.string().min(1).optional(),
        dueDate: dateSchema.nullable().optional(),
        done: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() => database.commands.updateTodo(
      input, policy(), 'onmove.update_todo', server.server.getClientVersion()?.name
    ))
  )

  const patchMarksSchema = z.array(z.enum([
    ...ONMOVE_RICH_TEXT_MARKS,
    'highlight-yellow'
  ])).max(ONMOVE_RICH_TEXT_MARKS.length).optional().describe(
    'Formatting marks applied only to the matched text: bold, italic, underline, strikethrough, or highlight. highlight-yellow is accepted as an input alias.'
  )

  const richTextFieldTargetSchema = z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('focus-description').describe(
        'Selects the rich-text description belonging to one top-level Focus.'
      ),
      focusId: idSchema.describe(
        'The Focus\'s own positive ID from get_focus_by_id, get_note_by_path context, or search hierarchy.focus.id.'
      )
    }),
    z.strictObject({
      type: z.literal('update-observation').describe(
        'Selects the rich-text observation belonging to one Update evidence record.'
      ),
      updateId: idSchema.describe(
        'The Update\'s own positive ID from get_update_by_id, a parent updates array, or an Update searchResult.reference.id.'
      )
    })
  ]).describe(
    'A self-describing rich-text target. IDs are interpreted only within the selected target type.'
  )

  const readRichTextTarget = (target: RichTextFieldTarget): unknown =>
    target.type === 'focus-description'
      ? withFocusDescriptionWriteGuide(found(database.queries.getFocus(
          target.focusId,
          policy(),
          { includeRichText: true }
        )))
      : withUpdateContextWriteGuide(found(database.queries.getUpdate(target.updateId, policy())))

  server.registerTool(
    'onmove.patch_rich_text',
    {
      title: 'Patch an OnMove rich-text field',
      description: 'Safely replace exact text or change marks in a Focus description or Update observation without resending the whole document. Surrounding structure, links, colors, and unspecified marks are preserved. Notes use onmove.patch_note_text.',
      inputSchema: z.strictObject({
        target: richTextFieldTargetSchema,
        expectedRevision: z.number().int().nonnegative().describe(
          'The exact field revision returned by its read or write guide. Stale writes are rejected without changing content.'
        ),
        findText: z.string().min(1).describe(
          'Exact case-sensitive words to match within one paragraph or list item. It cannot cross a line or block boundary.'
        ),
        replaceText: z.string().optional().describe(
          'Replacement words. Omit for a marks-only patch; send an empty string only to delete the matched text.'
        ),
        occurrence: z.number().int().positive().optional().describe(
          'One-based match in document order. Omit for a unique match; an ambiguous response reports the available count.'
        ),
        addMarks: patchMarksSchema,
        removeMarks: patchMarksSchema,
        clear: z.boolean().optional().describe(
          'Set true only to confirm intentionally removing all readable text from a populated field.'
        )
      }).refine(({ replaceText, addMarks, removeMarks }) =>
        replaceText !== undefined || Boolean(addMarks?.length) || Boolean(removeMarks?.length), {
        message: 'Provide replaceText, addMarks, or removeMarks.'
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      const canonicalMarks = (marks: typeof input.addMarks): OnMoveRichTextMark[] | undefined =>
        marks?.map((mark) => mark === 'highlight-yellow' ? 'highlight' : mark)
      try {
        const document = database.commands.patchRichText({
          reference: applicationRichTextReference(input.target),
          expectedRevision: input.expectedRevision,
          findText: input.findText,
          replaceText: input.replaceText,
          occurrence: input.occurrence,
          addMarks: canonicalMarks(input.addMarks),
          removeMarks: canonicalMarks(input.removeMarks),
          clear: input.clear
        }, policy(), server.server.getClientVersion()?.name)
        options.onRichTextMutation?.(document)
        notifyMutation()
        return result(readRichTextTarget(input.target))
      } catch (error) {
        if (error instanceof RichTextRevisionConflictError) {
          return rejected(
            'onmove.patch_rich_text', input, 'rich_text_revision_conflict',
            richTextRevisionConflictResult(error, input.target)
          )
        }
        if (error instanceof RichTextDisappearedError) {
          return rejected(
            'onmove.patch_rich_text', input, error.issue.code,
            richTextDisappearedResult(error, 'onmove.patch_rich_text', input.target, input)
          )
        }
        if (error instanceof OnMoveRichTextPatchError) {
          return rejected(
            'onmove.patch_rich_text', input, error.code, richTextPatchErrorResult(error, input)
          )
        }
        throw error
      }
    }
  )

  server.registerTool(
    'onmove.update_rich_text',
    {
      title: 'Replace an OnMove rich-text field',
      description: 'Replace a Focus description or Update observation with a complete editor-neutral rich-text document using optimistic concurrency. First read the one known entity with includeRichText=true. Do not expand search results for this; localized changes should use patch_rich_text from the compact Markdown read. Notes use onmove.update_note.',
      inputSchema: z.strictObject({
        target: richTextFieldTargetSchema,
        expectedRevision: z.number().int().nonnegative().describe(
          'The exact field revision returned by its read or write guide. Stale writes are rejected without changing content.'
        ),
        richText: richTextDocumentSchema.optional().describe(
          'The only complete replacement field. Copy the field\'s returned richText document, change only intended nodes, and submit it here.'
        ),
        clear: z.boolean().optional().describe(
          'Set true only to confirm intentionally removing all readable text from a populated field.'
        )
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      let richText: OnMoveRichTextDocument
      try {
        richText = normalizedRichTextToolInput(
          'onmove.update_rich_text',
          input,
          true
        ) as OnMoveRichTextDocument
      } catch (error) {
        if (!(error instanceof RichTextToolInputError)) throw error
        return rejected(
          'onmove.update_rich_text', input, error.code, richTextInputErrorResult(error)
        )
      }
      try {
        const document = database.commands.updateRichText({
          reference: applicationRichTextReference(input.target),
          expectedRevision: input.expectedRevision,
          document: richText,
          clear: input.clear
        }, policy(), server.server.getClientVersion()?.name)
        options.onRichTextMutation?.(document)
        notifyMutation()
        return result(readRichTextTarget(input.target))
      } catch (error) {
        if (error instanceof RichTextRevisionConflictError) {
          return rejected(
            'onmove.update_rich_text', input, 'rich_text_revision_conflict',
            richTextRevisionConflictResult(error, input.target)
          )
        }
        if (error instanceof RichTextDisappearedError) {
          return rejected(
            'onmove.update_rich_text', input, error.issue.code,
            richTextDisappearedResult(error, 'onmove.update_rich_text', input.target, input)
          )
        }
        throw error
      }
    }
  )

  server.registerTool(
    'onmove.patch_note_text',
    {
      title: 'Patch text in an OnMove note',
      description: 'Safely replace one exact text occurrence or change its marks without resending the rich-text document. Surrounding structure, links, colors, and unspecified marks are preserved. A unique match needs no occurrence; duplicate matches return a count and require a one-based occurrence.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Note\'s own positive ID from get_note_by_path, get_note_by_id, or a Note search result.'
        ),
        expectedRevision: z.number().int().nonnegative().describe(
          'The exact current Note revision. Stale writes are rejected without changing content.'
        ),
        findText: z.string().min(1).describe(
          'Exact case-sensitive words to match within one paragraph or list item. Example: hello world. It cannot cross a line or block boundary.'
        ),
        replaceText: z.string().optional().describe(
          'Replacement words. Omit for a marks-only patch; send an empty string only to delete the matched text.'
        ),
        occurrence: z.number().int().positive().optional().describe(
          'One-based match in document order. Omit when findText occurs exactly once; required after a NOTE_TEXT_AMBIGUOUS response.'
        ),
        addMarks: patchMarksSchema,
        removeMarks: patchMarksSchema,
        clear: z.boolean().optional().describe(
          'Set true only to confirm an intentional change from a populated Note to no readable text. Otherwise NOTE_TEXT_DISAPPEARED is returned.'
        )
      }).refine(({ replaceText, addMarks, removeMarks }) =>
        replaceText !== undefined || Boolean(addMarks?.length) || Boolean(removeMarks?.length), {
        message: 'Provide replaceText, addMarks, or removeMarks.'
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      const canonicalMarks = (marks: typeof input.addMarks): OnMoveRichTextMark[] | undefined =>
        marks?.map((mark) => mark === 'highlight-yellow' ? 'highlight' : mark)
      try {
        const document = database.commands.patchNoteText({
          ...input,
          addMarks: canonicalMarks(input.addMarks),
          removeMarks: canonicalMarks(input.removeMarks)
        }, policy(), server.server.getClientVersion()?.name)
        options.onRichTextMutation?.(document)
        notifyMutation()
        return result(withNoteWriteGuide(found(database.queries.getNote(input.id, policy()))))
      } catch (error) {
        if (error instanceof NoteRevisionConflictError) {
          return rejected(
            'onmove.patch_note_text', input, 'note_revision_conflict',
            noteRevisionConflictResult(error)
          )
        }
        if (error instanceof NoteTextDisappearedError) {
          return rejected(
            'onmove.patch_note_text', input, error.issue.code,
            noteTextDisappearedResult(error, 'onmove.patch_note_text', input)
          )
        }
        if (error instanceof OnMoveRichTextPatchError) {
          return rejected(
            'onmove.patch_note_text', input, error.code, noteTextPatchErrorResult(error, input)
          )
        }
        throw error
      }
    }
  )

  server.registerTool(
    'onmove.update_note',
    {
      title: 'Update an OnMove note',
      description: 'Replace one visible Note with a complete editor-neutral rich-text document using optimistic concurrency. First call get_note_by_id(includeRichText=true) for this known Note. Do not expand search results for this; localized changes should use patch_note_text from the compact Markdown read. The Markdown note.content projection is intentionally not writable, so formatting cannot be flattened accidentally.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Note\'s own positive ID from onmove.get_note_by_id, a Note search hit, or a parent context.'
        ),
        expectedRevision: z.number().int().nonnegative().describe(
          'The exact Note revision returned by onmove.get_note_by_id. Stale revisions are rejected without changing content.'
        ),
        richText: richTextDocumentSchema.optional().describe(
          'The only complete replacement field. Copy note.richText from onmove.get_note_by_id, change only the intended nodes, and submit it here.'
        ),
        clear: z.boolean().optional().describe(
          'Set true only to confirm an intentional change from a populated Note to no readable text. Otherwise NOTE_TEXT_DISAPPEARED is returned.'
        )
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => {
      let richText: OnMoveRichTextDocument
      try {
        richText = normalizedRichTextToolInput(
          'onmove.update_note',
          input,
          true
        ) as OnMoveRichTextDocument
      } catch (error) {
        if (!(error instanceof RichTextToolInputError)) throw error
        return rejected(
          'onmove.update_note', input, error.code, richTextInputErrorResult(error)
        )
      }
      try {
        const document = database.commands.updateNote(
          {
            id: input.id,
            expectedRevision: input.expectedRevision,
            document: richText,
            clear: input.clear
          },
          policy(),
          server.server.getClientVersion()?.name
        )
        options.onRichTextMutation?.(document)
        notifyMutation()
        return result(withNoteWriteGuide(found(database.queries.getNote(input.id, policy()))))
      } catch (error) {
        if (error instanceof NoteRevisionConflictError) {
          return rejected(
            'onmove.update_note', input, 'note_revision_conflict',
            noteRevisionConflictResult(error)
          )
        }
        if (error instanceof NoteTextDisappearedError) {
          return rejected(
            'onmove.update_note', input, error.issue.code,
            noteTextDisappearedResult(error, 'onmove.update_note', input)
          )
        }
        throw error
      }
    }
  )

  server.registerTool(
    'onmove.complete_todo',
    {
      title: 'Complete OnMove todo',
      description: 'Mark one visible Todo complete through the audited model transition.',
      inputSchema: z.object({
        id: idSchema.describe('The Todo\'s own positive ID returned by OnMove Todo data.')
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ id }) => mutationResult(() => database.commands.updateTodo(
      { id, done: true }, policy(), 'onmove.complete_todo', server.server.getClientVersion()?.name
    ))
  )

  const deleteEntityTargetSchema = z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('focus'),
      id: idSchema.describe(
        'The Focus ID. Deleting it also deletes its owned Threads and all descendants.'
      )
    }),
    z.strictObject({
      type: z.literal('thread'),
      id: idSchema.describe(
        'The Thread ID. Deleting it also deletes its Commitments, Routines, Todos, Notes, and evidence.'
      )
    }),
    z.strictObject({
      type: z.literal('commitment'),
      id: idSchema.describe(
        'The tracking Commitment ID. Deleting it also deletes its Todos, Note, and evidence.'
      )
    }),
    z.strictObject({
      type: z.literal('routine'),
      id: idSchema.describe(
        'The Routine ID. Deleting it also deletes its checklist Runs, cells, notes, and owned evidence.'
      )
    }),
    z.strictObject({
      type: z.literal('update'),
      id: idSchema.describe(
        'The Update ID. Its immutable snapshot moves to OnMove\'s bounded 30-day Update Archive.'
      )
    }),
    z.strictObject({
      type: z.literal('todo'),
      id: idSchema.describe('The Todo ID. This permanently deletes the Todo.')
    }),
    z.strictObject({
      type: z.literal('note'),
      id: idSchema.describe('The Note ID. This permanently deletes the Note and its history.')
    }),
    z.strictObject({
      type: z.literal('subject'),
      id: idSchema.describe(
        'The canonical Subject ID. Historical Scope, Update, or Todo references prevent deletion; remove active applicability instead when history must remain.'
      )
    })
  ]).describe(
    'The exact user-addressable record to delete. Type discriminates the meaning of id; use the reference returned by an OnMove read.'
  )

  server.registerTool(
    'onmove.delete_entity',
    {
      title: 'Delete an OnMove entity',
      description: 'Delete one exact Focus, Thread, tracking Commitment, Routine, Update, Todo, Note, or unused Subject through OnMove\'s normal domain invariants. Requires the independent Delete grant for that resource and an explicit confirmation. Parent deletion cascades through owned descendants even when their separate Delete grants are denied; every removed Update is rescued into the bounded 30-day Archive. Subject deletion is rejected while durable attribution or applicability history references it.',
      inputSchema: z.strictObject({
        target: deleteEntityTargetSchema,
        confirm: z.literal(true).describe(
          'Must be true only after the user explicitly confirms deletion of this exact target and understands any described descendants will also be deleted.'
        )
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    },
    async ({ target }) => mutationResult(() => database.commands.deleteEntity(
      target,
      policy(),
      server.server.getClientVersion()?.name
    ))
  )

  server.registerTool(
    'onmove.poke_review',
    {
      title: 'Pass along an OnMove review',
      description: 'Record a review poke for a Thread or Commitment, resolving an optional Subject to its exact current Scope cell.',
      inputSchema: z.object({
        target: parentSchema,
        subjectId: idSchema.optional().describe(
          'The canonical Subject ID for the exact current Scope cell; omit for an unscoped target.'
        )
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() =>
      database.commands.pokeReview(input, policy(), server.server.getClientVersion()?.name)
    )
  )

  registerResources(server, database)
  return server
}

function registerResources(server: McpServer, database: AppDatabase): void {
  const policy = () => database.mcpSettings.accessPolicy()
  server.registerResource(
    'onmove-client-instructions',
    'onmove://client-instructions',
    {
      title: 'OnMove custom instructions for MCP clients',
      description: 'The current user-authored global guidance advertised by this MCP server.',
      mimeType: 'text/plain'
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain',
        text: database.mcpSettings.get().clientInstructions ||
          'No custom instructions are configured.'
      }]
    })
  )
  const entityTemplates = [
    ['focus', (id: number) => database.queries.getFocus(id, policy())],
    ['thread', (id: number) => database.queries.getThread(id, policy(), { includeRichText: false })],
    ['commitment', (id: number) => database.queries.getCommitment(id, policy(), { includeRichText: false })],
    ['routine', (id: number) => database.queries.getRoutine(id, policy())]
  ] as const
  for (const [type, getter] of entityTemplates) {
    server.registerResource(
      `onmove-${type}`,
      new ResourceTemplate(`onmove://${type}/{id}`, { list: undefined }),
      {
        title: `OnMove ${type}`,
        description: `Hierarchy-aware OnMove ${type} context.`,
        mimeType: 'application/json'
      },
      async (uri, variables) => resource(
        uri,
        withWriteGuide(found(getter(variableId(variables.id))))
      )
    )
  }

  server.registerResource(
    'onmove-note',
    new ResourceTemplate('onmove://note/{id}', { list: undefined }),
    {
      title: 'OnMove note',
      description: 'Hierarchy-aware Note with compact Markdown content and revision. Use get_note_by_id(includeRichText=true) immediately before full structural replacement.',
      mimeType: 'application/json'
    },
    async (uri, variables) => resource(
      uri,
      withNoteWriteGuide(found(database.queries.getNote(
        variableId(variables.id), policy(), { includeRichText: false }
      )))
    )
  )

  for (const [name, uri, getter] of [
    ['onmove-reviews', 'onmove://reviews', () => database.queries.getReviews(policy())],
    ['onmove-due', 'onmove://due', () => database.queries.getDue(policy())],
    ['onmove-todos', 'onmove://todos', () => database.queries.getTodos(policy())]
  ] as const) {
    server.registerResource(
      name,
      uri,
      { title: name.replace('onmove-', 'OnMove '), mimeType: 'application/json' },
      async (resourceUri) => resource(resourceUri, getter())
    )
  }

  server.registerResource(
    'onmove-tag',
    new ResourceTemplate('onmove://tags/{name}', { list: undefined }),
    {
      title: 'OnMove tag uses',
      description: 'Visible uses of one canonical OnMove tag.',
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const name = Array.isArray(variables.name) ? variables.name[0] : variables.name
      return resource(uri, database.queries.getTagUses(name ?? '', policy()))
    }
  )
}
