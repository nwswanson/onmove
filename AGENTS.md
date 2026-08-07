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
- Build contextual inspectors with the shared `ContextDrawer` primitives. Every drawer must have a
  visible close button, a descriptive accessible label, and view-specific content composed inside
  the common shell.

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
