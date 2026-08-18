import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { RICH_TEXT_PREFIX } from '../../src/shared/rich-text-value'

function richText(value: string): string {
  return `${RICH_TEXT_PREFIX}${JSON.stringify({
    root: {
      children: [{
        children: [{ text: value, type: 'tag', version: 1 }],
        type: 'paragraph',
        version: 1
      }],
      type: 'root',
      version: 1
    }
  })}`
}

describe('Tag model', () => {
  let directory: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-tag-model-test-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('derives canonical tag uses and hierarchy links from every user-authored record kind', () => {
    const focus = database!.domain.focuses.create({
      title: 'Project @Atlas',
      description: richText('Coordinate @Launch across the portfolio')
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: '@Launch execution',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve @Launch ticket quality',
      sensitive: true
    })
    const update = database!.domain.updates.create({
      parent: { type: 'commitment', id: commitment.id },
      observation: richText('Evidence for @Launch is improving')
    })
    const todo = database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Review @Launch examples'
    })
    const note = commitment.snapshot().notes[0]
    database!.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      richText('Decisions about @Launch belong here')
    )

    expect(database!.domain.tags.list()).toEqual([
      { name: 'atlas', useCount: 1, sensitiveUseCount: 0 },
      { name: 'launch', useCount: 6, sensitiveUseCount: 4 }
    ])

    const uses = database!.domain.tags.uses('launch')
    expect(uses).toHaveLength(6)
    expect(uses.map(({ source }) => source)).toEqual(expect.arrayContaining([
      { type: 'focus', id: focus.id, field: 'description' },
      { type: 'thread', id: thread.id, field: 'title' },
      { type: 'commitment', id: commitment.id, field: 'title' },
      { type: 'update', id: update.id, field: 'observation' },
      { type: 'todo', id: todo.id, field: 'name' },
      { type: 'note', id: note.id, field: 'content' }
    ]))
    expect(uses.find(({ source }) => source.type === 'update')).toMatchObject({
      context: {
        focus: { id: focus.id, title: 'Project @Atlas' },
        thread: { id: thread.id, title: '@Launch execution' },
        commitment: { id: commitment.id, title: 'Improve @Launch ticket quality' }
      },
      snippet: 'Evidence for @Launch is improving',
      effectiveSensitive: true
    })
  })

  it('normalizes case, emits one bounded plain use per field, and follows edits', () => {
    const longContext = `${'before '.repeat(40)}@Launch ${'after '.repeat(40)}`
    const focus = database!.domain.focuses.create({
      title: '@Launch and @launch',
      description: richText(`${longContext} then @Launch again`)
    })

    const launchUses = database!.domain.tags.uses('Launch')
    expect(launchUses).toHaveLength(2)
    expect(launchUses.every(({ name }) => name === 'launch')).toBe(true)
    expect(launchUses.every(({ snippet }) => !snippet.includes(RICH_TEXT_PREFIX))).toBe(true)
    expect(launchUses.every(({ snippet }) => Array.from(snippet).length <= 182)).toBe(true)
    expect(database!.domain.tags.uses('launch')).toEqual(launchUses)
    expect(database!.domain.tags.list()).toEqual([
      { name: 'launch', useCount: 2, sensitiveUseCount: 0 }
    ])

    database!.domain.focuses.requireModel(focus.id).update({ title: 'Project ready' })
    expect(database!.domain.tags.list()).toEqual([
      { name: 'launch', useCount: 1, sensitiveUseCount: 0 }
    ])
  })

  it('removes cascaded uses without repair and rejects malformed lookup identifiers', () => {
    const focus = database!.domain.focuses.create({ title: 'Project' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Deliver @Gone'
    })
    database!.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Verify @Gone'
    })

    expect(database!.domain.tags.uses('Gone')).toHaveLength(2)
    database!.domain.commitments.delete(commitment.id)
    expect(database!.domain.tags.uses('Gone')).toEqual([])
    expect(database!.domain.tags.list()).toEqual([])
    expect(() => database!.domain.tags.uses('team-name')).toThrow(
      'tag name must contain only Unicode letters and numbers'
    )
  })
})
