# Contextual sidebar navigation

The **contextual sidebar** is the secondary hierarchy pane between the persistent primary sidebar
and the main view. It is distinct from the right-side **context drawer**, which edits the currently
selected object.

Navigating deeper replaces the contextual sidebar's current level. It does not append another
column. The shared primitives live in
`src/renderer/src/components/ui/contextual-sidebar.tsx` and divide responsibility three ways:

- `ContextualSidebarLevel<TItem>` owns one level's typed items, item identifiers, item renderer,
  groups, optional new-item action, selection callback, and optional parent.
- `ContextualSidebarNavigation` owns the current level and the selected item at every visited level.
- `ContextualSidebar` renders the current level and owns global controls such as Back.
- `useContextualSidebarNavigation` lets the main view consume the same current level and selection.

## Root and parent rules

A navigation controller starts at one parentless root. For a Focus, that root will eventually own
the Focus's Thread items. A Focus is not itself an item in another contextual level; the persistent
primary sidebar owns Focus selection.

Every deeper level must explicitly assert the currently visible level and one of that level's items
as its parent. A Commitment level beneath a Thread therefore points to the Thread level and the
selected Thread item. An Update level beneath Commitments points to the Commitment level and its
selected Commitment item. `navigateTo` rejects unrelated levels and parent-item mismatches, which
prevents the main view and contextual sidebar from silently diverging.

```tsx
const threads = new ContextualSidebarLevel<ThreadSnapshot>({
  id: `focus:${focus.id}:threads`,
  title: 'Threads',
  ariaLabel: `${focus.title} threads`,
  items: () => threadSnapshots,
  getItemId: (thread) => String(thread.id),
  renderItem: (thread) => <span>{thread.title}</span>,
  newItem: {
    label: 'New thread',
    onCreate: () => setNewThreadOpen(true)
  },
  onSelect: (thread) => setSelectedThreadId(thread.id)
})

const commitments = new ContextualSidebarLevel<CommitmentSnapshot>({
  id: `thread:${thread.id}:commitments`,
  title: 'Commitments',
  ariaLabel: `${thread.title} commitments`,
  parent: threads,
  parentItemId: String(thread.id),
  items: () => commitmentSnapshots,
  getItemId: (commitment) => String(commitment.id),
  renderItem: (commitment) => <span>{commitment.title}</span>,
  onSelect: (commitment) => setSelectedCommitmentId(commitment.id)
})

const navigation = new ContextualSidebarNavigation(threads)

navigation.select(String(thread.id))
navigation.navigateTo(commitments)

function Workspace(): React.JSX.Element {
  const current = useContextualSidebarNavigation(navigation)
  const selectedCommitment =
    current.level === commitments && current.selectedItemId
      ? commitments.getItem(current.selectedItemId)
      : undefined

  return (
    <>
      <ContextualSidebar navigation={navigation} />
      <main>{selectedCommitment?.title}</main>
    </>
  )
}
```

The first item is selected by default. Set `selectFirstItem: false` when a level may intentionally
have no selection, or set `initialSelectedItemId` for a specific initial record. Explicit
selections are retained independently for each level, so Back restores the parent's previous
selection.

## Data changes

`items` may be an array or a provider function. For ordinary async IPC data, call
`level.setItems(nextSnapshots)` and then `navigation.refresh()` from the load or mutation handler.
If the selected record disappeared, the controller selects the first remaining record or `null`
when the level is empty.

Deletion reconciliation keeps the deepest still-valid level. Removing a selected leaf selects the
first surviving peer and leaves the level open; removing the final leaf leaves that valid collection
open with no selection. If a level's asserted parent item was deleted, `navigation.refresh()` walks
up the full parent chain to the nearest reachable ancestor and reconciles that ancestor's selection.
This also handles cascades that invalidate multiple nested levels in one mutation.

Item identifiers must be non-empty and unique within a level. Level identifiers cannot repeat in
their own parent chain. `renderItem` supplies domain-specific row content, while
`getItemClassName` can opt a level into taller or multi-line rows without replacing the shared
button semantics. `getItemGroup` supplies semantic group labels. `newItem` declares the optional
level-local creation action; the shared contextual sidebar renders its icon, button, location,
disabled behavior, and accessible label. This lets a root level offer New Thread and its child
level offer New Commitment without either adapter reimplementing footer UI. `footer` remains
available for uncommon custom controls. Disabled items remain visible but cannot become selected.

The live Focus root uses these interfaces for Overall and persisted Threads. Its Focus-level
Commitments section creates a child level that asserts Overall as its parent item, so opening a
Commitment replaces the contextual sidebar while Back restores the previous root selection.
