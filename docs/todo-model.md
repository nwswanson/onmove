# Todo model and contextual ordering

This document specifies the current Todo domain model. Todos are deliberately separate from
Commitments: a Commitment describes an expectation and owns evidence/cadence, while a Todo is a
small executable reminder with a completion bit and optional due date.

## Record shape

Every Todo has:

| Field | Meaning |
| --- | --- |
| `name` | Required non-empty text. Duplicate names are allowed. |
| `parent` | One aggregate entity or one exact Thread/Commitment Subject cell. Immutable after creation. |
| `dueDate` | Optional real `YYYY-MM-DD` calendar date. |
| `done` | Required boolean, defaulting to `false`. This is not lifecycle status or evidence state. |
| `sort` | All independent contextual sort placements currently held by the Todo. |
| `createdAt`, `updatedAt` | Durable timestamps. |

The parent contract is:

```ts
type TodoParent =
  | { type: 'focus'; id: number }
  | { type: 'thread'; id: number }
  | { type: 'commitment'; id: number }
  | { type: 'thread-scope'; id: number; scope: { scopeId: number; subjectId: number } }
  | { type: 'commitment-scope'; id: number; scope: { scopeId: number; subjectId: number } }
```

Focus Todos are aggregate only. Scoped parents use the same exact effective Scope/Subject cell
identity as scoped evidence. Creation requires the Scope to belong to the entity's Focus, equal the
entity's current effective Scope, and contain the Subject on the creation date. The stored cell is
not silently rewritten when Scope application or membership later changes. Existing Todos remain
available in their former exact context and in the entity rollup, while creation into a former cell
is rejected.

## Why sort is a relation

A scalar `todos.sort` column cannot represent the product correctly. A Todo under
`Thread × Subject` is visible in at least two legitimate lists:

```text
Thread aggregate list
└── Todo

Thread × Subject list
└── the same Todo
```

Reordering either list must not unexpectedly reorder the other. Migration 13 therefore separates:

- `todos`: durable content and parent/cell attribution;
- `todo_lists`: a canonical aggregate or exact-cell ordering context; and
- `todo_sort_placements`: the Todo's integer position within one list.

An aggregate Todo receives one placement. A scoped Todo receives two placements atomically: its
entity-wide rollup and its exact cell. `TodoSnapshot.sort` exposes both as
`{ context, position }` values. Additional projections can filter a canonical list without creating
another competing scalar sort field.

Positions are spaced by 1024 on append and normalized to the same stride after reorder. Equal or
sparse imported positions remain deterministic because id is the final tie breaker.

## Filter-tolerant reorder

`todos.list(context, options)` always applies filters after selecting one canonical sort context.
Supported filters currently include completion and inclusive due-date bounds. Filtering preserves
the underlying context order.

`todos.reorder(context, orderedTodoIds)` accepts either the complete list or a subset from a filtered
view. For a subset, only the slots already occupied by those supplied Todos are reassigned. Omitted
Todos keep their relative positions and slots. For example:

```text
full order:       A(active), B(done), C(active)
active filter:    A, C
reorder active:   C, A
new full order:   C(active), B(done), A(active)
```

This prevents a drag operation in an Active, Due, or other filtered view from scrambling hidden
records. Exact-cell and aggregate placements remain independent throughout.

## Ownership and deletion

Todo parent identity is immutable. Name, due date, and done may be edited. Deleting a Todo cascades
its placements and prunes empty ordering contexts. Deleting a Focus, Thread, or Commitment cascades
its Todos, lists, and placements. Shared Focus-owned Scopes and canonical Subjects survive an owner
delete.

A Scope or Subject referenced by a surviving scoped Todo cannot be hard-deleted. Membership rows
used by a Todo cannot be erased as unused setup; applicability may still be ended so the Todo becomes
former-context work without losing its identity.

## Boundary and future UI

The main process exposes `database.domain.todos` with create, find, list, update, reorder, and delete
operations. No renderer IPC or UI has been added yet. A future receiver should request one explicit
`TodoParent` context, render the returned order, and send the visible ordered id subset back for
reordering. It must not compute or persist its own global sort number.
