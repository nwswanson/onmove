# Contextual sidebar navigation

The contextual sidebar is the secondary hierarchy pane. Its navigation controller remains generic,
and its rows now use a receiver-owned data contract rather than caller-provided render functions.

Responsibility is divided as follows:

- `ContextualSidebarItemModel` defines the only row data accepted by the receiver: stable id,
  label, accessible label, group, semantic icon token, tone, line count, accessory, and disabled
  state.
- `ContextualSidebarLevel` owns a collection of those row models plus its parent assertion and
  optional New action.
- `ContextualSidebarNavigation` owns the current level, selection retention, Back traversal, and
  reconciliation after deletion.
- `ContextualSidebar` owns every row element, icon, class, focus state, selection marker, group
  label, empty state, and New button.
- A feature presenter converts Threads or Commitments into `ContextualSidebarItemModel[]` before
  the level sees them.

There is deliberately no `renderItem`, arbitrary class name, React node, or domain generic on a
level. A caller can request a two-line row or muted tone using vocabulary the sidebar contract
defines, but cannot replace receiver markup.

```ts
const root = new ContextualSidebarLevel({
  id: `focus:${focus.id}`,
  title: 'Focus',
  ariaLabel: 'Focus sections',
  items: focusContextSidebarItems(threads),
  newItem: { label: 'New thread', onCreate: openNewThread }
})

const commitments = new ContextualSidebarLevel({
  id: `focus:${focus.id}:commitments`,
  title: 'Commitments',
  ariaLabel: 'Focus commitments',
  parent: root,
  parentItemId: 'overall',
  items: commitmentContextSidebarItems(focusCommitments),
  newItem: { label: 'New commitment', onCreate: openNewCommitment }
})
```

The navigation snapshot exposes only a selected presentation id. The feature view resolves that id
against its own model data when it needs the selected Thread or Commitment. Domain records never
live inside the shared level.

## Parent and deletion rules

A controller starts at one parentless root. Every entered child level must assert both the current
parent level and one selected parent item. `navigateTo` rejects unrelated levels and mismatched
parent selections.

Selections are retained independently per level, so Back restores the previous parent selection.
After items change, `navigation.refresh()` selects the first surviving peer or `null`. If the item
asserted by a deeper level disappears, refresh walks upward to the nearest reachable ancestor. This
handles leaf deletion and cascades without embedding Focus/Thread/Commitment rules in navigation.

Item and level ids must be non-empty and unique. Labels and group labels are validated at the
receiver boundary. The optional `newItem` callback is a capability supplied by the feature; the
sidebar owns its placement, icon, semantics, and disabled presentation.
