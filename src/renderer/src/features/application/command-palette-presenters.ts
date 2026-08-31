import type {
  CommitmentSnapshot,
  FocusSnapshot,
  ThreadSnapshot,
  TodoSnapshot
} from '../../../../shared/contracts'
import { entityReference } from '../../../../shared/entity-reference'
import type {
  FocusWorkspaceDestinationTarget
} from '@/features/application/application-navigation'
import type {
  CommandMenuGroupModel,
  CommandMenuItemModel
} from '@/components/ui/command-menu'
import type { LifecycleStatusOptionModel } from '@/components/ui/lifecycle-status'
import type {
  CommandPaletteSnapshot
} from '@/features/application/use-command-palette-model'
import { healthStateLabel } from '@/features/shared/state-presenters'
import { workStatusLabel } from '@/features/shared/work-status'

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

function currentStatus(status: FocusSnapshot['status']): boolean {
  return status === 'active' || status === 'paused'
}

function todoStatus(todo: TodoSnapshot): LifecycleStatusOptionModel {
  return todo.done
    ? { value: 'done', label: 'Done', tone: 'success' }
    : { value: 'open', label: 'Open', tone: 'primary' }
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
  hideSensitiveContent: boolean,
  includeClosedWork = false
): CommandPaletteGroupModel[] {
  const focuses = snapshot.focuses.filter((focus) =>
    (includeClosedWork || currentStatus(focus.status)) &&
    (!hideSensitiveContent || !focus.sensitive))
  const focusById = new Map(focuses.map((focus) => [focus.id, focus]))
  const threads = snapshot.threads.filter((thread) => {
    const focus = focusById.get(thread.focusId)
    return Boolean(focus) && (includeClosedWork || currentStatus(thread.status)) &&
      (!hideSensitiveContent || !thread.sensitive)
  })
  const threadById = new Map(threads.map((thread) => [thread.id, thread]))
  const threadScopeById = new Map(
    snapshot.threadScopes.map((scope) => [scope.threadId, scope])
  )
  const commitments = snapshot.commitments.filter((commitment) => {
    const context = commitmentContext(commitment, focusById, threadById)
    return Boolean(context) && (includeClosedWork || currentStatus(commitment.status)) &&
      (!hideSensitiveContent || !commitment.sensitive)
  })
  const commitmentById = new Map(commitments.map((commitment) => [commitment.id, commitment]))
  const commitmentContextById = new Map(
    snapshot.commitmentWorkingContexts.map((context) => [context.commitmentId, context])
  )

  const groups: CommandPaletteGroupModel[] = [
    {
      id: 'focuses',
      label: 'Focuses',
      items: sorted(focuses.map((focus) => {
        const code = entityReference('focus', focus.id)
        return {
          id: `focus:${focus.id}`,
          icon: 'folder' as const,
          label: focus.title,
          description: 'Focus · Overall',
          code,
          keywords: ['focus', 'overall', focus.title, focus.status, code],
          status: workStatusLabel(focus.status),
          destination: { type: 'focus' as const, target: focusTarget(focus.id) }
        }
      }))
    },
    {
      id: 'threads',
      label: 'Threads',
      items: sorted(threads.flatMap((thread) => {
        const focus = focusById.get(thread.focusId) as FocusSnapshot
        const scope = threadScopeById.get(thread.id)
        const ordinaryContextLabel = scope?.scopeId == null
          ? 'Thread-wide'
          : 'All subjects'
        const code = entityReference('thread', thread.id)
        const ordinaryDestination: CommandPaletteItemModel = {
          id: `thread:${thread.id}`,
          icon: 'branch' as const,
          label: thread.title,
          description: `${focus.title} › ${ordinaryContextLabel}`,
          code,
          keywords: [
            'thread', 'scope', thread.title, focus.title, ordinaryContextLabel,
            thread.status, thread.health, code
          ],
          status: workStatusLabel(thread.status),
          ...(thread.health === 'none' ? {} : { state: healthStateLabel(thread.health) }),
          destination: {
            type: 'focus' as const,
            target: focusTarget(focus.id, thread.id)
          }
        }
        const scopedDestinations = !scope || scope.scopeId === null ? [] : scope.subjects
          .filter((subject) => !hideSensitiveContent || !subject.sensitive)
          .map((subject): CommandPaletteItemModel => ({
            id: `thread:${thread.id}:scope:${scope.scopeId}:subject:${subject.id}`,
            icon: 'branch',
            label: thread.title,
            description: `${focus.title} › ${subject.name}`,
            code,
            keywords: [
              'thread',
              'scope',
              'subject',
              thread.title,
              focus.title,
              subject.name,
              code,
              entityReference('subject', subject.id),
              thread.status,
              thread.health
            ],
            status: workStatusLabel(thread.status),
            ...(thread.health === 'none' ? {} : { state: healthStateLabel(thread.health) }),
            destination: {
              type: 'focus',
              target: focusTarget(focus.id, thread.id, null, subject.id)
            }
          }))
        return [ordinaryDestination, ...scopedDestinations]
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
        const code = entityReference('commitment', commitment.id)
        const ordinaryDestination: CommandPaletteItemModel = {
          id: `commitment:${commitment.id}`,
          icon: 'item' as const,
          label: commitment.title,
          description: `${path} › ${ordinaryContextLabel}`,
          code,
          keywords: [
            'commitment',
            commitment.title,
            context.focus.title,
            parent,
            ordinaryContextLabel,
            code,
            commitment.status,
            commitment.state
          ],
          status: workStatusLabel(commitment.status),
          ...(commitment.state === 'none'
            ? {}
            : { state: healthStateLabel(commitment.state) }),
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
            code,
            keywords: [
              'commitment',
              'scope',
              'subject',
              commitment.title,
              context.focus.title,
              parent,
              cell.subject.name,
              code,
              entityReference('subject', cell.subjectId),
              commitment.status,
              cell.state
            ],
            status: workStatusLabel(commitment.status),
            ...(cell.state === 'none' ? {} : { state: healthStateLabel(cell.state) }),
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
        const code = entityReference('todo', todo.id)
        return [{
          id: `todo:${todo.id}`,
          icon: 'check' as const,
          label: todo.name,
          description: path.join(' › '),
          code,
          keywords: [
            'todo', todo.name, todo.done ? 'done' : 'open', code,
            ...(todo.subject ? [entityReference('subject', todo.subject.id)] : []),
            ...path
          ],
          status: todoStatus(todo),
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
