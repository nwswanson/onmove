import { useRef, useState } from 'react'
import type { CreateFocusInput } from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { TaggedInput } from '@/components/ui/tagged-text'

interface NewFocusDialogProps {
  onClose: () => void
  onCreate: (input: CreateFocusInput) => Promise<void>
}

export function NewFocusDialog({ onClose, onCreate }: NewFocusDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const descriptionRef = useRef('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (title.trim().length === 0) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        title,
        description:
          descriptionRef.current.trim().length === 0 ? null : descriptionRef.current
      })
      onClose()
    } catch {
      setError('The focus could not be created. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title="New focus"
      description="Create a top-level focus in this portfolio. Titles do not need to be unique."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="new-focus-form" disabled={saving || title.trim().length === 0}>
            {saving ? 'Creating…' : 'Create focus'}
          </Button>
        </>
      }
    >
      <form id="new-focus-form" className="space-y-4" onSubmit={submit}>
        <DialogField>
          <label htmlFor="new-focus-title" className="text-xs font-medium">
            Title <span className="text-destructive">*</span>
          </label>
          <TaggedInput
            id="new-focus-title"
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </DialogField>
        <DialogField>
          <label htmlFor="new-focus-description" className="text-xs font-medium">
            Description / notes <span className="text-muted-foreground">(optional)</span>
          </label>
          <RichTextEditor
            id="new-focus-description"
            ariaLabel="Description / notes"
            value={description}
            onChange={(value) => {
              descriptionRef.current = value
              setDescription(value)
            }}
          />
        </DialogField>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
