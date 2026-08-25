import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { StateDot, type StateLabelModel } from '@/components/ui/state-label'
import { TaggedText } from '@/components/ui/tagged-text'

export interface SidebarTransferTarget {
  targetType: string
  targetId: string
}

export interface SidebarTransferSourceData {
  kind: 'sidebar-transfer-source'
  sourceId: string
  acceptedTargetTypes: readonly string[]
  preview: {
    label: string
    state?: StateLabelModel
  }
  onDrop: (target: SidebarTransferTarget) => void
}

export interface SidebarTransferTargetData extends SidebarTransferTarget {
  kind: 'sidebar-transfer-target'
}

export function isSidebarTransferSourceData(
  value: unknown
): value is SidebarTransferSourceData {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'sidebar-transfer-source'
  )
}

export function isSidebarTransferTargetData(
  value: unknown
): value is SidebarTransferTargetData {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'sidebar-transfer-target'
  )
}

const SidebarDndContext = createContext(false)

export function useSidebarDndAvailable(): boolean {
  return useContext(SidebarDndContext)
}

/**
 * One receiver-owned drag boundary spans the primary and contextual sidebars.
 * Domain adapters provide opaque source/target ids and receive only a move
 * intent after the shared boundary validates target compatibility.
 */
export function SidebarDndProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )
  const [activeSource, setActiveSource] = useState<SidebarTransferSourceData | null>(null)

  function handleDragStart(event: DragStartEvent): void {
    const source = event.active.data.current
    setActiveSource(isSidebarTransferSourceData(source) ? source : null)
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveSource(null)
    const source = event.active.data.current
    const target = event.over?.data.current
    if (!isSidebarTransferSourceData(source) || !isSidebarTransferTargetData(target)) return
    if (!source.acceptedTargetTypes.includes(target.targetType)) return
    source.onDrop({ targetType: target.targetType, targetId: target.targetId })
  }

  return (
    <SidebarDndContext.Provider value>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setActiveSource(null)}
        onDragEnd={handleDragEnd}
      >
        {children}
        <DragOverlay adjustScale={false}>
          {activeSource ? (
            <div className="flex min-h-8 w-56 items-center gap-2 rounded-md border border-sidebar-border bg-sidebar px-2 text-left text-xs text-sidebar-foreground shadow-lg">
              {activeSource.preview.state && <StateDot model={activeSource.preview.state} />}
              <span className="min-w-0 flex-1 truncate">
                <TaggedText value={activeSource.preview.label} />
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </SidebarDndContext.Provider>
  )
}

/** Supply a local boundary for isolated receiver tests and stories. */
export function SidebarDndBoundary({ children }: { children: ReactNode }): React.JSX.Element {
  return useSidebarDndAvailable()
    ? <>{children}</>
    : <SidebarDndProvider>{children}</SidebarDndProvider>
}
