# OnMove work-domain model

This document is the unified specification for the durable model beneath a Focus. It describes the
model as it exists now, including Subjects, Focus-owned Scopes, Threads, Commitments, Updates,
derived health, review cadence, lifecycle history, and deletion behavior. It is intentionally a
domain and persistence document; renderer layouts and future workflows are outside its contract.

The central idea is:

> A Focus defines a pursuit. Threads identify independently meaningful dimensions of that pursuit.
> Subjects identify the things being managed or observed. Scopes state where the pursuit, Thread,
> or Commitment applies. Updates record reality in an exact context, and Commitments state what is
> expected.

## Core invariants

- A Focus is a generic pursuit or area of stewardship. It is not specialized as a people, project,
  service, or initiative Focus.
- A Subject is a canonical thing the application can manage or observe. Subject kind is data, not
  a branch in the domain model.
- A Scope belongs to exactly one Focus and resolves to a set of Subjects on a given date.
- Context, Scope, and attention are different concepts. Scope means applicability; it is not a tag
  or a list of exceptions.
- Focus, Thread, and Commitment applicability is always explicit through a Scope application. The
  absence of a bounded Scope is represented by `open`, never by a missing row.
- Threads and Commitments may inherit their parent's effective Scope, select another Scope owned by
  the same Focus, or remain Open. A Focus cannot inherit.
- A bounded Thread or Commitment Update belongs to one exact Scope/Subject cell. The cell is required
  and is retained as historical attribution.
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
   │                         └── Commitment Scope application
   │
   └── exact cell attribution on scoped Updates

Focus
├── Threads[]
│   ├── Commitments[]
│   │   └── Updates[]
│   └── Updates[]
├── Commitments[]
│   └── Updates[]
└── Updates[]
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
| `lastReviewDate` | Newest direct Focus Update on or before the projection date. |
| `needsReview` | Whether review workflows should include the Focus. Independent of status. |
| `sensitive` | Presentation classification; it does not change ownership or persistence. |
| `createdAt`, `updatedAt` | Durable timestamps. |

Focus completion is not blocked by active Threads or Commitments. Direct Focus Updates represent
aggregate Focus-level judgments; descendant Updates do not advance `lastReviewDate`.

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

A Scope cannot change dimension while another Scope uses it as a base. A Scope referenced by Update
history cannot be deleted. Deleting an unused Scope resets any surviving application that selected
it to an `open` application.

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
and a later interval may begin. Ending a membership is rejected if it would place an already stored
Update from that exact Scope/Subject cell outside the interval. Deleting a membership is likewise
rejected while that exact cell has Update history.

### Scope application

A Scope application states how a particular Focus, Thread, or Commitment obtains applicability. It
has a separate row for every owner, including Open owners.

| Mode | Declared Scope | Effective behavior |
| --- | --- | --- |
| `open` | none | No applicability boundary; Updates on the owner are aggregate/unscoped. |
| `inherited` | none | Resolves the current effective Scope of the direct parent. Threads and Commitments only. |
| `explicit` | required | Uses a Focus-owned explicit Scope definition. |
| `derived` | required | Uses a Focus-owned derived Scope definition. |

The model exposes both `declaredScopeId` and `effectiveScopeId`. An inherited application has no
declared id, while its effective id is resolved dynamically through its parent. It also identifies
the immediate `inheritedFrom` owner.

Inheritance is a live relationship. If a parent changes from a bounded Scope to Open, an inheriting
child becomes effectively Open. If the parent selects another Scope, the child follows it. This does
not mutate the child's application row or silently mutate the parent.

When a new Thread or Commitment is created:

- it defaults to `inherited` if its direct parent currently has a bounded application;
- it defaults to `open` if its direct parent is Open; and
- an explicit creation input may choose any valid mode instead.

A child may select a local Scope that extends or narrows the parent's population, or uses a different
dimension. This never expands the parent application. All selected Scopes still belong to the same
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
| `lastReviewDate` | Latest qualifying direct Thread Update. |
| `nextReviewDate` | Review baseline plus `reviewFrequencyDays`. |
| `needsReview` | Review-workflow inclusion independent of status. |
| `reviewDue` | Derived from status, inclusion, cadence, and projection date. |
| `sensitive` | Presentation classification. |
| `createdAt`, `updatedAt` | Durable timestamps. |

Selecting or opening a Thread never counts as reviewing it. A direct Thread Update is the explicit
review evidence. Commitment Updates do not advance the Thread review date.

For an Open Thread, the latest direct unscoped Update supplies its direct state and review date. For
a bounded Thread, the repository projects one direct state per currently effective Subject. A
Subject without an effective Update contributes `none`; it is not silently treated as healthy.
The Thread's `lastReviewDate` is the newest qualifying direct cell Update.

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
| `scope` | Exact `{scopeId, subjectId}` attribution for bounded Thread/Commitment Updates, otherwise `null`. |
| `createdAt` | Durable insertion timestamp and same-day tie breaker. |

Creation validation uses the parent's current effective application and tests membership on the
Update date:

- a direct Focus Update must be unscoped;
- an Open Thread or Commitment Update must be unscoped;
- a bounded Thread or Commitment Update must provide both Scope and Subject ids;
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

- Focus review is based only on direct Focus Updates.
- Thread review is based only on direct Thread Updates, including all effective cells when bounded.
- `needsReview = false` excludes a Focus or Thread from due-review workflows without pausing it.
- A Thread is due only when active, included in review, and its next review date is on or before the
  projection date.
- Commitment cadence is per Scope/Subject cell when bounded and one stream when Open.
- A Commitment needs an Update only when active and at least one applicable cadence deadline is due.
- Review and cadence values are recomputed from durable records whenever a snapshot is materialized.

## Deletion and historical integrity

- Deleting a Focus cascades its Threads, Focus- and Thread-owned Commitments, Updates, status
  histories, Scope definitions, memberships, and Scope applications.
- Deleting a Thread cascades its direct Updates, Commitments, their Updates, histories, and Scope
  applications. It does not delete Focus-owned Commitments.
- Deleting a Commitment cascades its Updates, status history, and Scope application.
- Deleting an Update immediately changes every derived value that depended on it.
- Subjects are global and survive Focus deletion unless explicitly deleted later.
- Scope, Subject, and membership operations reject changes that would invalidate retained scoped
  Update history.
- Foreign keys and key ownership invariants are also enforced in SQLite so direct database writes
  cannot bypass the essential Focus boundary or partial-cell constraints.

## Model API boundary

The main process accesses these repositories through `database.domain`:

```ts
database.domain.subjects
database.domain.scopes
database.domain.scopeMemberships
database.domain.scopeApplications
database.domain.focuses
database.domain.threads
database.domain.commitments
database.domain.updates
```

Models expose ordinary update/delete/refresh behavior plus domain helpers such as
`scopeApplication()`, `setScope()`, `effectiveSubjects()`, and `scopeMatrix()`. Repository methods
return JSON-compatible snapshots; they never return SQLite handles.

The new Scope repositories are main-process model contracts. They are not yet exposed to the
renderer. When the UI is added, it must use named, typed IPC methods rather than generic repository
dispatch or SQL.

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
- Scope Board, exception filtering, or any other Scope UI; or
- renderer IPC for Subject, Scope, membership, application, or matrix management.

Those features can build on the exact historical cell, effective membership, and explicit
applicability contracts without changing the meaning of existing records.
