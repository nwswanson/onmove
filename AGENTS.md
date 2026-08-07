# OnMove repository guidance

## Product shell

- The macOS application uses a persistent sidebar and a selection-driven main view.
- Keep one macOS-style toolbar across the full window, with the sidebar and main workspace beneath
  it. Do not add view-level breadcrumb bars above the main canvas.
- Put primary item destinations at the top of the sidebar. `Home` is selectable; `Focuses` is a
  section label with focus records and the `New focus` action exposed directly beneath it.
- Focus records with `active` or `paused` status appear in the selector. Paused focuses remain
  selectable but visually muted; `cancelled` and `done` focuses remain in SQLite but are filtered
  from navigation.
- Put workspace utilities such as Settings, help, and data/storage actions at the bottom of the
  sidebar.
- Build sidebar primitives and other interface elements using the local shadcn/ui conventions in
  `src/renderer/src/components/ui`. Extend those primitives instead of adding one-off navigation
  markup.
- Every selected destination must update the main view, use `aria-current="page"`, and retain a
  visible keyboard focus state.
- Preserve the native macOS inset title bar and draggable regions. Interactive controls must remain
  outside draggable hit targets.
- The sidebar is resizable. Contextual editing belongs in the resizable right-side drawer, which
  participates in layout and shrinks the main canvas instead of overlaying it.
- Use “contextual sidebar” for the secondary left-side hierarchy pane and “context drawer” for the
  right-side inspector. Build progressive hierarchy navigation with the shared
  `ContextualSidebarLevel`, `ContextualSidebarNavigation`, and `ContextualSidebar` primitives.
  Every non-root contextual level must assert its parent level and parent item; the shared sidebar
  owns Back navigation and restores the selection previously held by each parent level.
- Declare ordinary level-local creation through a contextual level's optional `newItem` action;
  do not hard-code New Thread or New Commitment footer markup in domain adapters.
- Describe contextual inspectors with the shared `ContextDrawerModel` contract and render them only
  through `ContextDrawerOutlet`. The receiver guarantees a visible close button and requires a
  descriptive accessible label; feature code must not compose the low-level drawer shell directly.
- Drive the right drawer through a screen-owned, data-only `ContextDrawerAdapter` and the shared persistent
  `ContextDrawerOutlet`. The application shell must not switch on domain entity types. Navigating
  must replace the active adapter without closing the drawer or resetting its width; use the shared
  empty state when a screen has no contextual settings.
- Use the drawer controller's generic adapter pin to inspect an item without changing the main view
  or contextual-sidebar selection. Reuse the selected item's normal adapter. Pins take precedence
  across navigation and drawer visibility changes until the shared follow-current-selection action
  explicitly clears them.
- Give each drawer adapter invalidation keys for itself and its owning ancestors. Report successful
  deletions through the shared drawer controller: invalidated pins clear without closing the drawer,
  while unrelated or failed deletions preserve drawer and selection state.

## Color system

These product colors are fixed:

- Pantone Cerulean — `#9BB7D4`: primary actions, selection, focus, and active navigation.
- Pantone Tigerlily — `#E2583E`: alerts, warnings, destructive states, and failures.
- Pantone Greenery — `#88B04B`: healthy, complete, connected, and other positive states.

Use the semantic CSS variables (`primary`, `destructive`, and `success`) rather than repeating hex
values in components. Cerulean is the active-sidebar highlight. Maintain readable foreground colors
and do not rely on color alone to communicate selection or status.

## Renderer architecture

- Keep the renderer sandboxed. Access application data only through the typed `window.onmove` preload
  API.
- Keep `src/renderer/src/components/ui` domain-free: it must not import feature modules, shared
  domain contracts, main/preload modules, or access `window.onmove`.
- Compose the window with `ApplicationShell` and each active screen with `WorkspaceShell`. Supply
  toolbar, primary sidebar, contextual sidebar, main view, and drawer as independent slots rather
  than rebuilding the frame in feature components.
- Put preload calls, persistence-backed state, and domain mutation rules in feature model hooks.
  Model hooks must not import UI components; feature views translate their results into generic
  sidebar levels, main content, and drawer adapters.
- Use receiver-owned contracts when domain data enters reusable UI. Primary navigation accepts
  `SidebarNavigationItemModel`, contextual navigation accepts `ContextualSidebarItemModel`, and the
  drawer accepts `ContextDrawerModel`; callers must not provide row/drawer JSX, arbitrary classes,
  render callbacks, or domain records to those receivers.
- Keep domain-to-UI translation in plain feature presenter `.ts` modules. Presenters may import
  domain types and UI contract types but must not render React. Domain snapshots and model hooks
  must not expose UI fields, icons, styling, or render methods.
- Keep view identifiers and navigation definitions typed. Add tests whenever a destination or
  sidebar action is introduced.
- Prefer small view components and shared shadcn/ui primitives over a monolithic application shell.

## Data model

- Add schema changes as new numbered migrations; never edit a migration already released to users.
- Preserve hierarchy cascades, relation `SET NULL` behavior, and automatic status-transition
  auditing.
- Treat Thread health, review dates, Commitment state, and cadence deadlines as model projections.
  Do not add writable columns or UI mutations for those derived values.
- A Commitment must have exactly one Focus or Thread parent. An Update must have exactly one Focus,
  Thread, or Commitment parent. Preserve these SQLite constraints and cascades.
- Return UI-ready snapshots through named IPC methods. Do not expose generic SQL or arbitrary model
  dispatch to the renderer.

## Required verification

Run `pnpm check` for every change. Run `pnpm test:e2e` for navigation, preload, persistence, window,
or packaging-boundary changes. Rebuild the `.app` with `pnpm dist:mac` before handing off a new
desktop version.
