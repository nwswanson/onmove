import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { createOnMoveMcpServer } from '../../src/mcp/server'
import type { McpUiContextSnapshot } from '../../src/shared/contracts'

describe('OnMove MCP protocol adapter', () => {
  let directory: string
  let database: AppDatabase
  let client: Client
  let server: ReturnType<typeof createOnMoveMcpServer>
  let currentUiContext: McpUiContextSnapshot

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-mcp-protocol-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
    database.domain.focuses.create({ title: 'Launch readiness' })
    currentUiContext = { focusId: null, subjectId: null }
    server = createOnMoveMcpServer(database, {
      getCurrentUiContext: () => currentUiContext
    })
    client = new Client({ name: 'vitest-mcp-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await server.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('negotiates tools and resource templates and returns structured search output', async () => {
    const listed = await client.listTools()
    expect(listed.tools.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'onmove.list_focuses',
      'onmove.get_thread',
      'onmove.search',
      'onmove.create_update',
      'onmove.poke_review'
    ]))
    expect(listed.tools).toHaveLength(16)

    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate)).toEqual(
      expect.arrayContaining(['onmove://focus/{id}', 'onmove://thread/{id}', 'onmove://tags/{name}'])
    )

    const search = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'launch readiness' }
    })
    expect(search.isError).not.toBe(true)
    expect(search.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'focus', id: 1 },
        contextPath: ['Launch readiness'],
        hierarchy: {
          focus: { id: 1, title: 'Launch readiness' },
          thread: null,
          commitment: null
        }
      })],
      diagnostics: {
        appliedScope: { requestedMode: 'all', mode: 'all', focusId: null, subjectId: null },
        appliedKinds: 'all',
        resultCount: 1,
        warnings: []
      }
    })

    const focus = await client.readResource({ uri: 'onmove://focus/1' })
    expect(focus.contents[0]).toMatchObject({ uri: 'onmove://focus/1', mimeType: 'application/json' })
    expect(JSON.parse('text' in focus.contents[0] ? focus.contents[0].text : '{}')).toMatchObject({
      reference: { type: 'focus', id: 1 },
      diagnostics: { appliedScope: { mode: 'all', focusId: null, subjectId: null } }
    })
  })

  it('advertises named scope semantics and self-describing entity IDs in tool schemas', async () => {
    const tools = (await client.listTools()).tools
    const search = tools.find(({ name }) => name === 'onmove.search')!
    const getThread = tools.find(({ name }) => name === 'onmove.get_thread')!
    const createUpdate = tools.find(({ name }) => name === 'onmove.create_update')!
    const searchSchema = JSON.stringify(search.inputSchema)
    const threadSchema = JSON.stringify(getThread.inputSchema)
    const updateSchema = JSON.stringify(createUpdate.inputSchema)

    expect(searchSchema).toContain('current OnMove UI Focus and Subject selection')
    expect(searchSchema).toContain('Null or omitted means mode=all')
    expect(searchSchema).toContain('top-level area of work')
    expect(searchSchema).toContain('canonical Subject')
    expect(threadSchema).toContain('hierarchy.thread.id')
    expect(threadSchema).toContain('not searchResult.reference.id')
    expect(createUpdate.description).toContain('Open parents require unscoped attribution')
    expect(updateSchema).toContain('writeGuide.createUpdate.allowedSubjects')
    expect(updateSchema).toContain('Null or omitted means unscoped')
  })

  it('searches globally by default and only uses the UI context when mode=current is explicit', async () => {
    const first = database.domain.focuses.requireModel(1).toSnapshot()
    const second = database.domain.focuses.create({ title: 'Second workspace' }).toSnapshot()
    const firstThread = database.domain.threads.create({
      focusId: first.id,
      title: 'globaldefaultasdfasdf first lane',
      reviewFrequencyDays: 7
    }).snapshot()
    const secondThread = database.domain.threads.create({
      focusId: second.id,
      title: 'globaldefaultasdfasdf second lane',
      reviewFrequencyDays: 7
    }).snapshot()
    currentUiContext = { focusId: first.id, subjectId: null }

    const global = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'globaldefaultasdfasdf', kinds: ['thread'] }
    })
    expect(global.structuredContent).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ reference: { type: 'thread', id: firstThread.id } }),
        expect.objectContaining({ reference: { type: 'thread', id: secondThread.id } })
      ]),
      diagnostics: { appliedScope: { mode: 'all', source: 'default' }, resultCount: 2 }
    })

    const explicitNull = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'globaldefaultasdfasdf', scope: null, kinds: ['thread'] }
    })
    expect(explicitNull.structuredContent).toMatchObject({
      diagnostics: { appliedScope: { mode: 'all', source: 'default' }, resultCount: 2 }
    })

    const current = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'globaldefaultasdfasdf',
        scope: { mode: 'current' },
        kinds: ['thread']
      }
    })
    expect(current.structuredContent).toMatchObject({
      items: [expect.objectContaining({ reference: { type: 'thread', id: firstThread.id } })],
      diagnostics: {
        appliedScope: { mode: 'current', focusId: first.id, subjectId: null, source: 'current-ui' },
        resultCount: 1
      }
    })
  })

  it('supports named Focus and Subject scopes and explains suspiciously narrow empty results', async () => {
    const first = database.domain.focuses.requireModel(1).toSnapshot()
    const second = database.domain.focuses.create({ title: 'Other hierarchy' }).toSnapshot()
    const firstThread = database.domain.threads.create({
      focusId: first.id, title: 'Scoped first', reviewFrequencyDays: 7
    }).snapshot()
    const secondThread = database.domain.threads.create({
      focusId: second.id, title: 'Scoped second', reviewFrequencyDays: 7
    }).snapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: firstThread.id }, observation: 'namedscopeasdfasdf'
    })
    const secondUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: secondThread.id }, observation: 'namedscopeasdfasdf'
    }).toSnapshot()
    const scope = database.domain.threadScopes.addSubject(secondThread.id, {
      name: 'Scoped Person'
    })
    const subject = scope.subjects[0]
    const subjectUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: secondThread.id },
      scope: { scopeId: scope.scopeId as number, subjectId: subject.id },
      observation: 'subjectscopeasdfasdf'
    }).toSnapshot()

    const focusSearch = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'namedscopeasdfasdf',
        scope: { mode: 'focus', focusId: second.id }
      }
    })
    expect(focusSearch.structuredContent).toMatchObject({
      items: [expect.objectContaining({ reference: { type: 'update', id: secondUpdate.id } })],
      diagnostics: { appliedScope: { mode: 'focus', focusId: second.id }, resultCount: 1 }
    })

    const subjectSearch = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'subjectscopeasdfasdf',
        scope: { mode: 'subject', subjectId: subject.id }
      }
    })
    expect(subjectSearch.structuredContent).toMatchObject({
      items: [expect.objectContaining({ reference: { type: 'update', id: subjectUpdate.id } })],
      diagnostics: { appliedScope: { mode: 'subject', subjectId: subject.id }, resultCount: 1 }
    })

    const narrowEmpty = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'notpresentasdfasdf',
        scope: { mode: 'focus', focusId: second.id },
        kinds: ['note']
      }
    })
    expect(narrowEmpty.structuredContent).toMatchObject({
      items: [],
      diagnostics: {
        appliedScope: { mode: 'focus', focusId: second.id },
        appliedKinds: ['note'],
        resultCount: 0,
        warnings: [expect.stringContaining('Retry with scope.mode="all"')]
      }
    })
    expect(JSON.stringify(narrowEmpty.content)).toContain('no focusId or subjectId')
  })

  it('falls back to global search when a named hierarchy ID is null', async () => {
    database.domain.focuses.create({ title: 'nullscopeasdfasdf elsewhere' })
    const response = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'nullscopeasdfasdf',
        scope: { mode: 'focus', focusId: null }
      }
    })
    expect(response.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: expect.objectContaining({ type: 'focus' })
      })],
      diagnostics: {
        appliedScope: { requestedMode: 'focus', mode: 'all', focusId: null },
        resultCount: 1,
        warnings: [expect.stringContaining('search was global')]
      }
    })
  })

  it('uses a child search hit to retrieve its owning Thread without confusing entity IDs', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Search hydration Thread',
      reviewFrequencyDays: 7
    }).snapshot()
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'getthreadasdfasdf lives in a child Update'
    }).toSnapshot()

    const search = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'getthreadasdfasdf' }
    })
    const structured = search.structuredContent as {
      items: Array<{ hierarchy: { thread: { id: number } | null } }>
    }
    const owningThreadId = structured.items[0].hierarchy.thread?.id
    expect(owningThreadId).toBe(thread.id)

    const context = await client.callTool({
      name: 'onmove.get_thread',
      arguments: { id: owningThreadId }
    })
    expect(context.structuredContent).toMatchObject({
      reference: { type: 'thread', id: thread.id },
      updates: [expect.objectContaining({ id: update.id, observation: expect.stringContaining('getthreadasdfasdf') })],
      diagnostics: { appliedScope: { mode: 'all', focusId: null, subjectId: null } }
    })
  })

  it('guides and recovers an agent that incorrectly targets a Subject on an Open Thread', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Open update target',
      reviewFrequencyDays: 7
    }).snapshot()
    const subject = database.domain.subjects.create({ name: 'Person X' }).toSnapshot()
    database.mcpSettings.update({ allowMutations: true })

    const context = await client.callTool({
      name: 'onmove.get_thread',
      arguments: { id: thread.id }
    })
    expect(context.structuredContent).toMatchObject({
      reference: { type: 'thread', id: thread.id },
      scope: { mode: 'open', scopeId: null, subjects: [] },
      writeGuide: {
        createUpdate: {
          tool: 'onmove.create_update',
          parent: { type: 'thread', id: thread.id },
          attributionMode: 'unscoped',
          subjectRequired: false,
          allowedSubjects: [],
          requestExample: {
            parent: { type: 'thread', id: thread.id },
            attribution: { mode: 'unscoped' }
          }
        }
      }
    })

    const rejected = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        subjectId: subject.id,
        observation: 'Open Thread evidence',
        state: 'green'
      }
    })
    expect(rejected.isError).toBe(true)
    expect(rejected.structuredContent).toMatchObject({
      error: {
        code: 'open_parent_cannot_target_subject',
        message: expect.stringContaining('Retry without subjectId')
      },
      recovery: {
        inspect: {
          tool: 'onmove.get_thread',
          arguments: { id: thread.id },
          path: 'writeGuide.createUpdate'
        },
        allowedSubjects: [],
        retry: {
          tool: 'onmove.create_update',
          arguments: {
            parent: { type: 'thread', id: thread.id },
            attribution: { mode: 'unscoped' },
            observation: 'Open Thread evidence',
            state: 'green'
          }
        }
      }
    })
    expect(JSON.stringify(rejected.content)).toContain('Suggested retry')

    const recovery = rejected.structuredContent as {
      recovery: { retry: { tool: string; arguments: Record<string, unknown> } }
    }
    const created = await client.callTool({
      name: recovery.recovery.retry.tool,
      arguments: recovery.recovery.retry.arguments
    })
    expect(created.isError).not.toBe(true)
    expect(created.structuredContent).toMatchObject({
      parent: { type: 'thread', id: thread.id },
      scope: null,
      observation: 'Open Thread evidence',
      state: 'green'
    })
  })

  it('requires one allowed Subject for a scoped Thread and provides a ready retry when unambiguous', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Scoped update target',
      reviewFrequencyDays: 7
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'Only Subject' })
    const subject = scope.subjects[0]
    database.mcpSettings.update({ allowMutations: true })

    const context = await client.callTool({
      name: 'onmove.get_thread',
      arguments: { id: thread.id }
    })
    expect(context.structuredContent).toMatchObject({
      writeGuide: {
        createUpdate: {
          attributionMode: 'subject',
          subjectRequired: true,
          allowedSubjects: [{ id: subject.id, name: 'Only Subject' }],
          requestExample: {
            attribution: { mode: 'subject', subjectId: subject.id }
          }
        }
      }
    })

    const rejected = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'unscoped' },
        observation: 'Needs exact attribution'
      }
    })
    expect(rejected.isError).toBe(true)
    expect(rejected.structuredContent).toMatchObject({
      error: { code: 'scoped_parent_requires_subject' },
      recovery: {
        allowedSubjects: [{ id: subject.id, name: 'Only Subject' }],
        retry: {
          tool: 'onmove.create_update',
          arguments: {
            parent: { type: 'thread', id: thread.id },
            attribution: { mode: 'subject', subjectId: subject.id },
            observation: 'Needs exact attribution'
          }
        }
      }
    })

    const created = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'subject', subjectId: subject.id },
        observation: 'Subject evidence'
      }
    })
    expect(created.isError).not.toBe(true)
    expect(created.structuredContent).toMatchObject({
      scope: { scopeId: scope.scopeId, subjectId: subject.id },
      observation: 'Subject evidence'
    })
  })

  it('does not guess between multiple scoped Subjects and rejects an unrelated Subject', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Multiple Subject target',
      reviewFrequencyDays: 7
    }).snapshot()
    database.domain.threadScopes.addSubject(thread.id, { name: 'North' })
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'South' })
    const unrelated = database.domain.subjects.create({ name: 'Unrelated' }).toSnapshot()
    database.mcpSettings.update({ allowMutations: true })

    const missing = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        observation: 'Ambiguous evidence'
      }
    })
    expect(missing.isError).toBe(true)
    expect(missing.structuredContent).toMatchObject({
      error: { code: 'scoped_parent_requires_subject' },
      recovery: {
        allowedSubjects: expect.arrayContaining(scope.subjects.map(({ id, name }) => ({ id, name }))),
        retry: null
      }
    })
    expect(JSON.stringify(missing.content)).toContain('choose one allowed Subject')

    const invalid = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'subject', subjectId: unrelated.id },
        observation: 'Invalidly attributed evidence'
      }
    })
    expect(invalid.isError).toBe(true)
    expect(invalid.structuredContent).toMatchObject({
      error: { code: 'subject_not_applicable' },
      recovery: {
        allowedSubjects: expect.arrayContaining(scope.subjects.map(({ id, name }) => ({ id, name }))),
        retry: null
      }
    })
    expect(database.domain.updates.listForThread(thread.id)).toEqual([])
  })

  it('accepts an explicitly null legacy subjectId as unscoped attribution', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Nullable target',
      reviewFrequencyDays: 7
    }).snapshot()
    database.mcpSettings.update({ allowMutations: true })
    const created = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        subjectId: null,
        observation: 'Nullable unscoped evidence'
      }
    })
    expect(created.isError).not.toBe(true)
    expect(created.structuredContent).toMatchObject({ scope: null })
  })

  it('returns the same not-found behavior for hidden and unknown records', async () => {
    database.domain.focuses.requireModel(1).update({ sensitive: true })
    const hidden = await client.callTool({ name: 'onmove.get_focus', arguments: { id: 1 } })
    const missing = await client.callTool({ name: 'onmove.get_focus', arguments: { id: 999 } })
    expect(hidden.isError).toBe(true)
    expect(missing.isError).toBe(true)
    expect(hidden.content).toEqual(missing.content)
  })

  it('re-reads permissions for every call and enables safe writes without reconnecting', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery health',
      reviewFrequencyDays: 7
    }).snapshot()

    const denied = await client.callTool({
      name: 'onmove.create_update',
      arguments: { parent: { type: 'thread', id: thread.id }, observation: 'First evidence' }
    })
    expect(denied.isError).toBe(true)

    database.mcpSettings.update({ allowMutations: true })
    const allowed = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        observation: 'First evidence',
        state: 'green'
      }
    })
    expect(allowed.isError).not.toBe(true)
    expect(database.domain.updates.listForThread(thread.id)).toEqual([
      expect.objectContaining({ observation: 'First evidence', state: 'green' })
    ])
  })
})
