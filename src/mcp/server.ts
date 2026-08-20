import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { AppDatabase } from '../main/database'
import {
  NoteRevisionConflictError,
  ScopeTargetValidationError,
  type ApplicationResolvedTargetCandidate
} from '../main/application/services'
import {
  SEARCH_ENTITY_TYPES,
  type SearchEntityType,
  type SearchQuery
} from '../main/application/search-index'
import type { McpUiContextSnapshot, RichTextDocumentSnapshot } from '../shared/contracts'
import {
  ONMOVE_RICH_TEXT_COLORS,
  ONMOVE_RICH_TEXT_MARKS,
  assertOnMoveRichTextDocument,
  type OnMoveRichTextDocument
} from '../shared/rich-text-document'

export interface OnMoveMcpServerOptions {
  /** Called after a committed MCP mutation so the live application can refresh its windows. */
  onMutation?: () => void
  /** Called with committed rich-text state so open editors can apply an external revision. */
  onRichTextMutation?: (document: RichTextDocumentSnapshot) => void
  /** Read only for an explicit scope.mode=current search; never an implicit default filter. */
  getCurrentUiContext?: () => McpUiContextSnapshot
}

export interface SearchScopeInput {
  mode: 'all' | 'focus' | 'subject' | 'current'
  focusId?: number | null
  subjectId?: number | null
}

export interface AppliedSearchScope {
  requestedMode: SearchScopeInput['mode']
  mode: SearchScopeInput['mode']
  focusId: number | null
  subjectId: number | null
  source: 'default' | 'explicit' | 'current-ui'
  description: string
}

interface McpDiagnostics {
  appliedScope: AppliedSearchScope
  warnings: string[]
  appliedKinds?: SearchEntityType[] | 'all'
  resultCount?: number
  resolutionStatus?: 'resolved' | 'ambiguous' | 'not_found'
  candidateCount?: number
}

const EMPTY_UI_CONTEXT: McpUiContextSnapshot = { focusId: null, subjectId: null }
const GLOBAL_SCOPE: AppliedSearchScope = {
  requestedMode: 'all',
  mode: 'all',
  focusId: null,
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
  mode: z.enum(['all', 'focus', 'subject', 'current']).describe(
    'all searches the entire visible workspace; focus searches one Focus hierarchy; subject searches records attributed to one Subject; current explicitly uses the current OnMove UI Focus and Subject selection.'
  ),
  focusId: idSchema.nullable().optional().describe(
    'The ID of a Focus, OnMove\'s top-level area of work. Used only when mode is focus. Null or omitted never narrows the search.'
  ),
  subjectId: idSchema.nullable().optional().describe(
    'The ID of a canonical Subject used in scoped work. Used only when mode is subject. Null or omitted never narrows the search.'
  )
}).nullable().optional().describe(
  'An explicit named search scope. Null or omitted means mode=all; the current UI is never used implicitly.'
)

const richTextTextSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().describe('The text in this run.'),
  marks: z.array(z.string()).optional().describe(
    'Optional unique formatting marks: bold, italic, underline, strikethrough, or highlight. highlight is always yellow; highlight-yellow is accepted as an input alias and reads back as highlight. Other values return an actionable rich-text error.'
  ),
  color: z.string().optional().describe(
    `Optional readable foreground color: ${ONMOVE_RICH_TEXT_COLORS.join(', ')}. Other values return an actionable rich-text error.`
  ),
  tag: z.literal(true).optional().describe(
    'Set only when text is a durable @tag token of @ followed by alphanumeric characters.'
  )
}).describe('One text run with its complete formatting.')

const richTextLineBreakSchema = z.strictObject({
  type: z.literal('line-break')
}).describe('An intentional soft line break inside one block.')

const richTextLinkSchema = z.strictObject({
  type: z.literal('link'),
  url: z.string().describe(
    'An http, https, or mailto URL. Other protocols return an actionable rich-text error.'
  ),
  children: z.array(richTextTextSchema).min(1).describe(
    'Formatted visible text for the link.'
  )
}).describe('A clickable link whose text formatting is preserved.')

const richTextInlineSchema = z.union([
  richTextTextSchema,
  richTextLinkSchema,
  richTextLineBreakSchema
])

const richTextListSchema: z.ZodType = z.lazy(() => z.strictObject({
  type: z.enum(['bullet-list', 'numbered-list', 'checklist']),
  start: z.number().int().positive().optional().describe(
    'Optional starting number, valid only for a numbered-list. One is canonical and may be omitted.'
  ),
  items: z.array(z.strictObject({
    content: z.array(richTextInlineSchema).describe('Inline content of this list item.'),
    checked: z.boolean().optional().describe('Completion state; valid only for checklist items.'),
    children: z.array(richTextListSchema).optional().describe('Nested lists under this item.')
  })).min(1)
}).describe('A bulleted, numbered, or checklist block.'))

const richTextBlockSchema: z.ZodType = z.lazy(() => z.union([
  z.strictObject({
    type: z.literal('paragraph'),
    children: z.array(richTextInlineSchema)
  }).describe('A paragraph block.'),
  richTextListSchema,
  z.strictObject({
    type: z.literal('quote'),
    blocks: z.array(richTextBlockSchema).min(1)
  }).describe('A quote containing paragraphs, lists, or nested quotes.')
]))

const richTextDocumentSchema = z.strictObject({
  version: z.literal(1).describe('The OnMove rich-text API document version.'),
  blocks: z.array(richTextBlockSchema).describe(
    'Ordered paragraphs, lists, checklists, and quote blocks. An empty array is an empty Note.'
  )
}).describe(
  'A complete editor-neutral OnMove rich-text document. Read note.richText, edit this structure, and submit the whole document without flattening it to note.content.'
)

function plainRichTextDocument(text: string): OnMoveRichTextDocument {
  return {
    version: 1,
    blocks: text === ''
      ? []
      : [{ type: 'paragraph', children: [{ type: 'text', text }] }]
  }
}

type RichTextWriteTool = 'onmove.create_update' | 'onmove.update_note'

class RichTextToolInputError extends Error {
  constructor(
    readonly tool: RichTextWriteTool,
    readonly code: 'missing_rich_text' | 'invalid_rich_text',
    message: string
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
      `${tool} requires richText. Copy note.richText from onmove.get_note and submit it as richText.`
    )
  }
  try {
    return assertOnMoveRichTextDocument(value)
  } catch (error) {
    throw new RichTextToolInputError(
      tool,
      'invalid_rich_text',
      `${tool} received invalid richText: ${error instanceof Error ? error.message : String(error)}`
    )
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

interface NoteWriteGuide {
  tool: 'onmove.update_note'
  noteId: number
  expectedRevision: number
  instruction: string
  requestExample: { id: number; expectedRevision: number; richText: OnMoveRichTextDocument }
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

function updateWriteGuide(value: unknown): UpdateWriteGuide | null {
  const target = contextWriteTarget(value)
  if (!target) return null
  const { parent, scopeId, allowedSubjects } = target
  const subjectRequired = scopeId !== null && allowedSubjects.length > 0
  if (!subjectRequired) {
    return {
      tool: 'onmove.create_update',
      parent,
      attributionMode: 'unscoped',
      subjectRequired: false,
      allowedSubjects: [],
      instruction:
        `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id} accepts an ` +
        'unscoped Update. Omit subjectId or use attribution.mode="unscoped".',
      requestExample: {
        parent,
        attribution: { mode: 'unscoped' },
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
    instruction:
      `${parent.type === 'thread' ? 'Thread' : 'Commitment'} ${parent.id} is scoped. ` +
      'Choose exactly one allowed Subject and use attribution.mode="subject".',
    requestExample: {
      parent,
      attribution: { mode: 'subject', subjectId: allowedSubjects[0].id },
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
  const context = record(value)
  const createUpdate = updateWriteGuide(value)
  const createTodo = todoWriteGuide(value)
  return context && createUpdate && createTodo
    ? { ...context, writeGuide: { createUpdate, createTodo } }
    : value
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
    tool: 'onmove.update_note',
    noteId,
    expectedRevision,
    instruction:
      'Send the revision just read as expectedRevision. A stale revision is rejected; ' +
      'read the Note again and reconcile before retrying. Copy note.richText, edit that ' +
      'document, and submit it as richText; note.content is a read-only plain-text projection.',
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

function withNoteWriteGuide(value: unknown): unknown {
  const context = record(value)
  const updateNote = noteWriteGuide(value)
  return context && updateNote
    ? { ...context, writeGuide: { updateNote } }
    : value
}

function resolveSearchScope(
  input: SearchScopeInput | null | undefined,
  currentUiContext: McpUiContextSnapshot
): { query: Pick<SearchQuery, 'focusId' | 'subjectId'>; diagnostics: McpDiagnostics } {
  const requested = input ?? { mode: 'all' }
  const warnings: string[] = []
  const explicitFocusId = requested.focusId ?? null
  const explicitSubjectId = requested.subjectId ?? null

  if (requested.mode === 'all') {
    if (explicitFocusId !== null || explicitSubjectId !== null) {
      warnings.push('scope.mode is all, so focusId and subjectId were ignored.')
    }
    return {
      query: { focusId: null, subjectId: null },
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
        query: { focusId: null, subjectId: null },
        diagnostics: {
          appliedScope: { ...GLOBAL_SCOPE, requestedMode: 'focus', source: 'explicit' },
          warnings
        }
      }
    }
    if (explicitSubjectId !== null) warnings.push('subjectId was ignored because scope.mode is focus.')
    const appliedScope: AppliedSearchScope = {
      requestedMode: 'focus', mode: 'focus', focusId: explicitFocusId, subjectId: null,
      source: 'explicit', description: `Search within Focus ${explicitFocusId} and its descendants.`
    }
    return { query: { focusId: explicitFocusId, subjectId: null }, diagnostics: { appliedScope, warnings } }
  }

  if (requested.mode === 'subject') {
    if (explicitSubjectId === null) {
      warnings.push('scope.mode was subject but subjectId was null or omitted, so the search was global.')
      return {
        query: { focusId: null, subjectId: null },
        diagnostics: {
          appliedScope: { ...GLOBAL_SCOPE, requestedMode: 'subject', source: 'explicit' },
          warnings
        }
      }
    }
    if (explicitFocusId !== null) warnings.push('focusId was ignored because scope.mode is subject.')
    const appliedScope: AppliedSearchScope = {
      requestedMode: 'subject', mode: 'subject', focusId: null, subjectId: explicitSubjectId,
      source: 'explicit', description: `Search records attributed to Subject ${explicitSubjectId}.`
    }
    return { query: { focusId: null, subjectId: explicitSubjectId }, diagnostics: { appliedScope, warnings } }
  }

  if (explicitFocusId !== null || explicitSubjectId !== null) {
    warnings.push('focusId and subjectId were ignored because scope.mode=current reads the live OnMove UI selection.')
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
    subjectId,
    source: 'current-ui', description
  }
  return { query: { focusId, subjectId }, diagnostics: { appliedScope, warnings } }
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

function richTextInputErrorResult(error: RichTextToolInputError): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const example = plainRichTextDocument('Write rich text here.')
  const structuredContent = {
    error: {
      code: error.code,
      tool: error.tool,
      field: 'richText',
      message: error.message
    },
    recovery: {
      preferredField: 'richText',
      supportedMarks: ONMOVE_RICH_TEXT_MARKS,
      acceptedMarkAliases: { 'highlight-yellow': 'highlight' },
      instruction:
        'Send the complete version=1 document under richText. marks is an array using bold, ' +
        'italic, underline, strikethrough, or highlight. highlight is the yellow highlighter; ' +
        'highlight-yellow is accepted and canonicalized to highlight.',
      example: { richText: example }
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
  /** Backward-compatible shorthand. Prefer attribution. */
  subjectId?: number | null
  date?: string
  richText?: OnMoveRichTextDocument
  state?: 'red' | 'yellow' | 'green' | 'none'
  sensitive?: boolean
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
    writeGuide: createUpdate && createTodo ? { createUpdate, createTodo } : null,
    recommendedTodoRequest
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
        'Use onmove.search for literal information that may appear anywhere in titles, Updates, Notes, Todos, Subjects, or other indexed text. Search is global by default: never assume the current UI Focus is applied. For a hierarchy-shaped request such as "do X for Person Y\'s 1:1 in Team", use onmove.resolve_target with Thread, Commitment, and Subject selectors, then follow its recommendedTodoRequest or writeGuide.createTodo. Each search result includes hierarchy IDs; use hierarchy.thread.id with onmove.get_thread, not the ID of a matching Update or Note. Rich-text writes always use the editor-neutral document contract under richText: send richText to onmove.create_update, and before updating a Note call onmove.get_note, edit note.richText without flattening it, and send its revision as expectedRevision. Use highlight for the yellow highlighter; highlight-yellow is accepted as an alias. Before other mutations, inspect the matching writeGuide: Open parents must be unscoped, while scoped parents require a listed Subject or an explicitly shared Todo. Inspect diagnostics and warnings on every response. Sensitive content and mutations are controlled only in OnMove Settings.'
    }
  )
  const policy = () => database.mcpSettings.accessPolicy()
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

  for (const [name, title, entityDescription, idDescription, getter] of [
    [
      'onmove.get_focus', 'Get an OnMove focus',
      'Focus, a top-level area containing Threads',
      'The Focus\'s own positive ID, available as searchResult.hierarchy.focus.id.',
      (id: number) => database.queries.getFocus(id, policy())
    ],
    [
      'onmove.get_thread', 'Get an OnMove thread',
      'Thread, a workstream inside one Focus containing Commitments, Updates, Todos, Routines, and a Note',
      'The Thread\'s own positive ID. When search matched an Update, Note, Todo, or Commitment, use searchResult.hierarchy.thread.id—not searchResult.reference.id.',
      (id: number) => database.queries.getThread(id, policy())
    ],
    [
      'onmove.get_commitment', 'Get an OnMove commitment',
      'Commitment, a tracked obligation inside one Thread',
      'The Commitment\'s own positive ID, available as searchResult.hierarchy.commitment.id when the match belongs to one.',
      (id: number) => database.queries.getCommitment(id, policy())
    ]
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: `Read one visible ${entityDescription} with its resolved hierarchy, Scope, direct evidence, Todos, and Note. This is an ID lookup, not a text search.`,
        inputSchema: z.object({ id: idSchema.describe(idDescription) }),
        annotations: { readOnlyHint: true }
      },
      async ({ id }) => result(withWriteGuide(found(getter(id))))
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

  server.registerTool(
    'onmove.search',
    {
      title: 'Search OnMove',
      description: 'Search literal words globally across visible Focus and Thread hierarchies, including titles, rich text, Updates, Todos, Notes, Subjects, and Routine templates. Omitted or null scope is always global and never inherits the current UI. Use scope.mode=current only when the user explicitly wants the live UI context. Results include self-describing owning hierarchy IDs, applied-scope diagnostics, and retry warnings.',
      inputSchema: z.object({
        text: z.string().min(1).describe(
          'Literal ordinary-language words to find anywhere in indexed OnMove content. For a unique token such as asdfasdf, pass that token directly.'
        ),
        scope: searchScopeSchema,
        kinds: z.array(z.enum(SEARCH_ENTITY_TYPES)).optional().describe(
          'Optional entity-type filter. Omit to search every indexed kind: focus, thread, commitment, routine, update, todo, note, and subject.'
        ),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ scope, ...input }) => {
      const resolved = resolveSearchScope(
        scope,
        options.getCurrentUiContext?.() ?? EMPTY_UI_CONTEXT
      )
      const query = { ...input, ...resolved.query }
      const items = database.queries.search(query, policy())
      const appliedKinds = input.kinds?.length ? [...input.kinds] : 'all'
      const warnings = [...resolved.diagnostics.warnings]
      if (items.length === 0 && (
        resolved.diagnostics.appliedScope.mode !== 'all' || appliedKinds !== 'all'
      )) {
        warnings.push(
          'No matches were found with the applied filters. Retry with scope.mode="all", no focusId or subjectId, and omit kinds to search globally within the visible workspace.'
        )
      }
      return result(items, {
        ...resolved.diagnostics,
        warnings,
        appliedKinds,
        resultCount: items.length
      })
    }
  )

  const entitySelectorSchema = (entity: string, example: string) => z.object({
    id: idSchema.optional().describe(
      `Optional ${entity} ID. Prefer an ID from search hierarchy metadata when already known.`
    ),
    title: z.string().min(1).optional().describe(
      `Optional exact ${entity} title, matched case-insensitively. Example: ${example}.`
    )
  }).refine(({ id, title }) => id !== undefined || title !== undefined, {
    message: `${entity} selector requires id or title`
  })
  const subjectSelectorSchema = z.object({
    id: idSchema.optional().describe(
      'Optional canonical Subject ID from Scope data or a search result.'
    ),
    name: z.string().min(1).optional().describe(
      'Optional exact Subject name, matched case-insensitively. Example: Person Y.'
    )
  }).refine(({ id, name }) => id !== undefined || name !== undefined, {
    message: 'Subject selector requires id or name'
  })
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
      const warnings: string[] = []
      if (resolution.status === 'ambiguous') {
        warnings.push(
          'Multiple hierarchy targets matched. Add a Focus selector or use an ID at an ambiguous level; do not guess.'
        )
      } else if (resolution.status === 'not_found' && parentCandidates.length > 0) {
        warnings.push(
          'The hierarchy matched, but the requested Subject is not currently applicable. Choose a Subject from parentCandidates.allowedSubjects or update Scope in OnMove.'
        )
      } else if (resolution.status === 'not_found') {
        warnings.push(
          'No visible hierarchy target matched. Retry with exact names or IDs; use onmove.search to discover hierarchy candidates.'
        )
      }
      return result({
        status: resolution.status,
        requested: resolution.requested,
        target: resolution.status === 'resolved' ? candidates[0] : null,
        candidates,
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

  const parentSchema = z.object({
    type: z.enum(['thread', 'commitment']).describe(
      'The exact parent entity type: Thread is a Focus workstream; Commitment is a tracked obligation inside a Thread.'
    ),
    id: idSchema.describe(
      'The parent Thread or Commitment\'s own ID. Use the corresponding searchResult.hierarchy ID, not an Update, Todo, or Note ID.'
    )
  })
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
      description: 'Create an Update (direct evidence) with an optional editor-neutral rich-text document, not edit a Thread record. The parent object identifies the owning Thread or Commitment. Open parents require unscoped attribution and reject Subject IDs; scoped parents require exactly one Subject from the parent\'s writeGuide.createUpdate.allowedSubjects. Call onmove.get_thread or onmove.get_commitment first when attribution is uncertain.',
      inputSchema: z.strictObject({
        parent: parentSchema,
        attribution: updateAttributionSchema,
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
        return richTextInputErrorResult(error)
      }
      const normalized: CreateUpdateToolInput = {
        parent: input.parent,
        attribution: input.attribution,
        subjectId: input.subjectId,
        date: input.date,
        richText,
        state: input.state,
        sensitive: input.sensitive
      }
      const subjectId = normalizedUpdateSubject(normalized)
      try {
        return mutationResult(() => database.commands.createUpdate(
          {
            parent: normalized.parent,
            subjectId,
            date: normalized.date,
            document: normalized.richText,
            state: normalized.state,
            sensitive: normalized.sensitive
          },
          policy(),
          server.server.getClientVersion()?.name
        ))
      } catch (error) {
        if (!(error instanceof ScopeTargetValidationError)) throw error
        const context = error.issue.parent.type === 'thread'
          ? database.queries.getThread(error.issue.parent.id, policy())
          : database.queries.getCommitment(error.issue.parent.id, policy())
        return scopeTargetErrorResult(error, normalized, updateWriteGuide(context))
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

  server.registerTool(
    'onmove.update_note',
    {
      title: 'Update an OnMove note',
      description: 'Replace one visible Note with a complete editor-neutral rich-text document using optimistic concurrency. Call onmove.get_note first, edit note.richText, and pass its current revision. The plain note.content projection is intentionally not writable, so formatting cannot be flattened accidentally.',
      inputSchema: z.strictObject({
        id: idSchema.describe(
          'The Note\'s own positive ID from onmove.get_note, a Note search hit, or a parent context.'
        ),
        expectedRevision: z.number().int().nonnegative().describe(
          'The exact Note revision returned by onmove.get_note. Stale revisions are rejected without changing content.'
        ),
        richText: richTextDocumentSchema.optional().describe(
          'The only complete replacement field. Copy note.richText from onmove.get_note, change only the intended nodes, and submit it here.'
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
        return richTextInputErrorResult(error)
      }
      try {
        const document = database.commands.updateNote(
          { id: input.id, expectedRevision: input.expectedRevision, document: richText },
          policy(),
          server.server.getClientVersion()?.name
        )
        options.onRichTextMutation?.(document)
        options.onMutation?.()
        return result(withNoteWriteGuide(found(database.queries.getNote(input.id, policy()))))
      } catch (error) {
        if (!(error instanceof NoteRevisionConflictError)) throw error
        return noteRevisionConflictResult(error)
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
