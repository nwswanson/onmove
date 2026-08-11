# UI contract ownership

OnMove uses **receiver-owned contracts** wherever business data enters a reusable UI component.
The component that renders and interacts with the data defines the allowed input vocabulary. A
caller may translate its domain model into that vocabulary, but it may not send markup or teach the
domain object about UI.

```text
SQLite/domain -> typed preload snapshot -> feature model hook -> feature presenter
                                                           -> receiver-owned UI model
                                                           -> shared receiver component
```

## Boundary map

| Boundary | Receiver-owned contract | Caller responsibility | Receiver responsibility |
| --- | --- | --- | --- |
| Main sidebar | `SidebarNavigationItemModel` | Map visible destinations to ids, labels, semantic tokens, selection callbacks, and optional opaque drop targets | Rows, icons, focus, selection, empty state, action placement, and drop feedback |
| Contextual sidebar | `ContextualSidebarItemModel`, `ContextualSidebarChildCollectionModel`, and `ContextualSidebarLevelOptions` | Map hierarchy records to labels, optional nested child collections/actions, semantic state, parent/new-item capabilities, and opaque move intent | Parent/tree row markup, collection-action buttons, simple child state dots, Back, level vs. nested-route selection, atomic deep-link path resolution, drag handles/previews, accessibility, and deletion reconciliation |
| Semantic state label | `StateLabelModel` | Translate a domain state to label text and a semantic tone | Badge markup, dot, sizing, and semantic color tokens |
| Work status selector | `WorkStatusSelectProps` | Supply one Focus/Thread/Commitment status and a typed mutation callback | Shared domain choices and translation into the low-level lifecycle-select receiver |
| Sidebar Sunflower | `SemanticSunflowerModel` | Project the newest direct state and active Commitment states into labeled semantic-tone seeds | 24px spiral geometry, product-color resolution, density limits, SVG accessibility, and model validation |
| Rich text | `RichTextEditorProps` and the drawer's `rich-text` field kind | Supply an opaque persisted string and typed change/save callbacks | Lexical state, legacy-text import, toolbar, formatting, serialization, focus, and accessibility |
| Inline text tags | `TaggedInput`, `TaggedText`, and Lexical `TagNode` | Preserve the literal user-authored value and existing persistence callback | Shared syntax recognition, deep-blue token presentation, native compact-input behavior, and rich-text node materialization |
| Existing rich-text persistence | `useDurableRichText` and the typed `richText` preload API | Supply a document reference and initial opaque value | Synchronous SQLite commit, revisions, cross-window updates, detached-window opening, and errors |
| Compact-field persistence | `useThrottledAutosave` and `ContextDrawerAutosaveModel` | Supply the latest draft, persistence callback, and drawer field capabilities | The 750 ms interval, coalescing, write serialization, blur/close flushing, pending state, and errors |
| Context drawer | `ContextDrawerModel` inside `ContextDrawerAdapter` | Map the selected record to text/select/checkbox/static fields and typed action capabilities | Inputs/static values, boolean controls, draft state, validation, pending/errors, confirmation, close, resize, and pin UI |
| Commitment collection | `CommitmentCollectionModel` | Translate the ordered Commitment projection into display labels, state/status models, and completion capabilities | Group/list markup, empty states, Add action, Action checkbox, disclosure and info controls, accessibility, creation requests, and id-only item events |
| Direct updates | `UpdateListItemModel`, `UpdateListDraft`, and `UpdateListStateOptionModel` | Bind one typed Focus, Thread, or Commitment parent; map Update snapshots, provide explicit creation defaults, and translate drafts into typed mutations | Responsive cards, inline editors, immediate blank-record creation, automatic edit persistence, delete actions, validation, empty/loading/errors, accessible owner label, and visible state labels/colors |
| Sensitive visibility | `SensitiveRecord`, hierarchy visibility helpers, plus `SensitivityToggleProps` / Update draft `sensitive` | Filter collection membership with the app-wide preference and ancestor flags; persist typed flag changes; resolve hidden routes upward | Sensitivity-control markup and complete selected-record editing models |
| Main view | `WorkspaceShellProps.main` UI-composition slot | A feature view renders its own screen from feature-model data | Shell placement, sizing, and clipping |

The main-view slot is intentionally different: it is a UI-to-UI composition boundary, not a
business-object-to-widget boundary. `WorkspaceShell` accepts a rendered screen but no domain model.
Business hooks never return React nodes, and shared shell components never import domain contracts.

## Ownership rules

1. The receiver defines and exports the contract beside its component.
2. Domain snapshots and business models contain data and operations only—no icons, classes, field
   definitions, React nodes, or render methods.
3. Feature presenters are the only translation layer. They may import domain types and UI contract
   types, but are plain `.ts` modules with no React rendering.
4. Data flows toward the receiver. Event capabilities flow back toward the feature through typed
   callbacks.
5. Model-driven receivers do not accept escape hatches such as `renderItem`, arbitrary row markup,
   or feature-provided class names. New visual vocabulary is added to the receiver contract when it
   is genuinely reusable.
6. Receiver contracts use stable string ids and serializable display data. Callback capabilities
   are the sole intentional non-serializable values.

## Sensitive-content boundary

Focus, Thread, Commitment, and Update snapshots expose a persisted boolean `sensitive` value; they
never expose visibility or UI-redaction instructions. The native View menu owns one process-wide
“Hide Sensitive Content” preference, which defaults to false and is delivered through a narrowly
typed preload query/event pair. It is deliberately not persisted in SQLite.

Feature models keep complete snapshots and apply one hierarchy-aware predicate when they materialize
collection membership. A sensitive record is omitted when hiding is enabled, and an ancestor's flag
omits every descendant even when that descendant is not independently marked. This applies to the
primary Focus list, contextual Thread and Commitment lists, parent-page Commitment collections,
Update-card lists, and the signals exposed by sidebar Sunflowers. The reusable receivers never learn
what a Focus or Thread is; they simply receive fewer item models.

Navigation resolves the same filtered hierarchy. Hiding the active Commitment goes Back to its
owning Focus or Thread, hiding the active Thread selects Focus Overall, and hiding the active Focus
returns Todos. Showing content again restores list membership but does not silently restore the old
route. Selected model receivers remain complete: main screens and drawer adapters do not redact
field values, and a deliberately pinned drawer continues across navigation under its existing pin
contract. This keeps list visibility separate from model shape and avoids stale redacted adapters.

## Commitment example

`CommitmentSnapshot` does not expose “drawer settings.” The Focus feature presenter receives that
snapshot plus the resolved parent title and returns a `ContextDrawerAdapter`. Today the adapter
contains static Title, Parent, Status, State, and Last updated fields. Separately, the selected
Commitment screen delegates lifecycle status to the feature-level `WorkStatusSelect`, also used by
Focus and Thread detail screens. That component owns the shared domain vocabulary and adapts it into
the generic `LifecycleStatusSelect` contract; each screen still delegates the selected value to its
typed workspace-model mutation. This keeps the low-level receiver free of work-record types and
persistence. Later, additional business editing can be adapted into the
drawer's existing `text`, `select`, and action contracts without changing Commitment's domain
representation or allowing it to render itself.

The same Commitment is separately adapted into `ContextualSidebarItemModel` for the hierarchy. The
sidebar receives only `{ id, label, description, lines, stateLabel, accessory }`; it never receives
`CommitmentSnapshot`. Its nested `StateLabelModel` is created from the snapshot's already-derived
state, and its description combines presenter-owned lifecycle-status text with the snapshot's
already-derived `lastUpdateDate`, so the renderer never needs the Update collection. Consequently,
changing sidebar row layout cannot affect business code, and adding Commitment fields cannot
silently change navigation presentation.

Collection ordering is also outside the receivers. `buildCommitmentListModel` accepts domain
snapshots and returns ordered Active, Paused, and closed groups. `commitmentCollectionModel` then
translates those groups into the receiver-owned display contract used unchanged on Focus and Thread
screens; the receiver receives labels and semantic UI models, not domain records. The sidebar
presenter consumes the same ordered business projection independently, so neither UI receiver
embeds lifecycle or health priority rules. The adjacent `commitmentCompletionModel` is the
business/view-model boundary for the list-only Action checkbox: it declares visibility, checked
state, and one-way availability; the row owns checkbox markup and emits only the Commitment id to
the feature callback.

The top contextual level can also receive a nested `Commitments` collection for Overall and every
Thread. The presenter supplies direct children and semantic state models; the generic sidebar owns
the indented tree, generic collection-action button, simple color-dot receiver, active styling, and
keyboard behavior. The Focus presenter configures that action as `Add commitment` and translates
its owner id into the typed Focus or Thread parent expected by the existing creation flow.
`ContextualSidebarNavigation.selectChild` records a child route separately from its parent
selection, so opening a nested Commitment updates the main view without replacing the visible
sidebar level. The tree action also preserves the top level: after creation, the returned record is
selected as a nested route. Entering a parent-asserting filtered Commitment level remains an explicit
main-view collection-heading action, not a contextual-tree action.
If a selected child is deleted or filtered, refresh clears the child route and retains its visible
parent selection.

Drag and drop keeps the same receiver ownership. `SidebarDndProvider` spans both sidebar slots and
knows only opaque `{type, id, label}` sources and `{type, id}` targets. The contextual sidebar owns
which row surface moves and its drag preview; the main sidebar owns Focus drop feedback. The Focus
feature declares that a Thread may target a different Focus, requests the business move plan, and
handles confirmation and navigation. Neither receiver knows what a Scope is or mutates records.

Creation uses the same ownership direction. `CommitmentCollection` owns the visible Add button and
emits a parameterless creation request; the feature supplies the already-known Focus or Thread
parent to the shared dialog. Once persistence returns the new record from a parent screen, the
feature selects its nested child route and keeps the top-level tree visible. Creation while already
inside a filtered Commitment level stays there and selects the new row. Explicit deep links to
descendant levels still use `ContextualSidebarNavigation.navigateToPath`, which resolves every
asserted ancestor and leaf in one transaction.

Sidebar Sunflowers follow the same boundary. `status-summary.ts` materializes business data only:
the newest direct Update plus each unique active Commitment, including Thread descendants in a Focus
summary. `focus-presenters.ts` maps those health states into labeled semantic tones. The shared
`SemanticSunflower` receiver owns exact Cerulean, Tigerlily, Greenery, and gray values, seed geometry,
the 24px size, validation, and accessible/hover descriptions; sidebar components never inspect
Commitments or Updates.

Direct Focus, Thread, and Commitment Updates follow the same pattern. `useUpdatesModel` owns
persistence for one typed parent, `DirectUpdates` supplies the owner-specific accessible label, and
`updates-presenters.ts` maps snapshots and health states. `UpdateList` accepts only its own item,
draft, and state-option contracts; it does not import `UpdateSnapshot`, `HealthState`, or the preload
API. Its card layout keeps the narrative observation at full width; date, state, and actions wrap
independently above it as the available main-view width changes. The receiver's `defaultDate` and
`defaultState` make creation behavior explicit: Add immediately persists an empty Update, with
pending and failure feedback, and never creates a temporary UI-only draft. The resulting card's
date, state, and sensitivity edits enter the shared throttled pipeline. Observation text uses the
durable rich-text document path described below.

Multiline content follows one shared receiver contract. `RichTextEditor` owns a deliberately small
Lexical configuration: undo/redo, bold, italic, underline, strikethrough, a fixed yellow highlight,
bulleted, numbered, and check lists, links, and a conventional text-color palette. The palette uses
adaptive gray, red, orange, yellow, green, blue, and purple values chosen for readable light and dark
appearances instead of reusing product-theme semantics. Strikethrough is available through
`Command-Shift-X` and highlighting through `Command-Y`; tooltips and `aria-keyshortcuts` expose both
bindings. Color selection captures and restores the editor range before the native select receives
focus, so applying one color replaces every color in a mixed selection while preserving bold,
italic, links, and other independent formats. `RichTextContent` renders the same value without
editing controls.
The receiver normalizes links without a scheme to HTTPS and accepts only HTTP, HTTPS, and email
destinations. Links always request a new external window; Electron denies that window and delegates
allowed schemes to the user's default macOS application, while rejecting executable, data, and
local-file schemes. The stored string uses an `onmove-rich-text:1:` prefix followed by Lexical's
serialized editor-state JSON; unprefixed legacy strings are imported as paragraphs. Link nodes and
checked state live inside that envelope, so models and IPC continue to treat both representations as
opaque text and no data migration is necessary. Inside any list, Tab nests the selection and
Shift+Tab outdents it; outside a list, Tab retains normal focus navigation instead of trapping
keyboard users in the editor.

Inline tags use the same receiver-owned rule in compact and multiline text: `@` plus only Unicode
letters or numbers, outside email-like words. Hyphenated and underscored continuations are rejected
as complete tokens. Lexical materializes matches as durable `tag` nodes, while `TaggedInput` keeps a
native input and overlays a synchronized `TaggedText` projection; both use the same adaptive deep
blue treatment. The stored compact value remains literal text. These receivers deliberately expose
no tag identity, navigation, or backreference behavior before the future Tags model owns it.

Rich-text persistence belongs to the feature model rather than the generic Lexical receiver.
`useDurableRichText` accepts a typed document reference, commits every emitted value synchronously,
and applies only newer revision broadcasts from other windows. `RichTextEditor` accepts an external
revision token and updates Lexical only when that token changes; ordinary controlled rerenders never
interrupt rapid local typing. The receiver exposes an optional Open in new window action, while the
feature supplies the typed operation. Detached windows run the same sandboxed renderer and hook.

Compact metadata still uses `useThrottledAutosave`; it performs at most one write per 750 ms, never
overlaps writes, and coalesces changes made while a write is in flight. A drawer adapter declares
which compact field ids support autosave and how to persist them; the drawer owns scheduling,
required-field checks, pending/error feedback, and close/action flushing. Create dialogs do not
autosave because their record does not exist until the explicit Create action succeeds.

## Enforcement

- TypeScript prevents drawer adapters and contextual levels from accepting render callbacks or
  domain records.
- Receivers validate ids, labels, groups, select options, fields, sections, and actions.
- Presenter tests verify Focus and Update domain-to-contract translations.
- Dedicated receiver tests verify rendering and interactions using only receiver contracts.
- `tests/renderer/ui-architecture.test.ts` prevents shared UI from importing domain/features or
  accessing preload APIs, prevents model hooks from importing UI, and prevents feature views from
  bypassing the model-driven drawer.
