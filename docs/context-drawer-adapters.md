# Context drawer contracts

The right-side drawer is a model-driven receiver. A domain object never renders itself and a
feature cannot supply drawer JSX. The receiver owns the accepted format in
`src/renderer/src/components/ui/context-drawer.tsx`:

- `ContextDrawerModel` describes the title, accessible label, sections, fields, and actions.
- `ContextDrawerFieldModel` is a closed union of `text`, `select`, and `static` fields.
- `ContextDrawerActionModel` describes validation, pending/error labels, optional confirmation, and
  a capability callback.
- `ContextDrawerAdapter` adds stable identity and deletion-invalidation keys to that model.
- `ContextDrawerOutlet` alone owns markup, draft state, validation, pending/error state,
  confirmation dialogs, sizing, closing, pinning, and empty behavior.

This direction is intentional:

```text
CommitmentSnapshot -> Focus feature presenter -> ContextDrawerModel -> ContextDrawerOutlet
domain data            translation only          receiver contract    renderer
```

For example, a Commitment currently produces static fields. Its domain snapshot has no drawer
method and contains no UI state:

```ts
const adapter = commitmentDrawerAdapter(commitment, 'Project Atlas', ['focus:1'])

adapter.model.sections[0].fields
// [
//   { kind: 'static', id: 'title',  label: 'Title',  value: 'Improve ticket quality' },
//   { kind: 'static', id: 'parent', label: 'Parent', value: 'Focus — Project Atlas' },
//   { kind: 'static', id: 'status', label: 'Status', value: 'active' },
//   { kind: 'static', id: 'state',  label: 'State',  value: 'green' }
// ]
```

“No editable settings here yet” is therefore a description of the current adapter, not a
limitation baked into Commitment. When Commitment title editing is implemented, its presenter can
emit a `text` field and save action after the business layer exposes that mutation. The receiver
does not change, and the domain object still does not learn about inputs, buttons, or dialogs.

## Actions and data flow

The drawer owns a string-valued draft keyed by field id. An action receives a read-only snapshot of
that draft. The feature presenter converts those values into a typed business input before calling
the model hook. Thus the UI contract does not depend on `FocusStatus`, `CommitmentSnapshot`, or any
other domain type.

Confirmation and error presentation are declarative. A delete action supplies confirmation text
and an `onInvoke` capability; it does not render its own modal. Required-field validation and
pending button state are also receiver behavior.

## Pinning and deletion lifecycle

The application owns persistent drawer state (`open`, width, and optional pinned adapter). A pin
takes precedence over active navigation until “Follow current selection” clears it. Adapter
identifiers use a stable kind/id pair such as `commitment:20`.

Each adapter declares invalidation keys for itself and owning ancestors. After a successful model
deletion, the feature reports those keys to the drawer controller. Unrelated or failed deletions
preserve the pin. Invalidating a pinned entity clears the pin without closing the drawer, allowing
the outlet to resume the current screen model or its receiver-owned empty state.
