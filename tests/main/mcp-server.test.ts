import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { createOnMoveMcpServer } from '../../src/mcp/server'
import type { McpUiContextSnapshot } from '../../src/shared/contracts'
import {
  onMoveRichTextDocumentToStored,
  type OnMoveRichTextDocument
} from '../../src/shared/rich-text-document'
import { RICH_TEXT_PREFIX } from '../../src/shared/rich-text-value'

function richText(text: string): OnMoveRichTextDocument {
  return {
    version: 1,
    blocks: [{ type: 'paragraph', children: [{ type: 'text', text }] }]
  }
}

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
      'onmove.list_threads',
      'onmove.list_commitments',
      'onmove.list_routines',
      'onmove.get_thread_by_id',
      'onmove.get_thread_by_path',
      'onmove.get_focus_by_id',
      'onmove.get_focus_by_path',
      'onmove.get_commitment_by_id',
      'onmove.get_commitment_by_path',
      'onmove.get_routine_by_id',
      'onmove.get_routine_by_path',
      'onmove.get_update_by_id',
      'onmove.get_updates_by_ids',
      'onmove.get_note_by_id',
      'onmove.get_note_by_path',
      'onmove.search_focuses',
      'onmove.search_threads',
      'onmove.search_commitments',
      'onmove.search_routines',
      'onmove.search_updates',
      'onmove.search_notes',
      'onmove.search_todos',
      'onmove.search_subjects',
      'onmove.resolve_work_target',
      'onmove.review_subject',
      'onmove.search',
      'onmove.create_focus',
      'onmove.update_focus',
      'onmove.create_thread',
      'onmove.update_thread',
      'onmove.create_commitment',
      'onmove.update_commitment',
      'onmove.create_routine',
      'onmove.update_routine',
      'onmove.update_update',
      'onmove.create_update',
      'onmove.reparent_update',
      'onmove.patch_rich_text',
      'onmove.update_rich_text',
      'onmove.patch_note_text',
      'onmove.update_note',
      'onmove.poke_review'
    ]))
    expect(listed.tools).toHaveLength(51)
    expect(listed.tools.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
      'onmove.get_focus',
      'onmove.get_thread',
      'onmove.get_commitment',
      'onmove.get_update',
      'onmove.get_updates',
      'onmove.get_note',
      'onmove.resolve_note'
    ]))

    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate)).toEqual(
      expect.arrayContaining([
        'onmove://focus/{id}',
        'onmove://thread/{id}',
        'onmove://note/{id}',
        'onmove://tags/{name}'
      ])
    )

    const search = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'launch readiness', projection: { hierarchy: true } }
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

  it('lists compact hierarchy rows and expands scoped work once per Subject', async () => {
    const focus = database.domain.focuses.requireModel(1)
    focus.update({
      description: onMoveRichTextDocumentToStored(
        richText(`Portfolio breadcrumb ${'x'.repeat(240)}`)
      )
    })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Customer operations',
      reviewFrequencyDays: 7
    }).snapshot()
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: 'Confirm account health'
    }).snapshot()
    database.domain.focusScopes.addSubject(focus.id, { name: 'North' })
    const focusScope = database.domain.focusScopes.addSubject(focus.id, { name: 'South' })
    database.domain.threadScopes.followFocus(thread.id)
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Weekly account inspection',
      scheduleWeekdays: ['friday'],
      scopeId: focusScope.scopeId,
      checklist: [{ inspection: 'secret-checklist-contents must remain omitted' }]
    }).snapshot()
    database.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      scope: {
        scopeId: focusScope.scopeId as number,
        subjectId: focusScope.subjects[0].id
      },
      observation: 'secret-update-contents must remain omitted'
    })
    database.domain.richTextDocuments.save({
      type: 'note',
      id: database.domain.notes.list({ type: 'thread', id: thread.id })[0].id,
      field: 'content'
    }, 'secret-note-contents must remain omitted')

    const focuses = await client.callTool({
      name: 'onmove.list_focuses', arguments: {}
    })
    const focusItem = (focuses.structuredContent as {
      items: Array<{ breadcrumb?: { text: string; truncated: boolean } }>
    }).items[0]
    expect(focusItem.breadcrumb?.text).toHaveLength(200)
    expect(focusItem.breadcrumb).toMatchObject({ truncated: true })

    const threads = await client.callTool({
      name: 'onmove.list_threads', arguments: { focusId: focus.id }
    })
    const threadRows = (threads.structuredContent as {
      items: Array<Record<string, unknown>>
      total: number
      contentPolicy: Record<string, unknown>
    })
    expect(threadRows.total).toBe(2)
    expect(threadRows.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectionKey: `thread:${thread.id}:subject:${focusScope.subjects[0].id}`,
        reference: { type: 'thread', id: thread.id },
        displayPath: expect.stringContaining('Customer operations['),
        hierarchy: expect.objectContaining({
          focus: { id: focus.id, title: 'Launch readiness' },
          thread: { id: thread.id, title: 'Customer operations' }
        }),
        projection: expect.objectContaining({
          mode: 'subject', projectedScope: true,
          subject: { id: focusScope.subjects[0].id, name: focusScope.subjects[0].name }
        })
      })
    ]))
    expect(threadRows.contentPolicy).toMatchObject({
      childCollectionsIncluded: false,
      richTextIncluded: false,
      breadcrumbMaximumCharacters: 200
    })

    const commitments = await client.callTool({
      name: 'onmove.list_commitments', arguments: { threadId: thread.id }
    })
    const commitmentRows = commitments.structuredContent as {
      items: Array<Record<string, unknown>>
      total: number
    }
    expect(commitmentRows.total).toBe(2)
    expect(commitmentRows.items[0]).toMatchObject({
      reference: { type: 'commitment', id: commitment.id },
      hierarchy: {
        focus: { id: focus.id, title: 'Launch readiness' },
        thread: { id: thread.id, title: 'Customer operations' },
        commitment: { id: commitment.id, title: 'Confirm account health' },
        routine: null
      },
      projection: { mode: 'subject', projectedScope: true }
    })

    const routines = await client.callTool({
      name: 'onmove.list_routines', arguments: { threadId: thread.id }
    })
    const routineRows = routines.structuredContent as {
      items: Array<Record<string, unknown>>
      total: number
    }
    expect(routineRows.total).toBe(2)
    expect(routineRows.items[0]).toMatchObject({
      reference: { type: 'routine', id: routine.id },
      projection: { mode: 'subject', projectedScope: true },
      summary: expect.objectContaining({ scheduleWeekdays: ['friday'] })
    })

    const compactPayloads = JSON.stringify([
      threads.structuredContent,
      commitments.structuredContent,
      routines.structuredContent
    ])
    expect(compactPayloads).not.toContain('secret-checklist-contents')
    expect(compactPayloads).not.toContain('secret-update-contents')
    expect(compactPayloads).not.toContain('secret-note-contents')
    expect(compactPayloads).not.toContain('previousRuns')
    expect(compactPayloads).not.toContain('"richText":')
  })

  it('advertises named scope semantics and self-describing entity IDs in tool schemas', async () => {
    const tools = (await client.listTools()).tools
    const search = tools.find(({ name }) => name === 'onmove.search')!
    const getThread = tools.find(({ name }) => name === 'onmove.get_thread_by_id')!
    const resolveTarget = tools.find(({ name }) => name === 'onmove.resolve_work_target')!
    const createUpdate = tools.find(({ name }) => name === 'onmove.create_update')!
    const createTodo = tools.find(({ name }) => name === 'onmove.create_todo')!
    const patchRichText = tools.find(({ name }) => name === 'onmove.patch_rich_text')!
    const updateRichText = tools.find(({ name }) => name === 'onmove.update_rich_text')!
    const searchSchema = JSON.stringify(search.inputSchema)
    const threadSchema = JSON.stringify(getThread.inputSchema)
    const updateSchema = JSON.stringify(createUpdate.inputSchema)
    const resolveTargetSchema = resolveTarget.inputSchema as {
      properties?: Record<string, unknown>
    }

    expect(searchSchema).toContain('current OnMove UI Focus and Subject selection')
    expect(searchSchema).toContain('Null or omitted means mode=all')
    expect(searchSchema).toContain('top-level area of work')
    expect(searchSchema).toContain('canonical Subject')
    expect(searchSchema).toContain('projection')
    expect(searchSchema).toContain('hierarchy')
    expect(searchSchema).toContain('subjects')
    expect(searchSchema).toContain('scopes')
    expect(searchSchema).toContain('richText')
    expect(searchSchema).toContain('queryless list mode')
    expect(searchSchema).toContain('createdAt')
    expect(searchSchema).toContain('updatedAt')
    expect(searchSchema).toContain('IANA timezone')
    expect(searchSchema).toContain('Hard structured-response')
    expect(searchSchema).not.toContain('includeThreads')
    expect(searchSchema).not.toContain('includeCommitments')
    expect(searchSchema).not.toContain('includeSubjects')
    expect(searchSchema).not.toContain('includeScopes')
    expect(searchSchema).not.toContain('hierarchy-only')
    expect(searchSchema).toContain('continuationToken')
    expect(searchSchema).toContain('Initial request: omit or null')
    expect(searchSchema).toContain('do not send text, filters, scope, sort, kinds, projection, or page again')
    expect(searchSchema).toContain('preserve a previously returned Thread ID')
    expect(search.description).toContain('queryless structured listing')
    expect(search.description).toContain('signed continuationToken')
    expect(search.description).toContain('INITIAL REQUEST')
    expect(threadSchema).toContain('hierarchy.thread.id')
    expect(threadSchema).toContain('not searchResult.reference.id')
    expect(threadSchema).toContain('Defaults to false')
    expect(threadSchema).toContain('renders rich fields as Markdown')
    expect(JSON.stringify(resolveTarget.inputSchema)).toContain(
      'Provide either id or title, not both'
    )
    expect(resolveTargetSchema.properties?.subject).toMatchObject({
      oneOf: [
        expect.objectContaining({
          required: ['id'],
          additionalProperties: false
        }),
        expect.objectContaining({
          required: ['name'],
          additionalProperties: false
        })
      ]
    })
    expect(createUpdate.description).toContain('Open parents require unscoped attribution')
    expect(updateSchema).toContain('writeGuide.createUpdate.allowedSubjects')
    expect(updateSchema).toContain('Team management')
    expect(updateSchema).toContain('semanticPath')
    expect(updateSchema).toContain('Null or omitted means unscoped')
    expect(updateSchema).toContain('The only rich-text observation field')
    expect(updateSchema).toContain('highlight-yellow')
    expect(updateSchema).toContain('checklist')
    const updateProperties = (createUpdate.inputSchema as {
      properties?: Record<string, unknown>
    }).properties
    expect(updateProperties).toHaveProperty('richText')
    expect(updateProperties).not.toHaveProperty('document')
    expect(updateProperties).not.toHaveProperty('observation')
    expect(resolveTarget.description).toContain('Thread → Commitment → Subject')
    expect(JSON.stringify(resolveTarget.inputSchema)).toContain('1:1')
    expect(createTodo.description).toContain('writeGuide.createTodo')
    expect(JSON.stringify(createTodo.inputSchema)).toContain('all-subjects')
    const richTextTargetSchema = JSON.stringify(patchRichText.inputSchema)
    expect(richTextTargetSchema).toContain('focus-description')
    expect(richTextTargetSchema).toContain('update-observation')
    expect(richTextTargetSchema).toContain('searchResult.reference.id')
    expect(richTextTargetSchema).toContain('oneOf')
    expect(richTextTargetSchema).toContain('"additionalProperties":false')
    const replacementProperties = (updateRichText.inputSchema as {
      properties?: Record<string, unknown>
    }).properties
    expect(replacementProperties).toHaveProperty('richText')
    expect(replacementProperties).not.toHaveProperty('document')
    const updateNote = tools.find(({ name }) => name === 'onmove.update_note')!
    const updateNoteProperties = (updateNote.inputSchema as {
      properties?: Record<string, unknown>
    }).properties
    expect(updateNoteProperties).toHaveProperty('clear')
    expect(updateNoteProperties).toHaveProperty('richText')
    const noteSchema = JSON.stringify(updateNote.inputSchema)
    expect(noteSchema).toContain('explicitly by type')
    expect(noteSchema).toContain('"oneOf"')
    expect(noteSchema).toContain('"const":"text"')
    expect(noteSchema).toContain('"const":"line-break"')
    expect(noteSchema).toContain('"const":"paragraph"')
    expect(noteSchema).toContain('"const":"quote"')
    expect(noteSchema).toContain('"additionalProperties":false')
    expect(noteSchema).toContain('null is accepted and canonicalized to omission')
    expect(noteSchema).toContain('"type":"null"')
  })

  it('separates exact hierarchy paths from durable ID reads for every addressable entity', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Path Contract Thread',
      reviewFrequencyDays: 7
    }).snapshot()
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: 'Path Contract Commitment'
    }).snapshot()
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Path Contract Routine',
      scheduleWeekdays: ['monday'],
      checklist: [{ inspection: 'Verify the path contract.' }]
    })
    const note = database.domain.notes.list({ type: 'commitment', id: commitment.id })[0]

    for (const [tool, argumentsValue, reference] of [
      [
        'onmove.get_focus_by_path',
        { focusTitle: 'launch readiness' },
        { type: 'focus', id: focus.id }
      ],
      [
        'onmove.get_thread_by_path',
        { focusTitle: focus.title, threadTitle: 'path contract thread' },
        { type: 'thread', id: thread.id }
      ],
      [
        'onmove.get_commitment_by_path',
        {
          focusTitle: focus.title,
          threadTitle: thread.title,
          commitmentTitle: 'path contract commitment'
        },
        { type: 'commitment', id: commitment.id }
      ],
      [
        'onmove.get_routine_by_path',
        {
          focusTitle: focus.title,
          threadTitle: thread.title,
          routineTitle: 'path contract routine'
        },
        { type: 'routine', id: routine.id }
      ],
      [
        'onmove.get_note_by_path',
        {
          focusTitle: focus.title,
          threadTitle: thread.title,
          commitmentTitle: commitment.title,
          noteTitle: 'default'
        },
        { type: 'note', id: note.id }
      ]
    ] as const) {
      const response = await client.callTool({ name: tool, arguments: argumentsValue })
      expect(response.isError).not.toBe(true)
      expect(response.structuredContent).toMatchObject({
        status: 'resolved',
        target: { reference }
      })
    }

    const secondFocus = database.domain.focuses.create({ title: 'Second exact parent' }).toSnapshot()
    database.domain.threads.create({
      focusId: secondFocus.id,
      title: thread.title,
      reviewFrequencyDays: 7
    })
    const ambiguous = await client.callTool({
      name: 'onmove.get_thread_by_path',
      arguments: { threadTitle: thread.title }
    })
    expect(ambiguous.structuredContent).toMatchObject({
      status: 'ambiguous',
      target: null,
      diagnostics: { resolutionStatus: 'ambiguous', candidateCount: 2 }
    })

    const mixedIdentity = await client.callTool({
      name: 'onmove.get_thread_by_path',
      arguments: { focusId: focus.id, threadTitle: thread.title }
    })
    expect(mixedIdentity.isError).toBe(true)

    const routineById = await client.callTool({
      name: 'onmove.get_routine_by_id',
      arguments: { id: routine.id }
    })
    expect(routineById.structuredContent).toMatchObject({
      reference: { type: 'routine', id: routine.id }
    })
  })

  it('searches one named entity kind at a time with stable specialized continuations', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const searchableFocus = database.domain.focuses.create({ title: 'Kindneedle Focus' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Kindneedle Thread',
      reviewFrequencyDays: 7
    }).snapshot()
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: 'Kindneedle Commitment'
    }).snapshot()
    const update = database.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      observation: 'Kindneedle Update evidence'
    }).toSnapshot()
    const todo = database.domain.todos.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Kindneedle Todo'
    })
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Kindneedle Routine',
      scheduleWeekdays: ['tuesday'],
      checklist: [{ inspection: 'Verify Kindneedle.' }]
    })
    const subject = database.domain.threadScopes.addSubject(thread.id, {
      name: 'Kindneedle Subject'
    }).subjects[0]
    const notes = [
      database.domain.notes.list({ type: 'focus', id: focus.id })[0],
      database.domain.notes.list({ type: 'thread', id: thread.id })[0],
      database.domain.notes.list({ type: 'commitment', id: commitment.id })[0]
    ]
    notes.forEach((note, index) => database.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      `Notepagingneedle content ${index}`
    ))

    for (const [tool, reference] of [
      ['onmove.search_focuses', { type: 'focus', id: searchableFocus.id }],
      ['onmove.search_threads', { type: 'thread', id: thread.id }],
      ['onmove.search_commitments', { type: 'commitment', id: commitment.id }],
      ['onmove.search_routines', { type: 'routine', id: routine.id }],
      ['onmove.search_updates', { type: 'update', id: update.id }],
      ['onmove.search_todos', { type: 'todo', id: todo.id }],
      ['onmove.search_subjects', { type: 'subject', id: subject.id }]
    ] as const) {
      const response = await client.callTool({
        name: tool,
        arguments: { text: 'kindneedle' }
      })
      expect(response.isError).not.toBe(true)
      expect(response.structuredContent).toMatchObject({
        records: [expect.objectContaining({ reference })],
        diagnostics: { resultCount: 1 }
      })
    }

    const seen: number[] = []
    let page = await client.callTool({
      name: 'onmove.search_notes',
      arguments: {
        text: 'notepagingneedle',
        projection: {
          hierarchy: true,
          richText: true,
          richTextPurpose: 'structural-replacement'
        },
        page: { size: 1 }
      }
    })
    for (;;) {
      expect(page.isError).not.toBe(true)
      const content = page.structuredContent as {
        records: Array<{
          reference: { type: string; id: number }
          hierarchy: unknown
          editableRichText: unknown
        }>
        hasMore: boolean
        continuationToken: string | null
      }
      expect(content.records[0]).toMatchObject({
        reference: { type: 'note' },
        hierarchy: expect.any(Object),
        editableRichText: expect.any(Object)
      })
      seen.push(content.records[0].reference.id)
      if (!content.hasMore) break
      page = await client.callTool({
        name: 'onmove.search_notes',
        arguments: { continuationToken: content.continuationToken }
      })
    }
    expect(new Set(seen)).toEqual(new Set(notes.map(({ id }) => id)))

    const first = await client.callTool({
      name: 'onmove.search_notes',
      arguments: { text: 'notepagingneedle', page: { size: 1 } }
    })
    const noteToken = (first.structuredContent as { continuationToken: string }).continuationToken
    const wrongSearch = await client.callTool({
      name: 'onmove.search_updates',
      arguments: { continuationToken: noteToken }
    })
    expect(wrongSearch.isError).toBe(true)
    expect(JSON.stringify(wrongSearch)).toContain('different entity search')
  })

  it('treats omitted or null continuation tokens as initial searches and rejects only invalid values', async () => {
    const withNull = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'launch readiness',
        scope: { mode: 'all' },
        continuationToken: null
      }
    })
    expect(withNull.isError).not.toBe(true)
    expect(withNull.structuredContent).toMatchObject({
      items: [expect.objectContaining({ reference: { type: 'focus', id: 1 } })],
      diagnostics: {
        appliedScope: { mode: 'all', source: 'explicit' },
        warnings: []
      },
      continuationToken: null,
      hasMore: false
    })

    const omitted = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'launch readiness' }
    })
    expect(omitted.isError).not.toBe(true)

    const invented = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'launch readiness', continuationToken: 'invented-token' }
    })
    expect(invented.isError).toBe(true)
    expect(JSON.stringify(invented)).toContain(
      'continuationToken is not a valid OnMove search continuation token'
    )
  })

  it('rejects conflicting hierarchy selectors instead of silently preferring their IDs', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const first = database.domain.threads.create({
      focusId: focus.id,
      title: 'ID one Thread',
      reviewFrequencyDays: 7
    }).snapshot()
    database.domain.threads.create({
      focusId: focus.id,
      title: 'ID two name',
      reviewFrequencyDays: 7
    })

    const entityConflict = await client.callTool({
      name: 'onmove.resolve_work_target',
      arguments: { thread: { id: first.id, title: 'ID two name' } }
    })
    expect(entityConflict.isError).toBe(true)
    expect(JSON.stringify(entityConflict)).toContain(
      'Thread selector conflict: provide either id or title, not both'
    )

    const subject = database.domain.threadScopes.addSubject(first.id, { name: 'Person one' })
      .subjects[0]
    const subjectConflict = await client.callTool({
      name: 'onmove.review_subject',
      arguments: {
        thread: { id: first.id },
        subject: { id: subject.id, name: 'Somebody else' }
      }
    })
    expect(subjectConflict.isError).toBe(true)
    expect(JSON.stringify(subjectConflict)).toContain(
      'Subject selector conflict: provide either id or name, not both'
    )
  })

  it('keeps get_thread_by_id usable when a stored rich-text structure is unsupported', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Future rich text owner',
      reviewFrequencyDays: 7
    }).snapshot()
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Original evidence'
    }).toSnapshot()
    database.domain.richTextDocuments.save(
      { type: 'update', id: update.id, field: 'observation' },
      `${RICH_TEXT_PREFIX}${JSON.stringify({
        root: {
          type: 'root',
          children: [{
            type: 'future-widget',
            children: [{ type: 'text', text: 'Readable future evidence', version: 1 }],
            version: 1
          }],
          version: 1
        }
      })}`
    )

    const compact = await client.callTool({
      name: 'onmove.get_thread_by_id',
      arguments: { id: thread.id }
    })
    expect(compact.isError).not.toBe(true)
    expect(compact.structuredContent).toMatchObject({
      reference: { type: 'thread', id: thread.id },
      updates: [expect.objectContaining({
        id: update.id,
        observation: 'Readable future evidence'
      })],
      diagnostics: {
        warnings: expect.arrayContaining([
          expect.stringContaining('Lossless rich text was omitted')
        ])
      }
    })
    expect((compact.structuredContent as {
      updates: Array<Record<string, unknown>>
    }).updates[0]).not.toHaveProperty('observationRichText')

    const expanded = await client.callTool({
      name: 'onmove.get_thread_by_id',
      arguments: { id: thread.id, includeRichText: true }
    })
    expect(expanded.isError).not.toBe(true)
    expect(expanded.structuredContent).toMatchObject({
      reference: { type: 'thread', id: thread.id },
      updates: [expect.objectContaining({
        id: update.id,
        observation: 'Readable future evidence'
      })],
      diagnostics: {
        warnings: [expect.stringContaining('Update ' + update.id + ' contains unsupported rich text')]
      }
    })
    expect((expanded.structuredContent as {
      updates: Array<Record<string, unknown>>
    }).updates[0]).not.toHaveProperty('observationRichText')
  })

  it('keeps advertised patch tools callable and breaks repeated invalid-rich-text loops', async () => {
    const tools = (await client.listTools()).tools
    expect(tools.find(({ name }) => name === 'onmove.patch_note_text')).toBeDefined()
    expect(tools.find(({ name }) => name === 'onmove.patch_rich_text')).toBeDefined()
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const note = database.domain.notes.list({ type: 'focus', id: focus.id })[0]
    database.mcpSettings.update({ allowMutations: true })
    const invalidArguments = {
      id: note.id,
      expectedRevision: note.revision,
      richText: {
        version: 1,
        blocks: [{
          type: 'paragraph',
          children: [{ type: 'text', text: 'hey there', tag: true }]
        }]
      }
    }
    const rejected = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      rejected.push(await client.callTool({
        name: 'onmove.update_note',
        arguments: invalidArguments
      }))
    }
    expect(rejected[0].isError).toBe(true)
    expect(rejected[0].structuredContent).toMatchObject({
      error: {
        code: 'invalid_rich_text',
        pointer: '/richText/blocks/0/children/0',
        received: { type: 'text', text: 'hey there', tag: true },
        correction: {
          type: 'text', text: 'hey there', marks: ['bold', 'highlight']
        },
        message: expect.stringContaining('tagged text node')
      },
      recovery: {
        instruction: expect.stringContaining('Do not resend'),
        example: {
          pointer: '/richText/blocks/0/children/0',
          value: { type: 'text', text: 'hey there', marks: ['bold', 'highlight'] }
        }
      }
    })
    expect(rejected[2].structuredContent).toMatchObject({
      recovery: {
        duplicateInvalidCall: {
          count: 3,
          warning: expect.stringContaining('third identical rejected request')
        }
      }
    })
    const thirdText = rejected[2].content
      .flatMap((entry) => 'text' in entry ? [entry.text] : [])
      .join('\n')
    expect(thirdText).toContain('type:"text"')
    expect(thirdText).toContain('tag:true')
    expect(database.domain.notes.find(note.id)?.revision).toBe(note.revision)

    const acceptedNullColor = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{ type: 'text', text: 'hello world', color: null }]
          }]
        }
      }
    })
    expect(acceptedNullColor.isError).not.toBe(true)
    expect(acceptedNullColor.structuredContent).toMatchObject({
      note: {
        content: 'hello world',
        richText: { blocks: [{ children: [{ type: 'text', text: 'hello world' }] }] },
        revision: note.revision + 1
      }
    })

    const patched = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        findText: 'hello world',
        replaceText: 'hi there'
      }
    })
    expect(patched.isError).not.toBe(true)
    expect(patched.structuredContent).toMatchObject({
      note: { content: 'hi there', revision: note.revision + 2 }
    })
  })

  it('returns every editable rich-text field directly from one expanded search', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Expanded search owner',
      reviewFrequencyDays: 7
    }).snapshot()
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'lookupupdateasdf unique evidence'
    }).toSnapshot()
    const note = database.domain.notes.list({ type: 'thread', id: thread.id })[0]
    database.domain.richTextDocuments.save(
      { type: 'focus', id: focus.id, field: 'description' },
      'lookupfocusasdf unique description'
    )
    database.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      'lookupnoteasdf unique note'
    )
    database.mcpSettings.update({ allowMutations: true })

    const search = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'lookupfocusasdf lookupupdateasdf lookupnoteasdf',
        kinds: ['focus', 'update', 'note'],
        projection: { richText: true, richTextPurpose: 'structural-replacement' }
      }
    })
    expect(search.isError).not.toBe(true)
    const items = (search.structuredContent as {
      items: Array<Record<string, unknown>>
    }).items
    expect(items).toHaveLength(3)
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference: { type: 'focus', id: focus.id },
        editableRichText: expect.objectContaining({
          kind: 'focus-description',
          target: { type: 'focus-description', focusId: focus.id },
          markdown: 'lookupfocusasdf unique description',
          format: 'plain-text',
          revision: 1,
          writeGuide: expect.objectContaining({
            patchRichText: expect.objectContaining({ tool: 'onmove.patch_rich_text' })
          })
        })
      }),
      expect.objectContaining({
        reference: { type: 'update', id: update.id },
        editableRichText: expect.objectContaining({
          kind: 'update-observation',
          target: { type: 'update-observation', updateId: update.id },
          markdown: 'lookupupdateasdf unique evidence',
          format: 'plain-text',
          revision: 0,
          writeGuide: expect.objectContaining({
            patchRichText: expect.objectContaining({ tool: 'onmove.patch_rich_text' })
          })
        })
      }),
      expect.objectContaining({
        reference: { type: 'note', id: note.id },
        editableRichText: expect.objectContaining({
          kind: 'note-content',
          target: { type: 'note-content', noteId: note.id },
          markdown: 'lookupnoteasdf unique note',
          format: 'plain-text',
          revision: 1,
          writeGuide: expect.objectContaining({
            patchNoteText: expect.objectContaining({ tool: 'onmove.patch_note_text' })
          })
        })
      })
    ]))

    const noteHit = items.find((item) =>
      (item.reference as { type?: string } | undefined)?.type === 'note'
    ) as { editableRichText: { revision: number } }
    const patched = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: note.id,
        expectedRevision: noteHit.editableRichText.revision,
        findText: 'unique note',
        replaceText: 'edited note'
      }
    })
    expect(patched.isError).not.toBe(true)
    expect(patched.structuredContent).toMatchObject({
      note: { content: 'lookupnoteasdf edited note', revision: 2 }
    })
  })

  it('requires an explicit structural-replacement purpose before search expands rich text', async () => {
    const rejected = await client.callTool({
      name: 'onmove.search_notes',
      arguments: { text: 'launch', projection: { richText: true } }
    })
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected)).toContain('structural-replacement')

    const compact = await client.callTool({
      name: 'onmove.search_notes',
      arguments: { text: 'launch' }
    })
    expect(compact.isError).not.toBe(true)
    expect(JSON.stringify(compact.structuredContent)).not.toContain('editableRichText')
  })

  it('returns compact Markdown by ID and bounds bulk Update responses', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Compact rich-text reads',
      reviewFrequencyDays: 7
    }).snapshot()
    const note = database.domain.notes.list({ type: 'thread', id: thread.id })[0]
    const linked = {
      version: 1 as const,
      blocks: [{
        type: 'paragraph' as const,
        children: [{
          type: 'link' as const,
          url: 'https://example.com/context',
          children: [{ type: 'text' as const, text: 'linked context' }]
        }]
      }]
    }
    database.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      onMoveRichTextDocumentToStored(linked)
    )
    const updateIds = Array.from({ length: 12 }, (_, index) => database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: `bulk-${index} ${'context '.repeat(180)}`
    }).id)

    const noteRead = await client.callTool({
      name: 'onmove.get_note_by_id', arguments: { id: note.id }
    })
    expect(noteRead.structuredContent).toMatchObject({
      note: {
        content: '[linked context](https://example.com/context)',
        contentFormat: 'markdown'
      },
      diagnostics: {
        warnings: expect.arrayContaining([
          expect.stringContaining('includeRichText=true')
        ])
      }
    })
    expect((noteRead.structuredContent as { note: Record<string, unknown> }).note)
      .not.toHaveProperty('richText')

    const bulk = await client.callTool({
      name: 'onmove.get_updates_by_ids',
      arguments: { ids: updateIds, maxBytes: 4_096 }
    })
    expect(bulk.isError).not.toBe(true)
    expect(bulk.structuredContent).toMatchObject({
      hasMore: true,
      omittedIds: expect.any(Array),
      budget: { maxBytes: 4_096 }
    })
    const structured = bulk.structuredContent as {
      items: Array<{ update: Record<string, unknown> }>
      omittedIds: number[]
    }
    expect(structured.omittedIds.length).toBeGreaterThan(0)
    expect(structured.items.every(({ update }) => !('observationRichText' in update))).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(bulk.structuredContent), 'utf8')).toBeLessThanOrEqual(4_096)
  })

  it('resolves Team → 1:1 → Person Y and supplies an executable subject Todo request', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const team = database.domain.threads.create({
      focusId: focus.id,
      title: 'Leadership Team',
      reviewFrequencyDays: 7
    }).snapshot()
    const oneToOne = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: team.id },
      title: '1:1'
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(team.id, { name: 'Person Y' })
    const person = scope.subjects[0]
    database.mcpSettings.update({ allowMutations: true })

    const resolved = await client.callTool({
      name: 'onmove.resolve_work_target',
      arguments: {
        thread: { title: 'leadership team' },
        commitment: { title: '1:1' },
        subject: { name: 'person y' }
      }
    })
    expect(resolved.isError).not.toBe(true)
    expect(resolved.structuredContent).toMatchObject({
      status: 'resolved',
      target: {
        parent: { type: 'commitment', id: oneToOne.id },
        hierarchy: {
          focus: { id: focus.id, title: 'Launch readiness' },
          thread: { id: team.id, title: 'Leadership Team' },
          commitment: { id: oneToOne.id, title: '1:1' }
        },
        subject: { id: person.id, name: 'Person Y' },
        writeGuide: {
          createTodo: {
            allowedAttributions: ['subject', 'all-subjects'],
            allowedSubjects: [{ id: person.id, name: 'Person Y' }]
          }
        },
        recommendedTodoRequest: {
          tool: 'onmove.create_todo',
          arguments: {
            parent: { type: 'commitment', id: oneToOne.id },
            attribution: { mode: 'subject', subjectId: person.id }
          }
        }
      },
      candidates: [expect.objectContaining({
        parent: { type: 'commitment', id: oneToOne.id }
      })],
      diagnostics: {
        resolutionStatus: 'resolved',
        candidateCount: 1,
        warnings: []
      }
    })

    const recommendation = resolved.structuredContent as {
      target: {
        recommendedTodoRequest: {
          tool: string
          arguments: Record<string, unknown>
        }
      }
    }
    const created = await client.callTool({
      name: recommendation.target.recommendedTodoRequest.tool,
      arguments: {
        ...recommendation.target.recommendedTodoRequest.arguments,
        name: 'Do X'
      }
    })
    expect(created.isError).not.toBe(true)
    expect(created.structuredContent).toMatchObject({
      name: 'Do X',
      parent: {
        type: 'commitment-scope',
        id: oneToOne.id,
        scope: { scopeId: scope.scopeId, subjectId: person.id }
      },
      subject: { id: person.id, name: 'Person Y' }
    })
  })

  it('returns hierarchy ambiguity instead of guessing between duplicate Team and 1:1 names', async () => {
    const firstFocus = database.domain.focuses.requireModel(1).toSnapshot()
    const secondFocus = database.domain.focuses.create({ title: 'Other portfolio' }).toSnapshot()
    for (const focus of [firstFocus, secondFocus]) {
      const thread = database.domain.threads.create({
        focusId: focus.id,
        title: 'Team',
        reviewFrequencyDays: 7
      }).snapshot()
      database.domain.commitments.create({
        type: 'tracking', parent: { type: 'thread', id: thread.id }, title: '1:1'
      })
    }

    const ambiguous = await client.callTool({
      name: 'onmove.resolve_work_target',
      arguments: { thread: { title: 'Team' }, commitment: { title: '1:1' } }
    })
    expect(ambiguous.structuredContent).toMatchObject({
      status: 'ambiguous',
      target: null,
      candidates: [
        expect.objectContaining({
          hierarchy: expect.objectContaining({
            focus: expect.objectContaining({ id: firstFocus.id })
          })
        }),
        expect.objectContaining({
          hierarchy: expect.objectContaining({
            focus: expect.objectContaining({ id: secondFocus.id })
          })
        })
      ],
      diagnostics: {
        resolutionStatus: 'ambiguous',
        candidateCount: 2,
        warnings: [expect.stringContaining('Focus selector or use an ID')]
      }
    })
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

  it('supports named Focus, Thread, and Subject scopes and explains narrow empty results', async () => {
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

    const threadSearch = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'namedscopeasdfasdf',
        scope: { mode: 'thread', threadId: secondThread.id }
      }
    })
    expect(threadSearch.structuredContent).toMatchObject({
      items: [expect.objectContaining({ reference: { type: 'update', id: secondUpdate.id } })],
      diagnostics: {
        appliedScope: { mode: 'thread', threadId: secondThread.id },
        resultCount: 1
      }
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
        warnings: [expect.stringContaining('Retain the named boundary')]
      }
    })
    expect(JSON.stringify(narrowEmpty.content)).toContain('adjust only the intended date or kind filter')
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
      arguments: { text: 'getthreadasdfasdf', projection: { hierarchy: true } }
    })
    const structured = search.structuredContent as {
      items: Array<{ hierarchy: { thread: { id: number } | null } }>
    }
    const owningThreadId = structured.items[0].hierarchy.thread?.id
    expect(owningThreadId).toBe(thread.id)

    const context = await client.callTool({
      name: 'onmove.get_thread_by_id',
      arguments: { id: owningThreadId }
    })
    expect(context.structuredContent).toMatchObject({
      reference: { type: 'thread', id: thread.id },
      updates: [expect.objectContaining({ id: update.id, observation: expect.stringContaining('getthreadasdfasdf') })],
      diagnostics: { appliedScope: { mode: 'all', focusId: null, subjectId: null } }
    })
  })

  it('reads and safely updates a rich-text Note while returning structured stale-write recovery', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Note owner',
      reviewFrequencyDays: 7
    }).snapshot()
    const note = database.domain.notes.list({ type: 'thread', id: thread.id })[0]
    database.mcpSettings.update({ allowMutations: true })

    const read = await client.callTool({
      name: 'onmove.get_note_by_id', arguments: { id: note.id, includeRichText: true }
    })
    expect(read.isError).not.toBe(true)
    expect(read.structuredContent).toMatchObject({
      reference: { type: 'note', id: note.id },
      contextPath: [
        { type: 'focus', id: focus.id, title: 'Launch readiness' },
        { type: 'thread', id: thread.id, title: 'Note owner' }
      ],
      note: {
        id: note.id,
        title: 'Default',
        content: '',
        revision: note.revision,
        richText: { version: 1, blocks: [] }
      },
      writeGuide: {
        updateNote: {
          tool: 'onmove.update_note',
          noteId: note.id,
          expectedRevision: note.revision,
          requestExample: {
            id: note.id,
            expectedRevision: note.revision,
            richText: { version: 1, blocks: expect.any(Array) }
          }
        }
      }
    })

    const updated = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{
              type: 'text',
              text: 'Updated live through MCP',
              marks: ['italic', 'highlight-yellow']
            }]
          }]
        }
      }
    })
    expect(updated.isError).not.toBe(true)
    expect(updated.structuredContent).toMatchObject({
      reference: { type: 'note', id: note.id },
      note: {
        content: '*<mark>Updated live through MCP</mark>*',
        contentFormat: 'markdown',
        revision: note.revision + 1,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{
              type: 'text',
              text: 'Updated live through MCP',
              marks: ['italic', 'highlight']
            }]
          }]
        }
      }
    })

    const missingRichText = await client.callTool({
      name: 'onmove.update_note',
      arguments: { id: note.id, expectedRevision: note.revision + 1 }
    })
    expect(missingRichText.isError).toBe(true)
    expect(missingRichText.structuredContent).toMatchObject({
      error: {
        code: 'missing_rich_text',
        tool: 'onmove.update_note',
        field: 'richText',
        message: expect.stringContaining('Copy note.richText')
      },
      recovery: {
        preferredField: 'richText',
        supportedMarks: ['bold', 'italic', 'underline', 'strikethrough', 'highlight'],
        acceptedMarkAliases: { 'highlight-yellow': 'highlight' }
      }
    })
    expect(JSON.stringify(missingRichText.content)).toContain('highlight-yellow')

    const unsupportedMark = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{ type: 'text', text: 'Bad mark', marks: ['highlight-blue'] }]
          }]
        }
      }
    })
    expect(unsupportedMark.isError).toBe(true)
    expect(unsupportedMark.structuredContent).toMatchObject({
      error: {
        code: 'invalid_rich_text',
        field: 'richText',
        message: expect.stringContaining('marks must use bold, italic, underline')
      }
    })
    expect(JSON.stringify(unsupportedMark.content)).toContain('highlight-yellow')

    const stale = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision,
        richText: richText('This must not overwrite the newer value')
      }
    })
    expect(stale.isError).toBe(true)
    expect(stale.structuredContent).toMatchObject({
      error: {
        code: 'note_revision_conflict',
        noteId: note.id,
        expectedRevision: note.revision,
        currentRevision: note.revision + 1
      },
      recovery: {
        inspect: {
          tool: 'onmove.get_note_by_id',
          arguments: { id: note.id, includeRichText: true }
        },
        retry: null
      }
    })
    expect(JSON.stringify(stale.content)).toContain('Read the Note again')
    expect(database.domain.notes.find(note.id)?.content).toContain('Updated live through MCP')
  })

  it('resolves and patches a Note in two semantic calls while preserving its formatting', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const note = database.domain.notes.list({ type: 'focus', id: focus.id })[0]
    database.mcpSettings.update({ allowMutations: true })
    database.commands.updateNote({
      id: note.id,
      expectedRevision: note.revision,
      document: {
        version: 1,
        blocks: [{
          type: 'paragraph',
          children: [{
            type: 'text',
            text: 'hello world',
            marks: ['bold'],
            color: 'blue'
          }]
        }]
      }
    }, database.mcpSettings.accessPolicy())

    const resolved = await client.callTool({
      name: 'onmove.get_note_by_path',
      arguments: {
        focusTitle: 'launch readiness',
        noteTitle: 'default',
        includeRichText: true
      }
    })
    expect(resolved.isError).not.toBe(true)
    expect(resolved.structuredContent).toMatchObject({
      status: 'resolved',
      target: {
        reference: { type: 'note', id: note.id },
        contextPath: [{ type: 'focus', id: focus.id, title: 'Launch readiness' }],
        note: {
          content: '**<span style="color: blue">hello world</span>**',
          contentFormat: 'markdown',
          revision: note.revision + 1,
          richText: { blocks: [{ children: [{ marks: ['bold'], color: 'blue' }] }] }
        },
        writeGuide: {
          patchNoteText: {
            tool: 'onmove.patch_note_text',
            noteId: note.id,
            expectedRevision: note.revision + 1
          },
          updateNote: { tool: 'onmove.update_note' }
        }
      },
      diagnostics: { resolutionStatus: 'resolved', candidateCount: 1 }
    })

    const patched = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        findText: 'hello world',
        replaceText: 'hi there',
        addMarks: ['italic']
      }
    })
    expect(patched.isError).not.toBe(true)
    expect(patched.structuredContent).toMatchObject({
      note: {
        content: '***<span style="color: blue">hi there</span>***',
        contentFormat: 'markdown',
        revision: note.revision + 2,
        richText: {
          blocks: [{
            children: [{
              type: 'text',
              text: 'hi there',
              marks: ['bold', 'italic'],
              color: 'blue'
            }]
          }]
        }
      }
    })
  })

  it('reads and semantically edits Focus descriptions and Update observations', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Rich-text owner',
      reviewFrequencyDays: 7
    }).snapshot()
    database.mcpSettings.update({ allowMutations: true })
    database.commands.updateRichText({
      reference: { type: 'focus', id: focus.id, field: 'description' },
      expectedRevision: 0,
      document: {
        version: 1,
        blocks: [{
          type: 'paragraph',
          children: [{ type: 'text', text: 'hello world', marks: ['bold'], color: 'blue' }]
        }]
      }
    }, database.mcpSettings.accessPolicy())

    const focusRead = await client.callTool({
      name: 'onmove.get_focus_by_id',
      arguments: { id: focus.id, includeRichText: true }
    })
    expect(focusRead.structuredContent).toMatchObject({
      entity: {
        description: '**<span style="color: blue">hello world</span>**',
        descriptionFormat: 'markdown',
        descriptionRevision: 1,
        descriptionRichText: {
          blocks: [{ children: [{ text: 'hello world', marks: ['bold'], color: 'blue' }] }]
        },
        descriptionWriteGuide: {
          patchRichText: {
            tool: 'onmove.patch_rich_text',
            target: { type: 'focus-description', focusId: focus.id },
            expectedRevision: 1
          },
          updateRichText: { tool: 'onmove.update_rich_text' }
        }
      }
    })

    const focusPatched = await client.callTool({
      name: 'onmove.patch_rich_text',
      arguments: {
        target: { type: 'focus-description', focusId: focus.id },
        expectedRevision: 1,
        findText: 'hello world',
        replaceText: 'hi there',
        addMarks: ['italic']
      }
    })
    expect(focusPatched.isError).not.toBe(true)
    expect(focusPatched.structuredContent).toMatchObject({
      entity: {
        description: '***<span style="color: blue">hi there</span>***',
        descriptionFormat: 'markdown',
        descriptionRevision: 2,
        descriptionRichText: {
          blocks: [{ children: [{
            text: 'hi there', marks: ['bold', 'italic'], color: 'blue'
          }] }]
        },
        descriptionWriteGuide: {
          patchRichText: { expectedRevision: 2 }
        }
      }
    })

    const created = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'unscoped' },
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{ type: 'text', text: 'Risk is high', marks: ['bold'], color: 'red' }]
          }]
        }
      }
    })
    const updateId = Number((created.structuredContent as { id: number }).id)
    expect(created.structuredContent).toMatchObject({
      id: updateId,
      observationRevision: 0,
      observationWriteGuide: {
        patchRichText: {
          tool: 'onmove.patch_rich_text',
          target: { type: 'update-observation', updateId },
          expectedRevision: 0
        }
      }
    })

    const threadRead = await client.callTool({
      name: 'onmove.get_thread_by_id', arguments: { id: thread.id, includeRichText: true }
    })
    expect(threadRead.structuredContent).toMatchObject({
      updates: [{
        id: updateId,
        observationWriteGuide: {
          patchRichText: { target: { type: 'update-observation', updateId } }
        }
      }]
    })
    const updateRead = await client.callTool({
      name: 'onmove.get_update_by_id', arguments: { id: updateId }
    })
    expect(updateRead.structuredContent).toMatchObject({
      reference: { type: 'update', id: updateId },
      contextPath: [
        { type: 'focus', id: focus.id, title: 'Launch readiness' },
        { type: 'thread', id: thread.id, title: 'Rich-text owner' }
      ],
      update: {
        observation: '**<span style="color: red">Risk is high</span>**',
        observationFormat: 'markdown',
        observationRevision: 0,
        observationWriteGuide: {
          updateRichText: { tool: 'onmove.update_rich_text' }
        }
      }
    })

    const updatePatched = await client.callTool({
      name: 'onmove.patch_rich_text',
      arguments: {
        target: { type: 'update-observation', updateId },
        expectedRevision: 0,
        findText: 'high',
        replaceText: 'contained',
        addMarks: ['italic']
      }
    })
    expect(updatePatched.structuredContent).toMatchObject({
      update: {
        observation: '**<span style="color: red">Risk is </span>**' +
          '***<span style="color: red">contained</span>***',
        observationFormat: 'markdown',
        observationRevision: 1,
        observationRichText: {
          blocks: [{ children: [
            expect.objectContaining({ text: 'Risk is ' }),
            expect.objectContaining({
              text: 'contained', marks: ['bold', 'italic'], color: 'red'
            })
          ] }]
        }
      }
    })

    const stale = await client.callTool({
      name: 'onmove.patch_rich_text',
      arguments: {
        target: { type: 'update-observation', updateId },
        expectedRevision: 0,
        findText: 'Risk',
        replaceText: 'Delivery risk'
      }
    })
    expect(stale.isError).toBe(true)
    expect(stale.structuredContent).toMatchObject({
      error: {
        code: 'rich_text_revision_conflict',
        target: { type: 'update-observation', updateId },
        expectedRevision: 0,
        currentRevision: 1
      },
      recovery: {
        inspect: {
          tool: 'onmove.get_update_by_id',
          arguments: { id: updateId, includeRichText: true }
        }
      }
    })

    const accidentalClear = await client.callTool({
      name: 'onmove.update_rich_text',
      arguments: {
        target: { type: 'update-observation', updateId },
        expectedRevision: 1,
        richText: {
          version: 1,
          blocks: [{ type: 'paragraph', children: [{ type: 'line-break' }] }]
        }
      }
    })
    expect(accidentalClear.isError).toBe(true)
    expect(accidentalClear.structuredContent).toMatchObject({
      error: {
        code: 'RICH_TEXT_DISAPPEARED',
        target: { type: 'update-observation', updateId }
      },
      recovery: {
        inspect: {
          tool: 'onmove.get_update_by_id',
          arguments: { id: updateId, includeRichText: true }
        },
        retry: {
          tool: 'onmove.update_rich_text',
          arguments: { clear: true }
        }
      }
    })
  })

  it('returns full Focus Notes only on request and guards every accidental clear path', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const note = database.domain.notes.list({ type: 'focus', id: focus.id })[0]
    database.mcpSettings.update({ allowMutations: true })
    database.commands.updateNote({
      id: note.id,
      expectedRevision: note.revision,
      document: richText('Keep this text')
    }, database.mcpSettings.accessPolicy())

    const compact = await client.callTool({
      name: 'onmove.get_focus_by_id', arguments: { id: focus.id }
    })
    const compactNotes = (compact.structuredContent as { notes: Array<Record<string, unknown>> }).notes
    expect(compactNotes[0]).not.toHaveProperty('richText')
    expect(compactNotes[0]).not.toHaveProperty('writeGuide')

    const complete = await client.callTool({
      name: 'onmove.get_focus_by_id',
      arguments: { id: focus.id, includeRichText: true }
    })
    expect(complete.structuredContent).toMatchObject({
      notes: [{
        id: note.id,
        revision: note.revision + 1,
        richText: richText('Keep this text'),
        writeGuide: {
          patchNoteText: { tool: 'onmove.patch_note_text' },
          updateNote: { tool: 'onmove.update_note' }
        }
      }]
    })

    const structuralClear = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{ type: 'line-break' }]
          }]
        }
      }
    })
    expect(structuralClear.isError).toBe(true)
    expect(structuralClear.structuredContent).toMatchObject({
      error: { code: 'NOTE_TEXT_DISAPPEARED', noteId: note.id },
      recovery: {
        instruction: expect.stringContaining('clear=true'),
        retry: {
          tool: 'onmove.update_note',
          arguments: { id: note.id, clear: true }
        }
      }
    })
    expect(database.domain.notes.find(note.id)?.revision).toBe(note.revision + 1)

    const patchClear = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        findText: 'Keep this text',
        replaceText: ''
      }
    })
    expect(patchClear.isError).toBe(true)
    expect(patchClear.structuredContent).toMatchObject({
      error: { code: 'NOTE_TEXT_DISAPPEARED', noteId: note.id }
    })
    expect(database.domain.notes.find(note.id)?.revision).toBe(note.revision + 1)

    const intentional = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        findText: 'Keep this text',
        replaceText: '',
        clear: true
      }
    })
    expect(intentional.isError).not.toBe(true)
    expect(intentional.structuredContent).toMatchObject({
      note: { content: '', revision: note.revision + 2, richText: { blocks: [] } }
    })
  })

  it('makes duplicate semantic Note patches recoverable without guessing', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const note = database.domain.notes.list({ type: 'focus', id: focus.id })[0]
    database.mcpSettings.update({ allowMutations: true })
    database.commands.updateNote({
      id: note.id,
      expectedRevision: note.revision,
      document: richText('hello world and hello world')
    }, database.mcpSettings.accessPolicy())

    const ambiguous = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        findText: 'hello world',
        replaceText: 'hi there'
      }
    })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.structuredContent).toMatchObject({
      error: { code: 'NOTE_TEXT_AMBIGUOUS', matchCount: 2 },
      recovery: { instruction: expect.stringContaining('1 through 2') }
    })
    expect(database.domain.notes.find(note.id)?.revision).toBe(note.revision + 1)

    const selected = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: note.id,
        expectedRevision: note.revision + 1,
        findText: 'hello world',
        replaceText: 'hi there',
        occurrence: 2
      }
    })
    expect(selected.isError).not.toBe(true)
    expect(selected.structuredContent).toMatchObject({
      note: { content: 'hello world and hi there' }
    })
  })

  it('advertises a structured Note document and rejects unsafe rich-text input', async () => {
    const tools = (await client.listTools()).tools
    const updateNote = tools.find(({ name }) => name === 'onmove.update_note')!
    const patchNote = tools.find(({ name }) => name === 'onmove.patch_note_text')!
    const resolveNote = tools.find(({ name }) => name === 'onmove.get_note_by_path')!
    const schema = JSON.stringify(updateNote.inputSchema)
    expect(schema).toContain('bullet-list')
    expect(schema).toContain('checklist')
    expect(schema).toContain('strikethrough')
    expect(schema).toContain('rich-text')
    expect(schema).toContain('Example text run')
    expect(schema).toContain('structural soft line break')
    expect(schema).toContain('oneOf')
    expect(schema).toContain('"additionalProperties":false')
    const properties = (updateNote.inputSchema as { properties?: Record<string, unknown> }).properties
    expect(properties).toHaveProperty('richText')
    expect(properties).not.toHaveProperty('document')
    expect(properties).not.toHaveProperty('content')
    expect(JSON.stringify(patchNote.inputSchema)).toContain('NOTE_TEXT_AMBIGUOUS')
    expect(JSON.stringify(patchNote.inputSchema)).toContain('clear')
    expect(JSON.stringify(resolveNote.inputSchema)).toContain('Defaults to false')

    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const note = database.domain.notes.list({ type: 'focus', id: focus.id })[0]
    database.mcpSettings.update({ allowMutations: true })
    const removedAlias = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision,
        document: richText('The removed alias must not write')
      }
    })
    expect(removedAlias.isError).toBe(true)
    expect(database.domain.notes.find(note.id)?.content).toBe('')
    expect(database.domain.notes.find(note.id)?.revision).toBe(note.revision)

    const rejected = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{
              type: 'link',
              url: 'javascript:alert(1)',
              children: [{ type: 'text', text: 'unsafe' }]
            }]
          }]
        }
      }
    })
    expect(rejected.isError).toBe(true)
    expect(database.domain.notes.find(note.id)?.content).toBe('')
    expect(database.domain.notes.find(note.id)?.revision).toBe(note.revision)
  })

  it('creates Update observations as lossless rich text and rejects the flattening string API', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Rich evidence owner',
      reviewFrequencyDays: 7
    }).snapshot()
    const document: OnMoveRichTextDocument = {
      version: 1,
      blocks: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Delivery evidence', marks: ['bold'], color: 'green' },
            { type: 'text', text: ' in the ' },
            {
              type: 'link',
              url: 'https://example.com/review',
              children: [{ type: 'text', text: 'review', marks: ['italic'] }]
            }
          ]
        },
        {
          type: 'quote',
          blocks: [{
            type: 'checklist',
            items: [{ content: [{ type: 'text', text: 'Confirm rollout' }], checked: true }]
          }]
        }
      ]
    }
    database.mcpSettings.update({ allowMutations: true })

    const created = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'unscoped' },
        richText: document,
        state: 'green'
      }
    })
    expect(created.isError).not.toBe(true)
    expect(created.structuredContent).toMatchObject({
      parent: { type: 'thread', id: thread.id },
      observation: expect.stringContaining('[*review*](https://example.com/review)'),
      observationFormat: 'markdown',
      observationRichText: document,
      state: 'green'
    })
    const stored = database.domain.updates.listForThread(thread.id)[0]
    expect(stored.observation).toContain('"type":"link"')
    expect(stored.observation).toContain('"listType":"check"')

    const removedAlias = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'unscoped' },
        document: richText('The removed alias must not create an Update')
      }
    })
    expect(removedAlias.isError).toBe(true)
    expect(database.domain.updates.listForThread(thread.id)).toHaveLength(1)

    const flattened = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        observation: 'This legacy string must not flatten rich text.'
      }
    })
    expect(flattened.isError).toBe(true)
    expect(database.domain.updates.listForThread(thread.id)).toHaveLength(1)
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
      name: 'onmove.get_thread_by_id',
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
            attribution: { mode: 'unscoped' },
            richText: { version: 1, blocks: expect.any(Array) }
          }
        }
      }
    })

    const rejected = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        subjectId: subject.id,
        richText: richText('Open Thread evidence'),
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
          tool: 'onmove.get_thread_by_id',
          arguments: { id: thread.id },
          path: 'writeGuide.createUpdate'
        },
        allowedSubjects: [],
        retry: {
          tool: 'onmove.create_update',
          arguments: {
            parent: { type: 'thread', id: thread.id },
            attribution: { mode: 'unscoped' },
            richText: richText('Open Thread evidence'),
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

  it('guides and recovers Todo attribution with the same receiver-owned contract', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Open Todo target',
      reviewFrequencyDays: 7
    }).snapshot()
    const unrelated = database.domain.subjects.create({ name: 'Person Y' }).toSnapshot()
    database.mcpSettings.update({ allowMutations: true })

    const context = await client.callTool({
      name: 'onmove.get_thread_by_id', arguments: { id: thread.id }
    })
    expect(context.structuredContent).toMatchObject({
      writeGuide: {
        createTodo: {
          tool: 'onmove.create_todo',
          parent: { type: 'thread', id: thread.id },
          allowedAttributions: ['unscoped'],
          allowedSubjects: [],
          requestExamples: {
            unscoped: { attribution: { mode: 'unscoped' } }
          }
        }
      }
    })

    const rejected = await client.callTool({
      name: 'onmove.create_todo',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'subject', subjectId: unrelated.id },
        name: 'Do X'
      }
    })
    expect(rejected.isError).toBe(true)
    expect(rejected.structuredContent).toMatchObject({
      error: { code: 'open_parent_cannot_target_subject' },
      recovery: {
        inspect: {
          tool: 'onmove.get_thread_by_id',
          arguments: { id: thread.id },
          path: 'writeGuide.createTodo'
        },
        allowedAttributions: ['unscoped'],
        allowedSubjects: [],
        retry: {
          tool: 'onmove.create_todo',
          arguments: {
            parent: { type: 'thread', id: thread.id },
            attribution: { mode: 'unscoped' },
            name: 'Do X'
          }
        }
      }
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
      name: 'onmove.get_thread_by_id',
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
        richText: richText('Needs exact attribution')
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
            richText: richText('Needs exact attribution')
          }
        }
      }
    })

    const created = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        attribution: { mode: 'subject', subjectId: subject.id },
        richText: richText('Subject evidence')
      }
    })
    expect(created.isError).not.toBe(true)
    expect(created.structuredContent).toMatchObject({
      scope: { scopeId: scope.scopeId, subjectId: subject.id },
      observation: 'Subject evidence',
      observationRichText: richText('Subject evidence')
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
        richText: richText('Ambiguous evidence')
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
        richText: richText('Invalidly attributed evidence')
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
        richText: richText('Nullable unscoped evidence')
      }
    })
    expect(created.isError).not.toBe(true)
    expect(created.structuredContent).toMatchObject({ scope: null })
  })

  it('returns the same not-found behavior for hidden and unknown records', async () => {
    database.domain.focuses.requireModel(1).update({ sensitive: true })
    const hidden = await client.callTool({ name: 'onmove.get_focus_by_id', arguments: { id: 1 } })
    const missing = await client.callTool({ name: 'onmove.get_focus_by_id', arguments: { id: 999 } })
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
      arguments: { parent: { type: 'thread', id: thread.id }, richText: richText('First evidence') }
    })
    expect(denied.isError).toBe(true)

    database.mcpSettings.update({ allowMutations: true })
    const allowed = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        richText: richText('First evidence'),
        state: 'green'
      }
    })
    expect(allowed.isError).not.toBe(true)
    expect(database.domain.updates.listForThread(thread.id)).toEqual([
      expect.objectContaining({ observation: expect.stringContaining('First evidence'), state: 'green' })
    ])
  })

  it('applies sparse Focus and Thread edit rules to the expanded mutation surface', async () => {
    const deniedFocus = await client.callTool({
      name: 'onmove.create_focus',
      arguments: { title: 'Agent-created Focus' }
    })
    expect(deniedFocus.isError).toBe(true)

    database.mcpSettings.update({
      permission: {
        target: { type: 'default' }, resource: 'focus', edit: true
      }
    })
    const createdFocus = await client.callTool({
      name: 'onmove.create_focus',
      arguments: {
        title: 'Agent-created Focus',
        richText: richText('Structured Focus description')
      }
    })
    expect(createdFocus.isError).not.toBe(true)
    const focus = database.domain.focuses.list().find(({ title }) => title === 'Agent-created Focus')
    expect(focus?.description).toContain('Structured Focus description')

    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: focus?.id as number },
        resource: 'thread', view: true, edit: true
      }
    })
    const createdThread = await client.callTool({
      name: 'onmove.create_thread',
      arguments: {
        focusId: focus?.id,
        title: 'Agent-created Thread',
        reviewFrequencyDays: 5
      }
    })
    expect(createdThread.isError).not.toBe(true)
    const thread = database.domain.threads.listForFocus(focus?.id as number)[0]

    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: thread.id },
        resource: 'thread', edit: false
      }
    })
    const deniedThreadEdit = await client.callTool({
      name: 'onmove.update_thread',
      arguments: { id: thread.id, title: 'Should not persist' }
    })
    expect(deniedThreadEdit.isError).toBe(true)
    expect(database.domain.threads.find(thread.id)?.title).toBe('Agent-created Thread')

    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: thread.id },
        resource: 'thread', edit: true
      }
    })
    const allowedThreadEdit = await client.callTool({
      name: 'onmove.update_thread',
      arguments: { id: thread.id, title: 'Renamed through MCP', dueDate: '2026-09-01' }
    })
    expect(allowedThreadEdit.isError).not.toBe(true)
    expect(database.domain.threads.find(thread.id)).toMatchObject({
      title: 'Renamed through MCP',
      dueDate: '2026-09-01'
    })
  })

  it('discovers Subject hierarchy paths, guards scoped intent, and repairs a misplaced Update', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const team = database.domain.threads.create({
      focusId: focus.id,
      title: 'Team management',
      reviewFrequencyDays: 7
    }).snapshot()
    const oneToOnes = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: team.id },
      title: '1:1s'
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(team.id, { name: 'Michael' })
    const michael = scope.subjects[0]
    const existingMichaelUse = database.domain.updates.create({
      parent: { type: 'commitment', id: oneToOnes.id },
      scope: { scopeId: scope.scopeId as number, subjectId: michael.id },
      observation: 'Weekly confidence improved without repeating the Subject name.'
    }).toSnapshot()
    const wrongThread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Database clarity',
      reviewFrequencyDays: 7
    }).snapshot()
    const unrelatedGenericUse = database.domain.updates.create({
      parent: { type: 'thread', id: wrongThread.id },
      observation: 'Weekly confidence belongs to an unrelated container.'
    }).toSnapshot()
    const misplaced = database.domain.updates.create({
      parent: { type: 'thread', id: wrongThread.id },
      observation: 'Preserve this rich observation while moving it.',
      state: 'yellow'
    }).toSnapshot()
    database.mcpSettings.update({ allowMutations: true })

    const discovery = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'michael',
        projection: {
          hierarchy: true,
          subjects: true,
          scopes: true
        }
      }
    })
    expect(discovery.isError).not.toBe(true)
    expect(discovery.structuredContent).toMatchObject({
      hierarchyNotation: {
        example: { thread: 'Team management', commitment: '1:1s', subject: 'Michael' },
        display: 'Team management > 1:1s[Michael]'
      },
      hierarchyPaths: expect.arrayContaining([
        expect.objectContaining({
          relativePath: 'Team management > 1:1s[Michael]',
          semanticPath: {
            focus: { id: focus.id, title: focus.title },
            thread: { id: team.id, title: 'Team management' },
            commitment: { id: oneToOnes.id, title: '1:1s' },
            subject: { id: michael.id, name: 'Michael' }
          },
          recommendedUpdateRequest: {
            tool: 'onmove.create_update',
            arguments: expect.objectContaining({
              parent: { type: 'commitment', id: oneToOnes.id },
              attribution: { mode: 'subject', subjectId: michael.id }
            })
          }
        })
      ]),
      subjectUses: expect.arrayContaining([
        expect.objectContaining({
          reference: { type: 'update', id: existingMichaelUse.id },
          matchedSubject: { id: michael.id, name: 'Michael' },
          hierarchy: expect.objectContaining({
            commitment: { id: oneToOnes.id, title: '1:1s' }
          })
        })
      ]),
      namedSubjectDiscovery: [{
        subject: { id: michael.id, name: 'Michael' },
        applicablePaths: expect.arrayContaining([
          expect.objectContaining({
            hierarchy: {
              focus: { id: focus.id, title: focus.title },
              thread: { id: team.id, title: 'Team management' },
              commitment: { id: oneToOnes.id, title: '1:1s' }
            },
            subject: { id: michael.id, name: 'Michael' }
          })
        ]),
        reviewContexts: [expect.objectContaining({
          focus: { id: focus.id, title: focus.title },
          thread: { id: team.id, title: team.title },
          reviewSubjectRequest: {
            tool: 'onmove.review_subject',
            arguments: {
              focus: { id: focus.id },
              thread: { id: team.id },
              subject: { id: michael.id }
            }
          }
        })]
      }],
      items: expect.arrayContaining([
        expect.objectContaining({
          reference: { type: 'subject', id: michael.id },
          subjectDiscovery: expect.objectContaining({
            subject: { id: michael.id, name: 'Michael' },
            reviewContexts: [expect.objectContaining({
              focus: { id: focus.id, title: focus.title },
              thread: { id: team.id, title: team.title }
            })]
          })
        })
      ]),
      searchStatus: {
        sufficient: true,
        doNotBroaden: true,
        reason: expect.stringContaining('subjectUses is authoritative'),
        nextAction: expect.stringContaining('returned record IDs')
      },
      continuationToken: null,
      diagnostics: {
        hierarchyPathCount: expect.any(Number),
        hierarchyPathTotal: expect.any(Number),
        subjectUseCount: 1
      }
    })

    const scopedFollowUp = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'weekly confidence',
        scope: { mode: 'subject', subjectId: michael.id }
      }
    })
    expect(scopedFollowUp.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'update', id: existingMichaelUse.id }
      })],
      searchStatus: { sufficient: true, doNotBroaden: true },
      diagnostics: {
        appliedScope: { mode: 'subject', subjectId: michael.id }
      }
    })
    expect((scopedFollowUp.structuredContent as {
      items: Array<{ reference: { type: string; id: number } }>
    }).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: { type: 'update', id: unrelatedGenericUse.id } })
    ]))

    const projectedHierarchy = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'michael',
        projection: { hierarchy: true, subjects: true }
      }
    })
    expect(projectedHierarchy.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'subject', id: michael.id }
      })],
      subjectUses: [expect.objectContaining({
        reference: { type: 'update', id: existingMichaelUse.id }
      })],
      hierarchyPaths: expect.arrayContaining([
        expect.objectContaining({ relativePath: 'Team management > 1:1s[Michael]' })
      ]),
      searchStatus: { sufficient: true, doNotBroaden: true },
      diagnostics: { subjectUseCount: 1 }
    })

    const subjectListing = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: null,
        scope: { mode: 'subject', subjectId: michael.id },
        projection: { hierarchy: true, subjects: true }
      }
    })
    expect(subjectListing.isError).not.toBe(true)
    expect(subjectListing.structuredContent).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ reference: { type: 'subject', id: michael.id } })
      ]),
      hierarchyPaths: expect.arrayContaining([
        expect.objectContaining({ relativePath: 'Team management > 1:1s[Michael]' })
      ]),
      diagnostics: {
        appliedScope: { mode: 'subject', subjectId: michael.id }
      }
    })

    const semanticPath = {
      focus: { id: focus.id, title: focus.title },
      thread: { id: team.id, title: team.title },
      commitment: { id: oneToOnes.id, title: oneToOnes.title },
      subject: { id: michael.id, name: michael.name }
    }
    const flattened = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'commitment', id: oneToOnes.id },
        attribution: { mode: 'unscoped' },
        semanticPath,
        richText: richText('This must not flatten Michael out of the path.')
      }
    })
    expect(flattened.isError).toBe(true)
    expect(flattened.structuredContent).toMatchObject({
      error: { code: 'semantic_path_requires_subject_attribution' },
      recovery: {
        retry: {
          tool: 'onmove.create_update',
          arguments: {
            parent: { type: 'commitment', id: oneToOnes.id },
            attribution: { mode: 'subject', subjectId: michael.id },
            semanticPath
          }
        }
      }
    })
    const unsafe = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: wrongThread.id },
        attribution: { mode: 'unscoped' },
        semanticPath,
        richText: richText('This must not land on the wrong parent.')
      }
    })
    expect(unsafe.isError).toBe(true)
    expect(unsafe.structuredContent).toMatchObject({
      error: { code: 'semantic_path_parent_mismatch' },
      recovery: {
        retry: {
          tool: 'onmove.create_update',
          arguments: {
            parent: { type: 'commitment', id: oneToOnes.id },
            attribution: { mode: 'subject', subjectId: michael.id },
            semanticPath
          }
        }
      }
    })
    expect(database.domain.updates.listForThread(wrongThread.id)).toHaveLength(2)

    const repaired = await client.callTool({
      name: 'onmove.reparent_update',
      arguments: {
        id: misplaced.id,
        destination: {
          parent: { type: 'commitment', id: oneToOnes.id },
          attribution: { mode: 'subject', subjectId: michael.id },
          semanticPath
        }
      }
    })
    expect(repaired.isError).not.toBe(true)
    expect(repaired.structuredContent).toMatchObject({
      contextPath: [
        { type: 'focus', id: focus.id, title: focus.title },
        { type: 'thread', id: team.id, title: team.title },
        { type: 'commitment', id: oneToOnes.id, title: oneToOnes.title }
      ],
      update: {
        id: misplaced.id,
        date: misplaced.date,
        observation: 'Preserve this rich observation while moving it.',
        observationRevision: 0,
        state: 'yellow',
        parent: { type: 'commitment', id: oneToOnes.id },
        scope: { scopeId: scope.scopeId, subjectId: michael.id }
      },
      reparenting: {
        previous: {
          parent: { type: 'thread', id: wrongThread.id },
          subjectId: null
        },
        undo: { tool: 'onmove.reparent_update' }
      }
    })
    expect(database.domain.updates.listForThread(wrongThread.id)).toEqual([
      expect.objectContaining({ id: unrelatedGenericUse.id })
    ])
    expect(database.domain.updates.listForCommitment(oneToOnes.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: misplaced.id, state: 'yellow' })
    ]))
    const undo = (repaired.structuredContent as {
      reparenting: { undo: { tool: string; arguments: Record<string, unknown> } }
    }).reparenting.undo
    const undone = await client.callTool({ name: undo.tool, arguments: undo.arguments })
    expect(undone.isError).not.toBe(true)
    expect(undone.structuredContent).toMatchObject({
      update: {
        id: misplaced.id,
        parent: { type: 'thread', id: wrongThread.id },
        scope: null,
        observation: 'Preserve this rich observation while moving it.',
        observationRevision: 0
      }
    })
  })

  it('reviews one Subject in one Thread without chaining broad searches', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'People leadership',
      reviewFrequencyDays: 7
    }).snapshot()
    const oneToOnes = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: '1:1s'
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(
      thread.id,
      { name: 'Michael' },
      new Date('2026-08-20T09:00:00.000Z')
    )
    const michael = scope.subjects[0]
    const directUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      scope: { scopeId: scope.scopeId as number, subjectId: michael.id },
      observation: 'Earlier leadership observation.'
    }, new Date('2026-08-20T10:00:00.000Z')).toSnapshot()
    const commitmentUpdate = database.domain.updates.create({
      parent: { type: 'commitment', id: oneToOnes.id },
      scope: { scopeId: scope.scopeId as number, subjectId: michael.id },
      observation: 'Latest one to one observation.',
      state: 'green'
    }, new Date('2026-08-20T11:00:00.000Z')).toSnapshot()
    const todo = database.domain.todos.create({
      name: 'Prepare next coaching question',
      parent: {
        type: 'commitment-scope',
        id: oneToOnes.id,
        scope: { scopeId: scope.scopeId as number, subjectId: michael.id }
      }
    }).toSnapshot()
    database.domain.todos.create({
      name: 'Already handled',
      done: true,
      parent: {
        type: 'thread-scope',
        id: thread.id,
        scope: { scopeId: scope.scopeId as number, subjectId: michael.id }
      }
    })

    const reviewed = await client.callTool({
      name: 'onmove.review_subject',
      arguments: {
        focus: { id: focus.id },
        thread: { title: 'People leadership' },
        subject: { name: 'Michael' }
      }
    })
    expect(reviewed.isError).not.toBe(true)
    expect(reviewed.structuredContent).toMatchObject({
      status: 'resolved',
      review: {
        subject: { id: michael.id, name: 'Michael' },
        hierarchy: {
          focus: { id: focus.id, title: focus.title },
          thread: { id: thread.id, title: thread.title }
        },
        displayPath: `${focus.title} > ${thread.title}[Michael]`,
        updates: [
          expect.objectContaining({
            id: commitmentUpdate.id,
            displayPath: 'People leadership > 1:1s[Michael]',
            snippet: 'Latest one to one observation.'
          }),
          expect.objectContaining({
            id: directUpdate.id,
            displayPath: 'People leadership[Michael]'
          })
        ],
        openTodos: [expect.objectContaining({
          id: todo.id,
          name: 'Prepare next coaching question'
        })],
        openCommitments: [expect.objectContaining({
          id: oneToOnes.id,
          title: '1:1s',
          status: 'active',
          state: 'green'
        })]
      },
      searchStatus: {
        sufficient: true,
        doNotBroaden: true,
        nextAction: expect.stringContaining('Stop discovery')
      },
      continuationToken: expect.any(String),
      diagnostics: { resolutionStatus: 'resolved', candidateCount: 1 }
    })

    const continuationToken = (reviewed.structuredContent as {
      continuationToken: string
    }).continuationToken
    const followUp = await client.callTool({
      name: 'onmove.search',
      arguments: { continuationToken }
    })
    expect(followUp.structuredContent).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ reference: { type: 'update', id: commitmentUpdate.id } }),
        expect.objectContaining({ reference: { type: 'update', id: directUpdate.id } })
      ]),
      diagnostics: {
        appliedScope: {
          mode: 'subject',
          threadId: thread.id,
          subjectId: michael.id
        }
      }
    })
  })

  it('returns safe Thread title candidates for shorthand review queries without guessing', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Foobar / Xs!',
      reviewFrequencyDays: 7
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'Michael' })
    const michael = scope.subjects[0]

    const discovery = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'my Xs', projection: { hierarchy: true } }
    })
    expect(discovery.isError).not.toBe(true)
    expect(discovery.structuredContent).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          reference: { type: 'thread', id: thread.id },
          title: 'Foobar / Xs!'
        })
      ])
    })

    const targetSuggestion = await client.callTool({
      name: 'onmove.resolve_work_target',
      arguments: { thread: { title: 'my Xs' } }
    })
    expect(targetSuggestion.isError).not.toBe(true)
    expect(targetSuggestion.structuredContent).toMatchObject({
      status: 'not_found',
      target: null,
      threadCandidates: [expect.objectContaining({
        hierarchy: {
          focus: { id: focus.id, title: focus.title },
          thread: { id: thread.id, title: thread.title }
        },
        retrySelectors: {
          focus: { id: focus.id },
          thread: { id: thread.id }
        }
      })],
      diagnostics: {
        warnings: [expect.stringContaining('No exact Thread title matched')]
      }
    })

    const shorthand = await client.callTool({
      name: 'onmove.review_subject',
      arguments: {
        thread: { title: 'my Xs' },
        subject: { name: 'Michael' }
      }
    })
    expect(shorthand.isError).not.toBe(true)
    expect(shorthand.structuredContent).toMatchObject({
      status: 'not_found',
      review: null,
      candidates: [],
      threadCandidates: [expect.objectContaining({
        hierarchy: {
          focus: { id: focus.id, title: focus.title },
          thread: { id: thread.id, title: 'Foobar / Xs!' }
        },
        applicableSubjects: [{ id: michael.id, name: 'Michael' }],
        recommendedReviewRequest: {
          tool: 'onmove.review_subject',
          arguments: {
            focus: { id: focus.id },
            thread: { id: thread.id },
            subject: { id: michael.id }
          }
        }
      })],
      diagnostics: {
        warnings: [expect.stringContaining('No exact Thread title matched')]
      }
    })

    const exactRetry = await client.callTool({
      name: 'onmove.review_subject',
      arguments: {
        focus: { id: focus.id },
        thread: { id: thread.id },
        subject: { id: michael.id }
      }
    })
    expect(exactRetry.structuredContent).toMatchObject({
      status: 'resolved',
      review: {
        subject: { id: michael.id, name: 'Michael' },
        hierarchy: {
          focus: { id: focus.id, title: focus.title },
          thread: { id: thread.id, title: thread.title }
        }
      }
    })
  })

  it('lists records querylessly for one semantic calendar date without using FTS', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Calendar evidence',
      reviewFrequencyDays: 7
    }).snapshot()
    const included = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-20',
      observation: 'Included without a text query'
    }, new Date('2026-08-20T16:00:00.000Z')).toSnapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-19',
      observation: 'Different semantic date'
    }, new Date('2026-08-19T16:00:00.000Z'))

    const listed = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: null,
        kinds: ['update'],
        date: { from: '2026-08-20', to: '2026-08-20' }
      }
    })

    expect(listed.isError).not.toBe(true)
    expect(listed.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'update', id: included.id },
        date: '2026-08-20',
        createdAt: '2026-08-20T16:00:00.000Z',
        updatedAt: '2026-08-20T16:00:00.000Z'
      })],
      hasMore: false,
      appliedQuery: {
        text: null,
        kinds: ['update'],
        date: { from: '2026-08-20', to: '2026-08-20' }
      }
    })
  })

  it('keeps semantic date, createdAt, and updatedAt as independent predicates', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Timestamp distinctions',
      reviewFrequencyDays: 7
    }).snapshot()
    const changed = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2030-01-03',
      observation: 'Changed later'
    }, new Date('2026-08-18T10:00:00.000Z')).toSnapshot()
    const untouched = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2030-01-04',
      observation: 'Not changed later'
    }, new Date('2026-08-18T11:00:00.000Z')).toSnapshot()
    database.domain.richTextDocuments.save(
      { type: 'update', id: changed.id, field: 'observation' },
      'Changed on a later day',
      new Date('2026-08-20T12:00:00.000Z')
    )

    const created = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: null,
        kinds: ['update'],
        createdAt: { from: '2026-08-18', to: '2026-08-18' },
        timeZone: 'UTC',
        sort: { field: 'createdAt', direction: 'asc' }
      }
    })
    expect((created.structuredContent as {
      items: Array<{ reference: { id: number } }>
    }).items.map(({ reference }) => reference.id)).toEqual([changed.id, untouched.id])

    const updated = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: null,
        kinds: ['update'],
        updatedAt: { from: '2026-08-20', to: '2026-08-20' },
        timeZone: 'UTC'
      }
    })
    expect(updated.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'update', id: changed.id },
        date: '2030-01-03',
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-20T12:00:00.000Z'
      })]
    })
  })

  it('applies IANA local-calendar boundaries around UTC midnight', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Timezone boundary',
      reviewFrequencyDays: 7
    }).snapshot()
    const lateChicago = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-21',
      observation: 'Still August twentieth in Chicago'
    }, new Date('2026-08-21T04:30:00.000Z')).toSnapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-21',
      observation: 'Now August twenty first in Chicago'
    }, new Date('2026-08-21T05:30:00.000Z'))

    const localDay = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: null,
        kinds: ['update'],
        createdAt: { from: '2026-08-20', to: '2026-08-20' },
        timeZone: 'America/Chicago'
      }
    })
    expect(localDay.isError).not.toBe(true)
    expect((localDay.structuredContent as {
      items: Array<{ reference: { id: number } }>
    }).items.map(({ reference }) => reference.id)).toEqual([lateChicago.id])
  })

  it('paginates with a stable signed cursor and never repeats a record ID', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Cursor owner',
      reviewFrequencyDays: 7
    }).snapshot()
    const expectedIds = Array.from({ length: 7 }, (_, index) =>
      database.domain.updates.create({
        parent: { type: 'thread', id: thread.id },
        date: '2026-08-20',
        observation: `Cursor record ${index}`
      }, new Date('2026-08-20T12:00:00.000Z')).id)

    const seen: number[] = []
    let response = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: null,
        kinds: ['update'],
        scope: { mode: 'thread', threadId: thread.id },
        date: { from: '2026-08-20', to: '2026-08-20' },
        createdAt: { from: '2026-08-20', to: '2026-08-20' },
        timeZone: 'UTC',
        sort: { field: 'createdAt', direction: 'asc' },
        projection: { hierarchy: true },
        page: { size: 2, maxBytes: 8192 }
      }
    })
    for (;;) {
      expect(response.isError).not.toBe(true)
      const page = response.structuredContent as {
        items: Array<{ reference: { id: number } }>
        hasMore: boolean
        continuationToken: string | null
        appliedQuery: {
          kinds: string[]
          date: { from: string; to: string }
          createdAt: { from: string; to: string }
          timeZone: string
          sort: { field: string; direction: string }
          projection: { hierarchy: boolean }
        }
      }
      seen.push(...page.items.map(({ reference }) => reference.id))
      expect(page.appliedQuery).toMatchObject({
        kinds: ['update'],
        date: { from: '2026-08-20', to: '2026-08-20' },
        createdAt: { from: '2026-08-20', to: '2026-08-20' },
        timeZone: 'UTC',
        sort: { field: 'createdAt', direction: 'asc' },
        projection: { hierarchy: true }
      })
      if (!page.hasMore) {
        expect(page.continuationToken).toBeNull()
        break
      }
      expect(page.continuationToken).toMatch(/^onmove-search-v2\./u)
      response = await client.callTool({
        name: 'onmove.search',
        arguments: { continuationToken: page.continuationToken }
      })
    }
    expect(new Set(seen).size).toBe(seen.length)
    expect(new Set(seen)).toEqual(new Set(expectedIds))

    const firstPage = await client.callTool({
      name: 'onmove.search',
      arguments: { text: null, kinds: ['update'], page: { size: 1 } }
    })
    const token = (firstPage.structuredContent as { continuationToken: string }).continuationToken
    const separator = token.lastIndexOf('.')
    const signatureStart = separator + 1
    const signatureFirst = token[signatureStart]
    const tampered = `${token.slice(0, signatureStart)}${signatureFirst === 'a' ? 'b' : 'a'}${token.slice(signatureStart + 1)}`
    const rejected = await client.callTool({
      name: 'onmove.search',
      arguments: { continuationToken: tampered }
    })
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected)).toContain('invalid or incompatible')
  })

  it('keeps compact pages below the configured response byte limit', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Budget owner',
      reviewFrequencyDays: 7
    }).snapshot()
    for (let index = 0; index < 12; index += 1) {
      database.domain.updates.create({
        parent: { type: 'thread', id: thread.id },
        date: '2026-08-20',
        observation: `Budget ${index} ${'long evidence '.repeat(100)}`
      })
    }

    const compact = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: null,
        kinds: ['update'],
        page: { size: 25, maxBytes: 4096 }
      }
    })
    expect(compact.isError).not.toBe(true)
    const bytes = Buffer.byteLength(JSON.stringify(compact.structuredContent), 'utf8')
    expect(bytes).toBeLessThanOrEqual(4096)
    expect(compact.structuredContent).toMatchObject({
      hasMore: true,
      budget: {
        maxBytes: 4096,
        responseBytes: bytes,
        recordsTruncated: true
      }
    })
  })

  it('degrades malformed rich text to plain Update text with warnings in search and bulk reads', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Future document owner',
      reviewFrequencyDays: 7
    }).snapshot()
    const malformed = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Initial observation'
    }).toSnapshot()
    const ordinary = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Ordinary observation'
    }).toSnapshot()
    database.domain.richTextDocuments.save(
      { type: 'update', id: malformed.id, field: 'observation' },
      `${RICH_TEXT_PREFIX}${JSON.stringify({
        root: {
          type: 'root',
          children: [{
            type: 'future-widget',
            children: [{ type: 'text', text: 'Readable malformed evidence', version: 1 }],
            version: 1
          }],
          version: 1
        }
      })}`
    )

    const searched = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'readable malformed evidence',
        kinds: ['update'],
        projection: { richText: true, richTextPurpose: 'structural-replacement' }
      }
    })
    expect(searched.isError).not.toBe(true)
    expect(searched.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'update', id: malformed.id },
        snippet: 'Readable malformed evidence'
      })],
      diagnostics: {
        warnings: expect.arrayContaining([
          expect.stringContaining('plain text was retained')
        ])
      }
    })
    expect((searched.structuredContent as {
      items: Array<Record<string, unknown>>
    }).items[0]).not.toHaveProperty('editableRichText')

    const bulk = await client.callTool({
      name: 'onmove.get_updates_by_ids',
      arguments: { ids: [ordinary.id, malformed.id, ordinary.id, 999_999] }
    })
    expect(bulk.isError).not.toBe(true)
    expect(bulk.structuredContent).toMatchObject({
      unavailableIds: [999_999],
      diagnostics: {
        warnings: expect.arrayContaining([
          expect.stringContaining('unsupported rich text')
        ])
      }
    })
    const bulkItems = (bulk.structuredContent as {
      items: Array<{ reference: { id: number }; update: { observation: string } }>
    }).items
    expect(bulkItems.map(({ reference }) => reference.id)).toEqual([ordinary.id, malformed.id])
    expect(bulkItems[1].update.observation).toContain('Readable malformed evidence')
  })

  it('marks a complete global result sufficient and bounds hierarchy expansion', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Hierarchy fanout',
      reviewFrequencyDays: 7
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'Matrixpersonunique' })
    for (let index = 0; index < 18; index += 1) {
      database.domain.commitments.create({
        type: 'tracking',
        parent: { type: 'thread', id: thread.id },
        title: `Matrix commitment ${index}`
      })
    }

    const response = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'matrixpersonunique',
        kinds: ['subject'],
        projection: { hierarchy: true, subjects: true, scopes: true },
        page: { size: 5, maxBytes: 4096 }
      }
    })
    expect(response.isError).not.toBe(true)
    const structured = response.structuredContent as {
      items: unknown[]
      hierarchyPaths: unknown[]
      subjectUses: unknown[]
      hasMore: boolean
      searchStatus: { sufficient: boolean; doNotBroaden: boolean }
      diagnostics: { hierarchyPathTotal: number }
    }
    expect(structured.items).toHaveLength(1)
    expect(structured.hierarchyPaths.length).toBeLessThanOrEqual(5)
    expect(structured.subjectUses.length).toBeLessThanOrEqual(5)
    expect(structured.hasMore).toBe(false)
    expect(structured.searchStatus).toMatchObject({ sufficient: true, doNotBroaden: true })
    expect(structured.diagnostics.hierarchyPathTotal).toBeGreaterThan(5)
    expect(scope.subjects[0].name).toBe('Matrixpersonunique')
    expect(Buffer.byteLength(JSON.stringify(response.structuredContent), 'utf8'))
      .toBeLessThanOrEqual(4096)
  })

  it('canonicalizes accidental tag markers out of link text before storing and indexing', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const note = database.domain.notes.list({ type: 'focus', id: focus.id })[0]
    database.mcpSettings.update({ allowMutations: true })

    const updated = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: note.id,
        expectedRevision: note.revision,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{
              type: 'link',
              url: 'https://example.com/michael',
              children: [{ type: 'text', text: 'Michael reference', tag: true }]
            }]
          }]
        }
      }
    })
    expect(updated.isError).not.toBe(true)
    expect(updated.structuredContent).toMatchObject({
      note: {
        content: '[Michael reference](https://example.com/michael)',
        contentFormat: 'markdown',
        richText: {
          blocks: [{
            children: [{
              type: 'link',
              children: [{ type: 'text', text: 'Michael reference' }]
            }]
          }]
        }
      }
    })
    const search = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'michael reference' }
    })
    expect(search.structuredContent).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ reference: { type: 'note', id: note.id } })
      ])
    })
  })
})
