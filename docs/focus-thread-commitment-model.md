# OnMove work-domain model

This document is the unified specification for the durable model beneath a Focus. It describes the
model as it exists now, including Subjects, Focus-owned Scopes, Threads, Commitments, Updates, Todos,
derived health, review cadence, lifecycle history, and deletion behavior. It is intentionally a
domain and persistence document; renderer layouts and future workflows are outside its contract.

The central idea is:

> A Focus defines a pursuit. Threads identify independently meaningful dimensions of that pursuit.
> Subjects identify the things being managed or observed. Scopes state where the pursuit or Thread
> applies. Updates record reality in an exact context, and Commitments state what is expected within
> their owning Thread's context.

## Core invariants

- A Focus is a generic pursuit or area of stewardship. It is not specialized as a people, project,
  service, or initiative Focus.
- A Subject is a canonical thing the application can manage or observe. Subject kind is data, not
  a branch in the domain model.
- A Scope belongs to exactly one Focus and resolves to a set of Subjects on a given date.
- Context, Scope, and attention are different concepts. Scope means applicability; it is not a tag
  or a list of exceptions.
- Focus and Thread applicability is explicit through a Scope application. The absence of a bounded
  Scope is represented by `open`, never by a missing row.
- Threads either inherit their Focus's effective Scope or use a custom Focus-owned Scope. A Focus
  cannot inherit. A Thread-owned Commitment always derives the Thread's current effective Scope;
  a Focus-owned Commitment is always unscoped.
- A bounded Thread or Commitment Update belongs to one exact Scope/Subject cell. The cell is required
  and is retained as historical attribution. A Thread with zero effective Subjects is operationally
  Thread-wide and may record direct unscoped evidence until Subjects become effective.
- A bounded Thread has one independently scheduled review cell per currently effective Subject.
  Reviewing one Subject never satisfies another Subject's review obligation.
- Direct Focus Updates remain aggregate observations and therefore have no Scope/Subject cell.
- Lifecycle status and observed state are distinct. Status is audited; state is derived from Updates.
- Health, review dates, cadence deadlines, and `needsUpdate`/`reviewDue` are projections and are not
  writable columns.

## Relationship map

```text
Subject (canonical, global)
   ▲                         Focus
   │                           │
   ├── Scope membership ── Scope[]
   │                         │  │
   │                         │  └── optional same-Focus, same-dimension base Scope
   │                         │
   │                         ├── Focus Scope application
   │                         ├── Thread Scope application
   │                         └── derived Commitment application row
   │
   └── exact cell attribution on scoped Updates

Focus
├── Threads[]
│   ├── Commitments[]
│   │   └── Updates[]
│   ├── Updates[]
│   └── Todos[] (aggregate or exact Scope/Subject cell)
├── Commitments[]
│   └── Updates[]
├── Updates[]
└── Todos[]
```

A Commitment has exactly one parent: a Focus or a Thread. An Update has exactly one parent: a
Focus, Thread, or Commitment. SQLite enforces both exclusive-parent rules.

## Canonical entities

### Focus

A Focus is a top-level pursuit: something the user wants to make true, keep true, understand, or
deliberately end.

| Field | Meaning |
| --- | --- |
| `kind` | Currently the single enum value `generic`. |
| `title` | Required name. Duplicate titles are allowed. |
| `description` | Optional rich-text-compatible notes. |
| `goal` | The desired condition, stored in the existing rich-text-compatible text field. |
| `status` | `active`, `paused`, `done`, or `cancelled`. |
| `statusChangedAt` | Timestamp of the materialized lifecycle status. |
| `lastReviewDate` | Later of the explicit Focus review poke or newest direct Focus Update, considering evidence on or before the projection date. |
| `needsReview` | Whether review workflows should include the Focus. Independent of status. |
| `sensitive` | Presentation classification; it does not change ownership or persistence. |
| `createdAt`, `updatedAt` | Durable timestamps. |

Focus completion is not blocked by active Threads or Commitments. Direct Focus Updates represent
aggregate Focus-level judgments; descendant Updates do not advance `lastReviewDate`. `pokeReview`
records the local current date as review evidence without creating an Update.

Every Focus owns zero or more named Scope definitions. Its Scope application may be `open`,
`explicit`, or `derived`. A Focus cannot use `inherited` because it has no parent in this model.

### Subject

A Subject is a reusable identity for anything being managed or observed: a person, project, team,
service, vendor, customer, or organizational unit. The model is uniform across Subject kinds.

| Field | Meaning |
| --- | --- |
| `kind` | Required non-empty discriminator such as `person`, `project`, or `service`; defaults to `generic`. |
| `name` | Required display name. |
| `description` | Optional notes. |
| `externalKey` | Optional globally unique integration identity. |
| `sensitive` | Presentation classification. |
| `createdAt`, `updatedAt` | Durable timestamps. |

Subjects are global rather than Focus-owned. A single Subject may participate in Scopes belonging
to many Focuses. Subject kind never changes the Scope or Update rules.

A Subject cannot be deleted while any Scope definition uses it as derived context, any membership
references it, or any scoped Update preserves it as historical attribution.

### Scope definition

A Scope is a Focus-owned, named applicability expression. It is not the application of that
expression to a particular object; that is represented separately by a Scope application.

| Field | Meaning |
| --- | --- |
| `focusId` | Owning Focus. A Scope cannot be applied outside this Focus tree. |
| `name` | Required human-readable name, such as “Direct reports.” |
| `dimension` | Required grouping vocabulary, such as `people`, `projects`, or `services`. |
| `sourceType` | `explicit` or `derived`. |
| `baseScopeId` | Optional base Scope used by the expression. |
| `derivedRelationship` | Required relationship descriptor for a derived Scope. |
| `contextSubjectId` | Required contextual Subject for a derived Scope. |
| `sensitive` | Presentation classification. |
| `createdAt`, `updatedAt` | Durable timestamps. |

An explicit Scope has no derived relationship or context Subject. A derived Scope requires both.
The relationship descriptor is durable model information—for example `members_of`—but the current
repository does not yet query an external relationship graph. Current resolved membership comes
from a same-dimension base Scope plus effective-dated membership overlays. This keeps the derived
definition intact for a later relationship resolver without inventing Subject-kind-specific logic.

A base Scope must:

- belong to the same Focus;
- have the same dimension;
- not be the Scope itself; and
- not introduce a base cycle.

A used Scope's structural meaning is immutable. Dimension, base Scope, derived relationship, and
context Subject cannot change after membership, applicability, a dependent Scope, or Update history
exists; create and apply a new Scope instead. Name and sensitivity remain editable. A Scope
referenced by Update or application history cannot be deleted.

### Scope membership

A membership is an effective-dated include or exclude overlay for one Subject in one Scope.

| Field | Meaning |
| --- | --- |
| `scopeId` | Scope being modified. |
| `subjectId` | Canonical Subject. |
| `effect` | `include` or `exclude`; defaults to `include`. |
| `effectiveFrom` | Inclusive `YYYY-MM-DD` boundary. Defaults to the local current date. |
| `effectiveUntil` | Optional exclusive `YYYY-MM-DD` boundary. |
| `createdAt` | Durable insertion timestamp. |

Intervals are half-open: `[effectiveFrom, effectiveUntil)`. The same Scope/Subject/effect cannot
have overlapping intervals. Include and exclude records may overlap because they express different
parts of the Scope equation; exclusion wins while both are effective.

For a date `D`, effective membership is:

```text
members(base Scope at D)
+ effective includes at D
- effective excludes at D
```

Membership history is not rewritten when a Subject leaves a Scope. The current interval is ended
and a later interval may begin. An interval edit is applied transactionally and rejected if the
resulting full Scope expression would make any retained exact-cell Update invalid on its recorded
date, or if it overlaps another interval with the same effect. Membership deletion is reserved for
unused setup mistakes; after Update or application history exists, end the interval instead.

### Scope application

A Scope application states how a Focus or Thread obtains applicability. The database also keeps one
Commitment application row as an enforced projection so existing resolution, history, and exact-cell
queries have one consistent representation; callers cannot mutate that row.

| Mode | Declared Scope | Effective behavior |
| --- | --- | --- |
| `open` | none | No applicability boundary; Updates on the owner are aggregate/unscoped. |
| `inherited` | none | Resolves the current effective Scope of the direct parent. Editable for Threads; mandatory for Thread-owned Commitments. |
| `explicit` | required | Uses a Focus-owned explicit Scope definition. |
| `derived` | required | Uses a Focus-owned derived Scope definition. |

The model exposes both `declaredScopeId` and `effectiveScopeId`. An inherited application has no
declared id, while its effective id is resolved dynamically through its parent. It also identifies
the immediate `inheritedFrom` owner.

Every initial declaration and actual change is appended to immutable Scope-application transition
history. Reassigning the same declaration is a no-op. Inherited descendants do not receive synthetic
transitions when an ancestor changes; their declared choice remains `inherited`, and the effective
change is explained by the changing ancestor's history.

Inheritance is a live relationship. If a parent changes from a bounded Scope to Open, an inheriting
child becomes effectively Open. If the parent selects another Scope, the child follows it. This does
not mutate the child's application row or silently mutate the parent.

When a new Thread is created, it may inherit its Focus or declare a valid custom application. When a
Commitment is created, creation order is deliberately irrelevant: a Thread-owned Commitment is
always stored as `inherited`, even while the Thread is Open, so a later Thread Scope immediately
materializes on every existing Commitment. A Focus-owned Commitment is always stored as `open`.
`CreateCommitmentInput` has no Scope field, and both repository validation and SQLite triggers reject
direct Commitment application changes.

A Thread may select a custom Scope that extends or narrows its Focus population, or uses a different
dimension. This never expands the Focus application. All selected Scopes still belong to the same
Focus, which prevents cross-Focus leakage.

### Thread

A Thread is an independently meaningful dimension by which its Focus is judged.

| Field | Meaning |
| --- | --- |
| `focusId` | Required parent Focus. |
| `title` | Required dimension name. Duplicate titles are allowed. |
| `health` | Derived `red`, `yellow`, `green`, or `none`. |
| `status` | `active`, `paused`, `done`, or `cancelled`, with transition history. |
| `reviewFrequencyDays` | Required positive whole-number review interval. |
| `lastReviewDate` | Later of the explicit Thread poke and its applicable direct-Update review projection. |
| `nextReviewDate` | Open or zero-Subject: aggregate deadline. Bounded with Subjects: earliest Subject-cell deadline. |
| `needsReview` | Review-workflow inclusion independent of status. |
| `reviewDue` | Derived from status, inclusion, cadence, and projection date. |
| `sensitive` | Presentation classification. |
| `createdAt`, `updatedAt` | Durable timestamps. |

Selecting or opening a Thread never counts as reviewing it. A direct Thread Update supplies
observational review evidence; `pokeReview` is the explicit no-observation acknowledgement.
Commitment Updates do not advance the Thread review date.

For an Open Thread—or one whose effective Scope has no Subjects—the latest direct unscoped Update
supplies its direct state and review date. Otherwise `scopeMatrix(asOf)` returns one independent
review projection per currently effective Subject:

```ts
{
  scopeId,
  subjectId,
  subject,
  state,
  lastReviewDate,
  nextReviewDate,
  reviewDue
}
```

Each cell uses only direct Thread Updates attributed to that exact Scope/Subject pair. A Subject
without an effective Update contributes `none`, has `lastReviewDate: null`, and uses the Thread's
creation date as its initial review-cadence baseline. Future-dated Thread Updates do not affect a
cell before their recorded date.

The bounded Thread snapshot rolls up its review cells:

- `reviewDue` is true when any cell is due;
- `nextReviewDate` is the earliest cell deadline;
- its Update-derived review date is a coverage watermark: the oldest latest-review date across the
  effective cells, or `null` if any cell has never been reviewed;
- `lastReviewDate` is the later of that watermark and the aggregate Thread poke; and
- a bounded Scope with no effective Subjects has no due cell and therefore is not review-due.

The aggregate poke does not alter `scopeMatrix`: it neither creates Subject-cell evidence nor clears
cell `reviewDue` flags. This keeps the two-review obligation for a two-Subject Scope observable even
when someone acknowledges the Thread as a whole.

This means a Scope containing Alex and Jamie creates two review obligations. Reviewing Alex advances
only Alex's cell; the Thread remains due until Jamie is also reviewed. Effective-dated additions and
removals add and remove current matrix cells without rewriting their retained Update history.

Thread health combines its direct state values with the current derived state of every active child
Commitment. Paused, done, and cancelled Commitments do not participate.

### Commitment

A Commitment records an expectation, promise, continuing standard, or bounded action. It is not a
todo and does not block its parent from closing.

| Field | Meaning |
| --- | --- |
| `parent` | Exactly one Focus or Thread. |
| `type` | `ongoing` or `action`. |
| `title` | Required statement of what is expected. |
| `status` | `active`, `paused`, `done`, or `cancelled`, with transition history. |
| `dueDate` | Optional due date. |
| `cadenceDays` | Optional positive whole-number interval between required Updates. |
| `state` | Derived observed state. |
| `lastReviewDate` | Later of the latest direct Update date and explicit Commitment review poke. |
| `lastUpdateDate` | Derived latest relevant recorded date. |
| `nextUpdateDate` | Derived cadence boundary. |
| `needsUpdate` | Derived active/cadence condition. |
| `sensitive` | Presentation classification. |
| `createdAt`, `updatedAt` | Durable timestamps. |

For an Open Commitment, state and cadence use the newest unscoped Update. For a bounded Commitment,
`scopeMatrix(asOf)` returns one projection per currently effective Subject:

```ts
{
  scopeId,
  subjectId,
  subject,
  state,
  lastUpdateDate,
  nextUpdateDate,
  needsUpdate
}
```

The aggregate Commitment snapshot is derived from those cells:

- `state` is the severity aggregation of cell states;
- `lastUpdateDate` is the newest cell date;
- `nextUpdateDate` is the earliest cell deadline; and
- `needsUpdate` is true when any cell needs an Update.

`pokeReview` advances only `lastReviewDate`. It does not change `lastUpdateDate`, state,
`nextUpdateDate`, or `needsUpdate`, so a review acknowledgement cannot masquerade as new evidence or
defer an Update cadence.

A bounded Commitment therefore has independent evidence and cadence per Subject rather than one
shared Update stream. Empty cells contribute `none` and use the Commitment creation date as their
initial cadence baseline.

The current Commitment record can act as a scoped repeated expectation, but the model does not yet
split a Commitment series from generated one-to-one occurrences. Promisor, beneficiary, recurrence
triggers, acceptance criteria, and occurrence records are also future extensions.

### Update

An Update is a dated observation: the durable mechanism by which evidence and judgment enter the
model.

| Field | Meaning |
| --- | --- |
| `parent` | Exactly one Focus, Thread, or Commitment. Immutable after creation. |
| `date` | `YYYY-MM-DD`, defaulting to the local current date; past and future dates are valid. |
| `observation` | Optional rich-text-compatible text. Blank and state-only Updates are valid. |
| `state` | `red`, `yellow`, `green`, or `none`; defaults to `none`. |
| `sensitive` | Presentation classification. |
| `scope` | Exact `{scopeId, subjectId}` attribution for bounded cells; `null` for Focus, Open-parent, and zero-Subject Thread-wide evidence. |
| `createdAt` | Durable insertion timestamp and same-day tie breaker. |

Creation validation uses the parent's current effective application and tests membership on the
Update date:

- a direct Focus Update must be unscoped;
- an Open Thread or Commitment Update must be unscoped;
- a bounded Thread or Commitment Update must provide both Scope and Subject ids, except a direct
  Thread Update recorded when its effective Scope has zero Subjects is unscoped;
- the supplied Scope must equal the parent's effective Scope;
- the Subject must be an effective member of that Scope on the Update date; and
- the Scope must belong to the parent object's Focus.

Changing an Update date revalidates its stored Scope/Subject membership for the new date. The Update
cannot be moved to another parent or cell through edit; create a new Update if attribution changes.

The exact cell is stored on the Update. Later application changes, parent inheritance changes, or
membership changes do not erase or relabel historical evidence. Scope and Subject deletion is
blocked while that evidence exists.

Update ordering is by recorded date and then id. Commitment projections intentionally accept a
future-dated Update as the latest evidence immediately, preserving the existing deferral behavior.
Focus and Thread review projections are evaluated as of a supplied date and ignore observations
after that projection date.

### Todo

A Todo is an executable reminder, not evidence and not a Commitment. It has a required name, one
immutable parent context, an optional due date, a boolean `done`, and independent sort placements.
It may belong to a Focus, Thread, Commitment, Thread Scope/Subject cell, or Commitment Scope/Subject
cell. A scoped Todo is returned both in its exact-cell list and its entity aggregate list.

`completedAt` is durable transition evidence rather than an alias for `updatedAt`. Completing an
open Todo records the completion instant, edits while done preserve it, reopening clears it, and a
later completion records a new instant. The global Todo overview resolves each row's Focus, optional
Thread, optional Commitment, and Subject, and asks SQLite for every open Todo plus only those closed
within the last seven days. Older completed work is absent from the snapshot rather than hidden by
the renderer.

Sort is modeled as a relation rather than a scalar column because those two lists may have different
orders. Reordering a filtered subset only rearranges the supplied Todos among their existing slots,
so hidden done/not-due records remain stable. The complete contract is documented in
[`todo-model.md`](todo-model.md).

## State, health, status, and attention

These terms are deliberately not interchangeable:

- **Status** is lifecycle: `active`, `paused`, `done`, or `cancelled`. It is persisted and audited.
- **State** is an observed R/Y/G/none value derived from Updates.
- **Health** is an aggregate state projection over multiple evidence sources.
- **Scope** is the complete set to which something applies.
- **Attention** is the subset of effective Subjects that currently require intervention.

Attention is not currently a persisted relation. It can later be derived from cell state, staleness,
and other exception rules. A ten-person Scope with two red Subjects remains a ten-person Scope; the
two red Subjects are an attention set, not a narrowed Scope.

Current health aggregation uses this severity rule:

```text
any red             -> red
otherwise yellow    -> yellow
otherwise any none  -> none
otherwise all green -> green
empty input         -> none
```

## Lifecycle audit

Focus, Thread, and Commitment status is materialized on the entity row for efficient reads. SQLite
triggers append an immutable transition whenever the stored status actually changes. Both
`green -> red` evidence changes and `active -> paused` lifecycle changes retain their direction and
semantic meaning, but they live in different mechanisms: Updates for evidence, transition tables
for lifecycle.

Assigning the same lifecycle status again does not append a duplicate transition. Deleting the
entity cascades its transition history.

## Review and cadence calculations

- Focus review uses its direct Focus Updates plus its latest explicit poke.
- Open and zero-Subject Thread review uses its direct unscoped Update stream plus its latest explicit
  poke; the resulting latest date supplies the aggregate deadline.
- Bounded Thread review is based on one independently scheduled direct-Update cell per effective
  Subject. Its aggregate due flag uses any due cell, its next date uses the earliest deadline, and
  its Update-derived last-review date is the all-current-Subjects coverage watermark. A later
  aggregate poke advances only the aggregate last-review date, not any Subject obligation.
- `needsReview = false` excludes a Focus or Thread from due-review workflows without pausing it.
- A Thread review cell is due only when the Thread is active, included in review, and that cell's
  next review date is on or before the projection date.
- Commitment cadence is per Scope/Subject cell when bounded and one stream when Open.
- Commitment review uses the later Update date or explicit poke, independently of cadence.
- A Commitment needs an Update only when active and at least one applicable cadence deadline is due.
- Review and cadence values are recomputed from durable records whenever a snapshot is materialized.

## Commitment parent moves

A Commitment can move among Overall and Threads within one Focus through a two-step plan/move API.
The plan compares canonical Subject coverage, reports attached Update/Todo/Note counts, and lists any
Subjects the destination would need to add. Exact and superset destinations move immediately;
missing Subjects require confirmation of the exact planned ids. Confirmed Thread widening creates
an isolated overlay, while confirmed Overall widening adds the missing Subjects to the Focus Scope.

Updates, Todos, and Notes remain owned by the same Commitment id, so their identities, contents,
sort placements, and exact historical Scope cells survive without copying. The Commitment's derived
application synchronizes to `inherited` under a Thread or `open` under Overall. Immutable
`commitment_parent_transitions` record the initial parent and each actual move. SQLite rejects a
cross-Focus reparent even below the repository boundary.

## Thread Focus moves

A Thread moves between Focuses through a separate two-step plan/move API. Overall is not an entity
and cannot move. The planner reports the source and target Focus, applicability strategy, canonical
Subjects that would be added, and counts of descendant Commitments, Updates, Todos, and Notes. A
delayed confirmation carries the planned source Focus id, so another completed move makes it stale
instead of accidentally moving from an unexpected owner.

For an Open or inherited Thread, the destination Focus becomes the new inheritance source. If its
effective Scope is an exact match or superset, the move needs no confirmation. Otherwise the user
must confirm the exact missing Subject ids, and widening the destination Focus and moving the
Thread occur in one transaction. For a custom Thread, its full base/include/exclude Scope graph and
membership intervals are copied under the destination Focus and applied there; this never widens
the destination Focus's own applicability.

Commitments remain children of the same Thread id, and all descendant records retain identity and
content. Scopes, however, are Focus-owned. Every old Scope referenced by direct or Commitment-owned
Updates, Todos, or Todo lists is recursively copied to the destination and those exact records are
remapped to the corresponding copy. Canonical Subject ids remain unchanged. This preserves what
the evidence meant without pretending an unrelated destination Scope was its source. Shared Todo
Subject completion and aggregate/exact sort projections are reconciled after remapping.

SQLite accepts the otherwise-forbidden Thread owner and Todo Scope-id changes only while a matching
transient move authorization exists. That authorization cannot finish while any application or
owned evidence still refers to a Scope from another Focus, so any failure rolls the entire move
back. `thread_parent_transitions` records the initial Focus and every completed move. Deleting the
old Focus after a move leaves the Thread intact; deleting its new owning Focus performs the normal
full cascade.

## Deletion and historical integrity

- Deleting a Focus cascades its Threads, Focus- and Thread-owned Commitments, Updates, status
  histories, Scope definitions, memberships, and Scope applications.
- Deleting a Thread cascades its direct Updates, Commitments, their Updates, histories, and Scope
  applications. It does not delete Focus-owned Commitments.
- Deleting a Commitment cascades its Updates, status history, and Scope application.
- Thread and Commitment deletion also cascades their Scope-application transition history. It does
  not delete shared Focus-owned Scopes, memberships, or Subjects.
- Deleting an Update immediately changes every derived value that depended on it.
- Subjects are global and survive Focus deletion unless explicitly deleted later.
- Scope, Subject, and membership operations reject changes that would invalidate retained scoped
  Update history.
- An individually deleted Scope must be unused: Update or application history protects it. Deleting
  a Focus remains the explicit cascade that removes its entire Scope domain.
- Foreign keys and key ownership invariants are also enforced in SQLite so direct database writes
  cannot bypass the essential Focus boundary or partial-cell constraints.

The application exposes these hard deletes as confirmed destructive actions in each entity's
context drawer. Thread and Commitment deletion use named IPC operations rather than generic model
dispatch. The renderer removes successful deletions from its local projections immediately, moves
an active deleted route to its surviving parent, and invalidates a deleted pinned inspector without
changing an unrelated active route. A false or failed deletion preserves the route, pin, and drawer
contents.

## Model API boundary

The main process accesses these repositories through `database.domain`:

```ts
database.domain.subjects
database.domain.scopes
database.domain.scopeMemberships
database.domain.scopeApplications
database.domain.focusScopes
database.domain.threadScopes
database.domain.focuses
database.domain.threads
database.domain.commitments
database.domain.updates
database.domain.todos
```

Models expose ordinary update/delete/refresh behavior plus domain helpers such as
`scopeApplication()`, `setScope()`, `effectiveSubjects()`, and the Thread and Commitment
`scopeMatrix()` projections. Only Focus and Thread models expose `setScope()`; Commitment Scope is
read-only and derived. Focus, Thread, and Commitment models expose
`scopeApplicationHistory()`, while `scopeApplications.history(owner)` provides the generic audit
surface. Repository methods return JSON-compatible snapshots; they never return SQLite handles.
The Todo repository owns its contextual list and filtered-subset reorder operations; Todo sort
placements are never inferred in renderer code.

The Focus and Thread Scope aggregate repositories expose current applications and effective Subjects
without leaking lower-level Scope rows to the renderer. Thread customization creates a new
Focus-owned overlay instead of mutating the Focus Scope. Commitments have no Scope aggregate or
mutation surface; their working-context projection resolves the owning Thread application live.

Removal, deletion, and every supported observation surface are specified in
[`scope-lifecycle-and-observability.md`](scope-lifecycle-and-observability.md).

The renderer reaches the Focus and Thread aggregates only through named, typed IPC methods. The
Thread drawer offers only inheritance and custom Scope definition. Commitment screens consume a
named read-only working-context projection and never expose application controls. No generic
repository dispatch or SQL crosses the preload boundary.

## End-to-end example

The following creates one generic Focus whose career-development pursuit applies to two people. The
Thread and Commitment inherit the same population, and each Update records the exact Subject cell.

```ts
const focus = database.domain.focuses.create({
  title: 'Maintain meaningful career development across my team',
  goal: 'Every report has a current direction and a credible next step.'
})

const alex = database.domain.subjects.create({ kind: 'person', name: 'Alex' })
const jamie = database.domain.subjects.create({ kind: 'person', name: 'Jamie' })

const reports = database.domain.scopes.create({
  focusId: focus.id,
  name: 'Direct reports',
  dimension: 'people'
})

for (const subject of [alex, jamie]) {
  database.domain.scopeMemberships.create({
    scopeId: reports.id,
    subjectId: subject.id,
    effectiveFrom: '2026-08-01'
  })
}

focus.setScope({ mode: 'explicit', scopeId: reports.id })

const direction = database.domain.threads.create({
  focusId: focus.id,
  title: 'Career direction is current',
  reviewFrequencyDays: 30
}) // defaults to inherited

const conversations = database.domain.commitments.create({
  parent: { type: 'thread', id: direction.id },
  type: 'ongoing',
  title: 'Hold a substantive career conversation',
  cadenceDays: 30
}) // also defaults to inherited

database.domain.updates.create({
  parent: { type: 'commitment', id: conversations.id },
  date: '2026-08-07',
  observation: 'Alex has a concrete staff-level growth plan.',
  state: 'green',
  scope: { scopeId: reports.id, subjectId: alex.id }
})

database.domain.updates.create({
  parent: { type: 'commitment', id: conversations.id },
  date: '2026-08-07',
  observation: 'Jamie is still uncertain about the next role direction.',
  state: 'yellow',
  scope: { scopeId: reports.id, subjectId: jamie.id }
})
```

`conversations.scopeMatrix('2026-08-08')` now returns one independently materialized cell for Alex
and one for Jamie. The aggregate Commitment state is yellow, but both people remain in Scope. Jamie
is a likely member of a future attention projection; the Scope is not narrowed to Jamie.

## Deliberate future boundaries

The current model establishes the persistence boundaries needed for later work, but it does not yet
implement:

- automatic resolution of `derivedRelationship` from an external Subject relationship graph;
- a distinct Commitment-series record and generated Commitment occurrences;
- promisor, beneficiary, recurrence-trigger, and acceptance-basis fields;
- persisted or derived attention-set APIs;
- per-Subject Thread assessment records beyond scoped Updates;
- health trend and confidence projections;
- Moves, Agenda, or Review-session records;
- Scope Board, exception filtering, Commitment applicability, or matrix-review UI; or
- generic renderer IPC for arbitrary Subject, Scope, membership, application, or matrix management.

Those features can build on the exact historical cell, effective membership, and explicit
applicability contracts without changing the meaning of existing records.
