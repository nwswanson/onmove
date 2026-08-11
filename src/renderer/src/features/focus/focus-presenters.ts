import type {
  CommitmentSnapshot,
  CommitmentWorkingContextSnapshot,
  CommitmentType,
  FocusSnapshot,
  FocusScopeSnapshot,
  FocusStatus,
  HealthState,
  ThreadSnapshot,
  ThreadScopeSnapshot,
  ThreadSubjectCellSnapshot,
  UpdateCommitmentInput,
  UpdateFocusInput,
  UpdateThreadInput
} from '../../../../shared/contracts'
import type {
  ContextDrawerAdapter,
  ContextDrawerSectionModel,
  ContextDrawerValues
} from '@/components/ui/context-drawer'
import type {
  ContextualSidebarChildCollectionModel,
  ContextualSidebarItemModel
} from '@/components/ui/contextual-sidebar'
import type { SidebarNavigationItemModel } from '@/components/ui/sidebar-navigation'
import type {
  SemanticSunflowerModel,
  SemanticSunflowerTone
} from '@/components/ui/sunflower'
import type { CommitmentCollectionModel } from '@/features/focus/commitment-ui'
import type {
  FocusScopeEditorModel
} from '@/features/focus/focus-scope-ui'
import type { WorkspaceTabBarModel } from '@/components/ui/workspace-tab-bar'
import {
  buildCommitmentListModel,
  commitmentCompletionModel,
  type CommitmentListModel
} from '@/features/focus/commitment-list-model'
import { healthStateLabel } from '@/features/shared/state-presenters'
import {
  EMPTY_STATUS_SUMMARY,
  statusSummaryForVisibility,
  type StatusSummary
} from '@/features/shared/status-summary'
import {
  WORK_STATUS_OPTIONS,
  workStatusLabel
} from '@/features/shared/work-status'

export const COMMITMENT_TYPE_OPTIONS = [
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'action', label: 'Action' }
] as const satisfies readonly { value: CommitmentType; label: string }[]

export function commitmentTypeLabel(type: CommitmentType): string {
  const option = COMMITMENT_TYPE_OPTIONS.find((candidate) => candidate.value === type)
  if (!option) throw new Error(`Unsupported Commitment type "${type}".`)
  return option.label
}

export function commitmentDueDateLabel(dueDate: string | null): string {
  return dueDate ?? 'No due date'
}

function textValue(values: ContextDrawerValues, id: string): string {
  const value = values[id]
  return typeof value === 'string' ? value : ''
}

function booleanValue(values: ContextDrawerValues, id: string): boolean {
  return values[id] === true
}

function positiveDaysValue(values: ContextDrawerValues, id: string): number {
  const value = Number(textValue(values, id))
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${id} must be a positive whole number of days`)
  }
  return value
}

export function dateOrNeverLabel(value: string | null): string {
  return value ?? 'Never'
}

export function focusScopeEditorModel(scope: FocusScopeSnapshot): FocusScopeEditorModel {
  return {
    summary: scope.mode === 'open'
      ? 'Open scope — add a Subject to define its boundary.'
      : subjectCountLabel(scope.subjects.length),
    subjects: scope.subjects.map(({ id, name }) => ({ id, name }))
  }
}

export function threadWorkingContextModel(
  scope: ThreadScopeSnapshot,
  subjectMatrix: readonly ThreadSubjectCellSnapshot[] = []
): WorkspaceTabBarModel {
  return {
    ariaLabel: 'Thread working context',
    items: [
      {
        id: 'all',
        label: scope.subjects.length ? 'All subjects' : 'Thread-wide'
      },
      ...scope.subjects.map(({ id, name }) => {
        const cell = subjectMatrix.find(({ subjectId }) => subjectId === id)
        return {
          id: `subject:${id}`,
          label: name,
          accessibleLabel: `Work in ${name}`,
          stateLabel: healthStateLabel(cell?.state ?? 'none'),
          meta: `Last reviewed · ${dateOrNeverLabel(cell?.lastReviewDate ?? null)}`,
          attentionLabel: cell?.reviewDue ? 'Review due' : undefined
        }
      })
    ]
  }
}

export function commitmentWorkingContextModel(
  context: CommitmentWorkingContextSnapshot
): WorkspaceTabBarModel {
  const bounded = context.scopeId !== null
  return {
    ariaLabel: 'Commitment working context',
    items: [
      {
        id: 'all',
        label: bounded
          ? context.cells.length > 0 ? 'All subjects' : 'No subjects'
          : 'Commitment-wide'
      },
      ...context.cells.map((cell) => ({
        id: `subject:${cell.subjectId}`,
        label: cell.subject.name,
        accessibleLabel: `Work in ${cell.subject.name}`,
        stateLabel: healthStateLabel(cell.state),
        meta: `Last updated · ${dateOrNeverLabel(cell.lastUpdateDate)}`,
        attentionLabel: cell.needsUpdate ? 'Update due' : undefined
      }))
    ]
  }
}

function subjectCountLabel(count: number): string {
  return count === 1 ? '1 Subject in scope' : `${count} Subjects in scope`
}

const HEALTH_STATE_TONES: Readonly<Record<HealthState, SemanticSunflowerTone>> = {
  red: 'danger',
  yellow: 'warning',
  green: 'success',
  none: 'neutral'
}

const HEALTH_STATE_NAMES: Readonly<Record<HealthState, string>> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  none: 'None'
}

export type StatusSummariesById = Readonly<Record<number, StatusSummary | undefined>>

export function statusSunflowerModel(
  summary: StatusSummary,
  hideSensitiveContent = false
): SemanticSunflowerModel {
  const visibleSummary = statusSummaryForVisibility(summary, hideSensitiveContent)
  const commitmentDescription = visibleSummary.activeCommitments.length === 0
    ? 'no active commitments'
    : `active commitments: ${visibleSummary.activeCommitments
        .map((commitment) => `${commitment.title} ${HEALTH_STATE_NAMES[commitment.state]}`)
        .join(', ')}`

  return {
    ariaLabel: `Overall ${HEALTH_STATE_NAMES[visibleSummary.overallState]}; ${commitmentDescription}`,
    seeds: [
      {
        id: 'overall',
        label: `Overall: ${HEALTH_STATE_NAMES[visibleSummary.overallState]}`,
        tone: HEALTH_STATE_TONES[visibleSummary.overallState]
      },
      ...visibleSummary.activeCommitments.map((commitment) => ({
        id: `commitment:${commitment.id}`,
        label: `${commitment.title}: ${HEALTH_STATE_NAMES[commitment.state]}`,
        tone: HEALTH_STATE_TONES[commitment.state]
      }))
    ]
  }
}

export function focusPrimaryNavigationItems(
  focuses: readonly FocusSnapshot[],
  summaries: StatusSummariesById = {},
  hideSensitiveContent = false
): SidebarNavigationItemModel[] {
  return focuses.map((focus) => {
    const paused = focus.status === 'paused'
    const label = focus.title
    const sunflower = statusSunflowerModel(
      summaries[focus.id] ?? EMPTY_STATUS_SUMMARY,
      hideSensitiveContent
    )
    return {
      id: String(focus.id),
      label,
      ariaLabel: `${label}${paused ? ', paused' : ''}`,
      icon: paused ? 'paused' : 'sunflower',
      ...(paused ? {} : { sunflower }),
      tone: paused ? 'muted' : 'default',
      dropTarget: { type: 'focus', id: String(focus.id) }
    }
  })
}

export function threadSidebarItemId(threadId: number): string {
  return `thread:${threadId}`
}

export type CommitmentsByContextItemId = Readonly<
  Record<string, readonly CommitmentSnapshot[] | undefined>
>

function commitmentChildCollection(
  ownerLabel: string,
  commitments: readonly CommitmentSnapshot[]
): ContextualSidebarChildCollectionModel {
  return {
    id: 'commitments',
    label: 'Commitments',
    emptyState: 'No commitments',
    action: {
      id: 'add',
      label: 'Add commitment',
      ariaLabel: `Add commitment to ${ownerLabel}`
    },
    items: buildCommitmentListModel(commitments).ordered.map((commitment) => ({
      id: String(commitment.id),
      label: commitment.title,
      ariaLabel: `Open ${ownerLabel} commitment ${commitment.title}`,
      state: healthStateLabel(commitment.state),
      tone: commitment.status === 'active' ? 'default' : 'muted'
    }))
  }
}

export function focusContextSidebarItems(
  threads: readonly ThreadSnapshot[],
  summaries: StatusSummariesById = {},
  hideSensitiveContent = false,
  commitmentsByItemId?: CommitmentsByContextItemId
): ContextualSidebarItemModel[] {
  return [
    {
      id: 'overall',
      label: 'Overall',
      icon: 'overview',
      ...(commitmentsByItemId
        ? {
            childCollection: commitmentChildCollection(
              'Overall',
              commitmentsByItemId.overall ?? []
            )
          }
        : {}),
      group: { id: 'focus', label: 'Focus' }
    },
    ...[...threads]
      .sort((left, right) => left.title.localeCompare(right.title, undefined, {
        sensitivity: 'base'
      }))
      .map((thread) => {
      const paused = thread.status === 'paused'
      const label = thread.title
      const sunflower = statusSunflowerModel(
        summaries[thread.id] ?? EMPTY_STATUS_SUMMARY,
        hideSensitiveContent
      )
      return {
        id: threadSidebarItemId(thread.id),
        label,
        ariaLabel: `${label}${paused ? ', paused' : ''}`,
        icon: paused ? ('paused' as const) : ('sunflower' as const),
        ...(paused ? {} : { sunflower }),
        ...(commitmentsByItemId
          ? {
              childCollection: commitmentChildCollection(
                label,
                commitmentsByItemId[threadSidebarItemId(thread.id)] ?? []
              )
            }
          : {}),
        tone: paused ? ('muted' as const) : ('default' as const),
        movable: true,
        group: { id: 'threads', label: 'Threads' }
      }
      })
  ]
}

export function commitmentContextSidebarItems(
  commitments: readonly CommitmentSnapshot[]
): ContextualSidebarItemModel[] {
  return buildCommitmentListModel(commitments).groups.flatMap((group) =>
    group.commitments.map((commitment) => {
      const status = workStatusLabel(commitment.status)
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

/** Translate ordered Commitment business projections into the list receiver's visual contract. */
export function commitmentCollectionModel(
  model: CommitmentListModel
): CommitmentCollectionModel {
  const groups = model.groups.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.commitments.map((commitment) => ({
      id: commitment.id,
      title: commitment.title,
      typeLabel: commitmentTypeLabel(commitment.type),
      statusLabel: workStatusLabel(commitment.status),
      lastUpdatedLabel: dateOrNeverLabel(commitment.lastUpdateDate),
      dueDateLabel: commitment.dueDate,
      stateLabel: healthStateLabel(commitment.state),
      completion: commitmentCompletionModel(commitment)
    }))
  }))

  return {
    currentCount: model.current.length,
    closedCount: model.closed.length,
    groups
  }
}

export function focusDrawerAdapter({
  focus,
  onSave,
  onDescriptionChange,
  onOpenDescription,
  onDelete
}: {
  focus: FocusSnapshot
  onSave: (input: UpdateFocusInput) => Promise<void>
  onDescriptionChange?: (value: string) => void
  onOpenDescription?: () => void
  onDelete: () => Promise<void>
}): ContextDrawerAdapter {
  return {
    id: `focus:${focus.id}`,
    revision: [
      focus.title,
      focus.status,
      focus.statusChangedAt,
      focus.lastReviewDate ?? 'never',
      focus.needsReview,
      focus.sensitive
    ].join(':'),
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
              options: WORK_STATUS_OPTIONS
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
              kind: 'checkbox',
              id: 'sensitive',
              label: 'Sensitive',
              value: focus.sensitive,
              description: 'Hide this Focus and its descendants from lists.'
            },
            {
              kind: 'rich-text',
              id: 'description',
              label: 'Description / notes',
              value: focus.description ?? '',
              onValueChange: onDescriptionChange,
              onOpenInWindow: onOpenDescription,
              errorMessage: 'The description could not be saved. Keep editing to retry.',
              externalRevision: focus.updatedAt
            }
          ]
        }
      ],
      autosave: {
        fieldIds: ['title'],
        errorMessage: 'The focus text could not be saved. Please try again.',
        onInvoke: (values: ContextDrawerValues) =>
          onSave({
            title: textValue(values, 'title')
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
              description: textValue(values, 'description').trim().length === 0
                ? null
                : textValue(values, 'description'),
              status: textValue(values, 'status') as FocusStatus,
              needsReview: booleanValue(values, 'needs-review'),
              sensitive: booleanValue(values, 'sensitive')
            })
        }
      ]
    }
  }
}

interface NestedScopeEditor {
  mode: string
  subjects: readonly { id: number; name: string }[]
  parentSubjects: readonly { id: number; name: string }[]
  availableSubjects: readonly { id: number; name: string }[]
  parentLabel: 'Focus' | 'Thread'
  onCustomize: () => Promise<void>
  onFollowParent: () => Promise<void>
  onAddSubject: (name: string) => Promise<void>
  onRemoveSubject: (subjectId: number) => Promise<void>
}

function nestedScopeEditorSection(editor: NestedScopeEditor): ContextDrawerSectionModel {
  const selectedSubjectIds = new Set(editor.subjects.map(({ id }) => id))
  const availableSubjects = [...new Map(
    editor.availableSubjects.map((subject) => [subject.id, subject])
  ).values()]
  const parentSuppliesSubjects = editor.parentSubjects.length > 0
  return {
    id: 'scope',
    fields: [
      {
        kind: 'choice',
        id: 'scope-mode',
        label: 'Scope definition',
        value: editor.mode === 'inherited' ? 'inherited' : 'custom',
        options: [
          {
            value: 'inherited',
            label: `Inherit ${editor.parentLabel} scope`,
            description: parentSuppliesSubjects
              ? `Follow the ${editor.parentLabel} Subject set as it changes.`
              : `${editor.parentLabel} currently supplies no Subjects; inheritance remains item-wide until that changes.`
          },
          {
            value: 'custom',
            label: 'Custom scope',
            description: `Override the ${editor.parentLabel} Subject set for this item.`
          }
        ],
        errorMessage: 'The scope mode could not be changed.',
        onValueChange: (value) =>
          value === 'inherited'
            ? editor.onFollowParent()
            : editor.onCustomize()
      },
      {
        kind: 'token-list',
        id: 'scope-subjects',
        label: 'Subjects in custom scope',
        items: editor.subjects.map(({ id, name }) => ({ id: String(id), label: name })),
        suggestions: availableSubjects
          .filter(({ id }) => !selectedSubjectIds.has(id))
          .map(({ id, name }) => ({ id: String(id), label: name })),
        inputLabel: 'Add a Subject to custom scope',
        placeholder: 'Add a Subject…',
        errorMessage: 'The custom Subject set could not be changed.',
        visibleWhen: { fieldId: 'scope-mode', equals: 'custom' },
        onAdd: editor.onAddSubject,
        onRemove: (subjectId) => editor.onRemoveSubject(Number(subjectId))
      }
    ],
    note: parentSuppliesSubjects
      ? 'Scope changes apply immediately. Existing Updates retain their original cell attribution.'
      : `The ${editor.parentLabel} has no Subjects to inherit. Use the available Focus Subjects below for a custom scope, or define the ${editor.parentLabel} scope first.`
  }
}

export function threadDrawerAdapter({
  thread,
  parentTitle,
  onSave,
  onDelete,
  scopeEditor
}: {
  thread: ThreadSnapshot
  parentTitle: string
  onSave: (input: UpdateThreadInput) => Promise<void>
  onDelete: () => Promise<void>
  scopeEditor?: {
    scope: ThreadScopeSnapshot
    onCustomize: () => Promise<void>
    onFollowFocus: () => Promise<void>
    onAddSubject: (name: string) => Promise<void>
    onRemoveSubject: (subjectId: number) => Promise<void>
  }
}): ContextDrawerAdapter {
  return {
    id: `thread:${thread.id}`,
    revision: `${thread.updatedAt}:${thread.sensitive}`,
    invalidationKeys: [`focus:${thread.focusId}`, `thread:${thread.id}`],
    model: {
      title: 'Thread',
      description: thread.title,
      ariaLabel: 'Thread context drawer',
      sections: [
        {
          id: 'details',
          fields: [
            {
              kind: 'text',
              id: 'title',
              label: 'Title',
              value: thread.title,
              required: true
            },
            { kind: 'static', id: 'parent', label: 'Parent', value: `Focus — ${parentTitle}` },
            {
              kind: 'static',
              id: 'status',
              label: 'Status',
              value: thread.status,
              capitalization: 'capitalize'
            },
            {
              kind: 'number',
              id: 'review-frequency',
              label: 'Review every (days)',
              value: String(thread.reviewFrequencyDays),
              required: true,
              min: 1,
              step: 1,
              integer: true
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
            },
            {
              kind: 'checkbox',
              id: 'sensitive',
              label: 'Sensitive',
              value: thread.sensitive,
              description: 'Hide this Thread and its descendants from lists.'
            }
          ]
        },
        ...(scopeEditor ? [nestedScopeEditorSection({
          mode: scopeEditor.scope.mode,
          subjects: scopeEditor.scope.subjects,
          parentSubjects: scopeEditor.scope.focusSubjects,
          availableSubjects: scopeEditor.scope.focusSubjects,
          parentLabel: 'Focus',
          onCustomize: scopeEditor.onCustomize,
          onFollowParent: scopeEditor.onFollowFocus,
          onAddSubject: scopeEditor.onAddSubject,
          onRemoveSubject: scopeEditor.onRemoveSubject
        })] : [])
      ],
      autosave: {
        fieldIds: ['title', 'review-frequency'],
        errorMessage: 'The thread details could not be saved. Please try again.',
        onInvoke: (values) => onSave({
          title: textValue(values, 'title'),
          reviewFrequencyDays: positiveDaysValue(values, 'review-frequency')
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
            title: 'Delete thread?',
            description: `“${thread.title}” and everything beneath it will be permanently deleted.`,
            body: 'This includes its Commitments, Updates, Scope application, and history. This action cannot be undone.',
            confirmLabel: 'Delete thread'
          },
          errorMessage: 'The thread could not be deleted. Please try again.',
          onInvoke: onDelete
        },
        {
          id: 'save',
          label: 'Save changes',
          pendingLabel: 'Saving…',
          requiresValidFields: true,
          includesAutosaveFields: true,
          errorMessage: 'The thread could not be updated. Please try again.',
          onInvoke: (values) =>
            onSave({
              title: textValue(values, 'title'),
              reviewFrequencyDays: positiveDaysValue(values, 'review-frequency'),
              needsReview: booleanValue(values, 'needs-review'),
              sensitive: booleanValue(values, 'sensitive')
            })
        }
      ]
    }
  }
}

export function commitmentDrawerAdapter({
  commitment,
  parentTitle,
  onSave,
  onDelete,
  ancestorKeys = []
}: {
  commitment: CommitmentSnapshot
  parentTitle: string
  onSave: (input: UpdateCommitmentInput) => Promise<void>
  onDelete: () => Promise<void>
  ancestorKeys?: readonly string[]
}): ContextDrawerAdapter {
  const parentKind = commitment.parent.type === 'focus' ? 'Focus' : 'Thread'
  return {
    id: `commitment:${commitment.id}`,
    revision: `${commitment.updatedAt}:${commitment.sensitive}`,
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
            {
              kind: 'text',
              id: 'title',
              label: 'Title',
              value: commitment.title,
              required: true
            },
            {
              kind: 'static',
              id: 'parent',
              label: 'Parent',
              value: `${parentKind} — ${parentTitle}`
            },
            {
              kind: 'static',
              id: 'type',
              label: 'Type',
              value: commitmentTypeLabel(commitment.type)
            },
            {
              kind: 'static',
              id: 'due-date',
              label: 'Due date',
              value: commitmentDueDateLabel(commitment.dueDate)
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
            },
            {
              kind: 'checkbox',
              id: 'sensitive',
              label: 'Sensitive',
              value: commitment.sensitive,
              description: 'Hide this Commitment and its Updates from lists.'
            }
          ]
        }
      ],
      autosave: {
        fieldIds: ['title'],
        errorMessage: 'The commitment title could not be saved. Please try again.',
        onInvoke: (values) => onSave({ title: textValue(values, 'title') })
      },
      actions: [
        {
          id: 'delete',
          label: 'Delete',
          pendingLabel: 'Deleting…',
          variant: 'destructive',
          align: 'start',
          confirmation: {
            title: 'Delete commitment?',
            description: `“${commitment.title}” and its Updates will be permanently deleted.`,
            body: 'This includes its Scope application and history. This action cannot be undone.',
            confirmLabel: 'Delete commitment'
          },
          errorMessage: 'The commitment could not be deleted. Please try again.',
          onInvoke: onDelete
        },
        {
          id: 'save',
          label: 'Save changes',
          pendingLabel: 'Saving…',
          requiresValidFields: true,
          includesAutosaveFields: true,
          errorMessage: 'The commitment could not be updated. Please try again.',
          onInvoke: (values) =>
            onSave({
              title: textValue(values, 'title'),
              sensitive: booleanValue(values, 'sensitive')
            })
        }
      ]
    }
  }
}
