import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useThrottledAutosave } from '@/lib/use-throttled-autosave'

export interface RoutineItemNoteHandle {
  flush: () => Promise<void>
}

export const RoutineItemNote = forwardRef<RoutineItemNoteHandle, {
  itemId: number
  value: string
  inspection: string
  onSave: (value: string) => unknown | Promise<unknown>
}>(function RoutineItemNote({
  itemId,
  value,
  inspection,
  onSave
}, forwardedRef): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const priorExternal = useRef(value)
  const autosave = useThrottledAutosave({
    initialValue: value,
    onSave: async (next) => {
      await onSave(next)
    }
  })

  useEffect(() => {
    if (value === priorExternal.current) return
    setDraft((current) => {
      const next = current === priorExternal.current ? value : current
      draftRef.current = next
      return next
    })
    priorExternal.current = value
    autosave.acceptExternal(value)
  }, [autosave, value])

  useImperativeHandle(forwardedRef, () => ({
    flush: () => autosave.flush(draftRef.current)
  }), [autosave])

  return (
    <div className="mt-3">
      <RichTextEditor
        id={`routine-item-note-${itemId}`}
        value={draft}
        externalRevision={value}
        compact
        ariaLabel={`Optional note for ${inspection}`}
        placeholder="Optional note…"
        onChange={(next) => {
          draftRef.current = next
          setDraft(next)
          autosave.schedule(next)
        }}
        onBlur={(next) => {
          draftRef.current = next
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
})
