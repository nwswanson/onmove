import { describe, expect, it } from 'vitest'
import type { TagSummarySnapshot, TagUseSnapshot } from '../../src/shared/contracts'
import {
  tagSidebarItems,
  tagUseDestination,
  tagUseRows
} from '../../src/renderer/src/features/tags/tag-presenters'

function use(overrides: Partial<TagUseSnapshot> = {}): TagUseSnapshot {
  return {
    id: 'update:30:observation:0',
    name: 'launch',
    source: { type: 'update', id: 30, field: 'observation' },
    context: {
      focus: { id: 1, title: 'Project Atlas', sensitive: false },
      thread: { id: 10, title: 'Sprint execution', sensitive: false },
      commitment: { id: 20, title: 'Improve tickets', sensitive: false },
      subject: {
        id: 40,
        kind: 'generic',
        name: 'Customer Operations',
        description: null,
        externalKey: null,
        sensitive: false,
        createdAt: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z'
      }
    },
    snippet: 'Evidence for @Launch is improving',
    effectiveSensitive: false,
    ...overrides
  }
}

describe('Tags presenters', () => {
  it('projects visible counts into receiver-owned contextual rows', () => {
    const summaries: TagSummarySnapshot[] = [
      { name: 'launch', useCount: 4, sensitiveUseCount: 2 },
      { name: 'private', useCount: 1, sensitiveUseCount: 1 }
    ]

    expect(tagSidebarItems(summaries, false)).toEqual([
      { id: 'launch', label: '@launch', description: '4 uses' },
      { id: 'private', label: '@private', description: '1 use' }
    ])
    expect(tagSidebarItems(summaries, true)).toEqual([
      { id: 'launch', label: '@launch', description: '2 uses' }
    ])
  })

  it('filters sensitive uses and resolves one atomic containing-screen destination', () => {
    const visible = use()
    const hidden = use({
      id: 'todo:31:name:0',
      source: { type: 'todo', id: 31, field: 'name' },
      effectiveSensitive: true
    })

    expect(tagUseRows([hidden, visible], true)).toEqual([{
      id: visible.id,
      location: 'Project Atlas › Sprint execution › Improve tickets › Customer Operations',
      source: 'Update',
      snippet: visible.snippet,
      destination: {
        focusId: 1,
        threadId: 10,
        commitmentId: 20,
        subjectId: 40
      }
    }])
    expect(tagUseDestination(visible)).toEqual({
      focusId: 1,
      threadId: 10,
      commitmentId: 20,
      subjectId: 40
    })
  })
})
