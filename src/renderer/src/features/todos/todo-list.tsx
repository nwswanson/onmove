import { useId, useMemo, useState } from 'react'
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
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TaggedInput, TaggedText } from '@/components/ui/tagged-text'
import {
  validateTodoListModel,
  type TodoListItemModel,
  type TodoListProps
} from '@/features/todos/todo-list-contract'
import { cn } from '@/lib/utils'

function TodoRow({
  item,
  onUpdate,
  onDelete,
  onSubjectCompletionChange
}: {
  item: TodoListItemModel
  onUpdate: TodoListProps['onUpdate']
  onDelete: TodoListProps['onDelete']
  onSubjectCompletionChange: TodoListProps['onSubjectCompletionChange']
}): React.JSX.Element {
  const draggable = item.draggable !== false
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id, disabled: !draggable })
  const [name, setName] = useState(item.name)
  const [dueDate, setDueDate] = useState(item.dueDate ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subjectProgressOpen, setSubjectProgressOpen] = useState(false)

  async function saveName(): Promise<void> {
    const nextName = name.trim()
    if (!nextName || nextName === item.name) {
      setName(item.name)
      return
    }
    await mutate({ name: nextName })
    setName(nextName)
  }

  async function saveDueDate(): Promise<void> {
    const nextDueDate = dueDate || null
    if (nextDueDate === item.dueDate) return
    await mutate({ dueDate: nextDueDate })
  }

  async function mutate(
    input: Partial<Pick<TodoListItemModel, 'name' | 'dueDate' | 'done'>>
  ): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onUpdate(item.id, input)
    } catch {
      setError('The Todo could not be saved.')
      setName(item.name)
      setDueDate(item.dueDate ?? '')
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onDelete(item.id)
    } catch {
      setError('The Todo could not be deleted.')
      setSaving(false)
    }
  }

  async function mutateSubject(subjectId: string, done: boolean): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onSubjectCompletionChange(item.id, subjectId, done)
    } catch {
      setError('The Subject completion could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <li
      ref={setNodeRef}
      data-todo-id={item.id}
      data-overdue={item.overdue ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      className={cn(
        'relative bg-transparent will-change-transform transition-colors',
        item.overdue && 'bg-destructive/5',
        isDragging && 'z-10 bg-primary/10 ring-2 ring-inset ring-primary/70'
      )}
    >
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center gap-2 px-4 text-xs font-semibold text-primary">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          Drop Todo here
        </div>
      )}
      <div className={cn(
        'flex min-w-0 flex-wrap items-center gap-1.5 px-2 py-1.5',
        isDragging && 'invisible'
      )}>
        {draggable ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Drag ${item.name}`}
            title="Drag to reorder"
            disabled={saving}
            className="flex size-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50"
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        ) : <span className="size-7 shrink-0" aria-hidden="true" />}
        <input
          type="checkbox"
          aria-label={item.canToggleDone === false
            ? `${item.name} completes when every Subject is done`
            : `Mark ${item.name} done`}
          checked={item.done}
          disabled={saving || item.canToggleDone === false}
          className="size-4 accent-primary"
          onChange={(event) => item.completionSubjectId
            ? void mutateSubject(item.completionSubjectId, event.target.checked)
            : void mutate({ done: event.target.checked })}
        />
        <TaggedInput
          aria-label="Todo name"
          value={name}
          className={cn(
            'h-8 min-w-44 flex-1',
            item.done && 'text-muted-foreground line-through'
          )}
          disabled={saving || item.canEdit === false}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setName(item.name)
              event.currentTarget.blur()
            }
          }}
        />
        {item.contextLabel && (
          <span className="rounded-full border border-primary/45 bg-primary/15 px-2 py-0.5 text-[0.6875rem] font-semibold">
            {item.contextLabel}
          </span>
        )}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Due date</span>
          <Input
            type="date"
            aria-label="Todo due date"
            value={dueDate}
            disabled={saving || item.canEdit === false}
            className={cn('h-8 w-36', item.overdue && 'border-destructive text-destructive')}
            onChange={(event) => setDueDate(event.target.value)}
            onBlur={() => void saveDueDate()}
          />
        </label>
        {item.overdue && (
          <span className="text-xs font-semibold text-destructive">Overdue</span>
        )}
        {item.canDelete !== false ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${item.name}`}
            disabled={saving}
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : <span className="size-8 shrink-0" aria-hidden="true" />}
      </div>
      {(item.subjectCompletions?.length ?? 0) > 0 && (
        <div className="border-t border-border/65 px-3 py-2">
          <button
            type="button"
            aria-expanded={subjectProgressOpen}
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/55"
            onClick={() => setSubjectProgressOpen((open) => !open)}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-3.5 transition-transform', subjectProgressOpen && 'rotate-180')}
            />
            Subject progress
            <span className="ml-auto tabular-nums">
              {item.subjectCompletions?.filter(({ done }) => done).length}/
              {item.subjectCompletions?.length}
            </span>
          </button>
          {subjectProgressOpen && (
            <ul
              aria-label={`${item.name} Subject progress`}
              className="mt-2 space-y-1 pl-5"
            >
              {item.subjectCompletions?.map((completion) => (
                <li
                  key={completion.subjectId}
                  className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs"
                >
                  <input
                    type="checkbox"
                    aria-label={`Mark ${item.name} done for ${completion.label}`}
                    checked={completion.done}
                    disabled={saving}
                    className="size-4 accent-primary"
                    onChange={(event) =>
                      void mutateSubject(completion.subjectId, event.target.checked)}
                  />
                  <span className={cn(completion.done && 'text-muted-foreground line-through')}>
                    {completion.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{error}</p>}
    </li>
  )
}

function TodoDragPreview({ item }: { item: TodoListItemModel }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex w-full min-w-0 rotate-[0.35deg] items-center gap-1.5 rounded-lg border border-primary/70 bg-card p-2 shadow-2xl',
        item.overdue && 'border-destructive/70 bg-destructive/5'
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
        <GripVertical className="size-4" />
      </span>
      <span className={cn(
        'size-4 shrink-0 rounded border border-input bg-background',
        item.done && 'border-primary bg-primary'
      )} />
      <span className={cn(
        'min-w-44 flex-1 truncate rounded-md border border-input bg-background px-3 py-2 text-sm',
        item.done && 'text-muted-foreground line-through'
      )}>
        <TaggedText value={item.name} />
      </span>
      {item.contextLabel && (
        <span className="rounded-full border border-primary/45 bg-primary/15 px-2 py-0.5 text-[0.6875rem] font-semibold">
          {item.contextLabel}
        </span>
      )}
      {item.dueDate && (
        <span className={cn(
          'rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums',
          item.overdue && 'border-destructive text-destructive'
        )}>
          {item.dueDate}
        </span>
      )}
      {item.overdue && (
        <span className="text-xs font-semibold text-destructive">Overdue</span>
      )}
      <span className="size-8 shrink-0" />
    </div>
  )
}

function TodoSortableCollection({
  ariaLabel,
  items,
  onUpdate,
  onDelete,
  onSubjectCompletionChange,
  onReorder
}: {
  ariaLabel: string
  items: readonly TodoListItemModel[]
  onUpdate: TodoListProps['onUpdate']
  onDelete: TodoListProps['onDelete']
  onSubjectCompletionChange: TodoListProps['onSubjectCompletionChange']
  onReorder: TodoListProps['onReorder']
}): React.JSX.Element {
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<{
    sourceSignature: string
    ids: string[]
  } | null>(null)
  const [sortError, setSortError] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )
  const itemIds = useMemo(() => items.map(({ id }) => id), [items])
  const itemOrderSignature = itemIds.join('\u0000')
  const optimisticIds = pendingOrder?.sourceSignature === itemOrderSignature
    ? pendingOrder.ids
    : null
  const displayedItems = useMemo(() => {
    if (!optimisticIds) return items
    const byId = new Map(items.map((item) => [item.id, item] as const))
    return optimisticIds.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
  }, [items, optimisticIds])
  const displayedItemIds = useMemo(
    () => displayedItems.map(({ id }) => id),
    [displayedItems]
  )
  const activeItem = activeItemId === null
    ? null
    : items.find(({ id }) => id === activeItemId) ?? null

  function handleDragStart(event: DragStartEvent): void {
    setSortError(null)
    setActiveItemId(String(event.active.id))
  }

  function handleDragCancel(): void {
    setActiveItemId(null)
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveItemId(null)
    if (!event.over || event.active.id === event.over.id) return
    const sourceIndex = displayedItemIds.indexOf(String(event.active.id))
    const targetIndex = displayedItemIds.indexOf(String(event.over.id))
    if (sourceIndex < 0 || targetIndex < 0) return
    const nextIds = arrayMove(displayedItemIds, sourceIndex, targetIndex)
    if (nextIds.every((id, index) => id === displayedItemIds[index])) return
    setPendingOrder({ sourceSignature: itemOrderSignature, ids: nextIds })
    void persistOrder(nextIds)
  }

  async function persistOrder(nextIds: readonly string[]): Promise<void> {
    setSortError(null)
    try {
      await onReorder(nextIds)
    } catch {
      setSortError('The Todo order could not be saved.')
      setPendingOrder(null)
    }
  }

  return (
    <>
      {sortError && <p role="alert" className="mb-2 text-xs text-destructive">{sortError}</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={displayedItemIds} strategy={verticalListSortingStrategy}>
          <ul
            className="divide-y divide-border/65 overflow-hidden rounded-xl border border-border/80 bg-card/45 shadow-xs"
            aria-label={ariaLabel}
          >
            {displayedItems.map((item) => (
              <TodoRow
                key={item.id}
                item={item}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onSubjectCompletionChange={onSubjectCompletionChange}
              />
            ))}
          </ul>
        </SortableContext>
        <DragOverlay adjustScale={false}>
          {activeItem ? <TodoDragPreview item={activeItem} /> : null}
        </DragOverlay>
      </DndContext>
    </>
  )
}

export function TodoList({
  ariaLabel,
  items,
  orphanedItems = [],
  orphanedItemsLabel = 'Orphaned Todos',
  loading = false,
  loadError,
  createTargets = [],
  defaultCreateTargetId,
  onCreate,
  onUpdate,
  onDelete,
  onSubjectCompletionChange,
  onReorder
}: TodoListProps): React.JSX.Element {
  if (!ariaLabel.trim()) throw new Error('A Todo list requires an accessible label.')
  if (!orphanedItemsLabel.trim()) throw new Error('An orphaned Todo collection requires a label.')
  validateTodoListModel([...items, ...orphanedItems], createTargets)
  const headingId = useId()
  const orphanedItemsId = useId()
  const [name, setName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [createTargetId, setCreateTargetId] = useState(
    defaultCreateTargetId ?? createTargets[0]?.id ?? ''
  )
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [orphanedItemsOpen, setOrphanedItemsOpen] = useState(false)

  const effectiveCreateTargetId = createTargets.some(({ id }) => id === createTargetId)
    ? createTargetId
    : defaultCreateTargetId ?? createTargets[0]?.id ?? ''

  async function create(): Promise<void> {
    const nextName = name.trim()
    if (!nextName) return
    setCreating(true)
    setCreateError(null)
    try {
      await onCreate(
        { name: nextName, dueDate: dueDate || null },
        createTargets.length > 0 ? effectiveCreateTargetId : undefined
      )
      setName('')
      setDueDate('')
    } catch {
      setCreateError('The Todo could not be added.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="mt-8" aria-labelledby={headingId} aria-label={ariaLabel}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="mr-auto text-sm font-semibold">Todos</h2>
        <TaggedInput
          aria-label="New Todo name"
          placeholder="Add a Todo…"
          value={name}
          disabled={creating}
          className="min-w-48 flex-[1_1_16rem] sm:max-w-80"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create()
          }}
        />
        <Input
          type="date"
          aria-label="New Todo due date"
          value={dueDate}
          disabled={creating}
          className="w-36"
          onChange={(event) => setDueDate(event.target.value)}
        />
        {createTargets.length > 0 && (
          <select
            aria-label="New Todo context"
            value={effectiveCreateTargetId}
            disabled={creating}
            className="h-9 max-w-48 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            onChange={(event) => setCreateTargetId(event.target.value)}
          >
            {createTargets.map((target) => (
              <option key={target.id} value={target.id}>{target.label}</option>
            ))}
          </select>
        )}
        <Button type="button" size="sm" disabled={creating || !name.trim()} onClick={() => void create()}>
          <Plus aria-hidden="true" />
          Add Todo
        </Button>
      </div>
      {createError && <p role="alert" className="mb-2 text-xs text-destructive">{createError}</p>}
      {loadError && <p role="alert" className="text-xs text-destructive">{loadError}</p>}
      {loading ? (
        <p role="status" className="text-xs text-muted-foreground">Loading Todos…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/80 px-4 py-5 text-sm text-muted-foreground">
          {orphanedItems.length > 0 ? 'No current Todos yet.' : 'No Todos yet.'}
        </p>
      ) : (
        <TodoSortableCollection
          ariaLabel={`${ariaLabel} sortable list`}
          items={items}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onSubjectCompletionChange={onSubjectCompletionChange}
          onReorder={onReorder}
        />
      )}
      {orphanedItems.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-border/75 bg-muted/15">
          <button
            type="button"
            aria-expanded={orphanedItemsOpen}
            aria-controls={orphanedItemsId}
            className="flex w-full items-center gap-2 px-3.5 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
            onClick={() => setOrphanedItemsOpen((open) => !open)}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform',
                orphanedItemsOpen && 'rotate-180'
              )}
            />
            <span className="text-xs font-semibold">{orphanedItemsLabel}</span>
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              {orphanedItems.length}
            </span>
          </button>
          <div
            id={orphanedItemsId}
            hidden={!orphanedItemsOpen}
            className="border-t border-border/70 p-3"
          >
            {orphanedItemsOpen && (
              <TodoSortableCollection
                ariaLabel={orphanedItemsLabel}
                items={orphanedItems}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onSubjectCompletionChange={onSubjectCompletionChange}
                onReorder={onReorder}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
