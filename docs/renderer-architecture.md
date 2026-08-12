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
- `SidebarDndProvider` supplies one domain-free drag session across the primary and contextual
  sidebar slots. Receivers publish opaque source/target types and ids; feature views decide
  compatibility and translate a completed drop into a typed model operation. It handles nested
  Commitment moves and cross-slot Thread-to-Focus moves without importing either domain.
- `ContextDrawerOutlet` owns fields, actions, draft/validation state, generic visibility, sizing,
  pin priority, and empty behavior. A feature supplies a data-only `ContextDrawerAdapter`; the
  outlet never switches on entity types or renders feature-provided markup.
- The shadcn-style `Command` primitives own the command dialog, filtering, keyboard selection,
  focus, and result-list markup without importing OnMove records or navigation contracts.

The shell accepts React slots rather than application records, so Todos and future screens may omit
the contextual sidebar or drawer without changing the framework.

## Feature model hooks

Persistence-backed state lives in feature hooks:

- `useApplicationModel` loads application state and Focuses, owns Focus selection/filtering, and
  performs Focus mutations and data-folder actions.
- `useFocusWorkspaceModel` loads Threads and Focus-level Commitments and owns Goal, Thread, and
  Commitment persistence.
- `useTodoOverviewModel` loads the bounded global Todo projection and owns both ordinary and
  per-Subject completion mutations; SQLite has already excluded older completed records before this
  hook receives a snapshot.
- `useTagsModel` loads the canonical-name summary and only the selected tag's bounded field-use list.
  It also invalidates those projections when another window commits rich text; tag parsing and
  hierarchy resolution remain in the main-process repository.
- `useDueModel` loads one named main-process deadline projection and routes date/status mutations
  through typed Focus, Thread, and Commitment methods before rematerializing the aggregate. The Due
  table receives urgency-grouped row contracts and never traverses the hierarchy or calls IPC itself.
- `useCommandPaletteModel` loads a fresh searchable graph only while the palette is open. It uses
  named preload operations to collect navigable Focus hierarchy records, all persisted Todos, and
  canonical Tags; it does not teach the shared command receiver how those records are stored.

The domain-free `TodoList` receiver owns the disclosure and interaction grammar for a shared Todo.
Feature presenters provide only data: whether the parent may be edited/deleted/checked, its current
Subject completion rows, and (in an exact tab) the one completion Subject id. The receiver renders
plain progress children outside the sortable collection and emits ids through the typed mutation;
it never receives Scope records or decides aggregate completion.

Cross-feature navigation uses the data-only `FocusWorkspaceDestination` contract. The global Todo
and Tags views translate a clicked row into ids, while the Focus workspace atomically restores its own
contextual-sidebar route and working-context tab. Reusable table and sidebar receivers never see
domain records or orchestrate each other.

The application command presenter translates its on-demand snapshot into data-only grouped result
models. `Cmd-K` or the toolbar search action opens the shell-owned palette. Selecting a Focus,
Thread, Commitment, or Todo emits the same `FocusWorkspaceDestination`; selecting a Tag emits a
request-id Tag destination so its contextual sidebar applies that selection after async tag loading.
The palette never mutates sidebar controllers directly. Todo search intentionally uses the complete
Todo query rather than the bounded global-overview projection, so an older completed Todo can still
lead back to its containing screen.

Update-capable receivers register `Cmd-P` only while their creation action is present. Focus,
Thread, and Commitment screens therefore share one direct/Subject-choice behavior through
`UpdateList`; its creation callback returns an opaque row id so the receiver can focus the persisted
observation editor. Review registers the same domain-free shortcut and editor focus for its current
queue target. Todos, Tags, Settings, and empty Review states leave the key event untouched.

Cross-Focus Thread movement follows the same separation. The contextual receiver emits only a
generic Thread item move toward a generic Focus target. `useFocusWorkspaceModel` owns plan/move IPC,
while the Focus workspace owns any confirmation presentation. After success, the application model
refreshes both Focus summaries and deep-links through the existing destination path so the primary
Focus, contextual Thread selection, and main view change atomically. A pinned drawer is rebound to
the same moved record id and retains pin precedence.

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
