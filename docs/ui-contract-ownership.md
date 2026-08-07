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
| Main sidebar | `SidebarNavigationItemModel` | Map visible destinations to ids, labels, semantic tokens, and selection callbacks | Rows, icons, focus, selection, empty state, and action placement |
| Contextual sidebar | `ContextualSidebarItemModel` and `ContextualSidebarLevelOptions` | Map hierarchy records to row models and declare parent/new-item capabilities | Row markup, groups, Back, selection, accessibility, and deletion reconciliation |
| Semantic state label | `StateLabelModel` | Translate a domain state to label text and a semantic tone | Badge markup, dot, sizing, and semantic color tokens |
| Rich text | `RichTextEditorProps` and the drawer's `rich-text` field kind | Supply an opaque persisted string and typed change/save callbacks | Lexical state, legacy-text import, toolbar, formatting, serialization, focus, and accessibility |
| Existing-record text persistence | `useThrottledAutosave` and `ContextDrawerAutosaveModel` | Supply the latest draft, persistence callback, and drawer field capabilities | The 750 ms interval, coalescing, write serialization, blur/close flushing, pending state, and errors |
| Context drawer | `ContextDrawerModel` inside `ContextDrawerAdapter` | Map the selected record to fields and typed action capabilities | Inputs/static values, draft state, validation, pending/errors, confirmation, close, resize, and pin UI |
| Commitment updates | `UpdateTableRowModel`, `UpdateTableDraft`, and `UpdateTableStateOptionModel` | Map Update snapshots and translate drafts into typed update mutations | Inline editors, add/save/delete actions, validation, empty/loading/errors, and visible state labels/colors |
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

## Commitment example

`CommitmentSnapshot` does not expose “drawer settings.” The Focus feature presenter receives that
snapshot plus the resolved parent title and returns a `ContextDrawerAdapter`. Today the adapter
contains static Title, Parent, Status, and State fields. Later, business support for editing can be
adapted into the drawer's existing `text`, `select`, and action contracts without changing
Commitment's domain representation or allowing it to render itself.

The same Commitment is separately adapted into `ContextualSidebarItemModel` for the hierarchy. The
sidebar receives only `{ id, label, lines, stateLabel, accessory }`; it never receives
`CommitmentSnapshot`. Its nested `StateLabelModel` is created from the snapshot's already-derived
state, so the renderer never needs the Update collection. Consequently, changing sidebar row layout
cannot affect business code, and adding Commitment fields cannot silently change navigation
presentation.

Direct Commitment Updates follow the same pattern. `useCommitmentUpdatesModel` owns persistence,
`updates-presenters.ts` maps snapshots and health states, and `UpdateTable` accepts only its own row,
draft, and state-option contracts. The table does not import `UpdateSnapshot`, `HealthState`, or the
preload API.

Multiline content follows one shared receiver contract. `RichTextEditor` owns a deliberately small
Lexical configuration: undo/redo, bold, italic, underline, bulleted and numbered lists, and a text
color palette. `RichTextContent` renders the same value without editing controls. The stored string
uses an `onmove-rich-text:1:` prefix followed by Lexical's serialized editor-state JSON; unprefixed
legacy strings are imported as paragraphs. Models and IPC treat both representations as opaque
text, so rich-text UI concerns do not enter business logic. Inside one bulleted or numbered list,
Tab nests the selection and Shift+Tab outdents it; outside a list, Tab retains normal focus
navigation instead of trapping keyboard users in the editor.

Text persistence is likewise receiver-owned. Existing-record editors schedule their latest value
through `useThrottledAutosave`; it performs at most one write per 750 ms, never overlaps writes, and
coalesces changes made while a write is in flight. Goal and Update editors flush when their editing
region loses focus. A drawer adapter declares only which text field ids support autosave and how to
persist those values; the drawer owns scheduling, required-field checks, pending/error feedback, and
flushes before closing or invoking an action. Create dialogs do not autosave because their record
does not exist until the explicit Create action succeeds.

## Enforcement

- TypeScript prevents drawer adapters and contextual levels from accepting render callbacks or
  domain records.
- Receivers validate ids, labels, groups, select options, fields, sections, and actions.
- Presenter tests verify Focus and Update domain-to-contract translations.
- Dedicated receiver tests verify rendering and interactions using only receiver contracts.
- `tests/renderer/ui-architecture.test.ts` prevents shared UI from importing domain/features or
  accessing preload APIs, prevents model hooks from importing UI, and prevents feature views from
  bypassing the model-driven drawer.
