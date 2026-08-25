import { useEffect, useState } from 'react'
import type {
  CommitmentSnapshot,
  CommitmentWorkingContextSnapshot,
  FocusSnapshot,
  TagSummarySnapshot,
  ThreadScopeSnapshot,
  ThreadSnapshot,
  TodoSnapshot
} from '../../../../shared/contracts'

export interface CommandPaletteSnapshot {
  focuses: readonly FocusSnapshot[]
  threads: readonly ThreadSnapshot[]
  threadScopes: readonly ThreadScopeSnapshot[]
  commitments: readonly CommitmentSnapshot[]
  commitmentWorkingContexts: readonly CommitmentWorkingContextSnapshot[]
  todos: readonly TodoSnapshot[]
  tags: readonly TagSummarySnapshot[]
}

export interface CommandPaletteModel {
  snapshot: CommandPaletteSnapshot | null
  loading: boolean
  error: string | null
}

interface CommandPaletteModelOptions {
  open: boolean
  focuses: readonly FocusSnapshot[]
}

async function loadSnapshot(
  focuses: readonly FocusSnapshot[]
): Promise<CommandPaletteSnapshot> {
  const [focusBundles, todos, tags] = await Promise.all([
    Promise.all(focuses.map(async (focus) => {
      const [threads, focusCommitments] = await Promise.all([
        window.onmove.domain.listThreads(focus.id),
        window.onmove.domain.listCommitments({ type: 'focus', id: focus.id })
      ])
      const [threadCommitments, threadScopes] = await Promise.all([
        Promise.all(threads.map((thread) =>
          window.onmove.domain.listCommitments({ type: 'thread', id: thread.id }))),
        Promise.all(threads.map(({ id }) => window.onmove.domain.getThreadScope(id)))
      ])
      const commitments = [...focusCommitments, ...threadCommitments.flat()]
      const commitmentWorkingContexts = await Promise.all(
        commitments.map(({ id }) => window.onmove.domain.getCommitmentWorkingContext(id))
      )
      return { threads, threadScopes, commitments, commitmentWorkingContexts }
    })),
    window.onmove.domain.queryTodos(),
    window.onmove.domain.listTags()
  ])

  return {
    focuses,
    threads: focusBundles.flatMap(({ threads }) => threads),
    threadScopes: focusBundles.flatMap(({ threadScopes }) => threadScopes),
    commitments: focusBundles.flatMap(({ commitments }) => commitments),
    commitmentWorkingContexts: focusBundles.flatMap(
      ({ commitmentWorkingContexts }) => commitmentWorkingContexts
    ),
    todos,
    tags
  }
}

/** Loads the searchable application graph on demand and keeps preload access out of the shell. */
export function useCommandPaletteModel({
  open,
  focuses
}: CommandPaletteModelOptions): CommandPaletteModel {
  const [snapshot, setSnapshot] = useState<CommandPaletteSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    loadSnapshot(focuses).then(
      (next) => {
        if (!active) return
        setSnapshot(next)
        setError(null)
      },
      () => {
        if (!active) return
        setError('Search destinations could not be loaded.')
      }
    )
    return () => {
      active = false
    }
  }, [focuses, open])

  return { snapshot, loading: snapshot === null && error === null, error }
}
