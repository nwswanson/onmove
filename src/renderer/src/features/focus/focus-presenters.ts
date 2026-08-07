import type {
  CommitmentSnapshot,
  CommitmentStatus,
  FocusSnapshot,
  FocusStatus,
  ThreadSnapshot,
  UpdateFocusInput,
  UpdateThreadInput
} from '../../../../shared/contracts'
import type {
  ContextDrawerAdapter,
  ContextDrawerValues
} from '@/components/ui/context-drawer'
import type { ContextualSidebarItemModel } from '@/components/ui/contextual-sidebar'
import type { LifecycleStatusOptionModel } from '@/components/ui/lifecycle-status'
import type { SidebarNavigationItemModel } from '@/components/ui/sidebar-navigation'
import { buildCommitmentListModel } from '@/features/focus/commitment-list-model'
import { healthStateLabel } from '@/features/shared/state-presenters'

const FOCUS_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'done', label: 'Done' }
] as const

export const COMMITMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active', tone: 'primary' },
  { value: 'paused', label: 'Paused', tone: 'neutral' },
  { value: 'done', label: 'Done', tone: 'success' },
  { value: 'cancelled', label: 'Cancelled', tone: 'danger' }
] as const satisfies readonly LifecycleStatusOptionModel[]

/** Translate a domain lifecycle status into the receiver-owned visual contract. */
export function commitmentStatusLabel(
  status: CommitmentStatus
): LifecycleStatusOptionModel {
  const option = COMMITMENT_STATUS_OPTIONS.find((candidate) => candidate.value === status)
  if (!option) throw new Error(`Unsupported Commitment status "${status}".`)
  return option
}

function textValue(values: ContextDrawerValues, id: string): string {
  const value = values[id]
  return typeof value === 'string' ? value : ''
}

function booleanValue(values: ContextDrawerValues, id: string): boolean {
  return values[id] === true
}

export function dateOrNeverLabel(value: string | null): string {
  return value ?? 'Never'
}

export function focusPrimaryNavigationItems(
  focuses: readonly FocusSnapshot[]
): SidebarNavigationItemModel[] {
  return focuses.map((focus) => {
    const paused = focus.status === 'paused'
    return {
      id: String(focus.id),
      label: focus.title,
      ariaLabel: `${focus.title}${paused ? ', paused' : ''}`,
      icon: paused ? 'paused' : 'item',
      tone: paused ? 'muted' : 'default'
    }
  })
}

export function threadSidebarItemId(threadId: number): string {
  return `thread:${threadId}`
}

export function focusContextSidebarItems(
  threads: readonly ThreadSnapshot[]
): ContextualSidebarItemModel[] {
  return [
    {
      id: 'overall',
      label: 'Overall',
      icon: 'overview',
      group: { id: 'focus', label: 'Focus' }
    },
    ...threads.map((thread) => ({
      id: threadSidebarItemId(thread.id),
      label: thread.title,
      ariaLabel: `${thread.title}${thread.status === 'paused' ? ', paused' : ''}`,
      icon: thread.status === 'paused' ? ('paused' as const) : ('item' as const),
      tone: thread.status === 'paused' ? ('muted' as const) : ('default' as const),
      group: { id: 'threads', label: 'Threads' }
    }))
  ]
}

export function commitmentContextSidebarItems(
  commitments: readonly CommitmentSnapshot[]
): ContextualSidebarItemModel[] {
  return buildCommitmentListModel(commitments).groups.flatMap((group) =>
    group.commitments.map((commitment) => {
      const status = commitmentStatusLabel(commitment.status)
      return {
        id: String(commitment.id),
        label: commitment.title,
        description: `${status.label} · Last updated · ${dateOrNeverLabel(commitment.lastUpdateDate)}`,
        group: { id: group.id, label: group.label },
        lines: 2,
        stateLabel: healthStateLabel(commitment.state),
        accessory: 'disclosure'
      }
    })
  )
}

export function focusDrawerAdapter({
  focus,
  onSave,
  onDelete
}: {
  focus: FocusSnapshot
  onSave: (input: UpdateFocusInput) => Promise<void>
  onDelete: () => Promise<void>
}): ContextDrawerAdapter {
  return {
    id: `focus:${focus.id}`,
    invalidationKeys: [`focus:${focus.id}`],
    model: {
      title: 'Focus',
      description: focus.title,
      ariaLabel: 'Focus context drawer',
      sections: [
        {
          id: 'identity',
          fields: [
            {
              kind: 'text',
              id: 'title',
              label: 'Title',
              value: focus.title,
              required: true
            },
            {
              kind: 'select',
              id: 'status',
              label: 'Status',
              value: focus.status,
              options: FOCUS_STATUS_OPTIONS
            },
            { kind: 'static', id: 'kind', label: 'Kind', value: focus.kind },
            {
              kind: 'static',
              id: 'last-reviewed',
              label: 'Last reviewed',
              value: dateOrNeverLabel(focus.lastReviewDate)
            },
            {
              kind: 'checkbox',
              id: 'needs-review',
              label: 'Needs review',
              value: focus.needsReview,
              description: 'Include this Focus in review workflows.'
            },
            {
              kind: 'rich-text',
              id: 'description',
              label: 'Description / notes',
              value: focus.description ?? ''
            }
          ]
        }
      ],
      autosave: {
        fieldIds: ['title', 'description'],
        errorMessage: 'The focus text could not be saved. Please try again.',
        onInvoke: (values) =>
          onSave({
            title: textValue(values, 'title'),
            description:
              textValue(values, 'description').trim().length === 0
                ? null
                : textValue(values, 'description')
          })
      },
      actions: [
        {
          id: 'delete',
          label: 'Delete',
          pendingLabel: 'Deleting…',
          variant: 'destructive',
          align: 'start',
          confirmation: {
            title: 'Delete focus?',
            description: `“${focus.title}” and its status history will be permanently deleted.`,
            body: 'This action cannot be undone.',
            confirmLabel: 'Delete focus'
          },
          errorMessage: 'The focus could not be deleted. Please try again.',
          onInvoke: onDelete
        },
        {
          id: 'save',
          label: 'Save changes',
          pendingLabel: 'Saving…',
          requiresValidFields: true,
          includesAutosaveFields: true,
          errorMessage: 'The focus could not be updated. Please try again.',
          onInvoke: (values) =>
            onSave({
              title: textValue(values, 'title'),
              description:
                textValue(values, 'description').trim().length === 0
                  ? null
                  : textValue(values, 'description'),
              status: textValue(values, 'status') as FocusStatus,
              needsReview: booleanValue(values, 'needs-review')
            })
        }
      ]
    }
  }
}

export function threadDrawerAdapter(
  thread: ThreadSnapshot,
  parentTitle: string,
  onSave: (input: UpdateThreadInput) => Promise<void>
): ContextDrawerAdapter {
  return {
    id: `thread:${thread.id}`,
    invalidationKeys: [`focus:${thread.focusId}`, `thread:${thread.id}`],
    model: {
      title: 'Thread',
      description: thread.title,
      ariaLabel: 'Thread context drawer',
      sections: [
        {
          id: 'details',
          fields: [
            { kind: 'static', id: 'title', label: 'Title', value: thread.title },
            { kind: 'static', id: 'parent', label: 'Parent', value: `Focus — ${parentTitle}` },
            {
              kind: 'static',
              id: 'status',
              label: 'Status',
              value: thread.status,
              capitalization: 'capitalize'
            },
            {
              kind: 'static',
              id: 'review-frequency',
              label: 'Review frequency',
              value: `${thread.reviewFrequencyDays} days`
            },
            {
              kind: 'static',
              id: 'last-reviewed',
              label: 'Last reviewed',
              value: dateOrNeverLabel(thread.lastReviewDate)
            },
            {
              kind: 'checkbox',
              id: 'needs-review',
              label: 'Needs review',
              value: thread.needsReview,
              description: 'Include this Thread in review workflows.'
            }
          ]
        }
      ],
      actions: [
        {
          id: 'save',
          label: 'Save changes',
          pendingLabel: 'Saving…',
          errorMessage: 'The thread could not be updated. Please try again.',
          onInvoke: (values) =>
            onSave({ needsReview: booleanValue(values, 'needs-review') })
        }
      ]
    }
  }
}

export function commitmentDrawerAdapter(
  commitment: CommitmentSnapshot,
  parentTitle: string,
  ancestorKeys: readonly string[] = []
): ContextDrawerAdapter {
  const parentKind = commitment.parent.type === 'focus' ? 'Focus' : 'Thread'
  return {
    id: `commitment:${commitment.id}`,
    invalidationKeys: [
      ...new Set([
        ...ancestorKeys,
        `${commitment.parent.type}:${commitment.parent.id}`,
        `commitment:${commitment.id}`
      ])
    ],
    model: {
      title: 'Commitment',
      description: commitment.title,
      ariaLabel: 'Commitment context drawer',
      sections: [
        {
          id: 'details',
          fields: [
            { kind: 'static', id: 'title', label: 'Title', value: commitment.title },
            {
              kind: 'static',
              id: 'parent',
              label: 'Parent',
              value: `${parentKind} — ${parentTitle}`
            },
            {
              kind: 'static',
              id: 'status',
              label: 'Status',
              value: commitment.status,
              capitalization: 'capitalize'
            },
            {
              kind: 'static',
              id: 'state',
              label: 'State',
              value: commitment.state,
              capitalization: 'capitalize'
            },
            {
              kind: 'static',
              id: 'last-updated',
              label: 'Last updated',
              value: dateOrNeverLabel(commitment.lastUpdateDate)
            }
          ],
          note: 'No editable settings here yet.'
        }
      ]
    }
  }
}
