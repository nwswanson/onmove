import { useRef, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  RichTextContent,
  richTextPlainText
} from '@/components/ui/rich-text-editor'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  RoutineItemNote,
  type RoutineItemNoteHandle
} from '@/features/routines/routine-item-note'
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
    <div className="overflow-hidden rounded-xl border border-border bg-background/70">
      <ul className="divide-y divide-border" aria-label={`${cell.subjectLabel} checklist`}>
        {cell.items.map((item) => (
          <li key={item.id} className="px-4 py-3">
            {editable ? (
              <>
                <div className="flex items-start gap-3">
                  <label className="flex min-w-0 flex-1 items-start gap-3 text-sm leading-6">
                    <input
                      type="checkbox"
                      className="mt-1.5"
                      aria-label={`Attest: ${item.inspection}`}
                      checked={item.resolution === 'attested'}
                      disabled={saving || finalizing}
                      onChange={(event) => void onMutateItem(item.id, {
                        resolution: event.target.checked ? 'attested' : 'pending'
                      })}
                    />
                    <span className={cn(item.resolution !== 'pending' && 'text-muted-foreground')}>
                      <TaggedText value={item.inspection} />
                    </span>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant={item.resolution === 'not_applicable' ? 'default' : 'outline'}
                    disabled={saving || finalizing}
                    onClick={() => void onMutateItem(item.id, {
                      resolution: item.resolution === 'not_applicable'
                        ? 'pending'
                        : 'not_applicable'
                    })}
                  >
                    N/A
                  </Button>
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
                <div className="flex items-start gap-2.5 text-sm">
                  {item.resolution === 'attested' ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1"><TaggedText value={item.inspection} /></span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.resolution === 'attested'
                      ? 'Attested'
                      : item.resolution === 'not_applicable'
                        ? 'Not applicable'
                        : 'Pending'}
                  </span>
                </div>
                {item.attestedAt && (
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">Recorded {item.attestedAt}</p>
                )}
                {richTextPlainText(item.note ?? '').trim() && (
                  <div
                    className="mt-2 ml-6 rounded-lg border border-border/70 bg-muted/25 px-3 py-2"
                    aria-label={`Note for ${item.inspection}`}
                  >
                    <RichTextContent value={item.note} ariaLabel={`Recorded note for ${item.inspection}`} />
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {editable && onFinalize && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3">
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
