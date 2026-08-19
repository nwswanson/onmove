import { useEffect, useState } from 'react'
import type { McpSettingsSnapshot, UpdateMcpSettingsInput } from '../../../../shared/contracts'

export interface McpSettingsModel {
  state: McpSettingsSnapshot | null
  loading: boolean
  saving: boolean
  error: string | null
  update: (input: UpdateMcpSettingsInput) => Promise<void>
}

/** Owns the sandboxed settings boundary and reflects the main process's live server state. */
export function useMcpSettingsModel(): McpSettingsModel {
  const [state, setState] = useState<McpSettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = window.onmove.mcp.onChanged((next) => {
      if (active) setState(next)
    })
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
    return () => {
      active = false
      unsubscribe()
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

  return { state, loading, saving, error, update }
}
