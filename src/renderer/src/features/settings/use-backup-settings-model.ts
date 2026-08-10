import { useEffect, useState } from 'react'
import type { BackupStateSnapshot } from '../../../../shared/contracts'

export interface BackupSettingsModel {
  state: BackupStateSnapshot | null
  loading: boolean
  creating: boolean
  error: string | null
  createNow: () => Promise<void>
  showFolder: () => Promise<void>
}

/** Owns the sandboxed backup IPC boundary; the settings view receives only state and actions. */
export function useBackupSettingsModel(): BackupSettingsModel {
  const [state, setState] = useState<BackupStateSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.onmove.backups.getState().then(
      (next) => {
        if (!active) return
        setState(next)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Backup status could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [])

  async function createNow(): Promise<void> {
    setCreating(true)
    setError(null)
    try {
      setState(await window.onmove.backups.createNow())
    } catch {
      setError('The backup could not be created. Existing backups were not changed.')
    } finally {
      setCreating(false)
    }
  }

  async function showFolder(): Promise<void> {
    setError(null)
    try {
      await window.onmove.backups.showFolder()
    } catch {
      setError('The backup folder could not be opened.')
    }
  }

  return { state, loading, creating, error, createNow, showFolder }
}
