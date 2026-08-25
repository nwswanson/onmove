import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogField } from '@/components/ui/dialog'

const FOLDER_NAME = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

export function SidebarFolderDialog({
  noun,
  onClose,
  onCreate
}: {
  noun: 'focuses' | 'threads'
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const normalizedName = name.trim().replace(/\s+/g, ' ')
  const valid = FOLDER_NAME.test(normalizedName) && normalizedName.length <= 80

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(normalizedName)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The folder could not be created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title="New folder"
      description={`Create a visual folder for ${noun}. It does not change the underlying records.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-sidebar-folder-form" disabled={saving || !valid}>
            {saving ? 'Creating…' : 'Create folder'}
          </Button>
        </>
      }
    >
      <form id="new-sidebar-folder-form" onSubmit={submit}>
        <DialogField>
          <label htmlFor="new-sidebar-folder-name" className="text-xs font-medium">
            Name
          </label>
          <input
            id="new-sidebar-folder-name"
            autoFocus
            required
            maxLength={80}
            value={name}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
            aria-describedby="new-sidebar-folder-hint"
            onChange={(event) => setName(event.target.value)}
          />
          <p id="new-sidebar-folder-hint" className="text-[0.6875rem] text-muted-foreground">
            Use letters, numbers, and spaces only.
          </p>
        </DialogField>
        {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      </form>
    </Dialog>
  )
}
