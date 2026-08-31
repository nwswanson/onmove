import { defaultFilter } from 'cmdk'
import type { CommandMenuGroupModel, CommandMenuItemModel } from '@/components/ui/command-menu'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

interface SearchField {
  value: string
  weight: number
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ')
}

function matchStrength(candidate: string, query: string): number {
  if (!candidate || !query) return 0
  if (candidate === query) return 1
  if (candidate.startsWith(query)) return 0.88
  if (candidate.split(/[^\p{L}\p{N}@#]+/u).some((word) => word.startsWith(query))) return 0.8
  if (candidate.includes(query)) return 0.7
  return defaultFilter(candidate, query) * 0.4
}

function searchFields(item: CommandMenuItemModel): SearchField[] {
  const descriptionSegments = item.description.split(/[›·/]/u)
  return [
    ...(item.code ? [{ value: item.code, weight: 1_200 }] : []),
    { value: item.label, weight: 1_000 },
    ...item.keywords.map((keyword) => ({ value: keyword, weight: 900 })),
    ...descriptionSegments.map((segment) => ({ value: segment, weight: 850 })),
    { value: item.description, weight: 700 },
    { value: item.id, weight: 350 }
  ].map((field) => ({ ...field, value: normalized(field.value) }))
}

/**
 * Scores semantic fields independently so an exact title or Subject alias is
 * not diluted by a long hierarchy path. Every query token must match, while
 * cmdk's fuzzy scorer remains a low-weight fallback for forgiving discovery.
 */
export function commandMenuSearchScore(item: CommandMenuItemModel, search: string): number {
  const query = normalized(search)
  if (!query) return 1
  const fields = searchFields(item)
  const tokens = query.split(' ').filter(Boolean)
  const phraseScore = Math.max(...fields.map((field) =>
    field.weight * matchStrength(field.value, query)))
  const tokenScores = tokens.map((token) => Math.max(...fields.map((field) =>
    field.weight * matchStrength(field.value, token))))
  if (tokenScores.some((score) => score <= 0)) return 0

  const combinedValue = normalized(`${item.label} ${item.description}`)
  const fuzzyScore = defaultFilter(combinedValue, query, item.keywords.map(normalized))
  return phraseScore * 10 + tokenScores.reduce((total, score) => total + score, 0) + fuzzyScore
}

/** Keeps browse mode partitioned, but active search globally ordered by relevance. */
export function rankedCommandMenuGroups(
  groups: readonly CommandMenuGroupModel[],
  search: string
): readonly CommandMenuGroupModel[] {
  if (!normalized(search)) return groups

  const ranked = groups.flatMap((group, groupIndex) =>
    group.items.map((item, itemIndex) => ({
      item,
      groupIndex,
      itemIndex,
      score: commandMenuSearchScore(item, search)
    })))
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      collator.compare(left.item.label, right.item.label) ||
      collator.compare(left.item.description, right.item.description) ||
      left.groupIndex - right.groupIndex ||
      left.itemIndex - right.itemIndex)

  return ranked.length === 0
    ? []
    : [{ id: 'search-results', label: 'Best matches', items: ranked.map(({ item }) => item) }]
}
