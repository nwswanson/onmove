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
| `sharedAcrossSubjects` | Immutable flag for one aggregate Todo whose completion is tracked once per current Subject. |
| `subjectCompletions` | Current Subject cells for a shared Todo, each with its own `done`, `completedAt`, and timestamps. Empty for an individual Todo. |
| `dueDate` | Optional real `YYYY-MM-DD` calendar date. |
| `done` | Required boolean, defaulting to `false`. For a shared Todo it is derived: every current Subject cell is done. |
| `completedAt` | Completion instant while done; `null` while open. Shared completion records when the last current cell became done or was removed. |
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

Focus Todos are aggregate only. A bounded Thread or Commitment supports two distinct creation
semantics:

- an individual Todo uses the exact current Scope/Subject cell, just like scoped evidence; or
- an `All subjects` Todo is one shared aggregate record with one durable completion cell for every
  currently effective canonical Subject.

An individual scoped Todo preserves its original cell when applicability later changes. It remains
available as former-context work and cannot be created into a cell that is no longer current. A
shared Todo instead follows current applicability: reconciliation adds a fresh unchecked cell and
an exact-list placement for a newly effective Subject, and removes both when that Subject stops
being effective. Removing an unchecked cell can therefore complete the parent; adding a Subject to
a completed parent reopens it. Reapplying a removed Subject starts with a fresh unchecked cell.

If a Thread or Commitment has no effective Subjects, direct unscoped creation remains the fallback.
A shared Todo requires at least one current Subject, an aggregate Thread/Commitment parent, and an
initially open state. Sharing mode and parent identity are immutable.

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

An ordinary aggregate Todo receives one placement. An individual scoped Todo receives two
placements atomically: its entity-wide rollup and its exact cell. A shared Todo receives its
aggregate placement plus one independent exact-cell placement per current Subject; reconciliation
adds and removes those exact placements with completion cells. `TodoSnapshot.sort` exposes all as
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

Todo parent identity and sharing mode are immutable. Name and due date may be edited. An individual
Todo's `done` bit may be edited directly; a shared parent's `done` bit cannot. Only its current
Subject completion cells can be toggled, and the repository atomically recomputes parent completion.
Deleting a Todo cascades its Subject cells and placements and prunes empty ordering contexts.
Deleting a Focus, Thread, or Commitment cascades its Todos, cells, lists, and placements. Shared
Focus-owned Scopes and canonical Subjects survive an owner delete.

A Scope or Subject referenced by a surviving individual scoped Todo cannot be hard-deleted.
Membership rows used by that Todo cannot be erased as unused setup; applicability may still be
ended so the Todo becomes former-context work without losing its identity. Shared Todo completion
cells refer only to the current canonical Subject population and are removed by normal applicability
reconciliation.

Completion is a small audited state projection. Creating or transitioning an individual Todo to
done records `completedAt`; later name/due-date edits retain that instant. Reopening clears it, and
completing again records the new instant. Shared Subject cells use the same timestamp invariant and
drive the aggregate timestamps. Migration 17 backfills pre-existing done records; migration 18 adds
shared cells and sharing/placement invariants. SQLite triggers reject mismatched completion state.

## Query and application boundaries

The main process exposes `database.domain.todos` with create, find, contextual list, cross-context
query, global overview, update, Subject-completion, reorder, and delete operations. Named preload/IPC
methods expose those same bounded operations without exposing SQL. `query(options)` returns every matching Todo exactly once in a
deterministic due-date order; every snapshot still contains its contextual `sort` placements so a
future aggregate screen can choose an existing list projection without inventing a global sort.

`overview(now)` is the dedicated aggregate-screen projection. Its SQL predicate returns every open
Todo plus only done Todos whose completion is within the last seven 24-hour periods. A Todo closed
ten days ago is therefore never materialized, cloned through IPC, or filtered in React. Each
returned row resolves its Focus, optional owning Thread, optional Commitment, and canonical Subject
so the renderer can sort and label the hierarchy without follow-up queries. The table hides the
recently completed subset by default and exposes an explicit view option to show it.

The overview keeps Project independently sortable and projects Thread/Commitment/Subject into one
linked Context path. Activating that link sends a data-only workspace destination to the
application navigator. The Focus workspace owns translating it into the primary Focus selection,
top-level contextual-sidebar item, optional nested Commitment route, and exact Subject tab; the
table does not coordinate those UI elements itself.

Focus, Thread, and Commitment screens render Todos through a shared receiver-owned React list.
Focuses use their aggregate context. Thread and Commitment Subject tabs query and create in one
exact Scope/Subject context and never show orphaned work. All Subjects uses the aggregate ordering
context. While current Subjects exist, its creation selector offers `All subjects` first plus each
individual Subject. The first creates one shared Todo; an individual option creates the existing
exact-cell kind. With zero Subjects, the ordinary form creates an unscoped fallback Todo.

The All Subjects row for a shared Todo owns editing, deletion, and drag ordering, but deliberately
has no parent completion checkbox. Its closed-by-default progress disclosure renders plain,
non-draggable Subject rows whose checkboxes mutate the completion cells. An exact Subject tab shows
the same shared Todo in that Subject's ordering context; it can toggle only that Subject's checkbox
and cannot edit or delete the shared parent. The global Todos/review projection returns the parent
once and offers the same expandable Subject progress behavior. The parent closes only when every
current cell is checked.

The All Subjects presenter splits individual aggregate snapshots by canonical Subject
applicability. Current individual Subject Todos and every shared parent remain in the primary list.
An individual Todo for a removed Subject moves into the
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
