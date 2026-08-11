# OnMove repository guidance

## Product shell

- The macOS application uses a persistent sidebar and a selection-driven main view.
- Keep one macOS-style toolbar across the full window, with the sidebar and main workspace beneath
  it. Do not add view-level breadcrumb bars above the main canvas.
- Put primary item destinations at the top of the sidebar. `Todos` is selectable and is the default
  aggregate workspace; `Tags` and `Review` are its peer destinations immediately below it;
  `Focuses` is a section label with focus records and the `New focus` action exposed directly
  beneath it.
- Focus records with `active` or `paused` status appear in the selector. Paused focuses remain
  selectable but visually muted; `cancelled` and `done` focuses remain in SQLite but are filtered
  from navigation.
- Put workspace utilities such as Settings, help, and data/storage actions at the bottom of the
  sidebar.
- Keep Settings selectable in the primary sidebar. Its backup pane exposes the fixed automatic
  policy, last/next backup dates, retained snapshots, `Back up now`, and `Show backups`; it must use
  only the typed backup preload contract and must not expose arbitrary filesystem paths or SQL.
- Build sidebar primitives and other interface elements using the local shadcn/ui conventions in
  `src/renderer/src/components/ui`. Extend those primitives instead of adding one-off navigation
  markup.
- Every selected destination must update the main view, use `aria-current="page"`, and retain a
  visible keyboard focus state.
- Use the shared 24px semantic `Sunflower` for active Focus and Thread sidebar destinations instead
  of generic circle icons. The center seed represents the newest direct Update; subsequent seeds
  represent every active Commitment (including Thread-parented Commitments in a Focus rollup).
  Map green to Greenery, red to Tigerlily, yellow to Illuminating, and missing/`none` state to gray,
  with Cerulean as the boundary. Keep the textual summary available as SVG/hover text; never rely on
  seed color alone.
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
- Treat top-level nested Commitment rows as generic dnd-kit draggable children and Overall/Thread
  rows as stationary Commitment drop targets through the contextual sidebar's receiver-owned
  child-move contract. Top-level Thread rows are also draggable to Focus rows in the primary
  sidebar; Overall is never draggable, and Threads remain alphabetically ordered rather than being
  reorderable within a Focus. One shared domain-free sidebar DnD provider must span both sidebar
  slots. Feature adapters provide only opaque move intent and compatibility; the shared receivers
  own sensors, drag previews, drop targeting, and accessibility.
- Route programmatic hierarchy destinations through `ContextualSidebarNavigation.navigateToPath`.
  The navigation owner must resolve asserted ancestor selections and the optional leaf selection
  atomically; feature screens must not manually sequence parent selection, level entry, and leaf
  selection for creation results or deep links.
- Expose the shell-owned command palette through `Cmd-K` and the toolbar search action. Build its
  interaction from the domain-free shadcn-style `Command` primitives and keep preload loading in a
  dedicated feature model hook. Search navigable Focuses, their Threads and Commitments, every
  persisted Todo, and current Tags; apply the same hierarchy-cascading sensitive visibility used by
  ordinary collections. Result selection must emit a typed destination and reuse atomic Focus or
  Tag deep-link navigation rather than coordinating sidebar state in the palette.
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
- Scope definition belongs to Focus and Thread only. Never expose a Commitment Scope editor or
  Commitment Scope mutation IPC. Every Thread-owned Commitment derives the Thread's current
  effective Scope, including Commitments created before that Thread becomes bounded; Focus-owned
  Commitments remain unscoped. Commitment working-context tabs and exact-cell Update creation are
  projections of that Thread boundary, not a separate Commitment choice.

## Color system

These product colors are fixed:

- Pantone Cerulean — `#9BB7D4`: primary actions, selection, focus, and active navigation.
- Pantone Tigerlily — `#E2583E`: alerts, destructive states, and failures.
- Pantone Illuminating — `#F5DF4D`: yellow health, caution, and warning states.
- Pantone Greenery — `#88B04B`: healthy, complete, connected, and other positive states.

Use the semantic CSS variables (`primary`, `destructive`, `warning`, and `success`) rather than
repeating hex values in components. Cerulean is the active-sidebar highlight. Maintain readable
foreground colors and do not rely on color alone to communicate selection or status.

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
  other compact values as native controls. Rich text is limited to bold, italic, underline,
  strikethrough, yellow highlight, a conventional readable text-color palette, bulleted, numbered,
  and check lists, and safe external links; do not add images or other embedded media. Strikethrough
  uses `Command-Shift-X` and highlight uses `Command-Y`, with both shortcuts exposed on their
  toolbar controls. Color changes must restore the complete pre-toolbar selection and replace the
  color across mixed-style text without removing its other formats. Link creation accepts only
  `http`, `https`, and `mailto` destinations, and link clicks must leave Electron through the
  main-process external-link policy. Within any list, Tab nests the selected item and Shift+Tab
  outdents it; outside lists, preserve normal keyboard focus navigation.
- Persist rich text as the versioned `onmove-rich-text:1:` Lexical JSON envelope in the existing
  text fields. Continue accepting legacy plain text and render it through the same component; do
  not require a destructive content migration.
- Recognize durable inline text tags only through the shared parser: `@` followed by one or more
  Unicode alphanumeric characters, outside email-like words. Reject hyphenated and underscored
  continuations instead of styling a misleading prefix. Rich text stores recognized tokens as
  Lexical `tag` nodes; compact user-authored strings keep the literal token and use `TaggedInput` /
  `TaggedText` for the same deep-blue visual treatment. Dates, numbers, URLs, Scope Subject names,
  and other structured identifiers remain ordinary controls. Canonicalize tag identity to Unicode
  lowercase, so `@Launch` and `@launch` resolve to one `@launch` identity without rewriting stored
  user text. Tags have no persisted database registry; derive the
  global summaries and backreferences from current stored text through the named tag-query IPC.
  Keep containing-screen links in the Tags feature and do not infer tag semantics in UI receivers.
- Persist every change from an existing rich-text editor synchronously through the typed
  `richText` preload contract. The main process commits it with `DatabaseSync` before the renderer
  call returns, increments its durable revision, and broadcasts the committed snapshot to every
  window. Use the shared 750 ms throttled-autosave hook for compact metadata fields; creation
  dialogs remain explicit because no persistent record exists before Create succeeds.
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
  date, state, and sensitivity autosave through the shared throttle; observation text uses the
  synchronous rich-text document path. Do not render a manual save action.
  Blank and state-only Updates are valid. State must always have a text label as well as semantic
  color (`destructive` for red, `warning` for yellow, `success` for green, muted for none). `Cmd-P`
  immediately adds an Update wherever direct creation is valid and focuses its observation editor.
  In a bounded All Subjects view it focuses the required Subject creation picker, then focuses the
  created editor after selection; on Review it starts an Update for the current exact target and
  focuses its editor. Todos, Tags, and other screens without Updates leave `Cmd-P` untouched.
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
  exposes Current (separate Active and Paused sections) and retains Done / Cancelled in a
  closed-by-default accordion. Contextual sidebars project only Active and Paused Commitments;
  never render closed Commitment rows or a Done / Cancelled sidebar group.
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
- Render Focus, Thread, and Commitment Todos through the shared receiver-owned `TodoList`. The
  receiver owns inline creation, editable name/due date/done controls, overdue presentation, delete,
  and dnd-kit sortable ordering. Overdue means incomplete with a due date before the current local
  date; always show the `Overdue` text in destructive color instead of relying on color alone.
- Present each Todo collection as one rounded, bordered container with compact divided rows. Do not
  wrap every ordinary Todo in its own rounded card or pill; row-level backgrounds are reserved for
  overdue, dragging, and other semantic interaction states.
- Todo dragging begins only from the row grip and supports pointer and keyboard sensors. Use a
  complete-row `DragOverlay` and reflow the list around a visible insertion placeholder during
  sorting; never make the editable row or its form controls draggable.
- A Thread or Commitment Subject tab lists and creates individual Todos in its exact Scope/Subject
  cell. Its All Subjects view uses the aggregate ordering context and, whenever at least one Subject
  exists, offers `All subjects` followed by every current Subject as creation targets. `All subjects`
  creates one shared aggregate Todo with a durable completion cell and exact sort placement for
  every current Subject; an individual target creates the existing exact-cell Todo. If no
  Subjects exist, allow direct unscoped fallback Todos. Keep the main aggregate list limited to
  current canonical Subjects and put retained work from removed Subjects—plus old unscoped work
  when Subjects are now present—in the receiver-owned `Orphaned Todos` accordion below it, closed by
  default. Render that accordion only in the aggregate All Subjects view, never in an exact Subject
  tab. Reapplying the same canonical Subject returns its historical Todos to the current aggregate
  list even when the effective Scope id changed. Reorder through named IPC in the active context;
  do not calculate or mutate sort positions in React.
- A shared Todo parent is editable, deletable, and draggable only from aggregate views, but is never
  directly checkable. Its receiver-owned disclosure contains non-draggable Subject completion rows.
  Exact Subject views may toggle only their own completion cell and cannot edit or delete the shared
  parent. The global Todos/review view returns the parent once and exposes the same completion
  disclosure. Derive parent `done`/`completedAt` from all current cells. Scope reconciliation adds a
  fresh unchecked cell for a newly effective Subject, removes cells and exact placements for removed
  Subjects, closes when no unchecked cells remain, and reopens when a new unchecked cell appears.
- Keep Focus Subject applicability in the shared feature-level chip editor on the Focus screen.
  Configure Thread applicability only through the Thread context drawer: a receiver-owned choice
  switches between `Inherit Focus scope` and `Custom scope`, and a conditional receiver-owned token
  list edits the custom Subject set. Do not add a third Open choice; an as-yet unbounded custom
  Thread is the nonscoped case. The Thread main screen owns only the operational Subject working
  context. Views consume presenter-owned models and never coordinate Subject, Scope, membership,
  or application writes themselves.
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
  to Todos. Pinned drawer adapters remain complete and continue to follow the pin-across-navigation
  contract because they are selected view models, not list membership.
- Prefer small view components and shared shadcn/ui primitives over a monolithic application shell.
- Build the Todos workspace from the named bounded overview IPC projection. Its table owns sorting
  controls for Todo, Project, unified Context, Due date, and Status and can complete/reopen records
  through the typed Todo mutation. Context is the linked hierarchy path: it includes Overall or
  Thread, optional Commitment, and optional canonical Subject. Route that link through the shared
  Focus-workspace destination contract so the Focus, top-level contextual sidebar selection,
  nested Commitment route, and working-context tab restore atomically. Hide completed rows by
  default; the view option may reveal only the recently completed records already returned by the
  model. Never fetch all historical closed Todos and filter them in React.
- Build the Tags workspace as a peer of Todos. It uses one parentless `ContextualSidebarLevel` whose
  rows are canonical lowercase tag names plus visible-use counts. Selecting a tag issues the bounded
  `listTagUses` query and renders at most one row per field for that tag with only Location, Field,
  and a short plain-text snippet from its first occurrence. The Location link must use
  `FocusWorkspaceDestination` so Overall/Thread,
  nested Commitment, and Subject context restore atomically. Sensitive visibility remains a
  renderer collection rule: hide sensitive-only sidebar tags and sensitive use rows, then let the
  contextual navigation reconcile an invalid selection to its first remaining item.
- Build Review as a full-width, single-item catch-up queue with no contextual sidebar. Review active
  Focuses and Threads whose `needsReview` flag is enabled, plus active Commitments. A never-reviewed
  Thread or Commitment gets an initial review; after that, Thread review frequency and Commitment
  Update cadence determine when it participates again. Focus review is daily when enabled. Any
  applicable direct Update or explicit Pass dated today suppresses that exact target for today,
  even when an unmet Commitment cadence remains due; such a passed due Commitment may return the
  next day. Render direct evidence and child Commitments as non-navigating reference rows; a Focus
  or Thread must never drill into a Commitment from Review. `Ignore` dismisses only the current
  in-memory queue entry, `Pass along` calls the aggregate's typed `pokeReview` operation, refreshes
  the application-owned Focus projection, and advances the session. `Update` immediately creates a
  blank direct Update before exposing its autosaved editor. The editor's finish action advances the
  session and refreshes the owning Focus projection; it is not a Save button. A same-day queue
  refresh must retain passed and updated item keys while offering ignored items again; do not
  present a completed item as fresh work through a replay-style `Review again` action.
- Render the current Review target's direct Todos through the shared `DirectTodos`/`TodoList`
  contracts, using the exact Scope/Subject cell for a scoped queue entry. Every successful
  Review-originated Todo mutation records the same typed aggregate or exact-cell review poke and
  refreshes the owning Focus projection, but it must keep the current queue item onscreen so the
  user can make multiple changes before advancing. This acknowledgement updates review timing;
  Todo contents remain separate from Update-derived state and cadence evidence.
- Preserve scoped review obligations as separate queue entries. A bounded Thread or Commitment
  contributes one eligible entry per effective Subject cell, and Review-created Updates must use
  that exact Scope/Subject cell. Pass persists a typed exact-cell poke so acknowledging one Subject
  survives refresh without clearing a sibling Subject. Exact Thread-cell pokes advance that cell's
  review schedule; exact Commitment-cell pokes acknowledge review without changing Update-only
  state or cadence. Apply the same hierarchy-cascading sensitive visibility rule used by other
  renderer collections.

## Data model

- Add schema changes as new numbered migrations; never edit a migration already released to users.
- Persist Todo closure time independently as `completed_at`: the first open-to-done transition sets
  it, edits to an already-done Todo preserve it, reopening clears it, and closing again records a new
  instant. The global overview returns every open Todo plus only completed Todos from the last seven
  days, with the cutoff enforced in SQLite before snapshots cross IPC.
- Preserve hierarchy cascades, relation `SET NULL` behavior, and automatic status-transition
  auditing.
- Keep tag identity derived from literal current text instead of adding a second persisted source of
  truth. Index Focus title/description/goal, Thread and Commitment titles, Update observation, Todo
  name, and Note title/content. Canonicalize names to lowercase and deduplicate repeated names within
  one field. Project rich-text envelopes to plain text before parsing or producing snippets.
  Imports, edits, moves, and cascade deletions must therefore become visible to
  tag queries without repair or migration. Return summaries and selected-tag field uses only
  through named IPC; do not expose arbitrary search or SQL.
- Treat Thread health, materialized review dates, Commitment state, and cadence deadlines as model
  projections. Do not add writable columns or UI mutations for those derived values. The nullable
  aggregate `review_poked_on` fields and exact-cell review-poke tables are deliberate exceptions:
  mutate them only through typed `pokeReview` operations, never as caller-supplied projections.
- Return Review through one named, bounded overview projection. The model owns active-ancestor and
  inclusion filtering, due metadata, hierarchy context, exact Scope/Subject cells, direct Updates,
  and direct child Commitments; the renderer must not rebuild review eligibility by fetching every
  aggregate.
- Order Commitment Updates by their recorded date without capping them at today. A future-dated
  Update immediately supplies the Commitment's state and cadence baseline.
- Derive every aggregate `lastReviewDate` as the later of its persisted explicit review poke and its
  applicable direct Update evidence. For Focus, applicable evidence is the newest effective direct
  Update. For an Open or zero-Subject Thread, it is the newest effective direct unscoped Update, and
  the later poke also advances the aggregate review deadline. For a bounded Thread with Subjects,
  expose one independent review cell per effective Subject: aggregate `reviewDue` with any due cell,
  `nextReviewDate` with the earliest cell deadline, and Update-derived coverage as the oldest latest
  review date across all current cells (or null while any current Subject is unreviewed). A global
  Thread poke may advance the aggregate `lastReviewDate`, but must not fabricate cell evidence or
  satisfy cell deadlines. An exact Thread-cell poke is separate durable review evidence for only
  that cell. Commitment `lastReviewDate` uses its later applicable aggregate/cell poke or Update,
  while state, `lastUpdateDate`, and cadence remain Update-only projections. Keep persisted
  `needsReview` separate from lifecycle status and from all derived review projections.
- A Commitment must have exactly one Focus or Thread parent. An Update must have exactly one Focus,
  Thread, or Commitment parent. Preserve these SQLite constraints and cascades.
- Treat Subject, Scope, and Scope application as distinct model concepts. Subjects are canonical and
  generic; Scopes are Focus-owned applicability expressions; editable applications belong to Focus
  and Thread. Persist Commitment application rows only as enforced derived projections:
  Thread-owned Commitments are always `inherited`, and Focus-owned Commitments are always `open`.
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
- Never accept a Scope declaration when creating or mutating a Commitment. Changing a Thread Scope
  must immediately change the effective working context of all its Commitments regardless of
  whether those Commitments were created before or after the Thread Scope.
- Reparent Commitments only through the transactional plan/move repository contract and only within
  one Focus. Updates, Todos, and Notes retain their Commitment ids and exact historical Scope cells;
  the move never copies or deletes child rows. Compare canonical Subjects in the source and
  destination contexts independently of evidence count. Exact/superset destinations need no
  confirmation; missing Subjects require an explicit, stale-plan-safe confirmation before widening
  the destination Focus Scope or an isolated Thread overlay. Record every actual parent change in
  immutable `commitment_parent_transitions` history and keep the derived Commitment Scope
  application synchronized (`inherited` under a Thread, `open` under Overall).
- Move Threads between Focuses only through the transactional plan/move repository contract. Keep
  the Thread id and all descendant Commitment, Update, Todo, Note, and sort-placement identities.
  An Open/inherited Thread follows the destination Focus; canonical Subjects absent there require
  an exact stale-plan-safe confirmation and atomic Focus widening. Copy a custom Thread Scope graph
  into the destination without widening its Focus. Recursively copy and remap every retained exact
  child-evidence Scope into the destination because Scopes are Focus-owned; never relabel historical
  cells as a different Scope merely because its Subjects match. Authorize those otherwise-immutable
  Scope-id remaps only inside the move transaction, and append immutable
  `thread_parent_transitions` for every actual parent change.
- Model Todos separately from Commitments. A Todo has a required name, immutable Focus/Thread/
  Commitment or exact Thread/Commitment Scope-cell parent, optional due date, boolean done state,
  and contextual sort placements. Individual scoped Todos receive placements in their exact cell
  and entity rollup. A shared aggregate Thread/Commitment Todo receives one durable current-Subject
  completion cell plus an exact placement per cell; parent completion is derived and cannot be
  directly mutated. Reordering a filtered subset may only permute that subset's occupied slots;
  never use one scalar sort column that lets one view corrupt another view's order.
- Reject direct unscoped Thread and Commitment Todo creation whenever the owner's current effective
  Scope has at least one Subject. Require an exact current Scope/Subject cell in that state. When no
  Subjects are effective, permit the unscoped fallback without rewriting retained scoped history.
- Expose Todo persistence only through named list/query/create/update/Subject-completion/reorder/
  delete IPC. The global
  query returns each Todo once for future cross-context screens; contextual list order remains in
  each snapshot's sort placements and must not be replaced with an invented global ordering.
- Model Notes as ordered children of exactly one Focus, Thread, or Commitment. Current inserts create
  one hardcoded `Default` Note through database triggers, but the schema and snapshots must tolerate
  zero or multiple Notes for future document organization. Parent deletion cascades Notes.
- Treat Focus goal, Focus description, Update observation, and Note content as addressable rich-text
  documents. Save each changed value before returning to its editor, append a numbered full-value
  revision, and broadcast the committed revision across renderer windows. Dedicated document
  windows use the same sandboxed preload contract and SQLite path; they must not own a second cache
  or delayed persistence queue.
- Keep native File-menu import/export in the main process. Export a versioned, named-field JSON
  archive rather than renderer view models or an opaque SQLite copy. Import must intersect known
  fields, default missing older fields, ignore unknown future fields/tables, and prune unsafe rows.
  Replace data only inside one transaction with triggers restored and foreign-key/integrity checks
  passing; a fatal import must leave the existing database unchanged and a successful import must
  relaunch all windows onto the new snapshot.
- Keep rolling backups in the main process under the `Backups` directory beside the live database.
  Use SQLite `VACUUM INTO` to produce a live, consistent pending snapshot, run `PRAGMA quick_check`
  against both source and destination, apply private file permissions, then atomically rename it.
  Only after a verified snapshot is complete may retention remove older recognized backups. Create
  at most one automatic snapshot per 24 hours, check hourly while open, retain the newest ten, and
  take an unconditional safety snapshot immediately before confirmed import replacement. Ignore
  unknown files and remove only interrupted OnMove pending files and recognized expired snapshots.
- Store `sensitive` as a strict non-null boolean flag that defaults to false on every Focus, Thread,
  Commitment, and Update. Visibility is a presentation preference, not a database filter or a
  lifecycle state.
- Return UI-ready snapshots through named IPC methods. Do not expose generic SQL or arbitrary model
  dispatch to the renderer.

## Required verification

Run `pnpm check` for every change. Run `pnpm test:e2e` for navigation, preload, persistence, window,
or packaging-boundary changes. Rebuild the `.app` with `pnpm dist:mac` before handing off a new
desktop version.

The canonical application icon is the tracked vector source at `build/icon.svg`. Keep electron-builder's
`directories.buildResources` pointed at `build` and its macOS icon pointed at that SVG so a clean clone
can generate the complete `.icns` set without relying on ignored local PNG or ICNS artifacts.
