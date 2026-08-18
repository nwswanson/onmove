import { useCallback, useLayoutEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { WorkKindIcon } from '@/features/shared/work-kind-icon'
import { cn } from '@/lib/utils'

export interface FocusOverviewTimelineUpdateModel {
  id: number
  threadId: number
  date: string
  dateLabel: string
  observation: string
  preview: string
  sourceLabel: string
  sourceKind: 'thread' | 'commitment'
  state: {
    label: string
    tone: 'danger' | 'warning' | 'success' | 'neutral'
  }
}

export interface FocusOverviewTimelineThreadModel {
  id: number
  title: string
  statusLabel: string
  closed: boolean
}

export interface FocusOverviewTimelineModel {
  threads: FocusOverviewTimelineThreadModel[]
  updates: FocusOverviewTimelineUpdateModel[]
}

interface PositionedUpdate extends FocusOverviewTimelineUpdateModel {
  bubbleX: number
  bubbleY: number
  pointX: number
  pointY: number
}

interface TimelinePoint {
  key: string
  threadId: number
  x: number
  y: number
  state: FocusOverviewTimelineUpdateModel['state']
}

interface TimelineDateMarker {
  date: string
  dateLabel: string
  x: number
  y: number
}

interface TimelineRailSegment {
  key: string
  threadId: number
  x: number
  y1: number
  y2: number
  state: FocusOverviewTimelineUpdateModel['state']
}

interface TimelineLayout {
  width: number
  height: number
  bubbleWidth: number
  railXs: Map<number, number>
  updates: PositionedUpdate[]
  points: TimelinePoint[]
  dates: TimelineDateMarker[]
  railSegments: TimelineRailSegment[]
}

const BUBBLE_HEIGHT = 88
const BUBBLE_GAP = 14
const MAX_RAIL_GAP = 46
const DATE_GROUP_GAP = 64
const DEFAULT_TIMELINE_WIDTH = 960
const NEUTRAL_STATE: FocusOverviewTimelineUpdateModel['state'] = {
  label: 'None',
  tone: 'neutral'
}

function stateToneClass(
  tone: FocusOverviewTimelineUpdateModel['state']['tone'],
  target: 'background' | 'fill' | 'stroke'
): string {
  if (target === 'background') {
    if (tone === 'danger') return 'bg-destructive'
    if (tone === 'warning') return 'bg-warning'
    if (tone === 'success') return 'bg-success'
    return 'bg-muted-foreground/55'
  }
  if (target === 'fill') {
    if (tone === 'danger') return 'fill-destructive'
    if (tone === 'warning') return 'fill-warning'
    if (tone === 'success') return 'fill-success'
    return 'fill-muted-foreground/55'
  }
  if (tone === 'danger') return 'stroke-destructive'
  if (tone === 'warning') return 'stroke-warning'
  if (tone === 'success') return 'stroke-success'
  return 'stroke-muted-foreground/55'
}

function dayDistance(firstDate: string, secondDate: string): number {
  const first = new Date(`${firstDate}T00:00:00Z`).getTime()
  const second = new Date(`${secondDate}T00:00:00Z`).getTime()
  if (!Number.isFinite(first) || !Number.isFinite(second)) return 1
  return Math.max(1, Math.round(Math.abs(first - second) / 86_400_000))
}

function dateSpacing(firstDate: string, secondDate: string): number {
  return Math.min(150, DATE_GROUP_GAP + Math.sqrt(dayDistance(firstDate, secondDate)) * 10)
}

function buildFocusTimelineLayout(
  model: FocusOverviewTimelineModel,
  availableWidth: number
): TimelineLayout {
  const width = Math.max(1, Math.floor(availableWidth))
  const sidePadding = Math.min(28, Math.max(12, width * 0.035))
  const connectorGap = Math.min(112, Math.max(48, width * 0.16))
  const bubbleWidth = Math.min(320, Math.max(180, width * 0.34))
  const bubbleX = sidePadding
  const minimumRailX = bubbleX + bubbleWidth + connectorGap
  const availableRailWidth = Math.max(0, width - minimumRailX - sidePadding)
  const railGap = model.threads.length <= 1
    ? 0
    : Math.min(MAX_RAIL_GAP, availableRailWidth / (model.threads.length - 1))
  const railSpan = Math.max(0, (model.threads.length - 1) * railGap)
  const desiredRailCenter = width * 0.64
  const firstRailX = Math.min(
    width - sidePadding - railSpan,
    Math.max(minimumRailX, desiredRailCenter - railSpan / 2)
  )
  const railXs = new Map(model.threads.map((thread, index) => [
    thread.id,
    firstRailX + index * railGap
  ]))
  const threadIndexes = new Map(model.threads.map((thread, index) => [thread.id, index]))
  const dates = [...new Set(model.updates.map(({ date }) => date))].sort().reverse()
  const positionedUpdates: PositionedUpdate[] = []
  const points: TimelinePoint[] = []
  const dateMarkers: TimelineDateMarker[] = []
  let groupTop = 34

  dates.forEach((date, dateIndex) => {
    const dateUpdates = model.updates
      .filter((update) => update.date === date)
      .sort((left, right) =>
        (threadIndexes.get(left.threadId) ?? 0) - (threadIndexes.get(right.threadId) ?? 0) ||
        right.id - left.id)
    const groupHeight = Math.max(
      BUBBLE_HEIGHT,
      dateUpdates.length * BUBBLE_HEIGHT + Math.max(0, dateUpdates.length - 1) * BUBBLE_GAP
    )
    const pointY = groupTop + groupHeight / 2

    dateUpdates.forEach((update, updateIndex) => {
      positionedUpdates.push({
        ...update,
        bubbleX,
        bubbleY: groupTop + updateIndex * (BUBBLE_HEIGHT + BUBBLE_GAP),
        pointX: railXs.get(update.threadId) ?? firstRailX,
        pointY
      })
    })

    const updatesByThread = new Map<number, FocusOverviewTimelineUpdateModel[]>()
    dateUpdates.forEach((update) => {
      updatesByThread.set(update.threadId, [
        ...(updatesByThread.get(update.threadId) ?? []),
        update
      ])
    })
    updatesByThread.forEach((threadUpdates, threadId) => {
      const effectiveUpdate = threadUpdates.reduce((latest, update) =>
        update.id > latest.id ? update : latest)
      points.push({
        key: `${threadId}:${date}`,
        threadId,
        x: railXs.get(threadId) ?? firstRailX,
        y: pointY,
        state: effectiveUpdate?.state ?? NEUTRAL_STATE
      })
    })
    dateMarkers.push({
      date,
      dateLabel: dateUpdates[0]?.dateLabel ?? date,
      x: firstRailX + railSpan / 2,
      y: pointY
    })

    const nextDate = dates[dateIndex + 1]
    groupTop += groupHeight + (nextDate ? dateSpacing(date, nextDate) : 0)
  })

  const height = dates.length === 0 ? 240 : groupTop + 52
  const railSegments = model.threads.flatMap((thread) => {
    const x = railXs.get(thread.id) ?? firstRailX
    const threadPoints = points
      .filter((point) => point.threadId === thread.id)
      .sort((left, right) => left.y - right.y)
    if (threadPoints.length === 0) {
      return [{
        key: `${thread.id}:empty`,
        threadId: thread.id,
        x,
        y1: 0,
        y2: height - 20,
        state: NEUTRAL_STATE
      }]
    }
    return [
      {
        key: `${thread.id}:current`,
        threadId: thread.id,
        x,
        y1: 0,
        y2: threadPoints[0]?.y ?? 0,
        state: threadPoints[0]?.state ?? NEUTRAL_STATE
      },
      ...threadPoints.slice(0, -1).map((point, index) => ({
        key: `${thread.id}:${index}`,
        threadId: thread.id,
        x,
        y1: point.y,
        y2: threadPoints[index + 1]?.y ?? point.y,
        state: threadPoints[index + 1]?.state ?? NEUTRAL_STATE
      })),
      {
        key: `${thread.id}:before-first-update`,
        threadId: thread.id,
        x,
        y1: threadPoints.at(-1)?.y ?? 0,
        y2: height - 20,
        state: NEUTRAL_STATE
      }
    ]
  })

  return {
    width,
    height,
    bubbleWidth,
    railXs,
    updates: positionedUpdates,
    points,
    dates: dateMarkers,
    railSegments
  }
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
        className={cn('size-2 rounded-full', stateToneClass(state.tone, 'background'))}
      />
      {state.label}
    </span>
  )
}

function connectorPath(update: PositionedUpdate, bubbleWidth: number): string {
  const startX = update.bubbleX + bubbleWidth
  const startY = update.bubbleY + BUBBLE_HEIGHT / 2
  const bend = Math.max(30, Math.abs(update.pointX - startX) * 0.42)
  const controlX = startX + bend
  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${update.pointY}, ${update.pointX} ${update.pointY}`
}

function updateTitle(sourceLabel: string): string {
  return sourceLabel === 'Thread update' ? sourceLabel : `${sourceLabel} update`
}

export function FocusOverviewTimeline({
  model,
  onOpenThread
}: {
  model: FocusOverviewTimelineModel
  onOpenThread: (threadId: number) => void
}): React.JSX.Element {
  const [timelineElement, setTimelineElement] = useState<HTMLDivElement | null>(null)
  const [timelineWidth, setTimelineWidth] = useState<number | null>(null)
  const [selectedUpdateId, setSelectedUpdateId] = useState<number | null>(null)
  const [hiddenThreadIds, setHiddenThreadIds] = useState<Set<number>>(() => new Set())
  const setTimelineRef = useCallback((element: HTMLDivElement | null): void => {
    setTimelineElement(element)
    if (!element) setTimelineWidth(null)
  }, [])

  useLayoutEffect(() => {
    if (!timelineElement) return
    const measure = (): void => {
      const nextWidth = Math.floor(timelineElement.getBoundingClientRect().width)
      if (nextWidth > 0) setTimelineWidth((current) => current === nextWidth ? current : nextWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(timelineElement)
    return () => observer.disconnect()
  }, [timelineElement])

  if (model.threads.length === 0) {
    return (
      <section className="mt-8 w-full border-t border-border/70 px-8 pt-6" aria-labelledby="thread-timeline-heading">
        <h2 id="thread-timeline-heading" className="text-sm font-semibold">Thread timeline</h2>
        <p className="mt-4 text-sm text-muted-foreground">No Threads yet.</p>
      </section>
    )
  }

  const visibleModel: FocusOverviewTimelineModel = {
    threads: model.threads,
    updates: model.updates.filter(({ threadId }) => !hiddenThreadIds.has(threadId))
  }
  const layout = buildFocusTimelineLayout(visibleModel, timelineWidth ?? DEFAULT_TIMELINE_WIDTH)
  const selectedUpdate = model.updates.find(({ id }) => id === selectedUpdateId) ?? null
  const selectedThread = selectedUpdate
    ? model.threads.find(({ id }) => id === selectedUpdate.threadId) ?? null
    : null

  return (
    <section className="mt-8 w-full border-t border-border/70 pt-6" aria-labelledby="thread-timeline-heading">
      <div className="flex items-baseline justify-between gap-4 px-8">
        <h2 id="thread-timeline-heading" className="text-sm font-semibold">Thread timeline</h2>
        <p className="text-xs text-muted-foreground">Latest at top · earlier below</p>
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 px-8">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Rails
        </span>
        <div
          role="group"
          aria-label="Timeline rail filters"
          className="flex min-w-0 gap-1.5 overflow-x-auto pb-1"
        >
          {model.threads.map((thread) => {
            const hidden = hiddenThreadIds.has(thread.id)
            return (
              <button
                key={thread.id}
                type="button"
                aria-label={`${thread.title} timeline rail`}
                aria-pressed={!hidden}
                title={hidden ? `Show ${thread.title}` : `Hide ${thread.title}`}
                className={cn(
                  'inline-flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  hidden
                    ? 'border-border/60 bg-muted/30 text-muted-foreground/60'
                    : 'border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15'
                )}
                onClick={() => {
                  setHiddenThreadIds((current) => {
                    const next = new Set(current)
                    if (hidden) next.delete(thread.id)
                    else next.add(thread.id)
                    return next
                  })
                  if (!hidden && selectedUpdate?.threadId === thread.id) {
                    setSelectedUpdateId(null)
                  }
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-3 w-0.5 shrink-0 rounded-full',
                    hidden ? 'bg-muted-foreground/35' : 'bg-primary'
                  )}
                />
                <span className="truncate">{thread.title}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div
        ref={setTimelineRef}
        className={cn(
          'relative mt-4 w-full border-y border-border/65 bg-muted/10',
          timelineWidth === null && 'invisible'
        )}
        data-testid="focus-thread-timeline"
      >
        <div
          className="sticky top-0 z-20 h-24 border-b border-border/70 bg-background/92 shadow-[0_1px_0_rgb(0_0_0/0.03)] backdrop-blur-xl"
          data-testid="timeline-sticky-thread-headers"
        >
          {model.threads.map((thread) => {
            const x = layout.railXs.get(thread.id) ?? layout.width / 2
            const hidden = hiddenThreadIds.has(thread.id)
            return (
              <button
                key={thread.id}
                type="button"
                className={cn(
                  'absolute bottom-1 w-28 rounded-md px-1.5 py-1 text-left transition hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  hidden && 'opacity-30 grayscale'
                )}
                style={{
                  left: x,
                  transform: 'rotate(-34deg)',
                  transformOrigin: 'left bottom'
                }}
                title={`${thread.title} · ${thread.statusLabel}`}
                onClick={() => onOpenThread(thread.id)}
                aria-label={`Open Thread ${thread.title}`}
              >
                <span className="block truncate text-[11px] font-semibold">{thread.title}</span>
                <span className={cn(
                  'block truncate text-[10px] capitalize text-muted-foreground',
                  thread.closed && 'italic'
                )}>
                  {thread.statusLabel}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative w-full" style={{ height: layout.height }}>
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="Thread update timeline"
          >
            <title>Thread state intervals and updates arranged chronologically</title>
            {layout.railSegments.map((segment) => {
              const thread = model.threads.find(({ id }) => id === segment.threadId)
              const hidden = hiddenThreadIds.has(segment.threadId)
              return (
                <line
                  key={segment.key}
                  data-testid={`thread-rail-${segment.threadId}`}
                  data-state={segment.state.label.toLowerCase()}
                  data-filtered={hidden ? 'true' : 'false'}
                  x1={segment.x}
                  x2={segment.x}
                  y1={segment.y1}
                  y2={segment.y2}
                  className={hidden
                    ? 'stroke-muted-foreground/30'
                    : stateToneClass(segment.state.tone, 'stroke')}
                  strokeWidth="4"
                  strokeOpacity={hidden ? '0.24' : thread?.closed ? '0.42' : '0.9'}
                  strokeLinecap="round"
                />
              )
            })}
            {layout.updates.map((update) => (
              <path
                key={`connector:${update.id}`}
                data-testid={`timeline-connector-${update.id}`}
                d={connectorPath(update, layout.bubbleWidth)}
                fill="none"
                className={stateToneClass(update.state.tone, 'stroke')}
                strokeWidth="1.5"
                strokeOpacity="0.65"
              />
            ))}
            {layout.dates.map((date) => (
              <g key={date.date}>
                <rect
                  x={date.x - 39}
                  y={date.y - 29}
                  width="78"
                  height="17"
                  rx="8.5"
                  className="fill-background stroke-border"
                />
                <text
                  x={date.x}
                  y={date.y - 17}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px] font-medium"
                >
                  {date.dateLabel}
                </text>
              </g>
            ))}
            {layout.points.map((point) => (
              <g key={point.key}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="6"
                  className="fill-background stroke-background"
                  strokeWidth="2"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="3.5"
                  className={stateToneClass(point.state.tone, 'fill')}
                />
              </g>
            ))}
          </svg>

          {visibleModel.updates.length === 0 && (
            <p className="absolute top-20 left-8 text-sm text-muted-foreground">
              {model.updates.length === 0 ? 'No updates yet.' : 'All update rails are hidden.'}
            </p>
          )}

          {layout.updates.map((update) => (
            <button
              key={update.id}
              type="button"
              data-side="left"
              className="absolute overflow-hidden rounded-xl border border-border/75 bg-card px-3.5 py-3 text-left shadow-sm transition hover:-translate-y-px hover:border-primary/55 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                left: update.bubbleX,
                top: update.bubbleY,
                width: layout.bubbleWidth,
                height: BUBBLE_HEIGHT
              }}
              aria-label={`Read ${updateTitle(update.sourceLabel)} from ${update.dateLabel}`}
              onClick={() => setSelectedUpdateId(update.id)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-primary">
                  <WorkKindIcon
                    kind={update.sourceKind}
                    className="size-4 text-primary [&_svg]:size-3.5"
                  />
                  <span className="truncate text-[11px] font-medium">
                    {update.sourceLabel}
                  </span>
                </span>
                <StateDot state={update.state} />
              </span>
              <span className={cn(
                'mt-1.5 line-clamp-3 text-xs leading-[1.15rem] text-foreground/85',
                !update.preview && 'italic text-muted-foreground'
              )}>
                {update.preview || 'Blank update'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Dialog
        open={selectedUpdate !== null}
        title={selectedUpdate ? updateTitle(selectedUpdate.sourceLabel) : 'Update'}
        description={selectedUpdate && selectedThread
          ? `${selectedThread.title} · ${selectedUpdate.dateLabel}`
          : undefined}
        contentClassName="max-w-2xl"
        onClose={() => setSelectedUpdateId(null)}
        footer={selectedUpdate && selectedThread ? (
          <Button
            type="button"
            onClick={() => {
              setSelectedUpdateId(null)
              onOpenThread(selectedThread.id)
            }}
          >
            Open Thread
          </Button>
        ) : undefined}
      >
        {selectedUpdate && (
          <div className="space-y-4">
            <StateDot state={selectedUpdate.state} />
            {selectedUpdate.observation ? (
              <RichTextContent
                value={selectedUpdate.observation}
                ariaLabel={`${selectedUpdate.sourceLabel} update`}
                className="max-h-[55vh] overflow-y-auto text-sm leading-6"
              />
            ) : (
              <p className="text-sm italic text-muted-foreground">Blank update</p>
            )}
          </div>
        )}
      </Dialog>
    </section>
  )
}
