import { useEffect, useId, useRef, useState } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  dueDateParentWarning,
  type ParentDueDateModel
} from '@/features/shared/work-due-date'

interface WorkDueDateFieldProps {
  entityLabel: string
  value: string | null
  parent?: ParentDueDateModel | null
  showLabel?: boolean
  disabled?: boolean
  onValueChange: (value: string | null) => Promise<boolean>
}

function WorkDueDateEditor({
  entityLabel,
  value,
  parent = null,
  showLabel = true,
  disabled = false,
  onValueChange
}: WorkDueDateFieldProps): React.JSX.Element {
  const inputId = useId()
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const editingRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(value ?? '')
  }, [value])

  const warning = dueDateParentWarning(draft || null, parent)

  async function save(nextValue: string): Promise<void> {
    setDraft(nextValue)
    if ((nextValue || null) === value) return
    setSaving(true)
    try {
      const saved = await onValueChange(nextValue || null)
      if (!saved) setDraft(value ?? '')
    } catch {
      setDraft(value ?? '')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <label
        htmlFor={inputId}
        className={showLabel ? 'text-xs font-medium text-foreground/80' : 'sr-only'}
      >
        Due date
      </label>
      <Input
        id={inputId}
        type="date"
        aria-label={`${entityLabel} due date`}
        className="h-8 w-[9.25rem] px-2 text-xs"
        value={draft}
        disabled={disabled || saving}
        onFocus={() => {
          editingRef.current = true
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          editingRef.current = false
          void save(event.currentTarget.value)
        }}
      />
      {draft && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label={`Clear ${entityLabel} due date`}
          title={`Clear ${entityLabel} due date`}
          disabled={disabled || saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void save('')}
        >
          <X aria-hidden="true" />
        </Button>
      )}
      {warning && (
        <span
          className="inline-flex text-destructive"
          aria-label={warning}
          title={warning}
          tabIndex={0}
        >
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
      )}
    </div>
  )
}

export function WorkDueDateField(props: WorkDueDateFieldProps): React.JSX.Element {
  return <WorkDueDateEditor {...props} />
}
