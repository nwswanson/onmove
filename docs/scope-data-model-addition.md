# Scope data-model addition

This note records the data-model work introduced in schema migrations 10 and 11. For the complete
current domain specification, read
[`focus-thread-commitment-model.md`](focus-thread-commitment-model.md).
Lifecycle and deletion behavior is specified in
[`scope-lifecycle-and-observability.md`](scope-lifecycle-and-observability.md).

## Why this addition exists

Previously, a Commitment or Thread had one undifferentiated Update stream. That works for an
aggregate commitment such as “Obtain executive approval,” but it loses information for a commitment
such as “Review every active project weekly.” The latter applies to a population and needs separate
evidence and cadence for each member of that population.

The addition introduces three separate concepts:

1. **Subject** — the canonical thing being managed or observed.
2. **Scope** — a Focus-owned expression describing which Subjects are applicable on a date.
3. **Scope application** — how a Focus, Thread, or Commitment obtains its effective Scope.

A bounded Thread or Commitment Update now identifies the exact Scope/Subject cell. This makes its
durable identity equivalent to:

```text
parent object × effective Scope × Subject × recorded date
```

It also preserves the distinction between applicability and attention. A Scope is the complete
population; current red/yellow/stale cells can later form an attention subset without narrowing it.

## Migration 10

Migration 10, `focus_scopes_and_scoped_updates`, adds the following durable structures.

### `subjects`

Stores global canonical Subjects with a generic kind, name, optional description, optional unique
external key, sensitivity flag, and timestamps. Subject kind is intentionally unconstrained beyond
being non-empty so people, projects, teams, services, and future kinds use one mechanism.

### `scopes`

Stores Focus-owned named definitions. A Scope has a dimension, `explicit` or `derived` source type,
an optional base Scope, and—in the derived case—a relationship descriptor and contextual Subject.

The schema and repository prevent:

- a base Scope from belonging to another Focus;
- a base Scope from using another dimension;
- self-reference and longer base cycles;
- incomplete derived definitions; and
- derived metadata on explicit definitions.

### `scope_memberships`

Stores effective-dated `include` and `exclude` overlays. Intervals use inclusive start and exclusive
end dates. Repository validation prevents overlapping intervals with the same effect for the same
Scope/Subject pair.

### Scope-application tables

The migration creates one application table per owner type:

- `focus_scope_applications`
- `thread_scope_applications`
- `commitment_scope_applications`

Every owner receives exactly one row. Focus rows accept `open`, `explicit`, or `derived`. Thread and
Commitment rows additionally accept `inherited`. Database triggers enforce Focus ownership and
require application mode to match the selected Scope's source type.

Existing Focuses, Threads, and Commitments are backfilled as Open. This preserves every existing
Update stream without inventing historical Subject attribution.

New Threads and Commitments default to inheritance only when their direct parent is currently
bounded; otherwise they default to Open. The repository resolves inheritance dynamically, so later
parent application changes flow to inheriting descendants without rewriting their rows.

### Scoped `updates`

The `updates` table is reconstructed with nullable `scope_id` and `subject_id` columns. The pair is
all-or-nothing, and direct Focus Updates cannot have a pair. Existing Updates are copied with both
columns null.

SQLite additionally verifies that a scoped Update's Scope belongs to the same Focus tree as its
Thread or Commitment parent. Repository validation adds the date-sensitive rules that cannot be
expressed cleanly as a static constraint:

- the parent must currently be bounded on the Update date;
- the submitted Scope must be the parent's effective Scope;
- the Subject must be an effective member on the recorded date; and
- editing the date must leave the stored cell valid on the new date.

Scope and Subject foreign keys use protected historical semantics. Deleting an entire Focus still
cascades its complete tree transactionally, while deleting an individual Scope or Subject is
rejected if retained Update history points to it.

## New typed contracts

The shared contract layer now defines:

```text
SubjectSnapshot / CreateSubjectInput / UpdateSubjectInput
ScopeSnapshot / CreateScopeInput / UpdateScopeInput
ScopeMembershipSnapshot / CreateScopeMembershipInput / EndScopeMembershipInput
ScopeOwner / SetScopeApplicationInput / ScopeApplicationSnapshot
ScopeApplicationState / ScopeApplicationTransition
UpdateScopeCell
ThreadScopeCellSnapshot
CommitmentScopeCellSnapshot
```

`CreateThreadInput` and `CreateCommitmentInput` accept an optional application declaration so object
creation and Scope selection can occur in one transaction. `UpdateSnapshot` always exposes `scope`
as either an exact cell or `null`; the shape is never ambiguous.

These are domain contracts, not a new renderer capability. Named IPC methods can be added when the
Scope UI is designed.

## Migration 11: application observability

Migration 11, `scope_application_transition_history`, adds one immutable transition stream across
Focus, Thread, and Commitment Scope applications. It backfills each existing application as an
initial transition and uses SQLite triggers to capture changes made either through repositories or
directly below the model layer.

Transition rows retain declared `from` and `to` modes and Scope ids. Reassigning the same declaration
through the repository is a no-op. History cascades only when its owning Focus, Thread, or Commitment
is hard deleted; individual mutation or deletion is rejected while the owner survives. A referenced
Scope cannot be deleted, so historical transitions never point at a missing definition. SQLite also
rejects direct deletion of a surviving owner's required current application row.

The same integrity review tightened membership interval edits and used Scope definitions without a
new storage shape: interval edits now validate the resulting effective membership against every
retained cell Update, and used Scope structure must be replaced rather than rewritten.

## New repositories and model helpers

`DomainStore` now provides:

| Repository | Primary responsibilities |
| --- | --- |
| `subjects` | Create, find, list, edit, and safely delete canonical Subjects. |
| `scopes` | Create and validate definitions, list per Focus, resolve effective Subjects, test membership, and safely delete. |
| `scopeMemberships` | Create/list intervals, end an interval, and safely delete unused history. |
| `scopeApplications` | Get/set declared mode and resolve the effective inherited Scope. |

Focus, Thread, and Commitment models expose `scopeApplication()` and `setScope()`. Scope models expose
`effectiveSubjects(date)`. Thread and Commitment models additionally expose `scopeMatrix(date)`.
`scopeApplications.history(owner)` and each owner's `scopeApplicationHistory()` helper return the
immutable declared transition stream.

## Materialized behavior

### Bounded Commitments

The Commitment matrix contains one current cell for each Subject effective in the Scope on the
projection date. Each cell independently calculates state, last Update, next cadence date, and
whether evidence is due. The normal Commitment snapshot rolls those cells up by worst state,
newest last-Update date, earliest next-Update date, and any-cell-needs-update.

### Bounded Threads

`ThreadModel.scopeMatrix(date)` contains one independently scheduled review cell per effective
Subject. Every cell carries its Subject, direct state, last review date, next review date, and due
flag. A missing Subject assessment contributes `none` and remains independently due according to
the Thread's review frequency. Child Commitment Updates do not complete Thread review cells.

The ordinary Thread snapshot rolls the matrix up for list and review surfaces: `reviewDue` means any
cell is due, `nextReviewDate` is the earliest cell deadline, and `lastReviewDate` is the oldest latest
review across all effective cells. It remains `null` while any current Subject has never been
reviewed. This projection required no additional schema migration because scoped Updates already
store the exact Thread/Scope/Subject attribution.

Thread health includes each cell's direct state plus every active child Commitment's materialized
state. A missing Subject assessment contributes `none`.

### Open objects

Open Focuses, Threads, and Commitments retain the prior aggregate behavior. Their Updates have
`scope: null`. Direct Focus Updates always use this form even if the Focus has a bounded application,
because they are currently aggregate Focus judgments.

## Validation coverage

The new automated tests cover:

- effective-dated base/include/exclude resolution and half-open interval ends;
- overlapping interval rejection;
- derived-definition requirements, same-Focus/same-dimension bases, and cycle rejection;
- all four application modes and live inheritance;
- prevention of implicit parent widening and cross-Focus selection;
- required exact cells for bounded Updates;
- rejection of wrong Scope, non-member Subject, invalid date edits, and scoped Focus/Open Updates;
- per-Subject Commitment state and cadence rollups;
- bounded Thread health and independent review deadlines for assessed and unassessed Subjects;
- Thread review coverage as Subjects enter and leave an effective-dated Scope;
- preservation of historical cell attribution after applicability changes;
- guarded Scope, Subject, and membership deletion;
- immutable Scope-application history, no-op reassignment, and below-repository auditing;
- exact membership-end validation across include, exclude, and base resolution;
- owner-deletion cascades that retain shared Scope and Subject records;
- complete Focus cascade behavior; and
- raw SQLite constraints for partial cells and cross-Focus references.

## Deliberately deferred

This addition does not change renderer layout or preload IPC. It also does not yet add automatic
relationship resolution, attention sets, Commitment series/occurrences, Moves, a Scope Board, or a
Review workflow. The schema captures the stable prerequisites for those features without claiming
that they already exist.
