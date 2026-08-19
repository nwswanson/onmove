import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import type { AppDatabase } from '../main/database'
import { SEARCH_ENTITY_TYPES } from '../main/application/search-index'

export interface OnMoveMcpServerOptions {
  /** Called after a committed MCP mutation so the live application can refresh its windows. */
  onMutation?: () => void
}

const idSchema = z.number().int().positive()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const pageSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(10_000).optional()
}

function result(value: unknown): {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: Record<string, unknown>
} {
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { items: value }
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
      text: JSON.stringify(value, null, 2)
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

/** Registers the complete typed MCP surface against one application-service boundary. */
export function createOnMoveMcpServer(
  database: AppDatabase,
  options: OnMoveMcpServerOptions = {}
): McpServer {
  const server = new McpServer(
    { name: 'onmove', version: '0.1.0' },
    {
      instructions:
        'Use OnMove resources and read tools for hierarchy-aware context. Search accepts ordinary language and is backed by a bounded local full-text index. Sensitive content and mutations are controlled only in OnMove Settings.'
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

  for (const [name, title, getter] of [
    ['onmove.get_focus', 'Get an OnMove focus', (id: number) => database.queries.getFocus(id, policy())],
    ['onmove.get_thread', 'Get an OnMove thread', (id: number) => database.queries.getThread(id, policy())],
    ['onmove.get_commitment', 'Get an OnMove commitment', (id: number) => database.queries.getCommitment(id, policy())]
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description: `Read one visible ${name.split('_').at(-1)} with its resolved hierarchy, Scope, direct evidence, Todos, and Note.`,
        inputSchema: z.object({ id: idSchema }),
        annotations: { readOnlyHint: true }
      },
      async ({ id }) => result(found(getter(id)))
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
      inputSchema: z.object({ name: z.string().min(1), ...pageSchema }),
      annotations: { readOnlyHint: true }
    },
    async ({ name, limit, offset }) =>
      result(database.queries.getTagUses(name, policy(), limit, offset))
  )

  server.registerTool(
    'onmove.search',
    {
      title: 'Search OnMove',
      description: 'Search titles, rich text, Updates, Todos, Notes, Subjects, and Routine templates using ordinary words. Results are ranked by SQLite FTS5 and include stable context paths.',
      inputSchema: z.object({
        text: z.string().min(1),
        kinds: z.array(z.enum(SEARCH_ENTITY_TYPES)).optional(),
        focusId: idSchema.optional(),
        subjectId: idSchema.optional(),
        ...pageSchema
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => result(database.queries.search(input, policy()))
  )

  const parentSchema = z.object({
    type: z.enum(['thread', 'commitment']),
    id: idSchema
  })
  server.registerTool(
    'onmove.create_update',
    {
      title: 'Create OnMove update',
      description: 'Create direct evidence on a Thread or Commitment. Scoped parents require one currently applicable canonical Subject.',
      inputSchema: z.object({
        parent: parentSchema,
        subjectId: idSchema.optional(),
        date: dateSchema.optional(),
        observation: z.string().optional(),
        state: z.enum(['red', 'yellow', 'green', 'none']).optional(),
        sensitive: z.boolean().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async (input) => mutationResult(() =>
      database.commands.createUpdate(input, policy(), server.server.getClientVersion()?.name)
    )
  )

  server.registerTool(
    'onmove.create_todo',
    {
      title: 'Create OnMove todo',
      description: 'Create a Todo on a Thread or Commitment, optionally for one Subject or shared across all current Subjects.',
      inputSchema: z.object({
        parent: parentSchema,
        subjectId: idSchema.optional(),
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
        id: idSchema,
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
      inputSchema: z.object({ id: idSchema }),
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
      inputSchema: z.object({ target: parentSchema, subjectId: idSchema.optional() }),
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
      async (uri, variables) => resource(uri, found(getter(variableId(variables.id))))
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
