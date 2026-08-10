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
| `subject` | Resolved canonical Subject snapshot for scoped Todos; otherwise `null`. |
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
available in their historical exact context and in the entity rollup, while creation into a former
cell is rejected.

Thread and Commitment creation follows the same boundedness rule as their working context. If the
owner's effective Scope currently has one or more Subjects, a new Todo must name one exact current
Scope/Subject cell; a direct entity-wide Todo is rejected by the repository as well as omitted from
the UI. If no Subjects are effective, direct unscoped creation is the fallback. Changing
applicability never rewrites or deletes already persisted Todos.

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

## Query and application boundaries

The main process exposes `database.domain.todos` with create, find, contextual list, cross-context
query, update, reorder, and delete operations. Named preload/IPC methods expose those same bounded
operations without exposing SQL. `query(options)` returns every matching Todo exactly once in a
deterministic due-date order; every snapshot still contains its contextual `sort` placements so a
future aggregate screen can choose an existing list projection without inventing a global sort.

Focus, Thread, and Commitment screens render Todos through a shared receiver-owned React list.
Focuses use their aggregate context. Thread and Commitment Subject tabs query and create in one
exact Scope/Subject context and never show orphaned work. All Subjects uses the aggregate ordering
context. While current Subjects exist, its creation selector contains only those Subjects and every
new Todo is cell-attributed; there is no simultaneous aggregate choice. With zero Subjects, the
ordinary form creates an unscoped fallback Todo.

The All Subjects presenter splits the aggregate snapshot by canonical Subject applicability. Current
Subject Todos remain in the primary list. A Todo for a removed Subject moves into the
closed-by-default `Orphaned Todos` accordion below the primary list. An old unscoped Todo is also
orphaned once the owner becomes bounded by Subjects, but remains current when no Subjects exist.
Reapplying the same canonical Subject moves its historical Todo back to the primary aggregate list
even if the new application uses a different Scope id; attribution and exact historical placement
remain immutable. The accordion is an aggregate-view projection, not a Todo lifecycle state.

The receiver owns both primary and orphaned accordion row rendering and drag behavior. It sends only
the ordered ids visible in the active list to the persistence model, whose filtered-subset reorder
preserves the slots of hidden current or orphaned siblings. Names, dates, completion, and deletion
use typed mutations. An incomplete Todo whose due date is before the current local date is visibly
labelled `Overdue` and uses the destructive color.
