import { useEffect, useState } from 'react'
import type { FocusSnapshot } from '../../../../shared/contracts'
import {
  updateCommandGroups,
  type UpdateCommandGroupModel,
  type UpdateCommandGraph
} from '@/features/updates/update-command-presenters'

interface UpdateCommandModel {
  groups: readonly UpdateCommandGroupModel[]
  loading: boolean
  error: string | null
}

async function loadUpdateCommandGraph(
  focuses: readonly FocusSnapshot[]
): Promise<UpdateCommandGraph> {
  const bundles = await Promise.all(focuses.map(async (focus) => {
    const threads = await window.onmove.domain.listThreads(focus.id)
    const [threadScopes, threadCommitments] = await Promise.all([
      Promise.all(threads.map(async (thread) => [
        thread.id,
        await window.onmove.domain.getThreadScope(thread.id)
      ] as const)),
      Promise.all(threads.map((thread) =>
        window.onmove.domain.listCommitments({ type: 'thread', id: thread.id })))
    ])
    return {
      threads,
      commitments: threadCommitments.flat(),
      threadScopes
    }
  }))
  const commitments = bundles.flatMap(({ commitments: records }) => records)
  const commitmentContexts = await Promise.all(commitments.map(async (commitment) => [
    commitment.id,
    await window.onmove.domain.getCommitmentWorkingContext(commitment.id)
  ] as const))

  return {
    focuses,
    threads: bundles.flatMap(({ threads }) => threads),
    commitments,
    threadScopes: new Map(bundles.flatMap(({ threadScopes }) => threadScopes)),
    commitmentContexts: new Map(commitmentContexts)
  }
}

/** Loads the bounded update graph only while the Cmd-P chooser is open. */
export function useUpdateCommandModel({
  open,
  focuses,
  hideSensitiveContent
}: {
  open: boolean
  focuses: readonly FocusSnapshot[]
  hideSensitiveContent: boolean
}): UpdateCommandModel {
  const [graph, setGraph] = useState<UpdateCommandGraph | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    Promise.resolve().then(() => {
      if (active) setError(null)
      return loadUpdateCommandGraph(focuses)
    }).then(
      (next) => {
        if (!active) return
        setGraph(next)
      },
      () => {
        if (!active) return
        setError('Update destinations could not be loaded.')
      }
    )
    return () => {
      active = false
    }
  }, [focuses, open])

  return {
    groups: graph ? updateCommandGroups(graph, hideSensitiveContent) : [],
    loading: open && graph === null && error === null,
    error
  }
}
