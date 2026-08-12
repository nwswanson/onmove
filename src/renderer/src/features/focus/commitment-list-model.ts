import type {
  CommitmentSnapshot,
  CommitmentStatus,
  CommitmentType,
  HealthState,
  ThreadSubjectCellSnapshot
} from '../../../../shared/contracts'

export type CommitmentListGroupId = 'active' | 'paused' | 'closed'

export interface CommitmentListGroup {
  id: CommitmentListGroupId
  label: string
  commitments: readonly CommitmentSnapshot[]
}

export interface CommitmentListModel {
  ordered: readonly CommitmentSnapshot[]
  current: readonly CommitmentSnapshot[]
  closed: readonly CommitmentSnapshot[]
  groups: readonly CommitmentListGroup[]
}

export interface CommitmentCompletionModel {
  visible: boolean
  checked: boolean
  disabled: boolean
}

const STATUS_ORDER: Readonly<Record<CommitmentStatus, number>> = {
  active: 0,
  paused: 1,
  done: 2,
  cancelled: 2
}

const ACTIVE_STATE_ORDER: Readonly<Record<HealthState, number>> = {
  red: 0,
  yellow: 1,
  green: 2,
  none: 3
}

function groupId(status: CommitmentStatus): CommitmentListGroupId {
  if (status === 'active') return 'active'
  if (status === 'paused') return 'paused'
  return 'closed'
}

/**
 * Compatibility value for the legacy database column. Due-date presence is
 * now the only UI-authored distinction and this helper can disappear with a
 * future column-removal migration.
 */
export function legacyCommitmentTypeForDueDate(
  dueDate: string | null
): CommitmentType {
  return dueDate === null ? 'ongoing' : 'action'
}

/** One-way list affordance for closing due-dated commitments through audited status updates. */
export function commitmentCompletionModel(
  commitment: Pick<CommitmentSnapshot, 'dueDate' | 'status'>
): CommitmentCompletionModel {
  if (commitment.dueDate === null) {
    return { visible: false, checked: false, disabled: true }
  }

  return {
    visible: true,
    checked: commitment.status === 'done',
    disabled: commitment.status === 'done' || commitment.status === 'cancelled'
  }
}

/**
 * Projects Thread-owned Commitments through one canonical Subject lens. Open
 * Commitments are intentionally absent because they have no Subject cell; each
 * included row receives the state and dates of this exact Commitment cell.
 */
export function commitmentsForThreadSubject(
  commitments: readonly CommitmentSnapshot[],
  subjectCell: ThreadSubjectCellSnapshot
): CommitmentSnapshot[] {
  const cellsByCommitmentId = new Map(
    subjectCell.commitments.map((cell) => [cell.commitmentId, cell])
  )
  return commitments.flatMap((commitment) => {
    const cell = cellsByCommitmentId.get(commitment.id)
    return cell
      ? [{
          ...commitment,
          state: cell.state,
          lastUpdateDate: cell.lastUpdateDate,
          nextUpdateDate: cell.nextUpdateDate,
          needsUpdate: cell.needsUpdate
        }]
      : []
  })
}

/**
 * Shared Commitment collection projection used by every list receiver.
 * Equal-ranked records retain repository order rather than inventing another business priority.
 */
export function buildCommitmentListModel(
  commitments: readonly CommitmentSnapshot[]
): CommitmentListModel {
  const ordered = commitments
    .map((commitment, index) => ({ commitment, index }))
    .sort((left, right) => {
      const statusDifference =
        STATUS_ORDER[left.commitment.status] - STATUS_ORDER[right.commitment.status]
      if (statusDifference !== 0) return statusDifference

      if (left.commitment.status === 'active' && right.commitment.status === 'active') {
        const stateDifference =
          ACTIVE_STATE_ORDER[left.commitment.state] - ACTIVE_STATE_ORDER[right.commitment.state]
        if (stateDifference !== 0) return stateDifference
      }

      return left.index - right.index
    })
    .map(({ commitment }) => commitment)

  const groups: readonly CommitmentListGroup[] = [
    {
      id: 'active',
      label: 'Active',
      commitments: ordered.filter((commitment) => groupId(commitment.status) === 'active')
    },
    {
      id: 'paused',
      label: 'Paused',
      commitments: ordered.filter((commitment) => groupId(commitment.status) === 'paused')
    },
    {
      id: 'closed',
      label: 'Done / Cancelled',
      commitments: ordered.filter((commitment) => groupId(commitment.status) === 'closed')
    }
  ]

  return {
    ordered,
    current: groups.slice(0, 2).flatMap((group) => group.commitments),
    closed: groups[2].commitments,
    groups
  }
}
