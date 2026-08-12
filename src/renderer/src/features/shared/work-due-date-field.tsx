import { useId, useState } from 'react'
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
  disabled?: boolean
  onValueChange: (value: string | null) => Promise<boolean>
}

function WorkDueDateEditor({
  entityLabel,
  value,
  parent = null,
  disabled = false,
  onValueChange
}: WorkDueDateFieldProps): React.JSX.Element {
  const inputId = useId()
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)

  const warning = dueDateParentWarning(draft || null, parent)

  async function save(nextValue: string): Promise<void> {
    setDraft(nextValue)
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
      <label htmlFor={inputId} className="text-xs font-medium text-foreground/80">
        Due date
      </label>
      <Input
        id={inputId}
        type="date"
        aria-label={`${entityLabel} due date`}
        className="h-8 w-[9.25rem] px-2 text-xs"
        value={draft}
        disabled={disabled || saving}
        onChange={(event) => void save(event.target.value)}
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
  return <WorkDueDateEditor key={`${props.entityLabel}:${props.value ?? ''}`} {...props} />
}
