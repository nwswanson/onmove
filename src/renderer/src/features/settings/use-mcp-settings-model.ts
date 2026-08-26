import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  EnhancedRetrievalStatusSnapshot,
  FocusSnapshot,
  McpSettingsSnapshot,
  ThreadSnapshot,
  UpdateMcpSettingsInput
} from '../../../../shared/contracts'

export interface McpSettingsModel {
  state: McpSettingsSnapshot | null
  retrievalStatus: EnhancedRetrievalStatusSnapshot | null
  retrievalStatusError: boolean
  loading: boolean
  saving: boolean
  error: string | null
  focuses: FocusSnapshot[]
  threadsByFocus: Record<number, ThreadSnapshot[]>
  update: (input: UpdateMcpSettingsInput) => Promise<void>
  loadThreads: (focusId: number) => Promise<void>
}

/** Owns the sandboxed settings boundary and reflects the main process's live server state. */
export function useMcpSettingsModel(): McpSettingsModel {
  const [state, setState] = useState<McpSettingsSnapshot | null>(null)
  const [retrievalStatus, setRetrievalStatus] =
    useState<EnhancedRetrievalStatusSnapshot | null>(null)
  const [retrievalStatusError, setRetrievalStatusError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focuses, setFocuses] = useState<FocusSnapshot[]>([])
  const [threadsByFocus, setThreadsByFocus] = useState<Record<number, ThreadSnapshot[]>>({})
  const requestedThreadFocuses = useRef(new Set<number>())
  const retrievalStatusRevision = useRef(-1)

  useEffect(() => {
    let active = true
    const unsubscribe = window.onmove.mcp.onChanged((next) => {
      if (active) setState(next)
    })
    const acceptRetrievalStatus = (next: EnhancedRetrievalStatusSnapshot): void => {
      if (!active || next.revision <= retrievalStatusRevision.current) return
      retrievalStatusRevision.current = next.revision
      setRetrievalStatus(next)
      setRetrievalStatusError(false)
    }
    const unsubscribeRetrievalStatus = window.onmove.mcp.onRetrievalStatusChanged(
      acceptRetrievalStatus
    )
    window.onmove.mcp.get().then(
      (next) => {
        if (!active) return
        setState(next)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('MCP access settings could not be loaded.')
        setLoading(false)
      }
    )
    window.onmove.domain.listFocuses().then(
      (items) => {
        if (active) setFocuses(items)
      },
      () => {
        if (active) setError('MCP access targets could not be loaded.')
      }
    )
    window.onmove.mcp.getRetrievalStatus().then(
      acceptRetrievalStatus,
      () => {
        if (active) setRetrievalStatusError(true)
      }
    )
    return () => {
      active = false
      unsubscribe()
      unsubscribeRetrievalStatus()
    }
  }, [])

  async function update(input: UpdateMcpSettingsInput): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      setState(await window.onmove.mcp.update(input))
    } catch {
      setError('MCP access settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const loadThreads = useCallback(async (focusId: number): Promise<void> => {
    if (requestedThreadFocuses.current.has(focusId)) return
    requestedThreadFocuses.current.add(focusId)
    try {
      const threads = await window.onmove.domain.listThreads(focusId)
      setThreadsByFocus((current) => ({ ...current, [focusId]: threads }))
    } catch {
      requestedThreadFocuses.current.delete(focusId)
      setError('Thread access targets could not be loaded.')
    }
  }, [])

  return {
    state,
    retrievalStatus,
    retrievalStatusError,
    loading,
    saving,
    error,
    focuses,
    threadsByFocus,
    update,
    loadThreads
  }
}
