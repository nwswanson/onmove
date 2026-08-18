import type {
  CommitmentSnapshot,
  CommitmentWorkingContextSnapshot,
  FocusSnapshot,
  ReviewQueueItemSnapshot,
  ThreadScopeSnapshot,
  ThreadSnapshot,
  UpdateParent,
  UpdateScopeCell
} from '../../../../shared/contracts'
import type {
  CommandMenuGroupModel,
  CommandMenuIcon,
  CommandMenuItemModel
} from '@/components/ui/command-menu'

export interface UpdateCommandTarget {
  id: string
  kind: 'thread' | 'commitment'
  focusId: number
  parent: UpdateParent
  scope: UpdateScopeCell | null
  label: string
  description: string
  keywords: readonly string[]
}

export interface UpdateCommandGraph {
  focuses: readonly FocusSnapshot[]
  threads: readonly ThreadSnapshot[]
  commitments: readonly CommitmentSnapshot[]
  threadScopes: ReadonlyMap<number, ThreadScopeSnapshot>
  commitmentContexts: ReadonlyMap<number, CommitmentWorkingContextSnapshot>
}

/**
 * The Review workspace already owns one exact review target. Convert that
 * target directly into the composer contract so its Update action never asks
 * the user to choose unrelated work again.
 */
export function reviewUpdateCommandTarget(
  reviewItem: ReviewQueueItemSnapshot
): UpdateCommandTarget {
  const scope = reviewItem.cell
    ? { scopeId: reviewItem.cell.scopeId, subjectId: reviewItem.cell.subjectId }
    : null
  const subjectPath = reviewItem.cell ? ` › ${reviewItem.cell.subject.name}` : ''

  if (reviewItem.kind === 'thread') {
    if (!reviewItem.thread) throw new Error('A Thread review target requires a Thread')
    return {
      id: reviewItem.cell
        ? `thread:${reviewItem.thread.id}:scope:${reviewItem.cell.scopeId}:subject:${reviewItem.cell.subjectId}`
        : `thread:${reviewItem.thread.id}`,
      kind: 'thread',
      focusId: reviewItem.focus.id,
      parent: { type: 'thread', id: reviewItem.thread.id },
      scope,
      label: reviewItem.thread.title,
      description: reviewItem.cell
        ? `${reviewItem.focus.title}${subjectPath}`
        : `${reviewItem.focus.title} › Thread-wide`,
      keywords: [
        'thread', reviewItem.focus.title, reviewItem.thread.title,
        ...(reviewItem.cell ? ['subject', reviewItem.cell.subject.name] : ['thread-wide'])
      ]
    }
  }

  if (!reviewItem.commitment) {
    throw new Error('A Commitment review target requires a Commitment')
  }
  const parentPath = `${reviewItem.focus.title} › ${reviewItem.thread?.title ?? 'Overall'}`
  return {
    id: reviewItem.cell
      ? `commitment:${reviewItem.commitment.id}:scope:${reviewItem.cell.scopeId}:subject:${reviewItem.cell.subjectId}`
      : `commitment:${reviewItem.commitment.id}`,
    kind: 'commitment',
    focusId: reviewItem.focus.id,
    parent: { type: 'commitment', id: reviewItem.commitment.id },
    scope,
    label: reviewItem.commitment.title,
    description: `${parentPath}${subjectPath}`,
    keywords: [
      'commitment', reviewItem.focus.title, reviewItem.thread?.title ?? 'overall',
      reviewItem.commitment.title,
      ...(reviewItem.cell ? ['subject', reviewItem.cell.subject.name] : [])
    ]
  }
}

export interface UpdateCommandItemModel extends CommandMenuItemModel {
  target: UpdateCommandTarget
}

export interface UpdateCommandGroupModel extends Omit<CommandMenuGroupModel, 'items'> {
  items: readonly UpdateCommandItemModel[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function currentStatus(status: string): boolean {
  return status === 'active' || status === 'paused'
}

function item(
  target: UpdateCommandTarget,
  icon: CommandMenuIcon
): UpdateCommandItemModel {
  return { ...target, icon, target }
}

function sorted(items: UpdateCommandItemModel[]): UpdateCommandItemModel[] {
  return items.sort((left, right) =>
    collator.compare(left.label, right.label) ||
    collator.compare(left.description, right.description) ||
    collator.compare(left.id, right.id))
}

function threadTargets(
  thread: ThreadSnapshot,
  focus: FocusSnapshot,
  scope: ThreadScopeSnapshot,
  hideSensitiveContent: boolean
): UpdateCommandItemModel[] {
  const base = {
    kind: 'thread' as const,
    focusId: focus.id,
    parent: { type: 'thread' as const, id: thread.id },
    label: thread.title
  }
  if (scope.scopeId === null || scope.subjects.length === 0) {
    return [item({
      ...base,
      id: `thread:${thread.id}`,
      scope: null,
      description: `${focus.title} › Thread-wide`,
      keywords: ['thread', 'thread-wide', focus.title, thread.title]
    }, 'branch')]
  }
  return scope.subjects.flatMap((subject) => hideSensitiveContent && subject.sensitive
    ? []
    : [item({
        ...base,
        id: `thread:${thread.id}:scope:${scope.scopeId}:subject:${subject.id}`,
        scope: { scopeId: scope.scopeId as number, subjectId: subject.id },
        description: `${focus.title} › ${subject.name}`,
        keywords: ['thread', 'subject', focus.title, thread.title, subject.name]
      }, 'branch')])
}

function commitmentContext(
  commitment: CommitmentSnapshot,
  focusById: ReadonlyMap<number, FocusSnapshot>,
  threadById: ReadonlyMap<number, ThreadSnapshot>
): { focus: FocusSnapshot; thread: ThreadSnapshot | null } | null {
  if (commitment.parent.type === 'focus') {
    const focus = focusById.get(commitment.parent.id)
    return focus ? { focus, thread: null } : null
  }
  const thread = threadById.get(commitment.parent.id)
  const focus = thread ? focusById.get(thread.focusId) : undefined
  return thread && focus ? { focus, thread } : null
}

function commitmentTargets(
  commitment: CommitmentSnapshot,
  focus: FocusSnapshot,
  thread: ThreadSnapshot | null,
  context: CommitmentWorkingContextSnapshot,
  hideSensitiveContent: boolean
): UpdateCommandItemModel[] {
  const parentPath = `${focus.title} › ${thread?.title ?? 'Overall'}`
  const base = {
    kind: 'commitment' as const,
    focusId: focus.id,
    parent: { type: 'commitment' as const, id: commitment.id },
    label: commitment.title
  }
  if (context.scopeId === null) {
    return [item({
      ...base,
      id: `commitment:${commitment.id}`,
      scope: null,
      description: parentPath,
      keywords: ['commitment', focus.title, thread?.title ?? 'overall', commitment.title]
    }, 'item')]
  }
  if (context.cells.length === 0) return []
  return context.cells.flatMap((cell) => hideSensitiveContent && cell.subject.sensitive
    ? []
    : [item({
        ...base,
        id: `commitment:${commitment.id}:scope:${cell.scopeId}:subject:${cell.subjectId}`,
        scope: { scopeId: cell.scopeId, subjectId: cell.subjectId },
        description: `${parentPath} › ${cell.subject.name}`,
        keywords: [
          'commitment', 'subject', focus.title, thread?.title ?? 'overall',
          commitment.title, cell.subject.name
        ]
      }, 'item')])
}

/** Receiver-ready update targets; exact Subject cells remain domain data. */
export function updateCommandGroups(
  graph: UpdateCommandGraph,
  hideSensitiveContent: boolean
): UpdateCommandGroupModel[] {
  const focuses = graph.focuses.filter((focus) =>
    currentStatus(focus.status) && (!hideSensitiveContent || !focus.sensitive))
  const focusById = new Map(focuses.map((focus) => [focus.id, focus]))
  const threads = graph.threads.filter((thread) => {
    const focus = focusById.get(thread.focusId)
    return Boolean(focus) && currentStatus(thread.status) &&
      (!hideSensitiveContent || !thread.sensitive)
  })
  const threadById = new Map(threads.map((thread) => [thread.id, thread]))
  const commitments = graph.commitments.filter((commitment) => {
    const context = commitmentContext(commitment, focusById, threadById)
    return Boolean(context) && currentStatus(commitment.status) &&
      (!hideSensitiveContent || !commitment.sensitive)
  })

  const groups: UpdateCommandGroupModel[] = [
    {
      id: 'threads',
      label: 'Threads',
      items: sorted(threads.flatMap((thread) => {
        const focus = focusById.get(thread.focusId)
        const scope = graph.threadScopes.get(thread.id)
        return focus && scope
          ? threadTargets(thread, focus, scope, hideSensitiveContent)
          : []
      }))
    },
    {
      id: 'commitments',
      label: 'Commitments',
      items: sorted(commitments.flatMap((commitment) => {
        const hierarchy = commitmentContext(commitment, focusById, threadById)
        const context = graph.commitmentContexts.get(commitment.id)
        return hierarchy && context
          ? commitmentTargets(
              commitment,
              hierarchy.focus,
              hierarchy.thread,
              context,
              hideSensitiveContent
            )
          : []
      }))
    }
  ]
  return groups.filter(({ items }) => items.length > 0)
}
