import type {
  CommitmentSnapshot,
  DomainApi,
  HealthState,
  UpdateSnapshot
} from '../../../../shared/contracts'

export interface ActiveCommitmentState {
  id: number
  title: string
  state: HealthState
  sensitive: boolean
  ancestorSensitive?: boolean
}

export interface DirectUpdateState {
  id: number
  date: string
  state: HealthState
  sensitive: boolean
}

export interface StatusSummary {
  overallState: HealthState
  activeCommitments: readonly ActiveCommitmentState[]
  directUpdates?: readonly DirectUpdateState[]
}

export const EMPTY_STATUS_SUMMARY: StatusSummary = {
  overallState: 'none',
  activeCommitments: []
}

type StatusSummaryDataSource = Pick<
  DomainApi,
  'listThreads' | 'listCommitments' | 'listUpdates'
>

function newestUpdate(updates: readonly UpdateSnapshot[]): UpdateSnapshot | undefined {
  return updates.reduce<UpdateSnapshot | undefined>((newest, candidate) => {
    if (!newest) return candidate
    if (candidate.date !== newest.date) return candidate.date > newest.date ? candidate : newest
    return candidate.id > newest.id ? candidate : newest
  }, undefined)
}

/** Business projection consumed by compact status visualizations. */
export function buildStatusSummary(
  directUpdates: readonly UpdateSnapshot[],
  commitments: readonly CommitmentSnapshot[],
  ancestorSensitive = false
): StatusSummary {
  const activeCommitments = new Map<number, ActiveCommitmentState>()
  for (const commitment of commitments) {
    if (commitment.status === 'active' && !activeCommitments.has(commitment.id)) {
      activeCommitments.set(commitment.id, {
        id: commitment.id,
        title: commitment.title,
        state: commitment.state,
        sensitive: commitment.sensitive,
        ancestorSensitive
      })
    }
  }
  return {
    overallState: newestUpdate(directUpdates)?.state ?? 'none',
    activeCommitments: [...activeCommitments.values()],
    directUpdates: directUpdates.map((update) => ({
      id: update.id,
      date: update.date,
      state: update.state,
      sensitive: update.sensitive
    }))
  }
}

function newestDirectUpdate(
  updates: readonly DirectUpdateState[]
): DirectUpdateState | undefined {
  return updates.reduce<DirectUpdateState | undefined>((newest, candidate) => {
    if (!newest) return candidate
    if (candidate.date !== newest.date) return candidate.date > newest.date ? candidate : newest
    return candidate.id > newest.id ? candidate : newest
  }, undefined)
}

/** Materialize a summary using the same visibility policy as its owning collection. */
export function statusSummaryForVisibility(
  summary: StatusSummary,
  hideSensitiveContent: boolean
): StatusSummary {
  if (!hideSensitiveContent) return summary
  const directUpdates = summary.directUpdates?.filter((update) => !update.sensitive)
  return {
    overallState: directUpdates
      ? (newestDirectUpdate(directUpdates)?.state ?? 'none')
      : summary.overallState,
    activeCommitments: summary.activeCommitments.filter(
      (commitment) => !commitment.sensitive && !commitment.ancestorSensitive
    ),
    ...(directUpdates ? { directUpdates } : {})
  }
}

export async function loadThreadStatusSummary(
  source: StatusSummaryDataSource,
  threadId: number
): Promise<StatusSummary> {
  const [updates, commitments] = await Promise.all([
    source.listUpdates({ type: 'thread', id: threadId }),
    source.listCommitments({ type: 'thread', id: threadId })
  ])
  return buildStatusSummary(updates, commitments)
}

/** A Focus summary includes direct and Thread-parented active Commitments in one rollup. */
export async function loadFocusStatusSummary(
  source: StatusSummaryDataSource,
  focusId: number
): Promise<StatusSummary> {
  const [updates, directCommitments, threads] = await Promise.all([
    source.listUpdates({ type: 'focus', id: focusId }),
    source.listCommitments({ type: 'focus', id: focusId }),
    source.listThreads(focusId)
  ])
  const nestedCommitments = await Promise.all(
    threads.map(async (thread) => ({
      thread,
      commitments: await source.listCommitments({ type: 'thread', id: thread.id })
    }))
  )
  const directSummary = buildStatusSummary(updates, directCommitments)
  const activeCommitments = new Map<number, ActiveCommitmentState>()
  for (const commitment of [
    ...directSummary.activeCommitments,
    ...nestedCommitments.flatMap(({ thread, commitments }) =>
      buildStatusSummary([], commitments, thread.sensitive).activeCommitments
    )
  ]) {
    if (!activeCommitments.has(commitment.id)) {
      activeCommitments.set(commitment.id, commitment)
    }
  }
  return {
    ...directSummary,
    activeCommitments: [...activeCommitments.values()]
  }
}
