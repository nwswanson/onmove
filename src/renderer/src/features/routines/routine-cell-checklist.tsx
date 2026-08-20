import { useRef, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  richTextPlainText
} from '@/components/ui/rich-text-editor'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  RoutineItemNote,
  type RoutineItemNoteHandle
} from '@/features/routines/routine-item-note'
import { RichTextContentWithHistory } from '@/features/rich-text/rich-text-history'
import { cn } from '@/lib/utils'

export interface RoutineCellItemMutation {
  resolution: 'pending' | 'attested' | 'not_applicable'
  note?: string
}

export interface RoutineCellChecklistItemModel {
  id: number
  inspection: string
  required: boolean
  resolution: RoutineCellItemMutation['resolution']
  attestedAt: string | null
  note: string
}

export interface RoutineCellChecklistModel {
  id: number
  subjectLabel: string
  completionDate: string | null
  progress: { complete: number; required: number }
  items: readonly RoutineCellChecklistItemModel[]
}

export function RoutineCellChecklist({
  cell,
  saving = false,
  onMutateItem,
  onFinalize
}: {
  cell: RoutineCellChecklistModel
  saving?: boolean
  onMutateItem?: (itemId: number, input: RoutineCellItemMutation) => unknown | Promise<unknown>
  onFinalize?: (cellId: number) => unknown | Promise<unknown>
}): React.JSX.Element {
  const noteHandles = useRef(new Map<number, RoutineItemNoteHandle>())
  const [finalizing, setFinalizing] = useState(false)
  const editable = cell.completionDate === null && onMutateItem !== undefined
  const readyToFinalize = cell.progress.complete >= cell.progress.required

  async function finalize(): Promise<void> {
    if (!onFinalize || !readyToFinalize || finalizing) return
    setFinalizing(true)
    try {
      await Promise.all([...noteHandles.current.values()].map(({ flush }) => flush()))
      await onFinalize(cell.id)
    } finally {
      setFinalizing(false)
    }
  }

  return (
    <div>
      <ul
        className="divide-y divide-border/60 border-y border-border/70"
        aria-label={`${cell.subjectLabel} checklist`}
      >
        {cell.items.map((item) => (
          <li key={item.id} className="py-4">
            {editable ? (
              <>
                <h3
                  className={cn(
                    'text-sm font-medium leading-6',
                    item.resolution === 'not_applicable' && 'text-muted-foreground'
                  )}
                >
                  <TaggedText value={item.inspection} />
                </h3>
                <div
                  role="radiogroup"
                  aria-label={`Resolution for ${item.inspection}`}
                  className="mt-2 inline-flex rounded-md bg-muted/55 p-0.5"
                >
                  {([
                    { value: 'attested', label: 'Check' },
                    { value: 'not_applicable', label: 'Ignore' }
                  ] as const).map((option) => {
                    const checked = item.resolution === option.value
                    return (
                      <label
                        key={option.value}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1.5 rounded-[0.3rem] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors',
                          'has-focus-visible:ring-2 has-focus-visible:ring-ring/45',
                          checked && 'bg-background text-foreground shadow-sm'
                        )}
                      >
                        <input
                          type="radio"
                          name={`routine-item-resolution-${item.id}`}
                          value={option.value}
                          className="size-3 accent-primary"
                          aria-label={`${option.label}: ${item.inspection}`}
                          checked={checked}
                          disabled={saving || finalizing}
                          onChange={() => void onMutateItem(item.id, { resolution: option.value })}
                        />
                        {option.label}
                      </label>
                    )
                  })}
                </div>
                <RoutineItemNote
                  ref={(handle) => {
                    if (handle) noteHandles.current.set(item.id, handle)
                    else noteHandles.current.delete(item.id)
                  }}
                  itemId={item.id}
                  value={item.note ?? ''}
                  inspection={item.inspection}
                  onSave={(note) => onMutateItem(item.id, {
                    resolution: item.resolution,
                    note
                  })}
                />
              </>
            ) : (
              <div>
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <h3 className="min-w-0 flex-1 text-sm font-medium leading-6">
                    <TaggedText value={item.inspection} />
                  </h3>
                  <span className="inline-flex shrink-0 items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                    {item.resolution === 'attested' ? (
                      <Check className="size-3.5 text-success" aria-hidden="true" />
                    ) : (
                      <Minus className="size-3.5" aria-hidden="true" />
                    )}
                    {item.resolution === 'attested'
                      ? 'Checked'
                      : item.resolution === 'not_applicable'
                        ? 'Ignored'
                        : 'Pending'}
                  </span>
                </div>
                {item.attestedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">Recorded {item.attestedAt}</p>
                )}
                {richTextPlainText(item.note ?? '').trim() && (
                  <div
                    className="mt-3 border-l-2 border-border/70 pl-3 text-sm"
                    aria-label={`Note for ${item.inspection}`}
                  >
                    <RichTextContentWithHistory
                      value={item.note}
                      ariaLabel={`Recorded note for ${item.inspection}`}
                      historyReference={{
                        type: 'routine-attestation',
                        id: item.id,
                        field: 'note'
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {editable && onFinalize && (
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {readyToFinalize
              ? 'All required inspections are resolved.'
              : 'Resolve every required inspection before finalizing.'}
          </p>
          <Button
            type="button"
            disabled={!readyToFinalize || saving || finalizing}
            onClick={() => void finalize()}
          >
            {finalizing ? 'Finalizing…' : 'Finalize check-in'}
          </Button>
        </footer>
      )}
    </div>
  )
}
