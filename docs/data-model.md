# OnMove data model

The data layer is intentionally split into four pieces:

1. `SqliteAdapter` owns the connection, prepared execution, and nested transactions.
2. The migration runner evolves the durable schema one transaction at a time.
3. `BaseModel` and `BaseRepository` provide subclassable lifecycle and persistence helpers.
4. `DomainStore` exposes typed `items` and `relations` repositories to the Electron main process.

The renderer never receives a database connection. Its typed, sandboxed IPC API returns snapshots
made only from JSON-compatible values.

## Relationships and deletion behavior

```text
relations 1 ─────── 0..n items         ON DELETE SET NULL
                            │
                            └── 0..n child items             ON DELETE CASCADE

items     1 ─────── 0..n status_transitions                 ON DELETE CASCADE
```

- An item can have one parent and any number of children.
- Deleting a parent deletes its entire descendant subtree.
- An item can optionally reference a reusable relation definition.
- Deleting a relation preserves the item and changes its `relationId` to `null`.
- Repository reparenting rejects self-parenting and descendant cycles before writing.
- `meta` and status-event `meta` must be JSON objects. Their contents remain application-defined.

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
