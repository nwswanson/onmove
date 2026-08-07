import type {
  CommitmentSnapshot,
  FocusSnapshot,
  FocusStatus,
  ThreadSnapshot,
  UpdateFocusInput
} from '../../../../shared/contracts'
import type { ContextDrawerAdapter } from '@/components/ui/context-drawer'
import type { ContextualSidebarItemModel } from '@/components/ui/contextual-sidebar'
import type { SidebarNavigationItemModel } from '@/components/ui/sidebar-navigation'

const FOCUS_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'done', label: 'Done' }
] as const

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
  return commitments.map((commitment) => ({
    id: String(commitment.id),
    label: commitment.title,
    lines: 2,
    accessory: 'disclosure'
  }))
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
              kind: 'text',
              id: 'description',
              label: 'Description / notes',
              value: focus.description ?? '',
              multiline: true
            },
            {
              kind: 'select',
              id: 'status',
              label: 'Status',
              value: focus.status,
              options: FOCUS_STATUS_OPTIONS
            },
            { kind: 'static', id: 'kind', label: 'Kind', value: focus.kind }
          ]
        }
      ],
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
          errorMessage: 'The focus could not be updated. Please try again.',
          onInvoke: (values) =>
            onSave({
              title: values.title,
              description:
                values.description.trim().length === 0 ? null : values.description,
              status: values.status as FocusStatus
            })
        }
      ]
    }
  }
}

export function threadDrawerAdapter(
  thread: ThreadSnapshot,
  parentTitle: string
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
            }
          ],
          note: 'No editable settings here yet.'
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
            }
          ],
          note: 'No editable settings here yet.'
        }
      ]
    }
  }
}
