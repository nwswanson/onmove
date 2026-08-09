import { useEffect, useState } from 'react'
import type { ThreadScopeSnapshot } from '../../../../shared/contracts'

interface UseThreadScopeModelOptions {
  threadId: number
  onScopeChanged: () => Promise<void>
}

export interface ThreadScopeModel {
  scope: ThreadScopeSnapshot | null
  loading: boolean
  saving: boolean
  error: string | null
  addSubject: (name: string) => Promise<void>
  removeSubject: (subjectId: number) => Promise<void>
  followFocus: () => Promise<void>
}

/** Persistence-backed Thread applicability, isolated from view composition. */
export function useThreadScopeModel({
  threadId,
  onScopeChanged
}: UseThreadScopeModelOptions): ThreadScopeModel {
  const [scope, setScope] = useState<ThreadScopeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.onmove.domain.getThreadScope(threadId).then(
      (nextScope) => {
        if (!active) return
        setScope(nextScope)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('The Thread scope could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [threadId])

  async function mutate(
    operation: () => Promise<ThreadScopeSnapshot>,
    message: string
  ): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      setScope(await operation())
      void onScopeChanged().catch(() => undefined)
    } catch (nextError) {
      setError(message)
      throw nextError
    } finally {
      setSaving(false)
    }
  }

  return {
    scope,
    loading,
    saving,
    error,
    addSubject: (name) => mutate(
      () => window.onmove.domain.addThreadScopeSubject(threadId, { name }),
      'The Subject could not be added to this Thread.'
    ),
    removeSubject: (subjectId) => mutate(
      () => window.onmove.domain.removeThreadScopeSubject(threadId, subjectId),
      'The Subject could not be removed from this Thread.'
    ),
    followFocus: () => mutate(
      () => window.onmove.domain.followFocusThreadScope(threadId),
      'This Thread could not be returned to the Focus scope.'
    )
  }
}
