import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { AppDatabase } from '../main/database'
import {
  ScopeTargetValidationError
} from '../main/application/services'
import {
  SEARCH_ENTITY_TYPES,
  type SearchEntityType,
  type SearchQuery
} from '../main/application/search-index'
import type { McpUiContextSnapshot } from '../shared/contracts'

export interface OnMoveMcpServerOptions {
  /** Called after a committed MCP mutation so the live application can refresh its windows. */
  onMutation?: () => void
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

function updateWriteGuide(value: unknown): UpdateWriteGuide | null {
  const context = record(value)
  const reference = record(context?.reference)
  if (
    !context || !reference ||
    (reference.type !== 'thread' && reference.type !== 'commitment') ||
    !Number.isSafeInteger(reference.id)
  ) return null
  const parent = {
    type: reference.type,
    id: Number(reference.id)
  } as const
  const scope = record(context.scope)
  const scopeId = typeof scope?.scopeId === 'number' ? scope.scopeId : null
  const candidates = parent.type === 'thread'
    ? (Array.isArray(scope?.subjects) ? scope.subjects : [])
    : (Array.isArray(scope?.cells)
        ? scope.cells.map((cell) => record(cell)?.subject)
        : [])
  const allowedSubjects = [...new Map(candidates.flatMap((candidate) => {
    const subject = subjectRecord(candidate)
    return subject ? [[subject.id, subject] as const] : []
  })).values()]
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
        observation: 'Write the Update observation here.'
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
      observation: 'Write the Update observation here.'
    }
  }
}

function withWriteGuide(value: unknown): unknown {
  const context = record(value)
  const guide = updateWriteGuide(value)
  return context && guide
    ? { ...context, writeGuide: { createUpdate: guide } }
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
  observation?: string
  state?: 'red' | 'yellow' | 'green' | 'none'
  sensitive?: boolean
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

/** Registers the complete typed MCP surface against one application-service boundary. */
export function createOnMoveMcpServer(
  database: AppDatabase,
  options: OnMoveMcpServerOptions = {}
): McpServer {
  const server = new McpServer(
    { name: 'onmove', version: '0.1.0' },
    {
      instructions:
        'Use onmove.search for literal information that may appear anywhere in titles, Updates, Notes, Todos, Subjects, or other indexed text. Search is global by default: never assume the current UI Focus is applied. Use the explicit named scope only when narrowing is intended. Each result includes hierarchy IDs; use hierarchy.thread.id with onmove.get_thread, not the ID of a matching Update or Note. Before onmove.create_update, inspect writeGuide.createUpdate on onmove.get_thread or onmove.get_commitment: Open parents must be unscoped, while scoped parents require one listed Subject. Inspect diagnostics.appliedScope and warnings on every response. Sensitive content and mutations are controlled only in OnMove Settings.'
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
  server.registerTool(
    'onmove.create_update',
    {
      title: 'Create OnMove update',
      description: 'Create an Update (direct evidence), not edit a Thread record. The parent object identifies the owning Thread or Commitment. Open parents require unscoped attribution and reject Subject IDs; scoped parents require exactly one Subject from the parent\'s writeGuide.createUpdate.allowedSubjects. Call onmove.get_thread or onmove.get_commitment first when attribution is uncertain.',
      inputSchema: z.object({
        parent: parentSchema,
        attribution: updateAttributionSchema,
        subjectId: idSchema.nullable().optional().describe(
          'Backward-compatible shorthand for attribution.mode="subject". Prefer attribution. Null or omitted means unscoped and is required for an Open parent.'
        ),
        date: dateSchema.optional().describe('The Update\'s recorded date; defaults to today.'),
        observation: z.string().optional().describe(
          'The Update evidence or observation. Blank Updates are valid.'
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
      const normalized: CreateUpdateToolInput = input
      const subjectId = normalizedUpdateSubject(normalized)
      try {
        return mutationResult(() => database.commands.createUpdate(
          {
            parent: normalized.parent,
            subjectId,
            date: normalized.date,
            observation: normalized.observation,
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
      description: 'Create a Todo on a Thread or Commitment, optionally for one Subject or shared across all current Subjects.',
      inputSchema: z.object({
        parent: parentSchema,
        subjectId: idSchema.optional().describe(
          'The canonical Subject ID for one scoped Todo; omit for an unscoped or shared Todo.'
        ),
        sharedAcrossSubjects: z.boolean().optional(),
        name: z.string().min(1),
        dueDate: dateSchema.nullable().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() =>
      database.commands.createTodo(input, policy(), server.server.getClientVersion()?.name)
    )
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
