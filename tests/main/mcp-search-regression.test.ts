import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OnMoveAccessPolicy } from '../../src/main/application/access-policy'
import { AppDatabase } from '../../src/main/database'
import { RICH_TEXT_PREFIX } from '../../src/shared/rich-text-value'

const visible: OnMoveAccessPolicy = { sensitiveContent: 'deny', mutations: 'read-only' }

function lexical(text: string): string {
  return `${RICH_TEXT_PREFIX}${JSON.stringify({
    root: {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'text', text, version: 1 }],
        version: 1
      }],
      version: 1
    }
  })}`
}

describe('OnMove MCP full-workspace search regressions', () => {
  let directory: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-mcp-search-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function hierarchy(prefix = 'Search fixture') {
    const focus = database.domain.focuses.create({
      title: `${prefix} Focus`,
      description: lexical(`${prefix} description`)
    }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: `${prefix} Thread`,
      reviewFrequencyDays: 7
    }).snapshot()
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: `${prefix} Commitment`
    }).snapshot()
    return { focus, thread, commitment }
  }

  it.each([
    ['Focus title surrounded by other words', 'focus-title-asdfasdf', 'focus'],
    ['rich Focus description', 'focus-description-asdfasdf', 'focus'],
    ['Thread title surrounded by other words', 'thread-title-asdfasdf', 'thread'],
    ['Commitment title surrounded by other words', 'commitment-title-asdfasdf', 'commitment'],
    ['Update observation rich text', 'update-observation-asdfasdf', 'update'],
    ['Todo name surrounded by other words', 'todo-name-asdfasdf', 'todo'],
    ['Default Note rich text', 'note-content-asdfasdf', 'note'],
    ['Subject name surrounded by other words', 'subject-name-asdfasdf', 'subject'],
    ['Subject description', 'subject-description-asdfasdf', 'subject'],
    ['Routine checklist inspection', 'routine-template-asdfasdf', 'routine']
  ] as const)('finds a unique token in %s', (_label, token, expectedType) => {
    const focus = database.domain.focuses.create({
      title: `Quarterly ${token === 'focus-title-asdfasdf' ? token : 'planning'} portfolio`,
      description: lexical(token === 'focus-description-asdfasdf'
        ? `Narrative before ${token} and after`
        : 'Ordinary overview')
    }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: token === 'thread-title-asdfasdf'
        ? `Delivery ${token} operating lane`
        : 'Delivery lane',
      reviewFrequencyDays: 7
    }).snapshot()
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: token === 'commitment-title-asdfasdf'
        ? `Verify ${token} readiness`
        : 'Verify readiness'
    }).snapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: lexical(token === 'update-observation-asdfasdf'
        ? `Evidence contains ${token} in its middle`
        : 'Ordinary evidence')
    })
    database.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: token === 'todo-name-asdfasdf' ? `Prepare ${token} evidence` : 'Prepare evidence'
    })
    const [note] = database.domain.notes.list({ type: 'thread', id: thread.id })
    database.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      lexical(token === 'note-content-asdfasdf' ? `Context around ${token}` : 'Ordinary note')
    )
    database.domain.subjects.create({
      name: token === 'subject-name-asdfasdf' ? `Person ${token} Name` : 'Ordinary Person',
      description: token === 'subject-description-asdfasdf'
        ? `Profile includes ${token}`
        : 'Ordinary profile'
    })
    database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Routine fixture',
      scheduleWeekdays: [],
      checklist: [{
        inspection: token === 'routine-template-asdfasdf'
          ? `Verify ${token} is represented`
          : 'Verify ordinary evidence'
      }]
    })

    const results = database.queries.search({ text: token }, visible)
    expect(results).not.toHaveLength(0)
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: expect.objectContaining({ type: expectedType }) })
    ]))
  })

  it('treats omitted and null hierarchy IDs as global and finds identical strings in unrelated Focuses', () => {
    const first = hierarchy('First unrelated')
    const second = hierarchy('Second unrelated')
    const firstUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: first.thread.id },
      observation: 'asdfasdf appears in the first unrelated hierarchy'
    }).toSnapshot()
    const secondUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: second.thread.id },
      observation: 'asdfasdf appears in the second unrelated hierarchy'
    }).toSnapshot()

    const omitted = database.queries.search({ text: 'asdfasdf' }, visible)
    const explicitNull = database.queries.search({
      text: 'asdfasdf', focusId: null, subjectId: null
    }, visible)

    expect(omitted.map(({ reference }) => reference)).toEqual(expect.arrayContaining([
      { type: 'update', id: firstUpdate.id },
      { type: 'update', id: secondUpdate.id }
    ]))
    expect(explicitNull.map(({ reference }) => reference)).toEqual(
      omitted.map(({ reference }) => reference)
    )
  })

  it('applies an explicit Focus ID only when requested and excludes unrelated matching data', () => {
    const first = hierarchy('Narrow first')
    const second = hierarchy('Narrow second')
    const firstUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: first.thread.id }, observation: 'focusfilterasdfasdf'
    }).toSnapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: second.thread.id }, observation: 'focusfilterasdfasdf'
    })
    database.domain.updates.create({
      parent: { type: 'thread', id: first.thread.id }, observation: 'totally unrelated material'
    })

    const results = database.queries.search({
      text: 'focusfilterasdfasdf', focusId: first.focus.id
    }, visible)
    expect(results).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: firstUpdate.id },
        hierarchy: {
          focus: expect.objectContaining({ id: first.focus.id, title: first.focus.title }),
          thread: expect.objectContaining({ id: first.thread.id, title: first.thread.title }),
          commitment: null
        }
      })
    ])
  })

  it('applies a Subject ID to exact attributed records without leaking other Subject cells', () => {
    const { thread } = hierarchy('Subject matrix')
    database.domain.threadScopes.addSubject(thread.id, { name: 'Person Alpha' })
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'Person Beta' })
    const alpha = scope.subjects.find(({ name }) => name === 'Person Alpha')!
    const beta = scope.subjects.find(({ name }) => name === 'Person Beta')!
    const alphaUpdate = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      scope: { scopeId: scope.scopeId as number, subjectId: alpha.id },
      observation: 'subjectfilterasdfasdf shared literal'
    }).toSnapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      scope: { scopeId: scope.scopeId as number, subjectId: beta.id },
      observation: 'subjectfilterasdfasdf shared literal'
    })

    const results = database.queries.search({
      text: 'subjectfilterasdfasdf', subjectId: alpha.id
    }, visible)
    expect(results).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: alphaUpdate.id },
        subject: expect.objectContaining({ id: alpha.id, name: 'Person Alpha' })
      })
    ])
  })

  it('returns the owning hierarchy IDs needed to retrieve a complete Thread after child matches', () => {
    const { focus, thread, commitment } = hierarchy('Hydration')
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id }, observation: 'hydrateupdateasdfasdf'
    }).toSnapshot()
    const todo = database.domain.todos.create({
      parent: { type: 'thread', id: thread.id }, name: 'hydratetodoasdfasdf'
    }).toSnapshot()
    const [note] = database.domain.notes.list({ type: 'thread', id: thread.id })
    database.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      'hydratenoteasdfasdf'
    )

    for (const token of [
      'hydrateupdateasdfasdf',
      'hydratetodoasdfasdf',
      'hydratenoteasdfasdf',
      'Commitment'
    ]) {
      const hit = database.queries.search({ text: token, focusId: focus.id }, visible)[0]
      expect(hit.hierarchy).toMatchObject({
        focus: { id: focus.id },
        thread: { id: thread.id }
      })
      const context = database.queries.getThread(hit.hierarchy.thread!.id, visible)
      expect(context).toMatchObject({
        reference: { type: 'thread', id: thread.id },
        updates: [expect.objectContaining({ id: update.id })],
        todos: [expect.objectContaining({ id: todo.id })],
        notes: [expect.objectContaining({ id: note.id })],
        commitments: [expect.objectContaining({ id: commitment.id })]
      })
    }
  })

  it('keeps the named entity as the useful term in a natural-language discovery request', () => {
    const { thread } = hierarchy('Natural language')
    const michael = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Michael completed the operating review'
    }).toSnapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'What has the team been doing this week'
    })

    const results = database.queries.search({
      text: 'what has Michael been doing',
      kinds: ['update']
    }, visible)

    expect(results.map(({ reference }) => reference)).toEqual([
      { type: 'update', id: michael.id }
    ])
  })

  it('ranks an exact sibling title before shared corporate vocabulary', () => {
    const { thread } = hierarchy('Sibling identity')
    database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: thread.id }, title: 'Project B'
    })
    database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: thread.id }, title: 'Project C'
    })
    const projectA = database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: thread.id }, title: 'Project A'
    }).snapshot()

    for (const text of [
      'Project A',
      "what's going on with Project A",
      'find the Project A commitment'
    ]) {
      expect(database.queries.search({
        text, kinds: ['commitment'], limit: 1
      }, visible)).toEqual([
        expect.objectContaining({
          reference: { type: 'commitment', id: projectA.id },
          field: 'title',
          title: 'Project A',
          snippet: 'Project A'
        })
      ])
    }
  })

  it('rebuilds exact-title ranking after a clean-index create and rename', () => {
    const { thread } = hierarchy('Live title changes')
    database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: thread.id }, title: 'Release B'
    })
    expect(database.queries.search({
      text: 'Release B', kinds: ['commitment']
    }, visible)).toHaveLength(1)

    const renamed = database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: thread.id }, title: 'Oldcinder Zeta'
    })
    expect(database.queries.search({
      text: 'Oldcinder Zeta', kinds: ['commitment'], limit: 1
    }, visible)[0]?.reference).toEqual({ type: 'commitment', id: renamed.id })

    renamed.update({ title: 'Release A' })
    expect(database.queries.search({
      text: 'Oldcinder Zeta', kinds: ['commitment']
    }, visible)).toEqual([])
    expect(database.queries.search({
      text: 'Release A', kinds: ['commitment'], limit: 1
    }, visible)[0]).toMatchObject({
      reference: { type: 'commitment', id: renamed.id },
      field: 'title',
      title: 'Release A'
    })
  })

  it('searches symbol-only text literally with filters, security, and stable pagination', () => {
    const { focus, thread } = hierarchy('Literal symbols')
    const first = database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: thread.id }, title: '⚠️'
    }).snapshot()
    const second = database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: thread.id }, title: '⚠️'
    }).snapshot()
    const todo = database.domain.todos.create({
      parent: { type: 'thread', id: thread.id }, name: '___'
    }).toSnapshot()
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id }, observation: 'Operational marker ⚠️'
    }).toSnapshot()
    const hiddenFocus = database.domain.focuses.create({
      title: 'Hidden literal owner', sensitive: true
    }).toSnapshot()
    const hiddenThread = database.domain.threads.create({
      focusId: hiddenFocus.id, title: 'Hidden literal thread', reviewFrequencyDays: 7
    }).snapshot()
    database.domain.commitments.create({
      type: 'tracking', parent: { type: 'thread', id: hiddenThread.id }, title: '⚠️'
    })

    const firstPage = database.queries.searchPage({
      text: '⚠️', kinds: ['commitment'], focusId: focus.id, limit: 1
    }, visible)
    expect(firstPage.items).toEqual([
      expect.objectContaining({ field: 'title', title: '⚠️', snippet: '⚠️' })
    ])
    expect(firstPage).toMatchObject({ hasMore: true, nextCursor: expect.any(Object) })

    const secondPage = database.queries.searchPage({
      text: '⚠️', kinds: ['commitment'], focusId: focus.id, limit: 1,
      cursor: firstPage.nextCursor
    }, visible)
    expect(secondPage).toMatchObject({ hasMore: false, nextCursor: null })
    expect([
      firstPage.items[0].reference.id,
      secondPage.items[0].reference.id
    ].sort((left, right) => left - right)).toEqual([first.id, second.id].sort((a, b) => a - b))

    expect(database.queries.search({ text: '___', kinds: ['todo'] }, visible)).toEqual([
      expect.objectContaining({ reference: { type: 'todo', id: todo.id }, field: 'name' })
    ])
    expect(database.queries.search({ text: '⚠️', kinds: ['update'] }, visible)).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: update.id }, field: 'observation'
      })
    ])
    expect(database.queries.search({
      text: '⚠️', kinds: ['commitment'], focusId: hiddenFocus.id
    }, visible)).toEqual([])
  })

  it('bounds queryless previews instead of returning entire indexed documents', () => {
    const { thread } = hierarchy('Compact list')
    database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Long evidence '.repeat(100)
    })

    const [result] = database.queries.search({
      text: null,
      kinds: ['update'],
      threadId: thread.id,
      limit: 1
    }, visible)

    expect(result.snippet.length).toBeLessThanOrEqual(200)
    expect(result.snippet.endsWith('…')).toBe(true)
  })
})
