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

commitment(type=routine) 1 ── n immutable template versions
routine 1 ── n scheduled Review Runs ── n snapshotted inspections

updates DELETE ── archived_updates                         BEFORE DELETE rescue
```

- An item can have one parent and any number of children.
- Deleting a parent deletes its entire descendant subtree.
- An item can optionally reference a reusable relation definition.
- Deleting a relation preserves the item and changes its `relationId` to `null`.
- Repository reparenting rejects self-parenting and descendant cycles before writing.
- `meta` and status-event `meta` must be JSON objects. Their contents remain application-defined.
- An Update leaving the live graph is copied to the immutable-content, 30-day archive before SQLite
  completes the direct delete or ancestor cascade.

## Focuses

Focuses are top-level portfolio objects rather than hierarchy children. Their initial model is:

```ts
{
  kind: 'generic',
  title: string,
  description: string | null,
  status: 'active' | 'paused' | 'cancelled' | 'done',
  dueDate: string | null,
  lastReviewDate: string | null,
  needsReview: boolean
}
```

Titles are required but intentionally not unique. Status is materialized on the `focuses` row and
every actual change is appended by SQLite triggers to `focus_status_transitions`. Active and paused
records appear in sidebar navigation; paused records are visually muted. Cancelled and done records
remain durable and queryable but are omitted from navigation. `needsReview` is a durable inclusion
flag independent of status. `lastReviewDate` is the Focus's explicit `review_poked_on` date;
descendant Thread and Commitment Updates do not advance it.

Focus Overall is an overview boundary, not a synthetic Thread. It owns no Goal, Commitment,
Routine, Todo, Todo list, or direct Update. It retains status, due date, description, Focus Scope,
and Notes. `FocusOverviewRepository.timeline()` projects every child Thread—including done and
cancelled Threads—alongside direct Thread and descendant Commitment Updates. Updates remain owned by
their original records; the projection is read-only. The renderer lays this projection onto parallel
vertical Thread rails, with compact left-lane bubbles connected to each recorded-date point and full
rich text available only through the evidence popup. Rail intervals use the state established by
each chronological Update until a later Update changes it; this is a view projection and does not
persist a second state history. A scoped Thread rail contains one tightly spaced track per Subject;
each Update retains and targets its exact historical Scope/Subject cell. The snapshot includes the
Thread's current Subjects and unions in historically evidenced Subjects so later Scope removal does
not collapse or hide prior evidence. Unscoped history uses a distinct Thread-wide track. The
projection orders newest first and omits Updates whose
Commitment is done or cancelled; deletion already moves an Update into Update Archive, outside the
live projection.

Focuses, Threads, and Commitments each store an optional calendar due date. The hierarchy does not
enforce chronological containment: a child may be due after its direct parent. Main entity screens
surface that condition as an advisory warning so planning remains observable without clipping or
rejecting valid dates.

`DueRepository.getOverview()` is the named cross-hierarchy deadline projection. It returns only
Focuses, Threads, and Commitments whose own due date is non-null, including done and cancelled work,
and supplies each row's direct parent and full containing hierarchy. Rows are globally ordered by
due date before hierarchy and title. The renderer uses the returned materialization date to group
Overdue, Due today, and Upcoming, applies the global sensitive-content preference at the collection
boundary, and routes mutations back through the existing typed entity update operations so lifecycle
transition auditing remains unchanged. Clearing a due date removes the record from the next projection.

Focuses, Threads, and Commitments can be explicitly “poked” as reviewed without creating a
synthetic Update. Open aggregates store their monotonic latest `review_poked_on` calendar date;
bounded Threads and Commitments additionally store exact Scope/Subject pokes in dedicated tables.
The named `pokeReview` repository/model operations supply the local current date, validate that an
exact cell is currently effective, and do not let callers write derived snapshot fields. Temporal
projections ignore pokes after their requested projection date. A Commitment exposes
`lastReviewDate` separately from `lastUpdateDate`: poking it never changes state, cadence, or the
meaning of its latest observation. Every Commitment owns a positive `reviewFrequencyDays` interval
and a separate `needsReview` inclusion flag. These override its parent Thread for review scheduling:
an excluded or long-interval Thread does not suppress a child Commitment whose own schedule is due.
For bounded Commitments, `nextReviewDate` and `reviewDue` are calculated independently for every
effective Scope/Subject cell and aggregated using the earliest deadline and any-due semantics.

`FocusModel` supplies update, status, history, refresh, and deletion helpers. The renderer reaches
these operations only through named IPC methods. Threads and Commitments use named list and create
and update methods; Updates use named list, create, edit, and delete methods. Todos use named
contextual list, cross-context query, bounded overview, create, update, per-Subject completion,
reorder, and delete methods. Repository
dispatch and SQL remain unavailable to the renderer.

## Notes and durable rich-text documents

Every Focus, Thread, and Commitment snapshot contains an ordered `notes` array. A Note belongs to
exactly one of those parents, has a title, opaque rich-text content, independent sort key, revision,
and timestamps, and cascades with its parent. Migration 14 backfills and insert triggers create one
Note titled `Default` for every current aggregate. The database does not require an aggregate to
have a Note and does not cap the array at one, so later document organization can remove the default
or introduce multiple named documents without changing parent shape.

Focus description, Update observation, and Note content implement one addressable
`RichTextDocumentReference` contract. A changed value is committed synchronously on the main
process's single SQLite connection. SQLite triggers increment the field-specific revision and append
the complete committed value to `rich_text_history`; saving the identical value is a no-op. Parent
and Update deletion also removes the corresponding polymorphic history rows.

The active record remains the materialized value used by normal snapshots. Revision history is the
safety trail, not something the UI must replay. A commit returns its new materialized snapshot and
is broadcast to every renderer window, allowing the main workspace and any detached editor window
to converge on the same persisted revision without a renderer-owned cache or close-time flush.

## Archived Updates

`archived_updates` is the durable, temporary deletion boundary for observation evidence. It mirrors
every column on the live `updates` table, stores the original Update id as `update_id`, and adds a
unique archive id plus `deleted_at`. Its former parent, Scope, and Subject ids are deliberately
scalar values rather than foreign keys: the archived row must remain valid after those records
disappear. It also captures the former Focus, Thread, Commitment, and Subject labels plus effective
sensitivity so the archive remains understandable and respects privacy after an ancestor cascade.

The `updates_archive_before_delete` SQLite trigger is the only archive writer. Because it runs
`BEFORE DELETE ON updates`, it covers an explicit Update delete, Focus/Thread/Commitment foreign-key
cascades, importer repairs, and any future Scope or Subject cascade without requiring each caller to
remember an application service. Focus, Thread, Commitment, Scope, and Subject `BEFORE DELETE`
triggers first place context that SQLite is about to remove in `update_archive_context`; the generic
Update trigger consumes and clears that staging row. Archive content rejects updates.
`UpdateArchiveRepository` verifies at application startup that the rescue, context-preparation, and
retention triggers exist and that every live Update column has a corresponding archive column.
Adding a live field or rebuilding `updates` therefore fails closed until the archive schema and
triggers are advanced in the same migration.

Archive retention is a rolling 30 × 24-hour window based on `deleted_at`. Rows older than the cutoff
are deleted in SQLite on application startup, every archive read, portable export/import, and after
each new archive insert; expired rows never cross IPC. The named repository is the supported write
boundary for permanent deletion of one archive id and Clear all. These operations remove only the
rescued copy and never modify live Updates. The top-level Archive view renders retained observations
through the read-only rich-text receiver and requires confirmation before either destructive action.

Portable import keeps the archive trigger installed while other invariant triggers are temporarily
removed. Clearing replacement data consequently archives the outgoing live Updates in the same
transaction. Existing local archive rows are never cleared; archive rows from the imported file
merge by their stable random archive ids. A failed import rolls back both the replacement and any
archive writes. Imported archive rows past the retention cutoff are discarded in the import
transaction. Rolling SQLite backups include the currently retained window naturally.

### Inline text tags

User-authored strings may contain durable inline tags written as `@` plus a Unicode alphanumeric
identifier, such as `@Launch2`. The literal syntax remains the source of truth in compact columns
such as titles and Todo names. Within a rich-text envelope, the same literal text is represented by
a Lexical `tag` node so its visual identity survives save, reload, detached-window synchronization,
and read-only rendering. Legacy plain text and older rich-text nodes are recognized lazily by the
same parser; no destructive migration is required.

Tags intentionally remain a derived model rather than a relational registry. Identity is Unicode
lowercase (`@Launch` and `@launch` both resolve to `@launch`) without rewriting the stored text, and
there is no canonical tag row to synchronize.
`TagRepository` projects current Focus title/description, Thread and Commitment titles, Update
observation, Todo name, and Note title/content. Rich-text envelopes are reduced to plain text before
parsing. Repeated instances of the same canonical tag in one field produce one use, whose snippet is
centered on the first instance. One query returns canonical-name summaries and per-field counts; a
second returns compact field uses for one selected name, including the hierarchy ids needed to open
its containing screen.

This derived design makes edits, imports, moves, and cascade deletions observable immediately. It
also avoids stale backreferences because the stored text remains the only source of truth. Each use
contains a short plain-text snippet rather than its full field. The snapshot carries effective
hierarchy sensitivity as data, while the renderer remains responsible for applying the global hide
preference to tag and use collections. Hyphenated/underscored forms and email-like substrings remain
unrecognized.

The model beneath Focus—Subjects, Focus-owned Scopes, Threads, Thread-owned Commitments, dated
Updates and Todos,
health, reviews, and cadence—is specified as a unified whole in
[`focus-thread-commitment-model.md`](focus-thread-commitment-model.md). The schema and repository work
introduced for Scope is summarized separately in
[`scope-data-model-addition.md`](scope-data-model-addition.md). Removal, deletion, and audit behavior
is specified in
[`scope-lifecycle-and-observability.md`](scope-lifecycle-and-observability.md).
The executable reminder and contextual sorting contract is specified in
[`todo-model.md`](todo-model.md).
The internal SQLite recovery policy is specified in
[`rolling-backups.md`](rolling-backups.md).
Recurring attestation semantics are specified in
[`routine-attestations.md`](routine-attestations.md).

Commitments use an explicit behavior discriminator rather than encoding behavior in due-date
presence. The generic family currently contains `tracking` and `routine`. Migration 26's constrained
`commitment_type` remains compatibility storage for the original tracking implementation;
migration 27 adds canonical `behavior_type` without rebuilding the heavily referenced base table.
`CommitmentRepository` admits only tracking records, while `RoutineRepository` admits only Routine
records. A Routine therefore cannot leak into lifecycle-status, Update-cadence, or due-date contracts
owned by tracking Commitments. The former due-derived `action`/`ongoing` value remains private
`legacy_due_type` import compatibility data.

Routine definitions reuse the base Commitment's exclusive Focus-or-Thread ownership, title,
sensitivity, parent-transition history, and cascade boundary. Dedicated tables own their selected
Monday–Friday schedule, optional same-Focus Scope, immutable template versions, scheduled Review
Runs, snapshotted checklist items, per-Subject attestation cells, and legacy recorded issues. Migration 28
adds `needs_attestation` and independently completable cells: one cell per effective Subject at the
scheduled boundary, or one unscoped cell. Routine status has no writable lifecycle selector: it is
projected solely from full required-cell attestation against the anchored schedule. Full semantics
are in [`routine-attestations.md`](routine-attestations.md).
Migration 29 gives every cell item an optional rich-text evidence note. Migration 30 makes Subject
cell completion an explicit finalize operation: required resolutions must be complete first, and
finalization freezes the resolutions, attestation timestamps, and notes together.
Migration 31 replaces interval recurrence with `routine_schedule_weekdays`. Any subset of Monday
through Friday is valid, including none. Effective queue inclusion is the persisted
`needs_attestation` preference combined with a nonempty weekday schedule; an empty schedule creates
no Runs without erasing that preference. The earlier `cadence_days` and `anchor_on` fields remain
only for tolerant import of older archives.

Migration 33 establishes the breaking Focus-overview boundary. It clears retired Focus Goal
content, deletes former Focus-owned work through the normal cascade/archive path, and installs
SQLite guards against new Focus-owned Commitments, Routines, Updates, Todos, or Todo lists. Every
Update removed directly or through a retired parent is rescued by `updates_archive_before_delete`.
Portable import applies the same semantic cleanup to pre-v33 archives without disabling the central
archive or archive-context triggers.

## Subjects, Scopes, and exact Update cells

Subjects are global canonical records for anything managed or observed. A Scope is a named,
Focus-owned applicability expression resolving to Subjects on a given date. Membership intervals
are effective-dated, so changing populations does not rewrite historical meaning.

Focuses and Threads have editable Scope applications. `open` means no boundary; a Thread may use
`inherited`, while `explicit` and `derived` select a Scope owned by the same Focus. Commitment
application rows are enforced projections: every Commitment inherits its owning Thread's effective
Scope. A bounded Thread or Commitment Update must store the exact effective Scope and Subject cell.
A Thread whose effective Scope has zero Subjects is operationally Thread-wide and may
record a direct unscoped Update; Commitments retain the strict exact-cell rule.

Scope is applicability, not tagging or current attention. Current exception sets can later be
derived from cell state without pretending that healthy Subjects have left the Scope.

Bounded Threads and Commitments both expose per-Subject matrix projections. Commitment cells own
state, update cadence, and Commitment-specific review cadence. Thread cells own state and Thread
review cadence. A bounded Thread is due when any
effective Subject cell is due; its next date is the earliest cell deadline, and its aggregate last
review date starts with complete current-Scope coverage rather than merely the newest observation.
A later aggregate Thread poke can advance that displayed date, but does not fabricate a review for
any Subject cell or change the cell-derived due and next-review projections.

Declared Focus and Thread Scope applications have immutable transition history. Commitment rows
record their enforced initial mode but cannot be directly changed. Membership is ended with an
effective date rather than deleted once used, and structural changes to a used Scope require a new
Scope definition. Hard-deleting a Thread or Commitment erases that owner's evidence and audit rows
but leaves Focus-owned Scopes, memberships, and global Subjects intact.

Migration 16 adds same-Focus Commitment reparenting. A read-only plan identifies missing canonical
Subjects before any write; confirmed widening and the parent change commit atomically. Child
Updates, Todos, and Notes remain attached through the Commitment id and retain their exact cells and
sort placements. Immutable `commitment_parent_transitions` make Thread-to-Thread moves observable,
while SQLite synchronizes the Commitment's derived Scope application and rejects cross-Focus moves.

Migration 19 adds cross-Focus Thread moves. The Thread and its entire descendant tree retain their
record ids. An inherited/Open Thread follows the destination Focus and can transactionally widen it
after exact confirmation; a custom Thread copies its Scope expression into the destination Focus
without changing that Focus's own application. Because every Scope belongs to one Focus, retained
exact child evidence is remapped to recursively copied Scope definitions rather than being
misattributed to a merely equivalent destination Scope. A transient authorization row narrows the
normally immutable Todo and Todo-list Scope-id changes to this one transaction, and cannot be
removed until the Thread, application, Updates, Todos, and lists all reference destination-owned
Scopes. Immutable `thread_parent_transitions` audit both the initial owner and every actual move.

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

## Primary-navigation count projection

`NavigationRepository.getBadgeOverview()` materializes bounded, actionable counts rather than
returning records to the application shell. Todos includes only unfinished items due on or before
the local materialization date. Review reuses the canonical review queue, so successful pokes and
Updates remove acknowledged targets. Due includes active or paused Focuses, Threads, and
Commitments overdue or dated no later than seven calendar days after that date; done and cancelled
work never inflates the badge.

Each count contains `total` and `nonSensitive` partitions. Sensitivity cascades through the same
Focus → Thread → Commitment and Subject boundaries as list presentation. The repository does not
read the View-menu preference: the renderer selects a partition, preserving the rule that content
visibility is presentation state rather than a database filter.

## Portable data archives

The native File menu exports a versioned `onmove-data` JSON archive. It contains named raw fields
for durable domain tables, including rescued Updates, plus archive, schema, application, and
timestamp metadata. Runtime-only preferences and launch counters are not user data and are not
exported.

Import is a replacement operation, never a blind SQL restore. The importer intersects archived
fields with columns known to the running version, accepts snake_case and camelCase field names,
uses current defaults for absent older fields, and ignores unknown future fields and tables.
Malformed scalar values are normalized where doing so is unambiguous. Invalid records and orphaned
relationships are skipped, while required Scope applications, lifecycle baselines, and Default
Notes are repaired.

The entire replacement—including temporarily removing and restoring invariant triggers—runs in one
SQLite transaction followed by foreign-key and integrity checks. A fatal archive rolls back the
data, schema triggers, and repairs together, leaving the pre-import application state untouched.
After a successful import the app relaunches so every window reads one coherent database snapshot.

## Migration rules

- Never edit a migration that may already exist in a user's database.
- Add the next integer version to `migrations.ts`.
- Each unapplied migration and its `schema_migrations` record are committed atomically.
- Startup refuses schemas newer than this version of the application rather than risking a
  downgrade write.
- Add an upgrade test starting from the previous schema and an invariant test for every new foreign
  key, trigger, or constraint.

Migration 17 adds Todo `completed_at`, backfills already-done records from their last durable
timestamp, enforces agreement between `done` and completion time, and indexes the bounded global
overview query. The named overview projection applies its seven-day completion cutoff in SQL and
resolves hierarchy labels without exposing arbitrary queries to the renderer.

Migration 18 adds immutable shared Thread/Commitment Todos and `todo_subject_completions`. One
shared parent is projected into every current exact Subject list through independent sort
placements. Repository reconciliation follows the owner's current effective Subject population,
adds new unchecked cells, removes departed cells, and derives the parent completion timestamp.

Migration 19 adds guarded cross-Focus Thread moves and immutable Thread parent history. It replaces
the Todo and Todo-list context guards with equivalent rules that permit only Scope-id remapping
under an active, matching move authorization. Upgrade backfills one initial parent transition for
every existing Thread.

Migration 23 adds the append-only `archived_updates` table, its read indexes, immutability guards,
and the single `updates_archive_before_delete` rescue trigger. The migration copies no live rows
because archival begins only when a row leaves `updates`; upgrading is non-destructive and
immediately protects every existing Update.

Migration 24 bounds the Update archive to 30 days, removes the deletion prohibition while keeping
content immutable, captures former hierarchy labels and effective sensitivity, adds cascade-context
staging triggers, and adds automatic insert-time retention pruning. Existing archive rows remain
valid; labels unavailable before this migration remain nullable and use a stable UI fallback.
