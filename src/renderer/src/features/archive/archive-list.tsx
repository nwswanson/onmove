import { LockKeyhole, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { StateLabel } from '@/components/ui/state-label'
import type { ArchivedUpdateItemModel } from '@/features/archive/archive-presenters'

interface ArchiveListProps {
  items: readonly ArchivedUpdateItemModel[]
  totalItemCount: number
  pendingIds: ReadonlySet<string>
  onDelete: (itemId: string) => void
}

/** Receiver-owned, read-only representation of temporarily retained Updates. */
export function ArchiveList({
  items,
  totalItemCount,
  pendingIds,
  onDelete
}: ArchiveListProps): React.JSX.Element {
  return (
    <div
      role="list"
      aria-label="Archived updates"
      className="mt-6 overflow-hidden rounded-xl border border-border/80 bg-card/45 shadow-xs"
    >
      {items.map((item) => (
        <article
          key={item.id}
          role="listitem"
          aria-label={`Archived update in ${item.contextLabel}`}
          className="border-b border-border/65 px-4 py-4 last:border-b-0 sm:px-5"
        >
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{item.contextLabel}</p>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div className="flex gap-1">
                  <dt>Update date</dt>
                  <dd><time dateTime={item.recordedOn}>{item.recordedOn}</time></dd>
                </div>
                <div className="flex gap-1">
                  <dt>Deleted</dt>
                  <dd><time dateTime={item.deletedAt}>{item.deletedLabel}</time></dd>
                </div>
              </dl>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.sensitive && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"
                  title="Sensitive content"
                >
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  Sensitive
                </span>
              )}
              <StateLabel model={item.state} size="compact" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Permanently delete archived update from ${item.contextLabel}`}
                title="Delete permanently"
                disabled={pendingIds.has(item.id)}
                onClick={() => onDelete(item.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="mt-3 border-t border-border/45 pt-3">
            {item.observation ? (
              <RichTextContent
                value={item.observation}
                ariaLabel={`Archived update observation from ${item.recordedOn}`}
              />
            ) : (
              <p className="text-sm italic text-muted-foreground">No observation recorded.</p>
            )}
          </div>
        </article>
      ))}
      {items.length === 0 && (
        <div className="px-5 py-16 text-center text-sm text-muted-foreground">
          {totalItemCount > 0
            ? 'No archived updates are visible with the current privacy setting.'
            : 'No deleted updates from the last 30 days.'}
        </div>
      )}
    </div>
  )
}
