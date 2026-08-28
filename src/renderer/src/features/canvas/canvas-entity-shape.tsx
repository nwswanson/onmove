import {
  CheckSquare2,
  FileText,
  GitBranch,
  Handshake,
  Repeat2
} from 'lucide-react'
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  resizeBox,
  type TLBaseShape
} from 'tldraw'
import type { CanvasEntityKind } from '../../../../shared/contracts'

export const CANVAS_ENTITY_SHAPE_TYPE = 'onmove-entity' as const

export type CanvasEntityShape = TLBaseShape<typeof CANVAS_ENTITY_SHAPE_TYPE, {
  w: number
  h: number
  entityType: CanvasEntityKind
  entityId: number
  title: string
  status: string
  context: string
  deleted: boolean
  deletedAt: string
}>

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    [CANVAS_ENTITY_SHAPE_TYPE]: CanvasEntityShape['props']
  }
}

function statusTone(status: string): string {
  if (status === 'red' || status === 'cancelled') return 'bg-destructive'
  if (status === 'yellow') return 'bg-warning'
  if (status === 'green' || status === 'done') return 'bg-success'
  if (status === 'active' || status === 'open') return 'bg-primary'
  return 'bg-muted-foreground/60'
}

/** Minimal custom TLDraw card; domain data arrives only through validated props. */
export class CanvasEntityShapeUtil extends ShapeUtil<CanvasEntityShape> {
  static override type = CANVAS_ENTITY_SHAPE_TYPE
  static override props = {
    w: T.number,
    h: T.number,
    entityType: T.literalEnum('thread', 'commitment', 'note', 'routine', 'todo'),
    entityId: T.number,
    title: T.string,
    status: T.string,
    context: T.string,
    deleted: T.boolean,
    deletedAt: T.string
  }

  override getDefaultProps(): CanvasEntityShape['props'] {
    return {
      w: 260,
      h: 116,
      entityType: 'thread',
      entityId: 1,
      title: 'Untitled',
      status: 'active',
      context: '',
      deleted: false,
      deletedAt: ''
    }
  }

  override getGeometry(shape: CanvasEntityShape): Rectangle2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    })
  }

  override component(shape: CanvasEntityShape): React.JSX.Element {
    const { entityType, title, status, context, deleted, deletedAt } = shape.props
    const Icon = entityType === 'thread'
      ? GitBranch
      : entityType === 'commitment'
        ? Handshake
        : entityType === 'routine'
          ? Repeat2
          : entityType === 'note'
            ? FileText
            : CheckSquare2
    return (
      <HTMLContainer
        id={shape.id}
        className="pointer-events-none flex h-full w-full select-none items-stretch"
      >
        <article
          aria-label={`${deleted ? 'Deleted ' : ''}${entityType}: ${title}`}
          data-canvas-entity-kind={entityType}
          data-canvas-entity-deleted={deleted ? 'true' : 'false'}
          className={deleted
            ? 'flex h-full w-full flex-col justify-between rounded-xl border-2 border-dashed border-muted-foreground/45 bg-background/60 p-4 text-muted-foreground shadow-sm'
            : 'flex h-full w-full flex-col justify-between rounded-xl border border-border bg-card p-4 text-card-foreground shadow-md'}
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {deleted ? `Deleted ${entityType}` : entityType}
              </span>
              <span className="mt-0.5 block truncate text-sm font-semibold">{title}</span>
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 text-[11px]">
            <span className="truncate text-muted-foreground">
              {deleted ? (context || 'Former OnMove item') : context}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 capitalize text-muted-foreground">
              <span className={`size-2 rounded-full ${deleted ? 'bg-muted-foreground/50' : statusTone(status)}`} />
              {deleted ? 'Deleted' : (status ? status.replace('_', ' ') : 'No status')}
            </span>
          </div>
          {deleted && deletedAt && (
            <span className="sr-only">Deleted at {deletedAt}</span>
          )}
        </article>
      </HTMLContainer>
    )
  }

  override getIndicatorPath(): undefined {
    return undefined
  }

  override canEdit(): boolean {
    return false
  }

  override onResize = resizeBox<CanvasEntityShape>
}

export const canvasEntityShapeUtils = [CanvasEntityShapeUtil]
