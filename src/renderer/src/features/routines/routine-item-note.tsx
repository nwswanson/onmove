import { useEffect, useRef, useState } from 'react'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useThrottledAutosave } from '@/lib/use-throttled-autosave'

export function RoutineItemNote({
  itemId,
  value,
  inspection,
  onSave
}: {
  itemId: number
  value: string
  inspection: string
  onSave: (value: string) => unknown | Promise<unknown>
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const priorExternal = useRef(value)
  const autosave = useThrottledAutosave({
    initialValue: value,
    onSave: async (next) => {
      await onSave(next)
    }
  })

  useEffect(() => {
    if (value === priorExternal.current) return
    setDraft((current) => current === priorExternal.current ? value : current)
    priorExternal.current = value
    autosave.acceptExternal(value)
  }, [autosave, value])

  return (
    <div className="ml-7 mt-2">
      <RichTextEditor
        id={`routine-item-note-${itemId}`}
        value={draft}
        externalRevision={value}
        compact
        ariaLabel={`Optional note for ${inspection}`}
        placeholder="Optional note…"
        onChange={(next) => {
          setDraft(next)
          autosave.schedule(next)
        }}
        onBlur={(next) => {
          setDraft(next)
          void autosave.flush(next)
        }}
      />
      {autosave.error !== null && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          The note could not be saved.
        </p>
      )}
    </div>
  )
}
