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
- Use the shared 24px semantic `Sunflower` for active Focus and Thread sidebar destinations instead
  of generic circle icons. The center seed represents the newest direct Update; subsequent seeds
  represent every active Commitment (including Thread-parented Commitments in a Focus rollup).
  Map green to Greenery, red/yellow to Tigerlily, and missing/`none` state to gray, with Cerulean as
  the boundary. Keep the textual summary available as SVG/hover text; never rely on seed color alone.
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
- Give each Focus and Thread its own parent-asserting Commitment level. Opening Commitments from the
  parent screen's collection heading replaces the contextual sidebar, selects the first owned
  Commitment, and returns through the shared Back behavior; never mix Focus-owned Commitments into
  a Thread level.
- At the top level, render each Focus Overall or Thread item's direct Commitments as a nested tree.
  Nested Commitment rows use the receiver-owned semantic state dot, never a Sunflower. Selecting a
  nested Commitment changes the main route while preserving the top-level sidebar. Give every tree
  scope a generic child-collection action that presents `Add commitment`; it opens creation for that
  scope and never enters the filtered Commitment level. Do not render a Commitments drilldown in the
  contextual tree.
- Route programmatic hierarchy destinations through `ContextualSidebarNavigation.navigateToPath`.
  The navigation owner must resolve asserted ancestor selections and the optional leaf selection
  atomically; feature screens must not manually sequence parent selection, level entry, and leaf
  selection for creation results or deep links.
- Describe contextual inspectors with the shared `ContextDrawerModel` contract and render them only
  through `ContextDrawerOutlet`. The receiver guarantees a visible close button and requires a
  descriptive accessible label; feature code must not compose the low-level drawer shell directly.
- Render boolean inspector settings through the receiver-owned drawer `checkbox` field contract;
  feature presenters supply boolean values and translate submitted values into typed mutations.
- Drive the right drawer through a screen-owned, data-only `ContextDrawerAdapter` and the shared
  persistent `ContextDrawerOutlet`. The application shell must not switch on domain entity types. Navigating
  must replace the active adapter without closing the drawer or resetting its width; use the shared
  empty state when a screen has no contextual settings.
- Use the drawer controller's generic adapter pin to inspect an item without changing the main view
  or contextual-sidebar selection. Reuse the selected item's normal adapter. Pins take precedence
  across navigation and drawer visibility changes until the shared follow-current-selection action
  explicitly clears them.
- Give each drawer adapter invalidation keys for itself and its owning ancestors. Report successful
  deletions through the shared drawer controller: invalidated pins clear without closing the drawer,
  while unrelated or failed deletions preserve drawer and selection state.
- Expose confirmed destructive actions for Focus, Thread, and Commitment through the receiver-owned
  drawer action contract. Thread and Commitment titles autosave through the shared throttle. Thread
  review frequency uses the drawer's generic required positive-whole-number field (`min=1`,
  `step=1`) and the model repeats that validation. After deleting the active Thread or Commitment,
  navigate to its surviving parent; deleting a pinned item off-route must not disturb the active
  route.
- Expose Thread-owned Commitment applicability through the same receiver-owned drawer choice and
  token-list contracts used for Thread scope. Use named Commitment Scope model/IPC operations;
  switching between Open/custom applicability and inheritance must refresh the selected
  Commitment's working-context cells immediately so bounded Update creation requires an exact
  Subject. Keep Focus-owned Commitment presentation unchanged unless its own workflow calls for a
  scope editor. A Thread-owned Commitment snapshot must expose direct-parent Subjects separately
  from owning-Focus Subject candidates: an Open Thread has nothing to inherit, but its Commitment
  must still be able to create a custom boundary from the Focus's current Subjects.

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
  toolbar, primary sidebar, contextual sidebar, workspace tab bar, main view, and drawer as
  independent slots rather than rebuilding the frame in feature components. Context tabs belong
  above the main canvas only; the contextual sidebar and context drawer retain their full height.
- Project scope/lens switching through the receiver-owned `WorkspaceTabBar` contract. Feature
  presenters supply data-only tab labels, state, review metadata, and stable ids; the shared
  receiver owns compact shadcn-style tab semantics, keyboard navigation, and visual selection. Do
  not spend horizontal space on a visible bar title or add explanatory metadata to All Subjects.
  Hide the bar when there are no Subject tabs. Keep one selected canonical Subject per Focus while
  navigating between its Threads and Commitments; remember each Focus independently while the app
  is open, and normalize that Focus to All Subjects when the next destination lacks the selection.
- Put preload calls, persistence-backed state, and domain mutation rules in feature model hooks.
  Model hooks must not import UI components; feature views translate their results into generic
  sidebar levels, main content, and drawer adapters.
- Use receiver-owned contracts when domain data enters reusable UI. Primary navigation accepts
  `SidebarNavigationItemModel`, contextual navigation accepts `ContextualSidebarItemModel`, and the
  drawer accepts `ContextDrawerModel`; callers must not provide row/drawer JSX, arbitrary classes,
  render callbacks, or domain records to those receivers.
- Use the shared Lexical-backed `RichTextEditor` for every multiline user-authored field, currently
  Focus description/notes, Focus goal, and Update observation. Keep titles, dates, statuses, and
  other compact values as native controls. Rich text is limited to text formatting, lists, and
  color; do not add images or other embedded media. Within bulleted or numbered lists, Tab nests
  the selected item and Shift+Tab outdents it; outside lists, preserve normal keyboard focus
  navigation.
- Persist rich text as the versioned `onmove-rich-text:1:` Lexical JSON envelope in the existing
  text fields. Continue accepting legacy plain text and render it through the same component; do
  not require a destructive content migration.
- Route edits to existing text records through the shared throttled-autosave hook. Coalesce the
  latest draft into at most one save per 750 ms, flush it on blur, and serialize overlapping writes;
  creation dialogs remain explicit because no persistent record exists before Create succeeds.
- Keep domain-to-UI translation in plain feature presenter `.ts` modules. Presenters may import
  domain types and UI contract types but must not render React. Domain snapshots and model hooks
  must not expose UI fields, icons, styling, or render methods.
- Render direct Focus, Thread, and Commitment Updates through the receiver-owned `UpdateList`
  contract. Focus Updates belong in Overall, Thread Updates in the selected Thread, and Commitment
  Updates in the selected Commitment view; none of these lists includes descendant Updates. Give
  every Update its own responsive card: observation
  uses the full card width while date, state, and actions occupy a wrapping metadata header. Do not
  reintroduce tabular columns. Updates must expose editable date, optional multi-line observation,
  and state plus add/delete actions. `Add update` must immediately persist a blank Update using the
  current local date and `none` state; do not introduce a second Create/Cancel draft step. All
  persisted Update fields autosave through the shared throttle; do not render a manual save action.
  Blank and state-only Updates are valid. State must always have a text label as well as semantic color
  (`destructive` for red/warning, `success` for green, muted for none).
- Treat a bounded Thread's Subject selector as an operational working-context lens, distinct from
  editing the Thread's Scope definition. All Subjects keeps its main Update list limited to
  currently applicable canonical Subjects. Put retained Updates whose Subject is no longer
  applicable—and retained unscoped evidence from a former Open application—in the receiver-owned
  `Former scope updates` accordion at the bottom, closed by default. Exact Subject and unscoped
  panes never render that accordion. While current Subject cells exist, the receiver-owned
  creation dropdown lets All Subjects immediately create a blank Update for one chosen Subject and
  keeps the resulting card editable in place. Selecting one Subject filters to its exact current
  Scope/Subject cell and retains the ordinary Add Update action. The model hook, not `UpdateList`,
  injects the exact cell during either creation path. In All Subjects, classify an Update as
  `Former scope` only when its canonical Subject is not currently applicable; never compare raw
  Scope ids for this label because every customization creates a replacement overlay. Re-applying
  the Subject moves its evidence back into the main list and restores its current label without
  rewriting the Update's immutable original cell.
  In a Subject lens, project only bounded child Commitments whose
  effective Scope includes the canonical Subject and show their cell-specific state and dates;
  keep Open Commitments in the aggregate overview. If a Thread has zero effective Subjects, present
  direct unscoped Updates without rendering the otherwise redundant one-item context bar.
- Give a selected Commitment the same operational Working Context tab contract. Open Commitments
  expose one Commitment-wide context and create unscoped Updates. Bounded Commitments expose All
  Subjects plus one tab per current exact Scope/Subject cell: All Subjects uses the choice-based
  creation control, while a Subject tab uses ordinary immediate creation with that exact cell.
  A bounded Commitment with zero effective Subjects has no valid current cell, so retain history
  but do not expose Update creation. Never fall back to an unscoped write for a bounded Commitment.
- Show every Commitment row's derived state using the shared receiver-owned state-label contract.
  The label must use `CommitmentSnapshot.state`, which already projects the Update with the highest
  recorded date (including a future date); do not sort or inspect Updates again in the renderer.
  Show the snapshot's `lastUpdateDate` with a visible `Never` fallback in Commitment screens,
  drawers, contextual rows, and main-view lists.
- Show Commitment lifecycle status as a receiver-owned, read-only label in lists. Render the shared
  feature-level `WorkStatusSelect` in Focus, Thread, and selected Commitment detail headers; it owns
  the common `active`, `paused`, `done`, and `cancelled` vocabulary while the low-level UI primitive
  owns select markup. Each screen must persist through its typed mutation so SQLite transition
  auditing remains intact.
- Build all Commitment collections through the pure feature view-model projection. Order Active
  Commitments by state (`red`, `yellow`, `green`, `none`), followed by Paused, followed by the
  combined Done / Cancelled group; preserve repository order within equal priorities. The main view
  exposes Current (separate Active and Paused sections) and Done / Cancelled lists, while the
  contextual sidebar uses the same ordered groups.
- Render Focus- and Thread-owned collections through the same `CommitmentCollection` receiver.
  Presenters must translate the business projection into its receiver-owned item contract; the
  receiver owns row markup and the visible `Add commitment` action, and emits only creation
  requests or Commitment ids for open, pin, and completion actions. Successful parent-page
  creation must select the new nested Commitment route without entering the filtered Commitment
  level; creation from an already-filtered level remains in that level.
- New Commitments expose `ongoing` and `action` types and default to `ongoing`; their optional due
  date must be visible in the selected Commitment screen. Render the one-way completion checkbox
  only on Action Commitment list rows. Checking an active or paused Action sends `status: done`
  through the existing typed mutation so transition auditing remains intact; closed Actions cannot
  be reopened through the checkbox, and Ongoing rows never expose it.
- Keep Focus Subject applicability in the shared feature-level chip editor on the Focus screen.
  Configure Thread applicability only through the Thread context drawer: a receiver-owned choice
  switches between `Inherit Focus scope` and `Custom scope`, and a conditional receiver-owned token
  list edits the custom Subject set. The Thread main screen owns only the operational Subject working
  context. Views consume presenter-owned models and never coordinate Subject, Scope, membership, or
  application writes themselves.
- Treat named preload IPC as request/response, not a live query subscription. After a Focus Subject
  mutation succeeds, invalidate and reload every Thread snapshot, effective Scope, Subject matrix,
  direct-Update summary, and owned Commitment collection for that Focus. Use one request generation
  so a slower initial load cannot overwrite the post-mutation projections. Inherited Threads must
  reflect the new Focus Subjects without navigation, reload, or app restart; custom/Open Threads
  still refresh their Focus-offered Subject suggestions.
- Keep view identifiers and navigation definitions typed. Add tests whenever a destination or
  sidebar action is introduced.
- Persist `sensitive` independently on Focus, Thread, Commitment, and Update records. The native
  View-menu checkbox defaults to showing content and broadcasts one application-wide visibility
  state to every renderer window. When hiding is enabled, filter sensitive records from collection
  boundaries instead of redacting their view models. Sensitivity cascades down the hierarchy, so a
  sensitive ancestor removes all descendants from lists regardless of each descendant's own flag.
  If the current route becomes hidden, resolve to the nearest visible parent; a hidden Focus resolves
  to Home. Pinned drawer adapters remain complete and continue to follow the pin-across-navigation
  contract because they are selected view models, not list membership.
- Prefer small view components and shared shadcn/ui primitives over a monolithic application shell.

## Data model

- Add schema changes as new numbered migrations; never edit a migration already released to users.
- Preserve hierarchy cascades, relation `SET NULL` behavior, and automatic status-transition
  auditing.
- Treat Thread health, review dates, Commitment state, and cadence deadlines as model projections.
  Do not add writable columns or UI mutations for those derived values.
- Order Commitment Updates by their recorded date without capping them at today. A future-dated
  Update immediately supplies the Commitment's state and cadence baseline.
- Derive Focus `lastReviewDate` from its newest effective direct Update. For an Open or zero-Subject
  Thread, use its newest effective direct unscoped Update. For a bounded Thread with Subjects, expose one independent review cell per
  effective Subject: aggregate `reviewDue` with any due cell, `nextReviewDate` with the earliest cell
  deadline, and `lastReviewDate` as the oldest latest-review date across all current cells (or null
  while any current Subject is unreviewed). Keep persisted `needsReview` separate from lifecycle
  status and from all derived review projections.
- A Commitment must have exactly one Focus or Thread parent. An Update must have exactly one Focus,
  Thread, or Commitment parent. Preserve these SQLite constraints and cascades.
- Treat Subject, Scope, and Scope application as distinct model concepts. Subjects are canonical and
  generic; Scopes are Focus-owned applicability expressions; applications state whether a Focus,
  Thread, or Commitment is Open, inherited, explicit, or derived.
- Route Focus and Thread applicability through their aggregate repositories and named IPC. Focus
  edits are inline on its main screen; Thread edits originate in its context drawer. A Thread
  customization must create and apply a new Focus-owned overlay Scope based on its current effective
  Scope; never mutate a Scope shared by the Focus or a sibling. `Inherit Focus scope` declares
  inheritance and retains obsolete overlays and exact-cell evidence for observability.
- Keep Scope membership effective-dated with half-open `[effectiveFrom, effectiveUntil)` intervals.
  Resolve effective membership as same-dimension base plus includes minus excludes, and never rewrite
  historical membership to describe a current population.
- Validate membership interval edits against the resulting full Scope expression and every retained
  exact-cell Update. Once a Scope has applicability or Update history, end membership instead of
  deleting it. Prevent same-effect interval overlap.
- Append immutable transitions for every actual declared Scope-application change, including writes
  below repositories; assigning the same declaration is a no-op. Inherited descendants retain their
  declared history and derive effective changes from their changing ancestor.
- Do not structurally rewrite a used Scope. Preserve its dimension, base, derived relationship, and
  context Subject; create and apply a new Scope so application history explains the change.
- Preserve the hard-delete boundary: deleting a Thread or Commitment cascades its evidence,
  lifecycle history, application, and application history, while shared Focus-owned Scopes,
  memberships, and Subjects survive. Use done/cancelled when history must remain.
- Keep context, Scope, and attention separate. Scope is the complete applicability set, not a tag or
  a filtered list of current exceptions; attention can be derived later without narrowing Scope.
- Require every bounded Thread or Commitment Update to store its exact effective Scope and Subject
  cell. Direct Focus Updates and Updates on Open parents remain unscoped. A Thread with zero
  effective Subjects is operationally Thread-wide and may store direct unscoped Updates; this
  exception does not apply to Commitments. Preserve cell attribution when applications or membership
  later change.
- Store `sensitive` as a strict non-null boolean flag that defaults to false on every Focus, Thread,
  Commitment, and Update. Visibility is a presentation preference, not a database filter or a
  lifecycle state.
- Return UI-ready snapshots through named IPC methods. Do not expose generic SQL or arbitrary model
  dispatch to the renderer.

## Required verification

Run `pnpm check` for every change. Run `pnpm test:e2e` for navigation, preload, persistence, window,
or packaging-boundary changes. Rebuild the `.app` with `pnpm dist:mac` before handing off a new
desktop version.
