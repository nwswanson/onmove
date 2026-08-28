import { describe, expect, it } from 'vitest'
import type {
  CanvasEntityReferenceSnapshot,
  CanvasEntitySnapshot
} from '../../src/shared/contracts'
import { canvasLibraryGroups } from '../../src/renderer/src/features/canvas/canvas-presenters'

function entity(
  type: CanvasEntitySnapshot['target']['type'],
  id: number,
  overrides: Partial<CanvasEntitySnapshot> = {}
): CanvasEntitySnapshot {
  return {
    target: { type, id },
    title: `${type} ${id}`,
    status: 'active',
    context: 'Project Atlas',
    effectiveSensitive: false,
    createdAt: '2026-08-27T12:00:00.000Z',
    ...overrides
  }
}

describe('Canvas presenters', () => {
  it('partitions all supported kinds and disables only live cards already on the Canvas', () => {
    const entities = [
      entity('thread', 1),
      entity('commitment', 2),
      entity('routine', 3, { status: 'yellow' }),
      entity('note', 4, { status: null }),
      entity('todo', 5, { status: 'done' })
    ]
    const references: CanvasEntityReferenceSnapshot[] = [
      {
        ...entities[0],
        elementId: 'onmove_thread',
        deleted: false,
        deletedAt: null
      },
      {
        ...entity('todo', 5),
        elementId: 'onmove_deleted-todo',
        deleted: true,
        deletedAt: '2026-08-27T12:00:00.000Z'
      }
    ]

    const groups = canvasLibraryGroups(entities, references, false)
    expect(groups.map(({ label }) => label)).toEqual([
      'Threads', 'Commitments', 'Routines', 'Notes', 'Todos'
    ])
    expect(groups.find(({ id }) => id === 'thread')?.items[0]).toMatchObject({
      id: 'thread:1',
      disabled: true
    })
    expect(groups.find(({ id }) => id === 'todo')?.items[0]).toMatchObject({
      id: 'todo:5',
      status: 'done',
      disabled: false
    })
  })

  it('applies sensitive list visibility without removing ordinary records', () => {
    const groups = canvasLibraryGroups([
      entity('thread', 1, { title: 'Public' }),
      entity('thread', 2, { title: 'Private', effectiveSensitive: true })
    ], [], true)
    expect(groups[0].items.map(({ label }) => label)).toEqual(['Public'])
  })
})
