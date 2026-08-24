import type {
  CommitmentSnapshot,
  FocusSnapshot,
  ThreadSnapshot,
  TodoSnapshot
} from '../../../../shared/contracts'
import type {
  FocusWorkspaceDestinationTarget
} from '@/features/application/application-navigation'
import type {
  CommandMenuGroupModel,
  CommandMenuItemModel
} from '@/components/ui/command-menu'
import type {
  CommandPaletteSnapshot
} from '@/features/application/use-command-palette-model'

export type CommandPaletteDestination =
  | { type: 'focus'; target: FocusWorkspaceDestinationTarget }
  | { type: 'tag'; name: string }

export interface CommandPaletteItemModel extends CommandMenuItemModel {
  destination: CommandPaletteDestination
}

export interface CommandPaletteGroupModel extends Omit<CommandMenuGroupModel, 'items'> {
  items: readonly CommandPaletteItemModel[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function sorted(items: CommandPaletteItemModel[]): CommandPaletteItemModel[] {
  return items.sort((left, right) =>
    collator.compare(left.label, right.label) || collator.compare(left.description, right.description)
  )
}

function focusTarget(
  focusId: number,
  threadId: number | null = null,
  commitmentId: number | null = null,
  subjectId: number | null = null
): FocusWorkspaceDestinationTarget {
  return { focusId, threadId, commitmentId, subjectId }
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

function todoContext(
  todo: TodoSnapshot,
  focusById: ReadonlyMap<number, FocusSnapshot>,
  threadById: ReadonlyMap<number, ThreadSnapshot>,
  commitmentById: ReadonlyMap<number, CommitmentSnapshot>
): { focus: FocusSnapshot; thread: ThreadSnapshot | null; commitment: CommitmentSnapshot | null } | null {
  if (todo.parent.type === 'focus') {
    const focus = focusById.get(todo.parent.id)
    return focus ? { focus, thread: null, commitment: null } : null
  }
  if (todo.parent.type === 'thread' || todo.parent.type === 'thread-scope') {
    const thread = threadById.get(todo.parent.id)
    const focus = thread ? focusById.get(thread.focusId) : undefined
    return thread && focus ? { focus, thread, commitment: null } : null
  }
  const commitment = commitmentById.get(todo.parent.id)
  if (!commitment) return null
  const context = commitmentContext(commitment, focusById, threadById)
  return context ? { ...context, commitment } : null
}

/** Translates domain snapshots into the command receiver's data-only result contract. */
export function commandPaletteGroups(
  snapshot: CommandPaletteSnapshot,
  hideSensitiveContent: boolean
): CommandPaletteGroupModel[] {
  const focuses = snapshot.focuses.filter((focus) =>
    !hideSensitiveContent || !focus.sensitive)
  const focusById = new Map(focuses.map((focus) => [focus.id, focus]))
  const threads = snapshot.threads.filter((thread) => {
    const focus = focusById.get(thread.focusId)
    return Boolean(focus) && (!hideSensitiveContent || !thread.sensitive)
  })
  const threadById = new Map(threads.map((thread) => [thread.id, thread]))
  const commitments = snapshot.commitments.filter((commitment) => {
    const context = commitmentContext(commitment, focusById, threadById)
    return Boolean(context) && (!hideSensitiveContent || !commitment.sensitive)
  })
  const commitmentById = new Map(commitments.map((commitment) => [commitment.id, commitment]))
  const commitmentContextById = new Map(
    snapshot.commitmentWorkingContexts.map((context) => [context.commitmentId, context])
  )

  const groups: CommandPaletteGroupModel[] = [
    {
      id: 'focuses',
      label: 'Focuses',
      items: sorted(focuses.map((focus) => ({
        id: `focus:${focus.id}`,
        icon: 'folder' as const,
        label: focus.title,
        description: 'Focus · Overall',
        keywords: ['focus', 'overall', focus.title],
        destination: { type: 'focus' as const, target: focusTarget(focus.id) }
      })))
    },
    {
      id: 'threads',
      label: 'Threads',
      items: sorted(threads.map((thread) => {
        const focus = focusById.get(thread.focusId) as FocusSnapshot
        return {
          id: `thread:${thread.id}`,
          icon: 'branch' as const,
          label: thread.title,
          description: focus.title,
          keywords: ['thread', thread.title, focus.title],
          destination: {
            type: 'focus' as const,
            target: focusTarget(focus.id, thread.id)
          }
        }
      }))
    },
    {
      id: 'commitments',
      label: 'Commitments',
      items: sorted(commitments.flatMap((commitment) => {
        const context = commitmentContext(commitment, focusById, threadById)
        if (!context) return []
        const parent = context.thread?.title ?? 'Overall'
        const path = `${context.focus.title} › ${parent}`
        const workingContext = commitmentContextById.get(commitment.id)
        const ordinaryContextLabel = workingContext?.scopeId === null
          ? 'Commitment-wide'
          : 'All subjects'
        const ordinaryDestination: CommandPaletteItemModel = {
          id: `commitment:${commitment.id}`,
          icon: 'item' as const,
          label: commitment.title,
          description: `${path} › ${ordinaryContextLabel}`,
          keywords: [
            'commitment',
            commitment.title,
            context.focus.title,
            parent,
            ordinaryContextLabel
          ],
          destination: {
            type: 'focus' as const,
            target: focusTarget(context.focus.id, context.thread?.id ?? null, commitment.id)
          }
        }
        const scopedDestinations = (workingContext?.cells ?? [])
          .filter(({ subject }) => !hideSensitiveContent || !subject.sensitive)
          .map((cell): CommandPaletteItemModel => ({
            id: `commitment:${commitment.id}:scope:${cell.scopeId}:subject:${cell.subjectId}`,
            icon: 'item',
            label: commitment.title,
            description: `${path} › ${cell.subject.name}`,
            keywords: [
              'commitment',
              'scope',
              'subject',
              commitment.title,
              context.focus.title,
              parent,
              cell.subject.name
            ],
            destination: {
              type: 'focus',
              target: focusTarget(
                context.focus.id,
                context.thread?.id ?? null,
                commitment.id,
                cell.subjectId
              )
            }
          }))
        return [ordinaryDestination, ...scopedDestinations]
      }))
    },
    {
      id: 'todos',
      label: 'Todos',
      items: sorted(snapshot.todos.flatMap((todo) => {
        const context = todoContext(todo, focusById, threadById, commitmentById)
        if (!context) return []
        if (hideSensitiveContent && todo.subject?.sensitive) return []
        const path = [
          context.focus.title,
          context.thread?.title ?? 'Overall',
          context.commitment?.title,
          todo.subject?.name
        ].filter((part): part is string => part !== undefined)
        return [{
          id: `todo:${todo.id}`,
          icon: 'check' as const,
          label: todo.name,
          description: path.join(' › '),
          keywords: ['todo', todo.name, ...path],
          destination: {
            type: 'focus' as const,
            target: focusTarget(
              context.focus.id,
              context.thread?.id ?? null,
              context.commitment?.id ?? null,
              todo.subject?.id ?? null
            )
          }
        }]
      }))
    },
    {
      id: 'tags',
      label: 'Tags',
      items: sorted(snapshot.tags.flatMap((tag) => {
        const visibleUseCount = tag.useCount - (
          hideSensitiveContent ? tag.sensitiveUseCount : 0
        )
        if (visibleUseCount <= 0) return []
        return [{
          id: `tag:${tag.name}`,
          icon: 'tag' as const,
          label: `@${tag.name}`,
          description: visibleUseCount === 1 ? '1 use' : `${visibleUseCount} uses`,
          keywords: ['tag', tag.name, `@${tag.name}`],
          destination: { type: 'tag' as const, name: tag.name }
        }]
      }))
    }
  ]

  return groups.filter(({ items }) => items.length > 0)
}
