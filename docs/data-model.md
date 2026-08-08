# OnMove data model

The data layer is intentionally split into four pieces:

1. `SqliteAdapter` owns the connection, prepared execution, and nested transactions.
2. The migration runner evolves the durable schema one transaction at a time.
3. `BaseModel` and `BaseRepository` provide subclassable lifecycle and persistence helpers.
4. `DomainStore` exposes typed repositories to the Electron main process.

The renderer never receives a database connection. Its typed, sandboxed IPC API returns snapshots
made only from JSON-compatible values.

## Relationships and deletion behavior

```text
relations 1 ─────── 0..n items         ON DELETE SET NULL
                            │
                            └── 0..n child items             ON DELETE CASCADE

items     1 ─────── 0..n status_transitions                 ON DELETE CASCADE

focuses   1 ─────── 0..n focus_status_transitions           ON DELETE CASCADE

subjects  n ─────── n scopes (effective-dated membership)

focuses   1 ─────── 0..n scopes                             ON DELETE CASCADE
scopes    1 ─────── 0..n scope membership overlays          ON DELETE CASCADE

focus/thread/commitment ── exactly one Scope application

scoped Update ── exactly one Scope + Subject cell
```

- An item can have one parent and any number of children.
- Deleting a parent deletes its entire descendant subtree.
- An item can optionally reference a reusable relation definition.
- Deleting a relation preserves the item and changes its `relationId` to `null`.
- Repository reparenting rejects self-parenting and descendant cycles before writing.
- `meta` and status-event `meta` must be JSON objects. Their contents remain application-defined.

## Focuses

Focuses are top-level portfolio objects rather than hierarchy children. Their initial model is:

```ts
{
  kind: 'generic',
  title: string,
  description: string | null,
  goal: string,
  status: 'active' | 'paused' | 'cancelled' | 'done',
  lastReviewDate: string | null,
  needsReview: boolean
}
```

`goal` is durable rich-text-compatible content and defaults to an empty string for new and migrated
Focus records.

Titles are required but intentionally not unique. Status is materialized on the `focuses` row and
every actual change is appended by SQLite triggers to `focus_status_transitions`. Active and paused
records appear in sidebar navigation; paused records are visually muted. Cancelled and done records
remain durable and queryable but are omitted from navigation. `needsReview` is a durable inclusion
flag independent of status. `lastReviewDate` is derived from the newest effective Update directly
on the Focus; descendant Thread and Commitment Updates do not advance it.

`FocusModel` supplies update, status, history, refresh, and deletion helpers. The renderer reaches
these operations only through named IPC methods. Threads and Commitments use named list and create
and update methods; Updates use named list, create, edit, and delete methods. Repository dispatch and SQL
remain unavailable to the renderer.

The model beneath Focus—Subjects, Focus-owned Scopes, Threads, Commitments, dated Updates, health,
reviews, and cadence—is specified as a unified whole in
[`focus-thread-commitment-model.md`](focus-thread-commitment-model.md). The schema and repository work
introduced for Scope is summarized separately in
[`scope-data-model-addition.md`](scope-data-model-addition.md). Removal, deletion, and audit behavior
is specified in
[`scope-lifecycle-and-observability.md`](scope-lifecycle-and-observability.md).

## Subjects, Scopes, and exact Update cells

Subjects are global canonical records for anything managed or observed. A Scope is a named,
Focus-owned applicability expression resolving to Subjects on a given date. Membership intervals
are effective-dated, so changing populations does not rewrite historical meaning.

Focuses, Threads, and Commitments each have an explicit Scope application. `open` means no boundary;
Threads and Commitments may use `inherited`; `explicit` and `derived` select a Scope owned by the
same Focus. A bounded Thread or Commitment Update must store the exact effective Scope and Subject
cell. Direct Focus Updates remain aggregate and unscoped.

Scope is applicability, not tagging or current attention. Current exception sets can later be
derived from cell state without pretending that healthy Subjects have left the Scope.

Bounded Threads and Commitments both expose per-Subject matrix projections. Commitment cells own
state and update cadence. Thread cells own state and review cadence. A bounded Thread is due when any
effective Subject cell is due; its next date is the earliest cell deadline, and its aggregate last
review date represents complete current-Scope coverage rather than merely the newest observation.

Declared Scope applications have immutable transition history. Membership is ended with an
effective date rather than deleted once used, and structural changes to a used Scope require a new
Scope definition. Hard-deleting a Thread or Commitment erases that owner's evidence and audit rows
but leaves Focus-owned Scopes, memberships, and global Subjects intact.

## Status is state plus history

`items.current_status` is the fast, materialized value used for queries and UI snapshots.
`status_transitions` is the directional audit log. SQLite triggers append a transition whenever the
current value actually changes, including changes made below the repository layer. This preserves
the meaning of both `bad → good` and `good → bad`.

An `ItemSnapshot` contains a UI-ready projection:

```ts
status: {
  current: 'bad',
  previous: 'good',
  changedAt: '2026-08-07T03:00:00.000Z',
  transitionCount: 3,
  lastTransition: {
    from: 'good',
    to: 'bad',
    meta: { reason: 'regressed' }
  }
}
```

This avoids replaying the entire event stream during every render. When a timeline is needed,
`statusHistory()` or `window.onmove.domain.getItemStatusHistory(id)` returns the complete ordered
log. Transition rows cannot be updated or independently deleted; deleting an item removes its
history as part of the same cascade.

## Main-process model API

```ts
const blocks = database.domain.relations.create({
  name: 'blocks',
  meta: { color: 'indigo' }
})

const parent = database.domain.items.create({
  relationId: blocks.id,
  status: 'bad',
  statusMeta: { source: 'import' },
  meta: { title: 'Parent' }
})

const child = database.domain.items.create({
  parentId: parent.id,
  status: 'good',
  meta: { title: 'Child' }
})

parent.setStatus({ status: 'good', meta: { reason: 'reviewed' } })
const tree = parent.materialize() // includes child, resolved relation, and status summaries
const history = parent.statusHistory()
```

Models support `refresh()`, `delete()`, and `isDeleted`. `ItemModel` adds `moveTo`, `setRelation`,
`setStatus`, `updateMeta`, `statusHistory`, and `materialize`; `RelationModel` adds `rename`,
`updateMeta`, and `toSnapshot`.

To introduce another entity type, subclass `BaseModel` and `BaseRepository`, add its schema in a
new numbered migration, and expose only specific operations over IPC. Avoid generic renderer-driven
SQL or arbitrary model method dispatch; named IPC operations keep the sandbox boundary auditable.

## Migration rules

- Never edit a migration that may already exist in a user's database.
- Add the next integer version to `migrations.ts`.
- Each unapplied migration and its `schema_migrations` record are committed atomically.
- Startup refuses schemas newer than this version of the application rather than risking a
  downgrade write.
- Add an upgrade test starting from the previous schema and an invariant test for every new foreign
  key, trigger, or constraint.
