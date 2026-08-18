import { RichTextContent } from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/utils'

export interface FocusOverviewTimelineUpdateModel {
  id: number
  observation: string
  sourceLabel: string
  state: {
    label: string
    tone: 'danger' | 'warning' | 'success' | 'neutral'
  }
}

export interface FocusOverviewTimelineCellModel {
  threadId: number
  updates: FocusOverviewTimelineUpdateModel[]
}

export interface FocusOverviewTimelineRowModel {
  date: string
  dateLabel: string
  cells: FocusOverviewTimelineCellModel[]
}

export interface FocusOverviewTimelineThreadModel {
  id: number
  title: string
  statusLabel: string
  closed: boolean
}

export interface FocusOverviewTimelineModel {
  threads: FocusOverviewTimelineThreadModel[]
  rows: FocusOverviewTimelineRowModel[]
}

function StateDot({
  state
}: {
  state: FocusOverviewTimelineUpdateModel['state']
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          state.tone === 'danger' && 'bg-destructive',
          state.tone === 'warning' && 'bg-warning',
          state.tone === 'success' && 'bg-success',
          state.tone === 'neutral' && 'bg-muted-foreground/45'
        )}
      />
      {state.label}
    </span>
  )
}

export function FocusOverviewTimeline({
  model,
  onOpenThread
}: {
  model: FocusOverviewTimelineModel
  onOpenThread: (threadId: number) => void
}): React.JSX.Element {
  if (model.threads.length === 0) {
    return (
      <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="thread-timeline-heading">
        <h2 id="thread-timeline-heading" className="text-sm font-semibold">Thread timeline</h2>
        <p className="mt-4 text-sm text-muted-foreground">No Threads yet.</p>
      </section>
    )
  }

  const gridTemplateColumns = `7rem repeat(${model.threads.length}, minmax(13.5rem, 1fr))`
  const minWidth = 112 + model.threads.length * 216

  return (
    <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="thread-timeline-heading">
      <h2 id="thread-timeline-heading" className="text-sm font-semibold">Thread timeline</h2>
      <div className="mt-4 overflow-x-auto pb-2" data-testid="focus-thread-timeline">
        <div style={{ minWidth }}>
          <div
            className="sticky top-0 z-10 grid border-b border-border/70 bg-background"
            style={{ gridTemplateColumns }}
          >
            <div aria-hidden="true" />
            {model.threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="min-w-0 border-l border-border/70 px-4 py-3 text-left hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => onOpenThread(thread.id)}
                aria-label={`Open Thread ${thread.title}`}
              >
                <span className="block truncate text-xs font-semibold">{thread.title}</span>
                <span className={cn(
                  'mt-0.5 block text-[11px] capitalize text-muted-foreground',
                  thread.closed && 'italic'
                )}>
                  {thread.statusLabel}
                </span>
              </button>
            ))}
          </div>

          {model.rows.length === 0 ? (
            <div
              className="grid min-h-28"
              style={{ gridTemplateColumns }}
            >
              <div className="px-2 py-5 text-xs text-muted-foreground">No updates</div>
              {model.threads.map((thread) => (
                <div key={thread.id} className="border-l border-border/70" />
              ))}
            </div>
          ) : model.rows.map((row) => (
            <div
              key={row.date}
              className="grid border-b border-border/50 last:border-b-0"
              style={{ gridTemplateColumns }}
            >
              <time
                dateTime={row.date}
                className="px-2 py-5 text-xs font-medium text-muted-foreground"
              >
                {row.dateLabel}
              </time>
              {row.cells.map((cell) => (
                <div
                  key={cell.threadId}
                  className="relative min-h-20 border-l border-border/70 px-4 py-4"
                >
                  <div className="space-y-3">
                    {cell.updates.map((update) => (
                      <article
                        key={update.id}
                        className="relative rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm before:absolute before:-left-[17px] before:top-5 before:h-px before:w-4 before:bg-border after:absolute after:-left-[20px] after:top-[17px] after:size-1.5 after:rounded-full after:bg-primary"
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="truncate text-left text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => onOpenThread(cell.threadId)}
                          >
                            {update.sourceLabel}
                          </button>
                          <StateDot state={update.state} />
                        </div>
                        {update.observation ? (
                          <RichTextContent
                            value={update.observation}
                            ariaLabel={`${update.sourceLabel} update`}
                            className="text-sm leading-5"
                          />
                        ) : (
                          <p className="text-sm italic text-muted-foreground">Blank update</p>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
