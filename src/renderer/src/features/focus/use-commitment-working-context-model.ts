import { useCallback, useEffect, useState } from 'react'
import type { CommitmentWorkingContextSnapshot } from '../../../../shared/contracts'

export interface CommitmentWorkingContextModel {
  snapshot: CommitmentWorkingContextSnapshot | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** Loads the exact current Scope cells for the selected Commitment. */
export function useCommitmentWorkingContextModel(
  commitmentId: number | null
): CommitmentWorkingContextModel {
  const [result, setResult] = useState<{
    commitmentId: number | null
    snapshot: CommitmentWorkingContextSnapshot | null
    loading: boolean
    error: string | null
  }>({ commitmentId: null, snapshot: null, loading: false, error: null })

  const refresh = useCallback(async (): Promise<void> => {
    if (commitmentId === null) return
    try {
      const snapshot = await window.onmove.domain.getCommitmentWorkingContext(commitmentId)
      setResult({ commitmentId, snapshot, loading: false, error: null })
    } catch (error) {
      setResult({
        commitmentId,
        snapshot: null,
        loading: false,
        error: 'The Commitment working context could not be loaded.'
      })
      throw error
    }
  }, [commitmentId])

  useEffect(() => {
    let active = true
    if (commitmentId === null) return () => { active = false }

    window.onmove.domain.getCommitmentWorkingContext(commitmentId).then(
      (nextSnapshot) => {
        if (!active) return
        setResult({
          commitmentId,
          snapshot: nextSnapshot,
          loading: false,
          error: null
        })
      },
      () => {
        if (!active) return
        setResult({
          commitmentId,
          snapshot: null,
          loading: false,
          error: 'The Commitment working context could not be loaded.'
        })
      }
    )

    return () => { active = false }
  }, [commitmentId, refresh])

  return result.commitmentId === commitmentId
    ? { ...result, refresh }
    : {
        snapshot: null,
        loading: commitmentId !== null,
        error: null,
        refresh
      }
}
