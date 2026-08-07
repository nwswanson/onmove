# Renderer architecture

The renderer is split into four one-way layers. This keeps the reusable macOS-style frame
independent from OnMove's Focus, Thread, Commitment, and Update rules.

```text
feature model hooks  ->  feature presenters  ->  feature views  ->  shared UI receivers
IPC + business state     contract translation     orchestration      layout + interaction
```

## Shared UI framework

`src/renderer/src/components/ui` is domain-free. It must not import shared domain contracts,
feature modules, main-process code, preload code, or call `window.onmove`.

- `ApplicationShell` places the toolbar, primary sidebar, primary resize handle, and active
  workspace.
- `WorkspaceShell` independently composes the contextual sidebar, main view, and context drawer.
- `SidebarNavigation`, `ContextualSidebarLevel`, and `ContextualSidebarNavigation` own generic hierarchy traversal,
  selection restoration, Back behavior, invalidation, and optional New actions.
- `ContextDrawerOutlet` owns fields, actions, draft/validation state, generic visibility, sizing,
  pin priority, and empty behavior. A feature supplies a data-only `ContextDrawerAdapter`; the
  outlet never switches on entity types or renders feature-provided markup.

The shell accepts React slots rather than application records, so Home and future screens may omit
the contextual sidebar or drawer without changing the framework.

## Feature model hooks

Persistence-backed state lives in feature hooks:

- `useApplicationModel` loads application state and Focuses, owns Focus selection/filtering, and
  performs Focus mutations and data-folder actions.
- `useFocusWorkspaceModel` loads Threads and Focus-level Commitments and owns Goal, Thread, and
  Commitment persistence.

These hooks may use typed shared contracts and the sandboxed `window.onmove` preload API. They do
not import UI components or define layout.

## Feature presenters and views

Plain `.ts` presenter modules are the translation seam. They consume domain snapshots and produce
receiver-owned sidebar or drawer contracts without React markup. Feature views orchestrate
selection, choose the resulting models, and pass rendered regions into the shells. They can use
domain types because they are application presentation—not framework code—but datastore calls stay
in model hooks and domain records do not cross into shared model-driven receivers.

See `docs/ui-contract-ownership.md` for the complete caller/receiver ownership rules and the
Commitment example.

`tests/renderer/ui-architecture.test.ts` enforces the dependency boundary. Shell behavior is
covered independently in `tests/renderer/workspace-shell.test.tsx`; application integration tests
then verify the complete composition and persisted behavior.
