import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
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
  type ApplicationHierarchyPath,
  type ApplicationRichTextReference,
  type ApplicationResolvedTargetCandidate,
  type ApplicationSemanticTargetPath
} from '../main/application/services'
import {
  SEARCH_ENTITY_TYPES,
  type SearchLocalDateRange,
  type SearchPageCursor,
  type SearchEntityType,
  type SearchQuery,
  type SearchResult,
  type SearchSortDirection,
  type SearchSortField
} from '../main/application/search-index'
import type { McpUiContextSnapshot, RichTextDocumentSnapshot } from '../shared/contracts'
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
  richText: boolean
}

interface SearchContinuationPayload {
  version: 2
  text: string | null
  query: Pick<SearchQuery, 'focusId' | 'threadId' | 'subjectId'>
  appliedScope: AppliedSearchScope
  kinds?: SearchEntityType[]
  date?: SearchLocalDateRange
  createdAt?: SearchLocalDateRange
  updatedAt?: SearchLocalDateRange
  timeZone: string
  sort: { field: SearchSortField; direction: SearchSortDirection }
  projection: SearchProjectionInput
  pageSize: number
  maxBytes: number
  /** Null is valid only for a preconfigured first page emitted by another MCP tool. */
  cursor: SearchPageCursor | null
}

const SEARCH_CONTINUATION_PREFIX = 'onmove-search-v2.'
const SEARCH_CONTINUATION_SECRET = randomBytes(32)

function encodeSearchContinuation(payload: SearchContinuationPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
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
    const parsed = JSON.parse(Buffer.from(
      encoded,
      'base64url'
    ).toString('utf8')) as Partial<SearchContinuationPayload>
    const query = parsed.query
    const appliedScope = parsed.appliedScope
    if (
      parsed.version !== 2 || !query || !appliedScope || !parsed.projection ||
      !parsed.sort || parsed.cursor === undefined ||
      (typeof parsed.text !== 'string' && parsed.text !== null) ||
      !['all', 'focus', 'thread', 'subject', 'current'].includes(appliedScope.mode) ||
      !['relevance', 'date', 'createdAt', 'updatedAt'].includes(parsed.sort.field) ||
      !['asc', 'desc'].includes(parsed.sort.direction) ||
      typeof parsed.timeZone !== 'string' || parsed.timeZone.length === 0 ||
      !Number.isSafeInteger(parsed.pageSize) || Number(parsed.pageSize) < 1 ||
      Number(parsed.pageSize) > 25 || !Number.isSafeInteger(parsed.maxBytes) ||
      Number(parsed.maxBytes) < 4_096 || Number(parsed.maxBytes) > 131_072 ||
      (parsed.cursor !== null && (
        typeof parsed.cursor.sourceKey !== 'string' || parsed.cursor.sourceKey.length === 0 ||
        !['string', 'number'].includes(typeof parsed.cursor.sortValue)
      ))
    ) throw new Error('invalid continuation payload')
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
        ? `${tool} requires richText. Copy note.richText from onmove.get_note and submit it as richText.`
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
        'richText document, edit it, and submit it with the revision just read. If populated ' +
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

function searchableRichText(
  database: AppDatabase,
  value: SearchResult,
  access: ReturnType<AppDatabase['mcpSettings']['accessPolicy']>
): Record<string, unknown> | null {
  if (value.reference.type === 'focus') {
    const context = record(withFocusDescriptionWriteGuide(database.queries.getFocus(
      value.reference.id,
      access,
      { includeRichText: true }
    )))
    const entity = record(context?.entity)
    if (!entity || !Number.isSafeInteger(entity.descriptionRevision) ||
        !('descriptionRichText' in entity)) return null
    return {
      kind: 'focus-description',
      target: { type: 'focus-description', focusId: value.reference.id },
      plainText: entity.description ?? '',
      richText: entity.descriptionRichText,
      revision: entity.descriptionRevision,
      writeGuide: entity.descriptionWriteGuide
    }
  }
  if (value.reference.type === 'update') {
    const context = record(withUpdateContextWriteGuide(database.queries.getUpdate(
      value.reference.id,
      access
    )))
    const contextWarnings = Array.isArray(context?.warnings)
      ? context.warnings.filter((warning): warning is string => typeof warning === 'string')
      : []
    if (contextWarnings.length > 0) throw new Error(contextWarnings.join(' '))
    const update = record(context?.update)
    if (!update || !Number.isSafeInteger(update.observationRevision) ||
        !('observationRichText' in update)) return null
    return {
      kind: 'update-observation',
      target: { type: 'update-observation', updateId: value.reference.id },
      plainText: update.observation ?? '',
      richText: update.observationRichText,
      revision: update.observationRevision,
      writeGuide: update.observationWriteGuide
    }
  }
  if (value.reference.type === 'note') {
    const context = record(withNoteWriteGuide(database.queries.getNote(
      value.reference.id,
      access
    )))
    const note = record(context?.note)
    if (!note || !Number.isSafeInteger(note.revision) || !('richText' in note)) return null
    return {
      kind: 'note-content',
      target: { type: 'note-content', noteId: value.reference.id },
      plainText: note.content ?? '',
      richText: note.richText,
      revision: note.revision,
      writeGuide: context?.writeGuide
    }
  }
  return null
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
        'retrying. Copy note.richText, edit that document, and submit it as richText; note.content ' +
        'is a read-only plain-text projection. If a populated Note is intentionally being emptied, ' +
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
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>), diagnostics }
    : { items: value, diagnostics }
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  }
}

function entityReadDiagnostics(value: unknown): McpDiagnostics {
  const context = record(value)
  const warnings = Array.isArray(context?.warnings)
    ? context.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return { ...diagnosticsScope(), warnings }
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
        value && typeof value === 'object' && !Array.isArray(value)
          ? { ...(value as Record<string, unknown>), diagnostics: diagnosticsScope() }
          : { items: value, diagnostics: diagnosticsScope() },
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
      inspect: { tool: 'onmove.resolve_target', arguments: resolutionArguments },
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
      tool: `onmove.get_${error.issue.parent.type}`,
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
      tool: `onmove.get_${error.issue.parent.type}`,
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
        tool: `onmove.get_${error.issue.parent.type}`,
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
      inspect: { tool: 'onmove.get_note', arguments: { id: error.issue.noteId } },
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
      inspect: { tool: 'onmove.get_note', arguments: { id: error.issue.noteId } },
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
      inspect: { tool: 'onmove.get_note', arguments: { id: input.id } },
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
  tool: 'onmove.get_focus' | 'onmove.get_update'
  arguments: Record<string, unknown>
} {
  return target.type === 'focus-description'
    ? { tool: 'onmove.get_focus', arguments: { id: target.focusId, includeRichText: true } }
    : { tool: 'onmove.get_update', arguments: { id: target.updateId } }
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
      ? 'Read the field again and use exact case-sensitive text from its plain-text projection.'
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

/** Registers the complete typed MCP surface against one application-service boundary. */
export function createOnMoveMcpServer(
  database: AppDatabase,
  options: OnMoveMcpServerOptions = {}
): McpServer {
  const server = new McpServer(
    { name: 'onmove', version: '0.1.0' },
    {
      instructions:
        'Use onmove.search for discovery, structured listing, and optional hierarchy projection. INITIAL SEARCH: send the user\'s specific entity/Subject name as text, or send text=null with kinds for a queryless list; omit scope for global visibility and omit continuationToken. Date, createdAt, and updatedAt are structured local-date ranges, never full-text terms. Use projection={hierarchy,subjects,scopes,richText}; omitted projection fields are false. Never invent or alter a continuationToken. A next-page request sends only the exact non-null signed token, which preserves the complete query and cursor. When a request names an entity or Subject, preserve it as the primary filter: search that specific name first, inspect namedSubjectDiscovery and subjectUses, and treat Subject-attributed uses as authoritative. If searchStatus.sufficient or doNotBroaden is true, stop discovery and fetch returned IDs directly. Use onmove.get_updates for multiple Update IDs and onmove.review_subject for a compact person/entity situation inside one Thread. Paths use {thread:"Team management",commitment:"1:1s",subject:"Michael"}, displayed as Team management > 1:1s[Michael]. Preserve bracketed Subject attribution on create_update. Use onmove.resolve_target for exact hierarchy names. Selectors use either an ID or a name/title, never both. For text mutation request rich text through projection.richText or the entity getter; use onmove.resolve_note and semantic patch tools for localized edits. Before mutations inspect writeGuide. Use onmove.reparent_update to repair wrong placement. Inspect diagnostics and warnings. OnMove Settings controls sensitive access and View/Edit grants by resource, Focus, and Thread.'
    }
  )
  const policy = () => database.mcpSettings.accessPolicy()
  const rejectedCalls = options.rejectedCallTracker ?? new RejectedCallTracker()
  const rejected = (
    tool: string,
    input: unknown,
    code: string,
    response: McpErrorResult
  ): McpErrorResult => rejectedCalls.rejected(tool, input, code, response)
  const mutationResult = <T>(operation: () => T): ReturnType<typeof result> => {
    const value = operation()
    options.onMutation?.()
    return result(value)
  }

  server.registerTool(
    'onmove.list_focuses',
    {
      title: 'List OnMove focuses',
      description: 'List visible Focus records with bounded lifecycle filtering.',
      inputSchema: z.object({
        statuses: z.array(z.enum(['active', 'paused', 'done', 'cancelled'])).optional(),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => result(database.queries.listFocuses(input, policy()))
  )

  server.registerTool(
    'onmove.get_focus',
    {
      title: 'Get an OnMove focus',
      description: 'Read one visible Focus, a top-level area containing Threads. Set includeRichText=true to return the lossless Focus description, its semantic write guide, and each directly owned Note with its lossless rich text and write guides in this same response.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Focus\'s own positive ID, available as searchResult.hierarchy.focus.id.'
        ),
        includeRichText: z.boolean().optional().describe(
          'When true, include the complete Focus description document and directly owned Note documents with revisions and write guides. Defaults to false for a compact read.'
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
      return result(includeRichText
        ? withFocusDescriptionWriteGuide(withEmbeddedNoteWriteGuides(context))
        : context)
    }
  )

  for (const [name, title, entityDescription, idDescription, getter] of [
    [
      'onmove.get_thread', 'Get an OnMove thread',
      'Thread, a workstream inside one Focus containing Commitments, Updates, Todos, Routines, and a Note',
      'The Thread\'s own positive ID. When search matched an Update, Note, Todo, or Commitment, use searchResult.hierarchy.thread.id—not searchResult.reference.id.',
      (id: number, includeRichText: boolean) => database.queries.getThread(
        id, policy(), { includeRichText }
      )
    ],
    [
      'onmove.get_commitment', 'Get an OnMove commitment',
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
        description: `Read one visible ${entityDescription} with its resolved hierarchy, Scope, direct evidence, Todos, and Note. This is an ID lookup, not a text search. It defaults to a compact, resilient projection; set includeRichText=true only when lossless documents are needed. Unsupported rich-text structures produce warnings and never discard the rest of the entity response.`,
        inputSchema: z.strictObject({
          id: idSchema.describe(idDescription),
          includeRichText: z.boolean().optional().describe(
            'Defaults to false. False returns compact readable plain text. True requests lossless rich-text documents and revisions; an unsupported document is omitted with a diagnostic warning while the remaining entity still returns.'
          )
        }),
        annotations: { readOnlyHint: true }
      },
      async ({ id, includeRichText }) => {
        const context = found(getter(id, includeRichText === true))
        return result(withWriteGuide(context), entityReadDiagnostics(context))
      }
    )
  }

  server.registerTool(
    'onmove.get_note',
    {
      title: 'Get an OnMove note',
      description: 'Read one visible Note by its own ID, including hierarchy context, a read-only plain-text content projection, the lossless editor-neutral note.richText document, current revision, and the safe update contract. Use a note searchResult.reference.id or an ID from a parent context\'s notes array.',
      inputSchema: z.object({
        id: idSchema.describe(
          'The Note\'s own positive ID from searchResult.reference.id or a parent context\'s notes array.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => result(withNoteWriteGuide(found(database.queries.getNote(id, policy()))))
  )

  server.registerTool(
    'onmove.get_update',
    {
      title: 'Get an OnMove update',
      description: 'Read one visible Update by its own ID, including hierarchy context, exact Scope/Subject attribution, the plain-text observation, its lossless rich-text document, current revision, and semantic write guide.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Update\'s own positive ID from searchResult.reference.id or a parent context\'s updates array.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      const context = found(database.queries.getUpdate(id, policy()))
      return result(withUpdateContextWriteGuide(context), entityReadDiagnostics(context))
    }
  )

  server.registerTool(
    'onmove.get_updates',
    {
      title: 'Get multiple OnMove updates',
      description: 'Read up to 50 Updates by their own IDs in one database-backed call. This avoids one get_update call per search result and preserves input order. Missing and non-visible IDs are reported together as unavailableIds.',
      inputSchema: z.strictObject({
        ids: z.array(idSchema).min(1).max(50).describe(
          'One to 50 Update IDs from searchResult.reference.id, subjectUses, review_subject, or parent update arrays.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ ids }) => {
      const contexts = database.queries.getUpdates(ids, policy())
      const warnings = contexts.items.flatMap((context) => context.warnings ?? [])
      return result({
        items: contexts.items.map(withUpdateContextWriteGuide),
        unavailableIds: contexts.unavailableIds
      }, { ...diagnosticsScope(), warnings, resultCount: contexts.items.length })
    }
  )

  server.registerTool(
    'onmove.list_routines',
    {
      title: 'List OnMove routines',
      description: 'List visible recurring attestation Routines and their current immutable Runs.',
      inputSchema: z.object(pageSchema),
      annotations: { readOnlyHint: true }
    },
    async ({ limit, offset }) => result(database.queries.listRoutines(policy(), limit, offset))
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
      description: 'Read every open Todo and the bounded recently completed window with hierarchy context.',
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
      'Include each record\'s containing Focus/Thread/Commitment IDs. Does not recursively expand unrelated descendants.'
    ),
    subjects: z.boolean().optional().describe(
      'Include Subject attribution, authoritative subjectUses, and named Subject applicability paths.'
    ),
    scopes: z.boolean().optional().describe(
      'Include bounded Scope metadata on applicable Subject paths.'
    ),
    richText: z.boolean().optional().describe(
      'Include lossless editable rich text where supported; malformed documents degrade to plain text with warnings.'
    )
  }).optional().describe(
    'Response projection. Omitted fields default false. Example: {hierarchy:true,subjects:true,scopes:false,richText:false}.'
  )
  const searchPageSchema = z.strictObject({
    size: z.number().int().min(1).max(25).optional().describe(
      'Maximum records in this page. Defaults to 10 and never exceeds 25.'
    ),
    maxBytes: z.number().int().min(4_096).max(131_072).optional().describe(
      'Hard structured-response UTF-8 byte budget. Defaults to 32768. Oversized auxiliary projections are removed before records.'
    )
  }).optional()

  server.registerTool(
    'onmove.search',
    {
      title: 'Search or list OnMove records',
      description: 'Use for both FTS discovery and queryless structured listing. INITIAL REQUEST: send text for language search, or text=null with kinds to list records without FTS. Date filters are database predicates, never search terms. Request optional expansion only through projection. Responses always contain records, hasMore, a hard byte-budget report, and a signed continuationToken only when another record page exists. A continuation request sends only that exact token; it preserves text, local-date filters, timezone, scope, sort, kinds, projection, page size, byte budget, and stable cursor. Never invent or alter a token.',
      inputSchema: z.strictObject({
        text: z.string().min(1).nullable().optional().describe(
          'Non-null uses full-text search. Null or omitted is queryless list mode and returns records selected by kinds, scope, and date filters.'
        ),
        kinds: z.array(z.enum(SEARCH_ENTITY_TYPES)).min(1).max(8).optional().describe(
          'Record kinds to return: focus, thread, commitment, routine, update, todo, note, subject. Omit for all kinds.'
        ),
        scope: searchScopeSchema,
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
        page: searchPageSchema,
        continuationToken: z.string().min(1).nullable().optional().describe(
          'Initial request: omit or null. Next page: send only the exact non-null token returned by OnMove; do not send text, filters, scope, sort, kinds, projection, or page again.'
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => {
      const continuation = input.continuationToken === undefined ||
        input.continuationToken === null
        ? null
        : decodeSearchContinuation(input.continuationToken)
      if (continuation) {
        const conflicting = Object.entries(input).filter(([key, value]) =>
          key !== 'continuationToken' && value !== undefined)
        if (conflicting.length > 0) {
          throw new TypeError(
            `A continuation request must contain only continuationToken; remove ${conflicting
              .map(([key]) => key).join(', ')}. The signed token already preserves the full query.`
          )
        }
      }
      const resolved = continuation
        ? {
            query: continuation.query,
            diagnostics: {
              appliedScope: continuation.appliedScope,
              warnings: ['The complete search request and stable cursor were verified from continuationToken.']
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
      const projection: SearchProjectionInput = continuation?.projection ?? {
        hierarchy: input.projection?.hierarchy ?? false,
        subjects: input.projection?.subjects ?? false,
        scopes: input.projection?.scopes ?? false,
        richText: input.projection?.richText ?? false
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
        sort: effectiveSort,
        cursor: continuation?.cursor,
        limit: pageSize,
        ...resolved.query
      }
      const access = policy()
      const searched = database.queries.searchPage(query, access)
      const matches = searched.items
      const warnings = [...resolved.diagnostics.warnings]
      const decorateSearchItems = (values: readonly SearchResult[]) => values.map((match) => {
        let editableRichText: Record<string, unknown> | null = null
        if (projection.richText) {
          try {
            editableRichText = searchableRichText(database, match, access)
          } catch (error) {
            warnings.push(
              `${match.reference.type} ${match.reference.id} rich text could not be expanded; ` +
              `plain text was retained. Detail: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }
        const projected: Record<string, unknown> = {
          ...match,
          ...(editableRichText ? { editableRichText } : {})
        }
        if (!projection.hierarchy) {
          delete projected.hierarchy
          delete projected.contextPath
        }
        if (!projection.subjects) delete projected.subject
        return projected
      })
      const matchedSubjects = !projection.subjects || normalizedText === null
        ? []
        : [...new Map(matches.flatMap((match) => {
            if (match.reference.type !== 'subject') return []
            const subject = match.subject ?? { id: match.reference.id, name: match.title }
            return [[subject.id, subject] as const]
          })).values()].slice(0, pageSize)
      const rawSubjectUses = matchedSubjects.flatMap((subject) =>
        database.queries.search({
          text: null,
          focusId: resolved.query.focusId,
          threadId: resolved.query.threadId,
          subjectId: subject.id,
          date: effectiveDate,
          createdAt: effectiveCreatedAt,
          updatedAt: effectiveUpdatedAt,
          timeZone: effectiveTimeZone,
          sort: { field: 'updatedAt', direction: 'desc' },
          limit: pageSize
        }, access)
          .filter(({ reference }) => reference.type !== 'subject')
          .map((use) => ({ ...use, matchedSubject: subject })))
        .slice(0, pageSize)
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
            limit: pageSize,
            offset: 0
          }, matches, access)
        : { paths: [], total: 0 }
      let hierarchyPaths = hierarchy.paths.map(decorateHierarchyPath)
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
      let items = decorateSearchItems(matches).map((item) => {
        const reference = item.reference as { type: string; id: number }
        if (reference.type !== 'subject') return item
        const discovery = namedSubjectDiscovery.find(({ subject }) =>
          subject.id === reference.id)
        return discovery ? { ...item, subjectDiscovery: discovery } : item
      })
      const itemCursors = [...searched.itemCursors]
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
        ? encodeSearchContinuation({
            version: 2,
            text: normalizedText,
            query: resolved.query,
            appliedScope: resolved.diagnostics.appliedScope,
            ...(effectiveKinds ? { kinds: [...effectiveKinds] } : {}),
            ...(effectiveDate ? { date: effectiveDate } : {}),
            ...(effectiveCreatedAt ? { createdAt: effectiveCreatedAt } : {}),
            ...(effectiveUpdatedAt ? { updatedAt: effectiveUpdatedAt } : {}),
            timeZone: effectiveTimeZone,
            sort: effectiveSort,
            projection,
            pageSize,
            maxBytes,
            cursor
          })
        : null
      const response = (): Record<string, unknown> => {
        const hasMore = searched.hasMore || recordsTruncatedByBudget
        const lastCursor = itemCursors.at(-1) ?? null
        const globalComplete = resolved.diagnostics.appliedScope.mode === 'all' && !hasMore
        const doNotBroaden = authoritativeSubjectResult || globalComplete
        const foundSubjectNames = [...new Set(matchedSubjects.map(({ name }) => name))]
        const searchStatus = {
          sufficient: doNotBroaden,
          doNotBroaden,
          reason: authoritativeSubjectResult
            ? relevantSubjectUpdates.length > 0
              ? `Relevant Subject-attributed Updates were found for ${foundSubjectNames.join(', ') || `Subject ${resolved.query.subjectId}`}; subjectUses is authoritative.`
              : 'The requested Subject boundary returned authoritative attributed records.'
            : globalComplete
              ? 'The global structured query is complete; every matching visible record was returned.'
              : 'Another bounded page remains; continue with the exact signed continuationToken.',
          nextAction: doNotBroaden
            ? 'Stop discovery and use the returned record IDs directly.'
            : 'Call onmove.search again with only continuationToken.'
        }
        return {
          items,
          subjectUses,
          namedSubjectDiscovery,
          hierarchyPaths,
          hierarchyNotation: HIERARCHY_NOTATION_GUIDE,
          searchStatus,
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
            projection
          },
          budget: {
            maxBytes,
            responseBytes: 0,
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
      const measuredBytes = (): number => Buffer.byteLength(JSON.stringify({
        ...response(), diagnostics: diagnostics()
      }), 'utf8')
      // Leave room for final truncation warnings and the decimal byte count itself.
      const exceedsBudget = (): boolean => measuredBytes() + 768 > maxBytes
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
      if (exceedsBudget()) {
        items = items.map((item) => {
          const compact = { ...item }
          delete compact.subjectDiscovery
          delete compact.editableRichText
          if (projection.hierarchy) {
            delete compact.hierarchy
            delete compact.contextPath
          }
          if (projection.subjects) delete compact.subject
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
      if (measuredBytes() > maxBytes) {
        throw new TypeError(
          `page.maxBytes=${maxBytes} is too small for one safe result and required diagnostics`
        )
      }
      if (projectionTruncatedByBudget) {
        warnings.push('Auxiliary projection data was reduced to honor page.maxBytes.')
      }
      if (recordsTruncatedByBudget) {
        warnings.push('The record page was shortened to honor page.maxBytes; continue with the signed token.')
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
      for (let pass = 0; pass < 3; pass += 1) {
        budget.responseBytes = Buffer.byteLength(JSON.stringify({
          ...finalResponse, diagnostics: diagnostics()
        }), 'utf8')
      }
      if (Number(budget.responseBytes) > maxBytes) {
        throw new TypeError(`The safe search response exceeded page.maxBytes=${maxBytes}`)
      }
      return result(finalResponse, diagnostics())
    }
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
    'onmove.resolve_target',
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
      const continuationToken = reviewed.review
        ? encodeSearchContinuation({
            version: 2,
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
            projection: {
              hierarchy: true,
              subjects: true,
              scopes: false,
              richText: false
            },
            pageSize: Math.min(input.limit ?? 10, 25),
            maxBytes: 32_768,
            cursor: null
          })
        : null
      return result({
        ...reviewed,
        threadCandidates,
        searchStatus: {
          sufficient: reviewed.status === 'resolved',
          doNotBroaden: reviewed.status === 'resolved',
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

  const resolveNoteSchema = z.strictObject({
    focus: entitySelectorSchema('Focus', 'Project Atlas').describe(
      'Required Focus anchor. When only Focus and Note are supplied, only Notes directly owned by that Focus are considered.'
    ),
    thread: entitySelectorSchema('Thread', 'Sprint execution').optional().describe(
      'Optional direct Thread parent inside the Focus. When present, only Notes directly owned by that Thread are considered.'
    ),
    commitment: entitySelectorSchema('Commitment', 'Ticket quality').optional().describe(
      'Optional direct Commitment parent inside the selected Thread. A Thread selector is required when this is present.'
    ),
    note: entitySelectorSchema('Note', 'Default').describe(
      'The directly owned Note to resolve by its own ID or exact case-insensitive title.'
    ),
    includeRichText: z.boolean().optional().describe(
      'Include the complete lossless note.richText document. Defaults to true so the resolved Note can be edited immediately.'
    )
  }).refine(({ thread, commitment }) => commitment === undefined || thread !== undefined, {
    message: 'A Commitment Note selector requires its parent Thread selector.',
    path: ['thread']
  })

  server.registerTool(
    'onmove.resolve_note',
    {
      title: 'Resolve and read an OnMove note',
      description: 'Resolve one directly owned Note from exact Focus → optional Thread → optional Commitment → Note selectors and return its own ID, hierarchy, revision, full rich text, and patch/full-write guides in one call. This avoids separate search, parent, and Note reads for title-based requests.',
      inputSchema: resolveNoteSchema,
      annotations: { readOnlyHint: true }
    },
    async ({ includeRichText, ...query }) => {
      const resolution = database.queries.resolveNote(query, policy())
      const include = includeRichText !== false
      const candidates = resolution.candidates.map((candidate) => withNoteWriteGuide(
        include ? candidate : withoutNoteRichText(candidate)
      ))
      const warnings = resolution.status === 'ambiguous'
        ? ['Multiple Notes matched this hierarchy. Add an ID at the ambiguous level; do not guess.']
        : resolution.status === 'not_found'
          ? ['No directly owned visible Note matched. Check each exact title or ID; this tool never searches descendant Notes implicitly.']
          : []
      return result({
        status: resolution.status,
        requested: { ...resolution.requested, includeRichText: include },
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
    id: idSchema.describe('The owning Thread ID from onmove.get_thread or hierarchy.thread.id.')
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
        needsReview: z.boolean().optional(),
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
          needsReview: input.needsReview,
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
        needsReview: z.boolean().optional(),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() => {
      const created = database.commands.createThread(
        input, policy(), server.server.getClientVersion()?.name
      ) as { id: number }
      return withWriteGuide(found(database.queries.getThread(created.id, policy())))
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
      return withWriteGuide(found(database.queries.getThread(id, policy())))
    })
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
        needsReview: z.boolean().optional(),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() => {
      const created = database.commands.createCommitment({
        ...input,
        type: 'tracking'
      }, policy(), server.server.getClientVersion()?.name) as { id: number }
      return withWriteGuide(found(database.queries.getCommitment(created.id, policy())))
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
      return withWriteGuide(found(database.queries.getCommitment(id, policy())))
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
      return withUpdateContextWriteGuide(found(database.queries.getUpdate(input.id, policy())))
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
    'The explicit hierarchy path copied from search or resolve_target. Example: ' +
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
        'A Subject ID from writeGuide.createUpdate.allowedSubjects on onmove.get_thread or onmove.get_commitment.'
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
        'A Subject ID from writeGuide.createTodo.allowedSubjects or resolve_target.'
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
      description: 'Create an Update (direct evidence) with an optional editor-neutral rich-text document, not edit a Thread record. The parent object identifies the owning Thread or Commitment. Open parents require unscoped attribution and reject Subject IDs; scoped parents require exactly one Subject from the parent\'s writeGuide.createUpdate.allowedSubjects. When the user names a Subject path such as 1:1s[Michael], semanticPath is required and an unscoped or different-parent write is rejected. Call search, resolve_target, get_thread, or get_commitment first when attribution is uncertain.',
      inputSchema: z.strictObject({
        parent: parentSchema,
        attribution: updateAttributionSchema,
        semanticPath: semanticPathSchema.optional().describe(
          'Copy this from hierarchyPaths[].semanticPath, resolve_target.target.semanticPath, or a write guide. Example names {thread:"Team management",commitment:"1:1s",subject:"Michael"} mean Team management > 1:1s[Michael]. It is required when the user request names a scoped Subject destination.'
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
          ? database.queries.getThread(error.issue.parent.id, policy())
          : database.queries.getCommitment(error.issue.parent.id, policy())
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
        id: idSchema.describe('The existing Update ID returned by search or get_update.'),
        destination: z.strictObject({
          parent: parentSchema,
          attribution: updateAttributionSchema,
          semanticPath: semanticPathSchema.optional().describe(
            'The intended destination path from search or resolve_target. Include it whenever the correction names a Subject.'
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
            database.queries.getUpdate(input.id, policy())
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
          ? database.queries.getThread(error.issue.parent.id, policy())
          : database.queries.getCommitment(error.issue.parent.id, policy())
        return reparentScopeTargetErrorResult(error, input, updateWriteGuide(context))
      }
    }
  )

  server.registerTool(
    'onmove.create_todo',
    {
      title: 'Create OnMove todo',
      description: 'Create an actionable Todo on a Thread or Commitment. Inspect writeGuide.createTodo from get_thread, get_commitment, or resolve_target: Open parents use unscoped attribution; scoped parents use one allowed Subject or all-subjects for independently completable Subject cells.',
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
          ? database.queries.getThread(error.issue.parent.id, policy())
          : database.queries.getCommitment(error.issue.parent.id, policy())
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
        'The Focus\'s own positive ID from get_focus, resolve_note context, or search hierarchy.focus.id.'
      )
    }),
    z.strictObject({
      type: z.literal('update-observation').describe(
        'Selects the rich-text observation belonging to one Update evidence record.'
      ),
      updateId: idSchema.describe(
        'The Update\'s own positive ID from get_update, a parent updates array, or an Update searchResult.reference.id.'
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
        options.onMutation?.()
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
      description: 'Replace a Focus description or Update observation with a complete editor-neutral rich-text document using optimistic concurrency. Prefer onmove.search(projection={richText:true}) followed by onmove.patch_rich_text for localized changes. Notes use onmove.update_note.',
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
        options.onMutation?.()
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
          'The Note\'s own positive ID from resolve_note, get_note, or a Note search result.'
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
        options.onMutation?.()
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
      description: 'Replace one visible Note with a complete editor-neutral rich-text document using optimistic concurrency. Prefer onmove.search(projection={richText:true}) followed by onmove.patch_note_text for localized changes; use get_note when its ID is already known. The plain note.content projection is intentionally not writable, so formatting cannot be flattened accidentally.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Note\'s own positive ID from onmove.get_note, a Note search hit, or a parent context.'
        ),
        expectedRevision: z.number().int().nonnegative().describe(
          'The exact Note revision returned by onmove.get_note. Stale revisions are rejected without changing content.'
        ),
        richText: richTextDocumentSchema.optional().describe(
          'The only complete replacement field. Copy note.richText from onmove.get_note, change only the intended nodes, and submit it here.'
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
        options.onMutation?.()
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
  const entityTemplates = [
    ['focus', (id: number) => database.queries.getFocus(id, policy())],
    ['thread', (id: number) => database.queries.getThread(id, policy())],
    ['commitment', (id: number) => database.queries.getCommitment(id, policy())],
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
      description: 'Hierarchy-aware Note with plain-text projection, lossless rich-text document, revision, and safe write guide.',
      mimeType: 'application/json'
    },
    async (uri, variables) => resource(
      uri,
      withNoteWriteGuide(found(database.queries.getNote(variableId(variables.id), policy())))
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
