# Context drawer adapters

The right-side context drawer is a persistent application affordance, while its contents belong to
the active screen. The shared types and outlet live in
`src/renderer/src/components/ui/context-drawer.tsx`:

- `ContextDrawerAdapter` identifies one active representation and renders it from shared width and
  close controls.
- `ContextDrawerOutlet` owns open/closed behavior, the resize handle, adapter replacement, and the
  fallback shown when the active screen has no settings.
- `ContextDrawer` and `ContextDrawerSection` provide the common macOS-style inspector shell.

The application owns only persistent drawer state (`open` and `width`). It does not switch on Focus,
Thread, Commitment, or any future domain type. Each active workspace derives an adapter from the
same selection that drives its main view:

```tsx
const adapter: ContextDrawerAdapter | null = selectedCommitment
  ? {
      id: `commitment:${selectedCommitment.id}`,
      render: ({ width, onClose }) => (
        <CommitmentContextPanel
          commitment={selectedCommitment}
          width={width}
          onClose={onClose}
        />
      )
    }
  : null

return <ContextDrawerOutlet adapter={adapter} {...persistentDrawerState} />
```

The toolbar information button toggles `open` and reports that state through `aria-pressed`.
Closing and reopening the drawer does not discard a pinned adapter or reset its width.

Adapter identifiers must include the entity kind and stable identifier. Changing adapters replaces
the rendered inspector state, but never closes the outlet or resets its width. Navigating Back or
to another primary destination therefore immediately shows that screen's adapter in the already
open drawer.

## Pinned inspections

An item may be inspected without becoming the main or contextual-sidebar selection. Call the
shared controller's `onPin(adapter)` with that item's normal drawer adapter. This opens the drawer
if needed and gives the supplied adapter precedence over the active screen:

```tsx
<Button
  aria-label={`Pin commitment ${commitment.title} in context drawer`}
  onClick={() => contextDrawer.onPin(commitmentDrawerAdapter(commitment))}
>
  Pin
</Button>
```

The pinned adapter survives main-view navigation, contextual navigation, and temporarily closing
the drawer. The outlet provides a global “Follow current selection” action to unpin it. Do not
modify the main view selection or contextual navigation merely to inspect an item, and reuse the
same adapter factory for ordinary selection and pinned rendering so their representations cannot
diverge.

## Deletion lifecycle

Every adapter declares `invalidationKeys` for its own entity and any owning ancestors. For example,
a Focus-level Commitment declares both `focus:1` and `commitment:2`. After a successful model
deletion, call `contextDrawer.onInvalidate(deletedKeys)`.

The shared reducer applies these defaults:

- An unrelated deletion leaves the pin unchanged.
- Deleting the pinned entity or an owning ancestor clears the pin.
- Invalidation never closes the drawer; it immediately resumes the active screen adapter or the
  shared empty state.
- Hiding and reopening the drawer does not affect a valid pin.
- A failed deletion does not invalidate anything, change selection, or close the drawer.

These rules are centralized in `contextDrawerReducer`; domain screens should report successful
deletions rather than recreating lifecycle behavior locally.

Use `null` when the active screen or collection does not expose contextual settings. The outlet
keeps its close button and displays the shared “No settings here” state. Domain components should
not implement their own resize handles, open state, or navigation-specific drawer branching in the
application shell.
