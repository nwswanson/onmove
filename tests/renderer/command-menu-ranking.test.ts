import { describe, expect, it } from 'vitest'
import type { CommandMenuGroupModel } from '../../src/renderer/src/components/ui/command-menu'
import {
  commandMenuSearchScore,
  rankedCommandMenuGroups
} from '../../src/renderer/src/components/ui/command-menu-ranking'

const groups: CommandMenuGroupModel[] = [
  {
    id: 'focuses',
    label: 'Focuses',
    items: [{
      id: 'focus:1',
      icon: 'folder',
      code: '#F1',
      label: 'Personname succession planning',
      description: 'Focus · Overall',
      keywords: ['focus', 'personname succession planning']
    }, {
      id: 'focus:2',
      icon: 'folder',
      code: '#F2',
      label: 'People operations',
      description: 'A historical mention of personname',
      keywords: ['focus', 'people operations']
    }]
  },
  {
    id: 'threads',
    label: 'Threads',
    items: [{
      id: 'thread:4',
      icon: 'branch',
      code: '#T4',
      label: 'Personname',
      description: 'Team management › All subjects',
      keywords: ['thread', 'personname', 'team management']
    }, {
      id: 'thread:5:subject:8',
      icon: 'branch',
      code: '#T5',
      label: 'Weekly 1:1s',
      description: 'Team management › Personname',
      keywords: ['thread', 'subject', 'weekly 1:1s', 'personname']
    }]
  }
]

describe('command menu relevance ranking', () => {
  it('keeps kind partitions only while browsing without a query', () => {
    expect(rankedCommandMenuGroups(groups, '')).toBe(groups)
  })

  it('globally ranks an exact label and exact Subject above weaker earlier-group matches', () => {
    const ranked = rankedCommandMenuGroups(groups, 'personname')

    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.label).toBe('Best matches')
    expect(ranked[0]?.items.map(({ id }) => id)).toEqual([
      'thread:4',
      'thread:5:subject:8',
      'focus:1',
      'focus:2'
    ])
  })

  it('requires every query token while allowing them to match across title and hierarchy', () => {
    const ranked = rankedCommandMenuGroups(groups, 'weekly personname')

    expect(ranked[0]?.items.map(({ id }) => id)).toEqual(['thread:5:subject:8'])
    expect(commandMenuSearchScore(groups[1].items[1], 'weekly personname')).toBeGreaterThan(0)
    expect(commandMenuSearchScore(groups[0].items[0], 'weekly personname')).toBe(0)
  })

  it('treats a canonical public code as an exact, case-insensitive lookup', () => {
    const ranked = rankedCommandMenuGroups(groups, '#t4')

    expect(ranked[0]?.items.map(({ id }) => id)).toEqual(['thread:4'])
    expect(commandMenuSearchScore(groups[1].items[0], '#T4'))
      .toBeGreaterThan(commandMenuSearchScore(groups[0].items[0], '#T4'))
  })
})
