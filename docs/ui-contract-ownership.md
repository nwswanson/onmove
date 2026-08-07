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
| Context drawer | `ContextDrawerModel` inside `ContextDrawerAdapter` | Map the selected record to fields and typed action capabilities | Inputs/static values, draft state, validation, pending/errors, confirmation, close, resize, and pin UI |
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
sidebar receives only `{ id, label, lines, accessory }`; it never receives `CommitmentSnapshot`.
Consequently, changing sidebar row layout cannot affect business code, and adding Commitment fields
cannot silently change navigation presentation.

## Enforcement

- TypeScript prevents drawer adapters and contextual levels from accepting render callbacks or
  domain records.
- Receivers validate ids, labels, groups, select options, fields, sections, and actions.
- `tests/renderer/focus-presenters.test.ts` verifies domain-to-contract translations.
- Dedicated receiver tests verify rendering and interactions using only receiver contracts.
- `tests/renderer/ui-architecture.test.ts` prevents shared UI from importing domain/features or
  accessing preload APIs, prevents model hooks from importing UI, and prevents feature views from
  bypassing the model-driven drawer.
