import { Fragment } from 'react'
import { Undo2, X } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { cn } from '@/lib/utils'

export interface ContextDrawerProps extends Omit<React.ComponentProps<'aside'>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
}

export interface ContextDrawerRenderProps {
  width: number
  onClose: () => void
}

/**
 * A screen-owned adapter for the application drawer. The shell knows only how
 * to keep the outlet open and sized; the active screen owns what is rendered.
 */
export interface ContextDrawerAdapter {
  id: string
  /** Entity/ancestor keys whose deletion makes this representation invalid. */
  invalidationKeys: readonly string[]
  render: (props: ContextDrawerRenderProps) => React.ReactNode
}

export interface ContextDrawerState {
  open: boolean
  pinnedAdapter: ContextDrawerAdapter | null
}

export type ContextDrawerAction =
  | { type: 'toggle' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'pin'; adapter: ContextDrawerAdapter }
  | { type: 'unpin' }
  | { type: 'invalidate'; keys: readonly string[] }

export const initialContextDrawerState: ContextDrawerState = {
  open: false,
  pinnedAdapter: null
}

/**
 * Centralizes visibility, pinning, and deletion invalidation so domain screens
 * can evolve without duplicating drawer lifecycle rules.
 */
export function contextDrawerReducer(
  state: ContextDrawerState,
  action: ContextDrawerAction
): ContextDrawerState {
  switch (action.type) {
    case 'toggle':
      return { ...state, open: !state.open }
    case 'open':
      return state.open ? state : { ...state, open: true }
    case 'close':
      return state.open ? { ...state, open: false } : state
    case 'pin':
      return { open: true, pinnedAdapter: action.adapter }
    case 'unpin':
      return state.pinnedAdapter ? { ...state, pinnedAdapter: null } : state
    case 'invalidate': {
      if (!state.pinnedAdapter || action.keys.length === 0) return state
      const invalidated = new Set(action.keys)
      return state.pinnedAdapter.invalidationKeys.some((key) => invalidated.has(key))
        ? { ...state, pinnedAdapter: null }
        : state
    }
  }
}

export interface ContextDrawerControl {
  open: boolean
  pinnedAdapter: ContextDrawerAdapter | null
  width: number
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number) => void
  onClose: () => void
  onPin: (adapter: ContextDrawerAdapter) => void
  onUnpin: () => void
  onInvalidate: (keys: readonly string[]) => void
}

export interface ContextDrawerOutletProps
  extends Omit<ContextDrawerControl, 'onPin' | 'onInvalidate'> {
  adapter?: ContextDrawerAdapter | null
}

/**
 * Composable shell for any contextual inspector. The required `onClose` prop
 * guarantees that every drawer instance renders an accessible close button.
 */
function ContextDrawer({
  title,
  description,
  footer,
  onClose,
  children,
  className,
  ...props
}: ContextDrawerProps): React.JSX.Element {
  return (
    <aside
      data-slot="context-drawer"
      className={cn(
        'flex h-full shrink-0 flex-col border-l border-border/75 bg-card/82 text-card-foreground backdrop-blur-xl',
        className
      )}
      {...props}
    >
      <div className="flex min-h-16 items-start gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-1 size-8 text-muted-foreground"
          aria-label="Close context drawer"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div data-slot="context-drawer-content" className="min-h-0 flex-1 overflow-auto p-4">
        {children}
      </div>
      {footer && (
        <div
          data-slot="context-drawer-footer"
          className="flex items-center justify-end gap-2 border-t border-border/70 p-4"
        >
          {footer}
        </div>
      )}
    </aside>
  )
}

function ContextDrawerSection({
  className,
  ...props
}: React.ComponentProps<'section'>): React.JSX.Element {
  return (
    <section
      data-slot="context-drawer-section"
      className={cn('space-y-4 rounded-xl border border-border/75 bg-background/45 p-4', className)}
      {...props}
    />
  )
}

/**
 * Persistent, domain-agnostic drawer outlet. Swapping adapters replaces only
 * the drawer representation; it never changes the caller-owned open state.
 */
function ContextDrawerOutlet({
  open,
  adapter,
  pinnedAdapter,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onClose,
  onUnpin
}: ContextDrawerOutletProps): React.JSX.Element | null {
  if (!open) return null

  const renderedAdapter = pinnedAdapter ?? adapter

  return (
    <>
      <ResizeHandle
        label="Resize context drawer"
        value={width}
        min={minWidth}
        max={maxWidth}
        direction={-1}
        onChange={onWidthChange}
      />
      <div
        data-slot="context-drawer-outlet"
        className="flex h-full shrink-0 flex-col overflow-hidden"
        style={{ width }}
      >
        {pinnedAdapter && (
          <div className="shrink-0 border-b border-l border-border/70 bg-card/82 p-1 backdrop-blur-xl">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start text-muted-foreground"
              aria-label="Unpin drawer and follow current selection"
              onClick={onUnpin}
            >
              <Undo2 aria-hidden="true" />
              <span>Follow current selection</span>
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {renderedAdapter ? (
            <Fragment key={renderedAdapter.id}>
              {renderedAdapter.render({ width, onClose })}
            </Fragment>
          ) : (
            <ContextDrawer
              title="Context"
              description="Current selection"
              aria-label="Context drawer"
              style={{ width }}
              onClose={onClose}
            >
              <p className="text-sm text-muted-foreground">No settings here.</p>
            </ContextDrawer>
          )}
        </div>
      </div>
    </>
  )
}

export { ContextDrawer, ContextDrawerOutlet, ContextDrawerSection }
