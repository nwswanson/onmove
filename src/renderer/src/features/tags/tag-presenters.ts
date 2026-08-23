import type {
  TagSummarySnapshot,
  TagUseSnapshot
} from '../../../../shared/contracts'
import type { ContextualSidebarItemModel } from '@/components/ui/contextual-sidebar'
import type { FocusWorkspaceDestinationTarget } from '@/features/application/application-navigation'
import type { EntityReferenceModel } from '@/components/ui/entity-reference'
import { entityReference, type EntityReferenceKind } from '../../../../shared/entity-reference'

export interface TagUseRowModel {
  id: string
  reference: EntityReferenceModel
  location: string
  source: string
  snippet: string
  destination: FocusWorkspaceDestinationTarget
}

export function tagSidebarItems(
  tags: readonly TagSummarySnapshot[],
  hideSensitiveContent: boolean
): ContextualSidebarItemModel[] {
  return tags.flatMap((tag) => {
    const visibleCount = tag.useCount - (hideSensitiveContent ? tag.sensitiveUseCount : 0)
    if (visibleCount <= 0) return []
    return [{
      id: tag.name,
      label: `@${tag.name}`,
      description: visibleCount === 1 ? '1 use' : `${visibleCount} uses`
    }]
  })
}

function sourceLabel(use: TagUseSnapshot): string {
  switch (use.source.type) {
    case 'focus':
      if (use.source.field === 'title') return 'Focus title'
      return 'Description'
    case 'thread':
      return 'Thread title'
    case 'commitment':
      return 'Commitment title'
    case 'update':
      return 'Update'
    case 'todo':
      return 'Todo'
    case 'note':
      return use.source.field === 'title' ? 'Note title' : 'Note'
  }
}

function sourceReference(use: TagUseSnapshot): EntityReferenceModel {
  const kind = use.source.type as EntityReferenceKind
  const label = kind === 'todo'
    ? 'Todo'
    : kind[0].toUpperCase() + kind.slice(1)
  return {
    value: entityReference(kind, use.source.id),
    label: `${label} ID`
  }
}

function locationLabel(use: TagUseSnapshot): string {
  return [
    use.context.focus.title,
    use.context.thread?.title ?? 'Overall',
    use.context.commitment?.title,
    use.context.subject?.name
  ].filter((part): part is string => part !== undefined).join(' › ')
}

export function tagUseDestination(use: TagUseSnapshot): FocusWorkspaceDestinationTarget {
  return {
    focusId: use.context.focus.id,
    threadId: use.context.thread?.id ?? null,
    commitmentId: use.context.commitment?.id ?? null,
    subjectId: use.context.subject?.id ?? null
  }
}

export function tagUseRows(
  uses: readonly TagUseSnapshot[],
  hideSensitiveContent: boolean
): TagUseRowModel[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return uses
    .filter((use) => !hideSensitiveContent || !use.effectiveSensitive)
    .map((use) => ({
      id: use.id,
      reference: sourceReference(use),
      location: locationLabel(use),
      source: sourceLabel(use),
      snippet: use.snippet,
      destination: tagUseDestination(use)
    }))
    .sort((left, right) =>
      collator.compare(left.location, right.location) ||
      collator.compare(left.source, right.source) ||
      collator.compare(left.snippet, right.snippet)
    )
}
