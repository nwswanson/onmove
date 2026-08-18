import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/utils'

export interface FocusOverviewTimelineUpdateModel {
  id: number
  threadId: number
  date: string
  dateLabel: string
  observation: string
  preview: string
  sourceLabel: string
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

type TimelineSide = 'left' | 'right'

interface PositionedUpdate extends FocusOverviewTimelineUpdateModel {
  side: TimelineSide
  bubbleX: number
  bubbleY: number
  pointX: number
  pointY: number
}

interface TimelinePoint {
  key: string
  threadId: number
  date: string
  dateLabel: string
  x: number
  y: number
  state: FocusOverviewTimelineUpdateModel['state']
}

interface TimelineLayout {
  width: number
  height: number
  railXs: Map<number, number>
  updates: PositionedUpdate[]
  points: TimelinePoint[]
}

const BUBBLE_WIDTH = 244
const BUBBLE_HEIGHT = 88
const BUBBLE_GAP = 14
const RAIL_GAP = 116
const HEADER_HEIGHT = 74
const SIDE_PADDING = 20
const SIDE_LANE_GAP = 64
const DATE_GROUP_GAP = 64

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

function dayDistance(newerDate: string, olderDate: string): number {
  const newer = new Date(`${newerDate}T00:00:00Z`).getTime()
  const older = new Date(`${olderDate}T00:00:00Z`).getTime()
  if (!Number.isFinite(newer) || !Number.isFinite(older)) return 1
  return Math.max(1, Math.round(Math.abs(newer - older) / 86_400_000))
}

function dateSpacing(newerDate: string, olderDate: string): number {
  return Math.min(150, DATE_GROUP_GAP + Math.sqrt(dayDistance(newerDate, olderDate)) * 10)
}

function buildFocusTimelineLayout(model: FocusOverviewTimelineModel): TimelineLayout {
  const railSpan = Math.max(0, (model.threads.length - 1) * RAIL_GAP)
  const centerWidth = Math.max(RAIL_GAP, railSpan)
  const width = Math.max(
    760,
    BUBBLE_WIDTH * 2 + SIDE_PADDING * 2 + SIDE_LANE_GAP * 2 + centerWidth
  )
  const centerX = width / 2
  const firstRailX = centerX - railSpan / 2
  const railXs = new Map(model.threads.map((thread, index) => [
    thread.id,
    firstRailX + index * RAIL_GAP
  ]))
  const threadIndexes = new Map(model.threads.map((thread, index) => [thread.id, index]))
  const dates = [...new Set(model.updates.map(({ date }) => date))].sort().reverse()
  const positionedUpdates: PositionedUpdate[] = []
  const points: TimelinePoint[] = []
  let groupTop = HEADER_HEIGHT + 34

  dates.forEach((date, dateIndex) => {
    const dateUpdates = model.updates.filter((update) => update.date === date)
    const sideCounts: Record<TimelineSide, number> = { left: 0, right: 0 }
    const threadOccurrences = new Map<number, number>()
    const assigned = dateUpdates.map((update, updateIndex) => {
      const occurrence = threadOccurrences.get(update.threadId) ?? 0
      threadOccurrences.set(update.threadId, occurrence + 1)
      const threadIndex = threadIndexes.get(update.threadId) ?? updateIndex
      const preferred: TimelineSide = (threadIndex + occurrence + dateIndex) % 2 === 0
        ? 'left'
        : 'right'
      const alternate: TimelineSide = preferred === 'left' ? 'right' : 'left'
      const side = sideCounts[preferred] <= sideCounts[alternate] + 1 ? preferred : alternate
      const sideIndex = sideCounts[side]
      sideCounts[side] += 1
      return { update, side, sideIndex }
    })
    const rowCount = Math.max(1, sideCounts.left, sideCounts.right)
    const groupHeight = rowCount * BUBBLE_HEIGHT + Math.max(0, rowCount - 1) * BUBBLE_GAP
    const pointY = groupTop + groupHeight / 2

    assigned.forEach(({ update, side, sideIndex }) => {
      const pointX = railXs.get(update.threadId) ?? centerX
      positionedUpdates.push({
        ...update,
        side,
        bubbleX: side === 'left' ? SIDE_PADDING : width - SIDE_PADDING - BUBBLE_WIDTH,
        bubbleY: groupTop + sideIndex * (BUBBLE_HEIGHT + BUBBLE_GAP),
        pointX,
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
    updatesByThread.forEach((updates, threadId) => {
      points.push({
        key: `${threadId}:${date}`,
        threadId,
        date,
        dateLabel: updates[0]?.dateLabel ?? date,
        x: railXs.get(threadId) ?? centerX,
        y: pointY,
        state: updates[0]?.state ?? { label: 'None', tone: 'neutral' }
      })
    })

    const nextDate = dates[dateIndex + 1]
    groupTop += groupHeight + (nextDate ? dateSpacing(date, nextDate) : 0)
  })

  return {
    width,
    height: dates.length === 0 ? 280 : groupTop + 34,
    railXs,
    updates: positionedUpdates,
    points
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

function connectorPath(update: PositionedUpdate): string {
  const startX = update.side === 'left'
    ? update.bubbleX + BUBBLE_WIDTH
    : update.bubbleX
  const startY = update.bubbleY + BUBBLE_HEIGHT / 2
  const bend = Math.max(30, Math.abs(update.pointX - startX) * 0.42)
  const controlX = update.side === 'left' ? startX + bend : startX - bend
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
  const [selectedUpdateId, setSelectedUpdateId] = useState<number | null>(null)

  if (model.threads.length === 0) {
    return (
      <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="thread-timeline-heading">
        <h2 id="thread-timeline-heading" className="text-sm font-semibold">Thread timeline</h2>
        <p className="mt-4 text-sm text-muted-foreground">No Threads yet.</p>
      </section>
    )
  }

  const layout = buildFocusTimelineLayout(model)
  const selectedUpdate = model.updates.find(({ id }) => id === selectedUpdateId) ?? null
  const selectedThread = selectedUpdate
    ? model.threads.find(({ id }) => id === selectedUpdate.threadId) ?? null
    : null

  return (
    <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="thread-timeline-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="thread-timeline-heading" className="text-sm font-semibold">Thread timeline</h2>
        <p className="text-xs text-muted-foreground">Select an update to read it</p>
      </div>
      <div
        className="mt-4 overflow-x-auto rounded-xl border border-border/65 bg-muted/10 pb-2"
        data-testid="focus-thread-timeline"
      >
        <div
          className="relative mx-auto"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="Thread update timeline"
          >
            <title>Thread updates arranged by date along parallel Thread timelines</title>
            {model.threads.map((thread) => {
              const x = layout.railXs.get(thread.id) ?? layout.width / 2
              return (
                <line
                  key={thread.id}
                  data-testid={`thread-rail-${thread.id}`}
                  x1={x}
                  x2={x}
                  y1={HEADER_HEIGHT - 4}
                  y2={layout.height - 22}
                  className={cn(
                    'stroke-primary/60',
                    thread.closed && 'stroke-muted-foreground/35'
                  )}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )
            })}
            {layout.updates.map((update) => (
              <path
                key={`connector:${update.id}`}
                data-testid={`timeline-connector-${update.id}`}
                d={connectorPath(update)}
                fill="none"
                className={stateToneClass(update.state.tone, 'stroke')}
                strokeWidth="1.5"
                strokeOpacity="0.7"
              />
            ))}
            {layout.points.map((point) => (
              <g key={point.key}>
                <rect
                  x={point.x - 39}
                  y={point.y - 27}
                  width="78"
                  height="17"
                  rx="8.5"
                  className="fill-background stroke-border"
                />
                <text
                  x={point.x}
                  y={point.y - 15}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px] font-medium"
                >
                  {point.dateLabel}
                </text>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="6"
                  className="fill-background stroke-primary"
                  strokeWidth="2"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="2.5"
                  className={stateToneClass(point.state.tone, 'fill')}
                />
              </g>
            ))}
          </svg>

          {model.threads.map((thread) => {
            const x = layout.railXs.get(thread.id) ?? layout.width / 2
            return (
              <button
                key={thread.id}
                type="button"
                className="absolute top-3 w-26 -translate-x-1/2 rounded-lg px-2 py-1.5 text-center hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: x }}
                onClick={() => onOpenThread(thread.id)}
                aria-label={`Open Thread ${thread.title}`}
              >
                <span className="block truncate text-[11px] font-semibold">{thread.title}</span>
                <span className={cn(
                  'block text-[10px] capitalize text-muted-foreground',
                  thread.closed && 'italic'
                )}>
                  {thread.statusLabel}
                </span>
              </button>
            )
          })}

          {model.updates.length === 0 && (
            <p className="absolute inset-x-0 top-34 text-center text-sm text-muted-foreground">
              No updates yet.
            </p>
          )}

          {layout.updates.map((update) => (
            <button
              key={update.id}
              type="button"
              data-side={update.side}
              className="absolute overflow-hidden rounded-xl border border-border/75 bg-card px-3.5 py-3 text-left shadow-sm transition hover:-translate-y-px hover:border-primary/55 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                left: update.bubbleX,
                top: update.bubbleY,
                width: BUBBLE_WIDTH,
                height: BUBBLE_HEIGHT
              }}
              aria-label={`Read ${updateTitle(update.sourceLabel)} from ${update.dateLabel}`}
              onClick={() => setSelectedUpdateId(update.id)}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-primary">
                  {update.sourceLabel}
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
