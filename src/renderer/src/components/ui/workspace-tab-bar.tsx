import { useRef } from 'react'
import { StateLabel, type StateLabelModel } from '@/components/ui/state-label'
import { cn } from '@/lib/utils'

export interface WorkspaceTabItemModel {
  id: string
  label: string
  accessibleLabel?: string
  meta?: string
  stateLabel?: StateLabelModel
  attentionLabel?: string
  disabled?: boolean
}

export interface WorkspaceTabBarModel {
  ariaLabel: string
  items: readonly WorkspaceTabItemModel[]
}

export interface WorkspaceTabBarProps {
  model: WorkspaceTabBarModel
  selectedId: string
  onSelect: (id: string) => void
  className?: string
}

/**
 * Domain-free tab navigation for switching the context projected into a
 * workspace canvas. Feature presenters own the tab data; this receiver owns
 * tab semantics, keyboard behavior, and visual treatment.
 */
export function WorkspaceTabBar({
  model,
  selectedId,
  onSelect,
  className
}: WorkspaceTabBarProps): React.JSX.Element {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function moveSelection(fromIndex: number, direction: 1 | -1): void {
    if (model.items.length === 0) return
    for (let offset = 1; offset <= model.items.length; offset += 1) {
      const index = (fromIndex + direction * offset + model.items.length) % model.items.length
      const item = model.items[index]
      if (!item.disabled) {
        onSelect(item.id)
        tabRefs.current[index]?.focus()
        return
      }
    }
  }

  function selectBoundary(direction: 1 | -1): void {
    const start = direction === 1 ? 0 : model.items.length - 1
    for (let index = start; index >= 0 && index < model.items.length; index += direction) {
      const item = model.items[index]
      if (!item.disabled) {
        onSelect(item.id)
        tabRefs.current[index]?.focus()
        return
      }
    }
  }

  return (
    <div
      data-slot="workspace-tab-bar"
      className={cn(
        'flex min-w-0 shrink-0 border-b border-border/80 bg-background/95 px-3 py-2',
        className
      )}
    >
      <div
        role="tablist"
        aria-label={model.ariaLabel}
        className="inline-flex min-w-0 max-w-full items-stretch gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground"
      >
        {model.items.map((item, index) => {
          const selected = item.id === selectedId
          return (
            <button
              key={item.id}
              ref={(element) => { tabRefs.current[index] = element }}
              type="button"
              role="tab"
              aria-label={item.accessibleLabel ?? item.label}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              title={item.meta}
              className={cn(
                'relative flex min-h-10 shrink-0 flex-col justify-center gap-0.5 rounded-md border border-transparent px-3 py-1 text-left outline-none transition-all',
                'hover:bg-background/55 hover:text-foreground focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/60',
                'disabled:pointer-events-none disabled:opacity-50',
                selected && 'border-border/70 bg-background text-foreground shadow-xs'
              )}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  moveSelection(index, 1)
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  moveSelection(index, -1)
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  selectBoundary(1)
                } else if (event.key === 'End') {
                  event.preventDefault()
                  selectBoundary(-1)
                }
              }}
            >
              <span className="flex items-center gap-2 text-xs font-medium">
                <span>{item.label}</span>
                {item.stateLabel && <StateLabel model={item.stateLabel} size="compact" />}
                {item.attentionLabel && (
                  <span className="text-[0.625rem] font-semibold text-destructive">
                    {item.attentionLabel}
                  </span>
                )}
              </span>
              {item.meta && (
                <span className="max-w-48 truncate text-[0.625rem] text-muted-foreground">
                  {item.meta}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
