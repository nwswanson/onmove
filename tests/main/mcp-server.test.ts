import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { createOnMoveMcpServer } from '../../src/mcp/server'
import type { McpUiContextSnapshot } from '../../src/shared/contracts'
import type { OnMoveRichTextDocument } from '../../src/shared/rich-text-document'

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
      'onmove.get_thread',
      'onmove.get_update',
      'onmove.get_note',
      'onmove.resolve_note',
      'onmove.resolve_target',
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
    expect(listed.tools).toHaveLength(35)

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
    const resolveTarget = tools.find(({ name }) => name === 'onmove.resolve_target')!
    const createUpdate = tools.find(({ name }) => name === 'onmove.create_update')!
    const createTodo = tools.find(({ name }) => name === 'onmove.create_todo')!
    const patchRichText = tools.find(({ name }) => name === 'onmove.patch_rich_text')!
    const updateRichText = tools.find(({ name }) => name === 'onmove.update_rich_text')!
    const searchSchema = JSON.stringify(search.inputSchema)
    const threadSchema = JSON.stringify(getThread.inputSchema)
    const updateSchema = JSON.stringify(createUpdate.inputSchema)

    expect(searchSchema).toContain('current OnMove UI Focus and Subject selection')
    expect(searchSchema).toContain('Null or omitted means mode=all')
    expect(searchSchema).toContain('top-level area of work')
    expect(searchSchema).toContain('canonical Subject')
    expect(searchSchema).toContain('includeThreads')
    expect(searchSchema).toContain('includeCommitments')
    expect(searchSchema).toContain('includeSubjects')
    expect(searchSchema).toContain('includeScopes')
    expect(searchSchema).toContain('hierarchy browsing')
    expect(searchSchema).toContain('continuationToken')
    expect(searchSchema).toContain('hierarchy-only')
    expect(searchSchema).toContain('preserve a previously returned Thread ID')
    expect(search.description).toContain('stop discovery')
    expect(search.description).toContain('searchStatus.doNotBroaden')
    expect(threadSchema).toContain('hierarchy.thread.id')
    expect(threadSchema).toContain('not searchResult.reference.id')
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
        includeRichText: true
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
          plainText: 'lookupfocusasdf unique description',
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
          plainText: 'lookupupdateasdf unique evidence',
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
          plainText: 'lookupnoteasdf unique note',
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
      name: 'onmove.resolve_target',
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
      name: 'onmove.resolve_target',
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
        warnings: [expect.stringContaining('Retain a named Subject, Thread, or Focus scope')]
      }
    })
    expect(JSON.stringify(narrowEmpty.content)).toContain(
      'only if the user requested all people or all records'
    )
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
      name: 'onmove.get_note', arguments: { id: note.id }
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
        content: 'Updated live through MCP',
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
        inspect: { tool: 'onmove.get_note', arguments: { id: note.id } },
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
      name: 'onmove.resolve_note',
      arguments: {
        focus: { title: 'launch readiness' },
        note: { title: 'default' },
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
          content: 'hello world',
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
        content: 'hi there',
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
      name: 'onmove.get_focus',
      arguments: { id: focus.id, includeRichText: true }
    })
    expect(focusRead.structuredContent).toMatchObject({
      entity: {
        description: 'hello world',
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
        description: 'hi there',
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
      name: 'onmove.get_thread', arguments: { id: thread.id }
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
      name: 'onmove.get_update', arguments: { id: updateId }
    })
    expect(updateRead.structuredContent).toMatchObject({
      reference: { type: 'update', id: updateId },
      contextPath: [
        { type: 'focus', id: focus.id, title: 'Launch readiness' },
        { type: 'thread', id: thread.id, title: 'Rich-text owner' }
      ],
      update: {
        observation: 'Risk is high',
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
        observation: 'Risk is contained',
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
      recovery: { inspect: { tool: 'onmove.get_update', arguments: { id: updateId } } }
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
        inspect: { tool: 'onmove.get_update', arguments: { id: updateId } },
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
      name: 'onmove.get_focus', arguments: { id: focus.id }
    })
    const compactNotes = (compact.structuredContent as { notes: Array<Record<string, unknown>> }).notes
    expect(compactNotes[0]).not.toHaveProperty('richText')
    expect(compactNotes[0]).not.toHaveProperty('writeGuide')

    const complete = await client.callTool({
      name: 'onmove.get_focus',
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
    const resolveNote = tools.find(({ name }) => name === 'onmove.resolve_note')!
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
    expect(JSON.stringify(resolveNote.inputSchema)).toContain('Defaults to true')

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
      observation: expect.stringContaining('Delivery evidence in the review'),
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
      name: 'onmove.get_thread', arguments: { id: thread.id }
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
          tool: 'onmove.get_thread',
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
        includeThreads: true,
        includeCommitments: true,
        includeSubjects: true,
        includeScopes: true
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
      searchStatus: {
        sufficient: true,
        doNotBroaden: true,
        reason: expect.stringContaining('subjectUses is authoritative'),
        nextAction: expect.stringContaining('fetch the relevant IDs')
      },
      continuationScope: {
        mode: 'subject',
        subjectId: michael.id
      },
      continuationToken: expect.any(String),
      diagnostics: {
        hierarchyPathCount: expect.any(Number),
        hierarchyPathTotal: expect.any(Number),
        subjectUseCount: 1
      }
    })

    const continuationToken = (discovery.structuredContent as {
      continuationToken: string
    }).continuationToken
    const scopedFollowUp = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'weekly confidence', continuationToken }
    })
    expect(scopedFollowUp.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'update', id: existingMichaelUse.id }
      })],
      searchStatus: { sufficient: true, doNotBroaden: true },
      diagnostics: {
        appliedScope: { mode: 'subject', subjectId: michael.id },
        warnings: [expect.stringContaining('preserved from continuationToken')]
      }
    })
    expect((scopedFollowUp.structuredContent as {
      items: Array<{ reference: { type: string; id: number } }>
    }).items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: { type: 'update', id: unrelatedGenericUse.id } })
    ]))

    const hierarchyOnly = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'michael',
        view: 'hierarchy-only',
        includeThreads: true,
        includeCommitments: true,
        includeSubjects: true
      }
    })
    expect(hierarchyOnly.structuredContent).toMatchObject({
      items: [],
      subjectUses: [],
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
        scope: { mode: 'subject', subjectId: michael.id }
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
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'Michael' })
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
      arguments: { text: 'observation', continuationToken }
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
        content: 'Michael reference',
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
