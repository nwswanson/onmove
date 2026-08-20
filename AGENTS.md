# OnMove repository guidance

## Product shell

- The macOS application uses a persistent sidebar and a selection-driven main view.
- Keep one macOS-style toolbar across the full window, with the sidebar and main workspace beneath
  it. Do not add view-level breadcrumb bars above the main canvas.
- Put primary item destinations at the top of the sidebar. `Todos` is selectable and is the default
  aggregate workspace; `Tags`, `Review`, and `Due` are its peer destinations immediately below it;
  `Focuses` is a section label with focus records and the `New focus` action exposed directly
  beneath it.
- Focus records with `active` or `paused` status appear in the selector. Paused focuses remain
  selectable but visually muted; `cancelled` and `done` focuses remain in SQLite but are filtered
  from navigation.
- Give every primary Focus row the receiver-owned context menu used by Focus Overall. Its review
  checkbox controls descendant review tracking for the whole Focus; keep the Overall entry as a
  second access point to the same setting.
- Put workspace utilities such as Settings, help, and data/storage actions at the bottom of the
  sidebar.
- Expose `Archive` as a top-level item destination. It renders only deleted Updates retained by the
  bounded archive projection, never editable Update controls. The receiver owns permanent per-row
  deletion and a confirmed Clear all action; sensitive archive rows follow the application-wide
  list visibility preference.
- Keep the primary sidebar free of summary-card placeholders. Put bounded, receiver-owned numeric
  badges on actionable destinations instead: Todos counts open items overdue or due today, Review
  counts remaining review targets, and Due counts open/paused dated work overdue or due within the
  next seven calendar days. Hide zero badges and recompute at local calendar-day rollover.
- Keep Settings selectable in the primary sidebar. Its backup pane exposes the fixed automatic
  policy, last/next backup dates, retained snapshots, `Back up now`, and `Show backups`; it must use
  only the typed backup preload contract and must not expose arbitrary filesystem paths or SQL.
- Build sidebar primitives and other interface elements using the local shadcn/ui conventions in
  `src/renderer/src/components/ui`. Extend those primitives instead of adding one-off navigation
  markup.
- Every selected destination must update the main view, use `aria-current="page"`, and retain a
  visible keyboard focus state.
- Show unobtrusive, receiver-owned sidebar indicators for Sensitive and Excluded from reviews on
  Focus, Thread, Commitment, and Routine destinations. Apply them to primary, contextual, and
  nested contextual rows as applicable; do not repeat the Focus indicators on its Overall row.
- Use the shared 24px semantic `Sunflower` for active Focus and Thread sidebar destinations instead
  of generic circle icons. The center seed represents the newest direct Update; subsequent seeds
  represent every active Commitment (including Thread-parented Commitments in a Focus rollup).
  Map green to Greenery, red to Tigerlily, yellow to Illuminating, and missing/`none` state to gray,
  with Cerulean as the boundary. Keep the textual summary available as SVG/hover text; never rely on
  seed color alone.
- Preserve the native macOS inset title bar and draggable regions. Interactive controls must remain
  outside draggable hit targets.
- Preserve native macOS text behavior in every BrowserWindow, including detached rich-text windows.
  Keep Electron spellchecking enabled and install the shared main-process text context menu for
  editable controls and selected read-only text. The menu owns spelling replacements, Learn Spelling,
  and standard native edit roles; renderer feature components must not implement private context menus.
- Persist one last-write-wins main-workspace window size in SQLite. Every normal main window may
  replace it after resizing, but existing windows must never subscribe to or apply later writes;
  read and display-clamp the preference only while constructing the next main window. Detached
  rich-text editor windows retain their independent defaults and do not overwrite this preference.
- The sidebar is resizable. Contextual editing belongs in the resizable right-side drawer, which
  participates in layout and shrinks the main canvas instead of overlaying it.
- Use “contextual sidebar” for the secondary left-side hierarchy pane and “context drawer” for the
  right-side inspector. Build progressive hierarchy navigation with the shared
  `ContextualSidebarLevel`, `ContextualSidebarNavigation`, and `ContextualSidebar` primitives.
  Every non-root contextual level must assert its parent level and parent item; the shared sidebar
  owns Back navigation and restores the selection previously held by each parent level.
- Declare ordinary level-local creation through a contextual level's optional `newItem` action;
  do not hard-code New Thread or New Commitment footer markup in domain adapters.
- Render adjacent bottom-of-sidebar controls through the shared receiver-owned footer-action
  contract in both primary and contextual sidebars. Callers supply data-only ids, labels, semantic
  icons, disabled state, and invocation handlers; the sidebar receiver owns the compact full-width
  vertical layout so creation and Archive remain separate, easy-to-target rows.
  Keep `newItem` as the contextual level's creation declaration and let the receiver merge it with
  optional peer actions such as Archive instead of composing feature-specific footer markup.
- Declare right-click actions on primary, contextual, and nested contextual-child sidebar item
  models through the shared `SidebarContextMenuModel`; never attach domain-specific menu JSX or
  per-item callbacks. The
  shadcn/Radix receiver owns pointer and keyboard opening, focus, dismissal, semantic icons,
  checkbox state, separators, and destructive styling. Sidebar owners receive only the target item
  id, declared action id, and optional checked value, then translate those into typed feature
  mutations.
- Give every active Thread row contextual actions for Add commitment, Add Routine, Needs review,
  Sensitive, and Delete Thread. Creation targets that exact Thread, checkbox actions use typed
  Thread updates, and deletion must open a confirmation before invoking the existing cascade-safe
  Thread deletion. Give the Focus Overall row only Needs review and Sensitive actions targeting the
  Focus itself; it owns no child work and is not a Thread. Give Commitment and Routine sidebar rows receiver-owned Needs review, Sensitive, and
  confirmed Delete actions; Routine Needs review translates to its stored attestation-inclusion
  preference while schedule availability remains a separate derived condition.
  Do not render Add commitment / Add Routine controls beneath nested child collections, and render
  no placeholder or empty collection chrome when a Thread has no visible children.
- Keep Done and Cancelled Threads in the Focus model and SQLite history, but omit them from the
  active top-level contextual hierarchy. Expose them through the Focus level's Archive footer
  action, subject the archive list to the normal sensitive-ancestor visibility boundary, and restore
  them by submitting an audited `active` status transition through the typed Thread mutation. If a
  selected Thread becomes closed, refresh navigation to the Focus Overall item; restoring a Thread
  makes it available again without selecting it or changing contextual depth.
- Treat Focus Overall as a read-oriented overview, never as a synthetic top-level Thread. Its main
  screen contains Focus status, due date, description, Focus Scope administration, and the Default
  note. It must not render or create a Goal, Commitment, Routine, Todo, or direct Focus Update.
  Render one read-only graphical timeline beneath that metadata: include every child Thread
  regardless of lifecycle status. A Thread owns one header/filter but its rail fans into one track
  per current or historically evidenced Subject, spaced 3–6px apart; Thread-wide evidence uses an
  explicit fallback track. Keep Subjects out of the top filter and expose each track's Subject name
  through its native SVG hover title and accessible label. Give the timeline the complete main-canvas
  width rather than the metadata column's
  maximum width. Bind SVG measurement to the mounted timeline element—not a one-shot screen mount—
  because Threads arrive asynchronously and Focus navigation can remove and recreate the canvas;
  keep it hidden until the live width is measured and never stretch SVG text with a mismatched
  fallback viewBox. Place every compact, truncated direct-Thread or descendant-Commitment Update bubble
  in the left evidence lane and draw an SVG connector to its dated rail point. Order latest at the
  top and oldest at the bottom; each rail interval still represents the state in effect between its
  chronological changes. Title direct bubbles with the Thread and nested bubbles with
  `Thread › Commitment`, accompanied by the shared Thread or Commitment work-kind icon. Exclude
  evidence belonging to done, cancelled, or deleted Commitments; deleted evidence remains available
  through Update Archive only. Keep the angled Thread-title rail header sticky while the timeline
  scrolls. Selecting a bubble opens the complete rich-text evidence in a read-only popup; Thread
  headers and popup actions link to the owning Thread. A closed Thread opens as a standalone route
  without restoring it or adding it to the active contextual sidebar; the timeline never exposes
  Update editing or deletion controls.
- Give each Thread its own parent-asserting Commitment level. Opening Commitments from the Thread
  screen's collection heading replaces the contextual sidebar, selects the first owned Commitment,
  and returns through the shared Back behavior.
- At the top level, render each Thread item's direct Commitments as a nested tree.
  Nested Commitment rows use the receiver-owned semantic state dot, never a Sunflower. Selecting a
  nested Commitment changes the main route while preserving the top-level sidebar.
  Render its direct Routine definitions after its direct Commitments with a checklist icon and
  derived status dot. Routine rows are draggable between sibling Threads through the
  same generic child-move boundary as Commitments. A Routine move changes ownership only: retain
  its Focus-owned optional Scope, schedule, template versions, current Run, immutable history,
  Subject cells, and item notes. Routine selections preserve the top-level contextual sidebar and
  open a main view of current and previous immutable check-ins, including
  Subject cells, completion timing, template versions, resolutions, and optional evidence notes.
  Use the same live checklist receiver in this history and the global Routines execution screen.
  Before finalization it owns resolution controls and autosaving rich-text notes; afterward it
  renders resolutions and notes as read-only content. Never expose a note pop-out action or the
  legacy Issue-found/follow-up controls.
  Put an explicit `Edit` button in that history view; only it opens the parent-owned definition
  modal. Creation opens for that exact scope and never enters a filtered level. Do not render a
  Commitments drilldown in the contextual tree.
- Treat top-level nested Commitment and Routine rows as generic dnd-kit draggable children and
  Thread rows as stationary ownership drop targets through the contextual sidebar's receiver-owned
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
  persisted Todo, and current Tags. Keep both an All Subjects destination and one destination per
  current Commitment Scope/Subject cell so search can deep-link directly into a Commitment lens;
  apply the same hierarchy-cascading sensitive visibility used by ordinary collections, including
  sensitive Subjects. Result selection must emit a typed destination and reuse atomic Focus or Tag
  deep-link navigation rather than coordinating sidebar state in the palette.
- Describe contextual inspectors with the shared `ContextDrawerModel` contract and render them only
  through `ContextDrawerOutlet`. The receiver guarantees a visible close button and requires a
  descriptive accessible label; feature code must not compose the low-level drawer shell directly.
- Render boolean inspector settings through the receiver-owned drawer `checkbox` field contract;
  feature presenters supply boolean values and translate submitted values into typed mutations.
- Drive the right drawer through a screen-owned, data-only `ContextDrawerAdapter` and the shared
  persistent `ContextDrawerOutlet`. The application shell must not switch on domain entity types. Navigating
  must replace the active adapter without closing the drawer or resetting its width; use the shared
  empty state when a screen has no contextual settings.
- Treat a drawer adapter `revision` as an in-place data reconciliation signal, never as a React
  remount key. Preserve focused controls and newer local autosave drafts while applying untouched
  incoming fields; only a change of adapter identity may replace the inspector form.
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
- Never access `window.localStorage` directly in renderer code or tests. Persist presentation-only
  browser preferences through a feature-owned storage adapter that tolerates an absent or throwing
  `localStorage` getter and throwing `getItem`, `setItem`, and `removeItem` methods. Tests must use
  the adapter's reset helper for isolation instead of assuming jsdom exposes browser storage.
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
  Focus description/notes and Update observation. Keep titles, dates, statuses, and
  other compact values as native controls. Rich text is limited to bold, italic, underline,
  strikethrough, yellow highlight, a conventional readable text-color palette, bulleted, numbered,
  and check lists, and safe external links; do not add images or other embedded media. Strikethrough
  uses `Command-Shift-X` and highlight uses `Command-Y`, with both shortcuts exposed on their
  toolbar controls. Color changes must restore the complete pre-toolbar selection and replace the
  color across mixed-style text without removing its other formats. Link creation accepts only
  `http`, `https`, and `mailto` destinations, and link clicks must leave Electron through the
  main-process external-link policy. Pasting a safe URL over selected text must retain that text and
  its inline formatting while using the URL only as the link target. Within any list, Tab nests the
  selected item and Shift+Tab outdents it; outside lists, preserve normal keyboard focus navigation.
  Represent blockquotes as Lexical multi-block (shadow-root) QuoteNodes so paragraphs, bulleted
  lists, numbered lists, and checklists remain structurally nested inside the quote. Upgrade legacy
  inline QuoteNodes in memory without flattening their content.
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
- Render direct Thread and Commitment Updates through the receiver-owned `UpdateList`
  contract. Thread Updates belong in the selected Thread and Commitment Updates in the selected
  Commitment view; neither list includes descendant Updates. Give
  every Update its own responsive card: observation
  uses the full card width while date, state, and actions occupy a wrapping metadata header. Do not
  reintroduce tabular columns. Updates must expose editable date, optional multi-line observation,
  and state plus add/delete actions. `Add update` must immediately persist a blank Update using the
  current local date and `none` state; do not introduce a second Create/Cancel draft step. All
  date, state, and sensitivity autosave through the shared throttle; observation text uses the
  synchronous rich-text document path. Do not render a manual save action.
  Blank and state-only Updates are valid. State must always have a text label as well as semantic
  color (`destructive` for red, `warning` for yellow, `success` for green, muted for none). `Cmd-P`
  immediately adds an Update wherever direct creation is valid, focuses its observation editor,
  and reveals the complete new card with the least necessary workspace scroll.
  In a bounded All Subjects view it focuses the required Subject creation picker, then focuses the
  created card after selection; on Review it starts an Update only for a Thread or Commitment target
  and reveals its editor region. Focus Overall, Todos, Tags, and other screens without Updates leave
  `Cmd-P` untouched.
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
- Keep Focus timeline rail filters compact and local to the active Focus. Filtering a Thread must
  preserve its rail position as a dim neutral guide while removing that Thread's update bubbles,
  connectors, points, and otherwise-empty date groups; switching Focuses resets the rail filters.
- Give every Focus timeline Thread a deterministic, collision-resolved identity color. Use that
  color only as a left-edge accent on the Thread's rail filter/header and a right-edge accent on its
  direct or Commitment update bubbles; state-colored rail intervals remain semantically authoritative.
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
- Render Thread-owned collections through the shared `CommitmentCollection` receiver.
  Presenters must translate the business projection into its receiver-owned item contract; the
  receiver owns row markup and the visible `Add commitment` action, and emits only creation
  requests or Commitment ids for open, pin, and completion actions. Successful parent-page
  creation must select the new nested Commitment route without entering the filtered Commitment
  level; creation from an already-filtered level remains in that level.
- Treat `tracking` and `routine` as separate Commitment behavior adapters. Existing Thread
  Commitment collections, health rollups, Update commands, Due, and Review consume tracking records
  only. The top-level Routines view consumes `RoutineSnapshot` only; do not switch on behavior inside
  low-level UI receivers.
- A Routine has no lifecycle status selector and never generates Todos. Render its derived Current,
  Overdue, or Lapsed state through the shared semantic state-label receiver. Current Run checklist
  text is read-only; template edits create a future version instead of mutating materialized Runs.
  Give every Run × Subject checklist item an optional inline rich-text note. Persist it through the
  shared throttled autosave path while its Subject cell is open. Resolving every required item only
  enables an explicit `Finalize check-in` action; it does not stamp completion automatically.
  Finalization flushes pending notes, stamps cell completion, and freezes every item resolution,
  attestation timestamp, and note in that cell. Present each live inspection as a section title with
  one horizontal `Check` / `Ignore` radio group beneath it; do not split those resolutions into
  unrelated checkbox and button controls. Keep Run history visually flat: use simple separators for
  Subject cells and inspection rows instead of nesting a card around every level.
- Render the Routine's current actionable check-in above the `Check-in history` section on its
  owning Thread screen. History contains prior completed Runs; when several weekday
  occurrences are unfinished, expose the oldest one as current and advance to the next only after
  explicit finalization. For a scoped Run, expose receiver-owned tabs for concrete Subjects only,
  retain a valid selected Subject or default to the first available Subject, and filter
  current/history cells to that Subject. Never add an aggregate `All subjects` Routine tab.
  A selected Routine owns the tab-bar slot completely: if its current Run has no concrete Subject
  cells, render no Routine tab bar and never fall through to its parent Thread's working-context
  tabs.
- Create and manage Routines only from the owning Thread screen. Put `Add Routine`
  beside `Add commitment`, render the parent's Routine definitions directly beneath its Commitment
  collection, and open the Routine's history when a Routine row is selected. Keep the creation form
  in the shared `Add Routine` dialog because no record exists yet, but render edits to its future
  template, queue inclusion, sensitivity, weekday schedule, and Scope as an embedded main-screen editor; do
  not open an Edit Routine dialog. Expose permanent deletion through the Routine's standard context
  drawer action with confirmation and shared invalidation behavior. Do not put definition creation or mutation in the
  global Routines destination. A scoped scheduled occurrence snapshots one independently
  completable attestation cell per effective Subject; never collapse multiple Subjects into a
  shared checklist resolution. When the parent already has an effective Scope, default a new
  Routine to applying that Scope; the user may explicitly uncheck it to create an open Routine.
- Build the global Routines destination with the shared contextual sidebar. Flatten it to one row
  per actionable `Routine × Subject` (or one unscoped Routine), grouped as Past due, Today, This
  week, and Upcoming. Selecting a row renders only that cell's checklist. Keep this destination an
  execution surface: its `ContextDrawerAdapter` may describe definition metadata, but it must not
  create, edit, or delete Routine definitions. Badge the primary Routines destination with the
  number of distinct visible Routines that currently have at least one editable cell, and show the
  same count in the workspace header.
- Treat due-date presence as the only user-facing Commitment mode. Do not expose an independent
  `ongoing` / `action` selector or label. The generic Commitment type remains `tracking` regardless
  of due date; mirror undated/due-dated compatibility values only inside the private
  `legacy_due_type` column. Render the one-way completion checkbox only on due-dated Commitment list rows. Checking
  an active or paused due-dated Commitment sends `status: done` through the existing typed mutation
  so transition auditing remains intact; closed Commitments cannot be reopened through the checkbox.
- Expose optional due dates for Focus, Thread, and Commitment through the shared feature-level
  `WorkDueDateField` in every selected entity's main header. It must support setting and explicitly
  clearing the date. Do not clip or reject a child date after its direct parent's date; show the
  shared accessible warning icon and tooltip while preserving the entered value. Keep a local draft
  while its native date input is focused and persist on blur; never key/remount or disable the field
  in response to an intermediate date segment, because macOS emits valid partial years while typing.
- Render Thread and Commitment Todos through the shared receiver-owned `TodoList`. The
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
- Build Review as a full-width, single-item catch-up queue with no contextual sidebar. Focuses are
  context and eligibility ancestors, never queue items. Review active Threads and Commitments whose
  own `needsReview` flag is enabled only when their owning Focus also enables descendant review
  tracking. A never-reviewed Thread or Commitment gets an initial review; after that, Thread review
  frequency and Commitment Update cadence determine when it participates again. Any
  applicable direct Update or explicit Pass dated today suppresses that exact target for today,
  even when an unmet Commitment cadence remains due; such a passed due Commitment may return the
  next day. Render direct evidence and child Commitments as non-navigating reference rows; a Thread
  must never drill into a Commitment from Review. `Ignore` dismisses only the current
  in-memory queue entry, `Pass along` calls the aggregate's typed `pokeReview` operation, refreshes
  the application-owned Focus projection, and advances the session. For Thread and Commitment
  targets, `Update` immediately creates a blank direct Update before exposing its autosaved editor.
  The editor's finish action advances the session and
  refreshes the owning Focus projection; it is not a Save button. A same-day queue
  refresh must retain passed and updated item keys while offering ignored items again; do not
  present a completed item as fresh work through a replay-style `Review again` action.
- Keep the current Review target and the Focus, Thread, and Commitment detail screens paired with
  their Default note through the shared `NoteSplitWorkspace`; feature screens supply only primary content,
  a note model, and optional mutation notification. Persist the last expanded height and collapsed
  state per screen kind (`review`, `focus`, `thread`, or `commitment`) as presentation preferences, never per
  domain record. The receiver owns a substantial draggable divider, snaps the note into a labeled
  bottom bar when dragged beyond its minimum-height threshold, and exposes an accessible
  collapse/expand button. Expanding restores the prior height; navigation between records must not
  reset either preference. Keep local preference access tolerant of missing, incomplete, or throwing
  `localStorage` implementations. The expanded note is the full-width lower-pane surface, not a
  nested card: keep its formatting toolbar fixed and make the bounded editor document the scroll
  owner so long notes remain usable at every split height.
- Build Due as a full-width aggregate worklist with no contextual sidebar. Load it through one named
  main-process projection that returns every Focus, Thread, and Commitment with an explicit due date,
  including done and cancelled records; never issue a renderer-side hierarchy fan-out. Group rows as
  Overdue, Due today, and Upcoming, ordered globally by due date within those sections. Every row owns
  the shared semantic work-kind glyph (Target for Focus, Git branch for Thread, Handshake for
  Commitment), name, atomic containing-screen destination, editable due date, and the shared lifecycle
  status selector. Glyphs require an accessible label and hover title. Preserve direct-parent date
  misalignment as the existing advisory warning. Clearing
  a due date removes the row after persistence. Apply hierarchy-cascading sensitive filtering at the
  presenter collection boundary. A link may open a closed Focus without restoring it to normal sidebar
  navigation.
- Render a current Thread or Commitment Review target's direct Todos through the shared
  `DirectTodos`/`TodoList` contracts, using the exact Scope/Subject cell for a scoped queue entry.
  Focus Review targets own no Todos. Every successful
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
- Migration 33 is the breaking Focus-overview boundary. It clears retired Focus Goal content and
  rejects new direct Focus Commitments, Routines, Updates, Todos, and Todo lists in both repositories
  and SQLite. Its cleanup deletes former Focus-owned work through the normal foreign-key graph so
  every affected direct or descendant Update reaches `archived_updates`. Portable import must apply
  the same semantic repair to older archives while keeping the central archive triggers installed.
- Rescue every Update deletion through the SQLite-owned `updates_archive_before_delete` trigger.
  `archived_updates` mirrors every live Update field plus its original id, former hierarchy labels,
  effective sensitivity, and deletion timestamp without foreign keys, so direct deletes and Focus,
  Thread, Commitment, Scope, or Subject cascades cannot erase evidence. Parent/Scope/Subject
  `BEFORE DELETE` preparation triggers must stage context before SQLite removes ancestor rows. Keep
  `UpdateArchiveRepository`'s startup schema check: any future Update column or table rebuild must
  update the archive table, staging triggers, and rescue trigger before the app may write. Archived
  content is immutable, but repository-owned permanent delete, Clear all, and automatic 30-day
  retention pruning are supported. Enforce the cutoff in SQLite before snapshots cross IPC and
  prune on startup, archive access, portable export/import, and new archive inserts. Portable import
  may merge retained rows but must never disable the rescue trigger or clear local rows implicitly.
- Persist Todo closure time independently as `completed_at`: the first open-to-done transition sets
  it, edits to an already-done Todo preserve it, reopening clears it, and closing again records a new
  instant. The global overview returns every open Todo plus only completed Todos from the last seven
  days, with the cutoff enforced in SQLite before snapshots cross IPC.
- Preserve hierarchy cascades, relation `SET NULL` behavior, and automatic status-transition
  auditing.
- Keep tag identity derived from literal current text instead of adding a second persisted source of
  truth. Index Focus title/description, Thread and Commitment titles, Update observation, Todo
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
  inclusion filtering, including the owning Focus's descendant-tracking gate, plus due metadata,
  hierarchy context, exact Scope/Subject cells, direct Updates, and direct child Commitments. It
  never returns a Focus as a review target; the renderer must not rebuild review eligibility by
  fetching every aggregate.
- Order Commitment Updates by their recorded date without capping them at today. A future-dated
  Update immediately supplies the Commitment's state and cadence baseline.
- Derive Focus `lastReviewDate` only from its persisted explicit review poke because Focuses no
  longer own Updates. Derive every Thread or Commitment `lastReviewDate` as the later of its persisted
  explicit review poke and applicable direct Update evidence. For an Open or zero-Subject Thread,
  that evidence is the newest effective direct unscoped Update, and
  the later poke also advances the aggregate review deadline. For a bounded Thread with Subjects,
  expose one independent review cell per effective Subject: aggregate `reviewDue` with any due cell,
  `nextReviewDate` with the earliest cell deadline, and Update-derived coverage as the oldest latest
  review date across all current cells (or null while any current Subject is unreviewed). A global
  Thread poke may advance the aggregate `lastReviewDate`, but must not fabricate cell evidence or
  satisfy cell deadlines. An exact Thread-cell poke is separate durable review evidence for only
  that cell. Commitment `lastReviewDate` uses its later applicable aggregate/cell poke or Update,
  while state, `lastUpdateDate`, and update cadence remain Update-only projections. Persist a
  positive `reviewFrequencyDays` and independent `needsReview` flag on every Commitment. Within an
  included Focus, a Commitment's review schedule overrides its parent Thread's schedule and
  inclusion; the Focus gate still excludes the entire descendant hierarchy. Bounded
  Commitments derive independent review deadlines per effective Subject cell. Keep persisted
  `needsReview` separate from lifecycle status and from all derived review projections.
- A Commitment or Routine must have exactly one Thread parent. An Update must have exactly one
  Thread or Commitment parent. Preserve these SQLite constraints and cascades.
- Treat Commitment as a generic behavior-discriminated model. `tracking` and `routine` share only
  the base Thread ownership boundary. Migration 26's constrained `commitment_type` remains
  tracking compatibility storage; migration 27's constrained `behavior_type` is canonical. Keep the
  due-derived `action`/`ongoing` compatibility value isolated in `legacy_due_type`; never expose it
  as the Commitment's type or use it to branch application behavior.
- Store Routine recurrence as an arbitrary subset of Monday through Friday. Each selected weekday
  creates an anchored occurrence, and late completion never moves future dates. An empty schedule
  creates no Runs. Derive effective `needsAttestation` as the stored queue-inclusion preference AND
  a nonempty weekday schedule; never overwrite the stored preference merely because the schedule is
  temporarily empty. Materialize every due occurrence; when none is unfinished, also materialize
  exactly the next calendar occurrence so its immutable checklist can be completed early. Do not
  materialize a second future occurrence merely because that next occurrence was completed ahead
  of schedule; it becomes eligible when the projection date reaches the completed occurrence. Every
  materialized Run stores its template version, inspection text/order/required flags, review window,
  and Scope/Subject-name snapshot. Materialize one independently editable attestation cell per
  effective Subject. Use one unscoped cell only for a Routine with no applied Scope; an applied Scope
  with no effective Subjects has no aggregate fallback cell. Before any resolution, note, issue, or
  finalization is recorded, reconcile today's or the next Run when its same-Focus Scope membership
  changes. Once attestation begins, preserve that Run's complete Scope/Subject snapshot. A scoped
  Thread Routine follows its parent when inherited/custom Thread Scope changes replace the effective
  Scope id. When a parent establishes its first Scope, Routines created while that parent was Open
  adopt it; a Routine explicitly left unscoped after a parent Scope already exists remains open.
  Cross-Focus Thread moves continue preserving existing Run attribution. Run checklist
  snapshots and evidence-bearing/finalized cells/Runs are immutable. Only explicit finalization after full resolution of every required item
  refreshes the practice; optional item-note evidence never changes Routine color. Keep
  the stored attestation preference independent of status. Legacy `cadence_days` and `anchor_on`
  columns remain import compatibility storage after migration 31 and must not drive recurrence.
  Legacy issue rows remain
  importable/readable compatibility data but have no creation or editing UI.
- Persist nullable, calendar-validated due dates independently on Focus, Thread, and Commitment.
  Parent dates are advisory planning boundaries, not database constraints: descendants may extend
  beyond them and the renderer owns the direct-parent warning.
  `DueRepository` is the named read projection for all explicit dates. It includes direct ownership
  context, sorts globally by date, and excludes only records whose due date is null; lifecycle status
  does not change aggregate membership.
- Treat Subject, Scope, and Scope application as distinct model concepts. Subjects are canonical and
  generic; Scopes are Focus-owned applicability expressions; editable applications belong to Focus
  and Thread. Persist Commitment application rows only as enforced derived projections:
  Commitments always inherit their owning Thread.
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
  cell. Updates on Open parents remain unscoped. A Thread with zero
  effective Subjects is operationally Thread-wide and may store direct unscoped Updates; this
  exception does not apply to Commitments. Preserve cell attribution when applications or membership
  later change.
- Never accept a Scope declaration when creating or mutating a Commitment. Changing a Thread Scope
  must immediately change the effective working context of all its Commitments regardless of
  whether those Commitments were created before or after the Thread Scope.
- Reparent Commitments only through the transactional plan/move repository contract between Threads
  within one Focus. Updates, Todos, and Notes retain their Commitment ids and exact historical Scope cells;
  the move never copies or deletes child rows. Compare canonical Subjects in the source and
  destination contexts independently of evidence count. Exact/superset destinations need no
  confirmation; missing Subjects require an explicit, stale-plan-safe confirmation before widening
  the destination Focus Scope or an isolated Thread overlay. Record every actual parent change in
  immutable `commitment_parent_transitions` history and keep the derived Commitment Scope
  application synchronized to its owning Thread.
- Move Threads between Focuses only through the transactional plan/move repository contract. Keep
  the Thread id and all descendant Commitment, Update, Todo, Note, and sort-placement identities.
  An Open/inherited Thread follows the destination Focus; canonical Subjects absent there require
  an exact stale-plan-safe confirmation and atomic Focus widening. Copy a custom Thread Scope graph
  into the destination without widening its Focus. Recursively copy and remap every retained exact
  child-evidence Scope into the destination because Scopes are Focus-owned; never relabel historical
  cells as a different Scope merely because its Subjects match. Authorize those otherwise-immutable
  Scope-id remaps only inside the move transaction, and append immutable
  `thread_parent_transitions` for every actual parent change.
- Model Todos separately from Commitments. A Todo has a required name, immutable Thread/Commitment
  or exact Thread/Commitment Scope-cell parent, optional due date, boolean done state,
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
- Treat Focus description, Update observation, and Note content as addressable rich-text
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

## MCP boundary

- Keep the loopback Streamable HTTP adapter in `src/mcp` transport-only. It is owned by the running
  Electron main process and uses that process's existing `AppDatabase`; it must never open SQLite or
  run migrations independently. MCP and Electron call the typed application boundary in
  `src/main/application`; neither exposes SQL, raw tables, renderer models, or migration column names.
- Re-read persisted MCP permissions on every request. Sensitive access and safe-write access are
  independent and default off; the View-menu preference never grants MCP access.
- Apply effective sensitivity before assembling output, including ancestors, Scope, and Subject
  cells. Hidden and missing IDs must have identical externally visible errors, and hidden records
  must not affect returned counts, tag uses, snippets, resources, or review items.
- Maintain natural-language discovery through the migration-backed FTS5 projection. Parse rich text
  to plain text, keep queries bounded, and resolve effective sensitivity against live hierarchy
  records at query time. Never accept SQL or field expressions from an MCP caller.
- MCP writes must go through `OnMoveCommandService`, preserve exact Scope × Subject attribution, and
  emit metadata-only mutation audits. Do not add destructive MCP tools without an explicit product
  decision and confirmation design.
- Start and stop MCP through the persisted Settings toggle. Bind only to `127.0.0.1`, validate
  localhost Host and Origin headers, expose the configured `/mcp` endpoint only while OnMove is
  running, and stop the listener before closing the shared database. Successful MCP mutations must
  broadcast the generic in-process domain-change event to every open renderer window.

### MCP API design lessons and regression constraints

- Design the MCP surface for an agent that knows none of OnMove's implementation terminology. Tool
  names, descriptions, parameter descriptions, errors, and returned guides must define Focuses,
  Threads, Commitments, Subjects, Scopes, Notes, Updates, and Todos at the point where the agent
  needs them. IDs must be self-describing (`focusId`, `threadId`, `subjectId`) rather than generic
  hierarchy ids. A search hit's `reference.id` identifies the matched record; its
  `hierarchy.thread.id` or `hierarchy.commitment.id` identifies a containing record. Never require
  the caller to infer or interchange those meanings.
- General discovery must work when a name or literal string may occur anywhere: titles,
  descriptions, rich-text Updates and Notes, Todos, Routine templates, Subjects, or Tags. Back it
  with the maintained FTS5 projection and readable rich-text extraction, not a collection of
  entity-specific `LIKE` queries. `get_thread` and other direct getters retrieve known entity ids;
  they are not substitutes for global search.
- Search globally by default. Omitted or null `scope`, `focusId`, and `subjectId` must never inherit
  the current UI selection. Use one named `scope` object with explicit modes: `all` for the visible
  workspace, `focus` for one Focus hierarchy, `subject` for one canonical Subject, and `current`
  only when the caller deliberately requests the live UI context. Return the normalized
  `diagnostics.appliedScope` on every response, plus applied kinds and result counts where relevant,
  so an agent can tell what the server actually searched.
- Treat an empty narrow search as diagnosable, not conclusive. A focus-, subject-, current-, or
  kinds-filtered empty result must include a plain-language warning such as “Retry with scope mode
  all to search globally.” Put important recovery guidance in textual MCP content as well as
  structured metadata because clients and models do not all inspect structured output reliably.
- Preserve regression tests for arbitrary literal strings globally, inside the matching Focus,
  inside the matching Subject, against unrelated records, and embedded within longer titles or
  rich text. Also test omitted and explicit-null scope, a deliberately narrow empty result, applied
  scope diagnostics, Unicode/case behavior, and sensitive ancestors. These tests exist because
  simple searches previously disappeared behind an implicit current-Focus filter.
- Use `onmove.resolve_target` for relational language such as “do X for Person Y's 1:1 in Team.”
  Resolve in hierarchy order—optional Focus, Thread, optional child Commitment, then optional
  Subject in the target's effective Scope—and return a directly usable recommended write request.
  Match names exactly and case-insensitively so punctuation-bearing names such as `1:1` are not
  damaged by FTS tokenization. Return candidates for duplicates and never guess through ambiguity.
- Keep applicability and the UI selection separate at the API boundary. A write target is a typed
  parent `{ type, id }`; Subject attribution is a separate named object. An Open parent accepts only
  `attribution: { mode: "unscoped" }`. A bounded parent accepts exactly one currently allowed
  Subject for an Update, while Todo rules may additionally support `all-subjects`. Never silently
  discard a supplied Subject or borrow one from the current UI context, because that changes the
  semantic cell receiving evidence.
- Every readable mutation target must return a `writeGuide` that states its current attribution
  mode, allowed Subjects, and executable argument shape. Invalid attribution—including the former
  confusing “an open parent cannot target a subject” case—must return the target's inspection call,
  allowed choices, a semantic explanation, and a ready-to-run retry when only one correction is
  possible. The caller should not need knowledge of Scope internals to recover.
- Keep one canonical name for every structured write field. Rich-text writes accept only the
  top-level `richText` field; never restore the former `document` compatibility alias or advertise
  both names. Agents responded to dual aliases by sending both. The internal application service
  may use different implementation vocabulary, but that must not leak into the MCP schema.
- Rich-text reads expose both a readable plain-text projection and a lossless editor-neutral
  versioned document. The plain projection is for search and comprehension and must remain
  read-only. All MCP-writable rich-text fields use the same AST and accept full-document replacement
  through `richText`, preserving paragraphs, nested lists and checklists, multi-block quotes, links,
  tags, colors, soft breaks, and marks. Never accept a plain string write that can flatten formatting.
- Keep the rich-text schema practical for LLM clients. Describe every node, field, mark, color,
  protocol, limit, and minimal valid example. The canonical yellow highlight mark is `highlight`;
  accept `highlight-yellow` only as an input mark alias and canonicalize it on read. This mark alias
  must not become another root document field. Missing or invalid rich text must name `richText`,
  identify the bad nested value, list supported values, and include a corrected example.
- Validate semantic rich-text details in the handler when doing so produces a more actionable error
  than an opaque MCP SDK “invalid arguments” response. Test invalid requests through a real MCP
  client, not only the converter, because transport schema validation can reject input before the
  handler can add recovery metadata. In particular, preserve regression coverage for mixed marks
  such as `marks: ["italic", "highlight-yellow"]`, unsupported marks, unsafe links, missing
  `richText`, and the rejected root-level `document` field. Rejected input must not mutate SQLite.
- A Note update is a read-edit-write operation. Require the revision returned by `onmove.get_note`,
  reject stale revisions without writing, and tell the agent to re-read, reconcile, and retry. Do
  not invent a merge. A blank Update remains a valid explicit record, so omitting optional
  `richText` from `onmove.create_update` must not be confused with a malformed Note replacement.
- Keep mutations narrow, typed, auditable, and opt-in. Route them only through
  `OnMoveCommandService`; never expose generic model updates, arbitrary fields, SQL, delete, import,
  move, archive clearing, or lifecycle transitions without a separate product and confirmation
  design. Return the refreshed canonical record and diagnostics after a successful mutation.
- MCP operates beside the live editor, not against a second database connection or a database file
  snapshot. It must share the running main process's repositories and command services. Every
  successful write must synchronously commit, refresh the search projection as designed, and
  broadcast domain and rich-text changes so every main and pop-out window updates immediately.
  Preserve live-server tests so MCP-visible changes never require quitting, reopening, or navigating
  away from the active screen.
- Server enablement, sensitive access, and write access are three independent persisted settings,
  re-read for each request so revocation takes effect without reconnecting. The UI's “hide sensitive
  content” preference is not authorization. Resolve effective sensitivity across ancestors and
  Scope/Subject cells before search, direct reads, counts, snippets, resources, or writes; expose
  hidden and nonexistent records identically to avoid leaking their existence.
- Treat compatibility as tolerant reading and explicit canonical writing, not a reason to multiply
  schema choices. When an older form must temporarily remain, prefer normalizing it behind the
  boundary without encouraging it in guides, and add a removal test when it is retired. New API
  additions should have one obvious request shape, one vocabulary, diagnostic metadata, textual
  recovery, and end-to-end tests from MCP client through the shared live application state.

## Required verification

Run `pnpm check` for every change. Run `pnpm test:e2e` for navigation, preload, persistence, window,
or packaging-boundary changes. Rebuild the `.app` with `pnpm dist:mac` before handing off a new
desktop version.

The canonical application icon is the tracked vector source at `build/icon.svg`. Keep electron-builder's
`directories.buildResources` pointed at `build` and its macOS icon pointed at that SVG so a clean clone
can generate the complete `.icns` set without relying on ignored local PNG or ICNS artifacts.
