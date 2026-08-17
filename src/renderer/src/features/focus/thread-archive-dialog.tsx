import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TaggedText } from '@/components/ui/tagged-text'
import type { ArchivedThreadItemModel } from '@/features/focus/focus-presenters'

interface ThreadArchiveDialogProps {
  items: readonly ArchivedThreadItemModel[]
  restoringId: number | null
  error: string | null
  onRestore: (threadId: number) => void
  onClose: () => void
}

/** Receiver for archived Thread rows; callers provide data and typed mutations only. */
export function ThreadArchiveDialog({
  items,
  restoringId,
  error,
  onRestore,
  onClose
}: ThreadArchiveDialogProps): React.JSX.Element {
  return (
    <Dialog
      open
      title="Archived threads"
      description="Done and cancelled Threads stay with this Focus. Restore one to make it active again."
      contentClassName="max-w-xl"
      onClose={onClose}
    >
      {items.length === 0 ? (
        <p className="py-5 text-center text-sm text-muted-foreground">
          No archived Threads.
        </p>
      ) : (
        <ul aria-label="Archived threads" className="divide-y divide-border/70 border-y border-border/70">
          {items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium"><TaggedText value={item.title} /></p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.statusLabel} · Last reviewed {item.lastReviewedLabel}
                  {item.dueDateLabel ? ` · Due ${item.dueDateLabel}` : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label={`Restore Thread ${item.title}`}
                disabled={restoringId !== null}
                onClick={() => onRestore(item.id)}
              >
                <RotateCcw aria-hidden="true" />
                {restoringId === item.id ? 'Restoring…' : 'Restore'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
    </Dialog>
  )
}
