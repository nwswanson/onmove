# Focus, Thread, Commitment, and Update model

This document describes the durable work model beneath a Focus and its current Commitment-update
UI surface. The model is designed around observations and commitments rather than a todo list.

## Shape of the model

```text
Focus: Project execution
├── Thread: Sprint execution
│   ├── Commitment: Improve ticket quality
│   │   └── Updates[]
│   ├── Commitment: Hold weekly refinement
│   │   └── Updates[]
│   └── Updates[]                   direct Thread reviews
├── Thread: Team health
│   ├── Commitments[]
│   └── Updates[]
├── Commitments[]                   Focus-level commitments are also valid
└── Updates[]                       Focus-level observations are also valid
```

A Focus owns zero or more Threads. A Thread is one dimension by which the Focus can be understood,
but it never blocks the Focus lifecycle: a Focus may move to `done` or `cancelled` while Threads are
still active.

Commitments can belong directly to a Focus or to one Thread. Updates can belong directly to a Focus,
Thread, or Commitment. SQLite requires exactly one valid parent for every Commitment and Update.

## Entities

### Focus

| Field | Meaning |
| --- | --- |
| `lastReviewDate` | Derived date of the newest effective Update directly on this Focus. |
| `needsReview` | Persisted inclusion policy; false excludes the Focus from review workflows without changing its lifecycle status. |

Recording a direct Focus Update is the explicit act that reviews the Focus. Updates on its Threads
or Commitments do not advance the Focus review date. `lastReviewDate` is a projection and is never
written directly.

### Thread

| Field | Meaning |
| --- | --- |
| `focusId` | Required parent Focus. |
| `title` | Required description of the dimension being judged. Duplicate titles are permitted. |
| `health` | Derived `red`, `yellow`, `green`, or `none`; it is never written directly. |
| `status` | `active`, `paused`, `done`, or `cancelled`. Changes have an immutable audit history. |
| `reviewFrequencyDays` | Positive whole-number review interval. |
| `lastReviewDate` | Derived date of the newest effective Update directly on this Thread. |
| `nextReviewDate` | `lastReviewDate + reviewFrequencyDays`; creation date is the initial baseline. |
| `needsReview` | Persisted inclusion policy; false excludes the Thread from review workflows. |
| `reviewDue` | True on or after `nextReviewDate` only when the Thread is active and included in reviews. |

In this first version, recording a direct Thread Update is the explicit act that completes a review.
Opening, selecting, or materializing a Thread does not change `lastReviewDate`. Updates on one of its
Commitments also do not count as a Thread review. The persisted `needsReview` flag is independent of
status; clearing it suppresses `reviewDue` without pausing or closing the Thread.

### Commitment

| Field | Meaning |
| --- | --- |
| `parent` | Exactly one Focus or Thread. |
| `type` | `action` for a bounded promise or `ongoing` for a continuing standard. |
| `title` | Required statement of the commitment. |
| `updates` | Dated observations parented to this Commitment. |
| `dueDate` | Optional calendar date. |
| `cadenceDays` | Optional positive update interval. |
| `status` | `active`, `paused`, `done`, or `cancelled`, with immutable transition history. |
| `state` | State of the Update with the highest recorded date, or `none` when there is no Update. |
| `lastUpdateDate` | Recorded date of that latest Update, including a future date. |
| `nextUpdateDate` | Latest Update date plus cadence; creation date is the initial baseline. |
| `needsUpdate` | True when cadence is due and the Commitment is active. |

Commitments are promises, standards, or expectations—not todo items. Completing a Focus does not
require every Commitment or Thread to be closed first.

A Commitment Update's recorded date orders the projection; it is not an activation date. A
future-dated Update therefore becomes the Commitment's current state and cadence baseline
immediately. This permits deliberate deferral for now; review-specific future-date policy remains a
separate concern.

### Update

| Field | Meaning |
| --- | --- |
| `parent` | Exactly one Focus, Thread, or Commitment. |
| `date` | Effective calendar date. Defaults to the local current day but accepts past or future dates. |
| `observation` | Optional freeform text describing what was observed. A state-only Update is valid. |
| `state` | `red`, `yellow`, `green`, or `none`. Defaults to `none`. |

Update order is determined by effective `date`, then insertion order for two Updates on the same
day. A future-dated Update is stored immediately but does not affect health, state, review, or
cadence projections before its date.

Date, observation, and state are editable without changing the Update's parent or identity. An
Update can also be deleted. Every edit or deletion immediately changes any derived Commitment state,
Thread health, review date, or cadence projection that depends on the affected observation.

In the UI, Add update immediately inserts a valid blank Update using today's local date and `none`
state. There is no separate unsaved draft or Create confirmation. Once inserted, all three fields use
the standard throttled autosave behavior.

## Naive Thread health rule

The current health calculation considers:

1. the latest effective Update directly on the Thread; and
2. the latest effective state of every active Commitment parented to that Thread.

Severity is aggregated as follows:

```text
any red    → red
else yellow present → yellow
else unknown/none present → none
else every value is green → green
```

Paused, done, and cancelled Commitments do not participate in current Thread health. This keeps an
old red observation on a closed Commitment from permanently holding the Thread red. The rule is
deliberately small and lives in model code so it can later be replaced without migrating stored
health values.

## End-to-end example

Suppose a portfolio contains the Focus **Project execution**. One important dimension is whether
the team executes sprints well, so it receives a Thread called **Sprint execution** with a seven-day
review frequency.

That Thread has an ongoing Commitment called **Improve ticket quality**, also with a seven-day update
cadence.

```ts
const projectExecution = database.domain.focuses.create({
  title: 'Project execution'
})

const sprintExecution = database.domain.threads.create({
  focusId: projectExecution.id,
  title: 'Sprint execution',
  reviewFrequencyDays: 7
})

const ticketQuality = database.domain.commitments.create({
  parent: { type: 'thread', id: sprintExecution.id },
  type: 'ongoing',
  title: 'Improve ticket quality',
  cadenceDays: 7
})
```

On February 3, the sprint review is positive, but ticket quality still needs attention:

```ts
database.domain.updates.create({
  parent: { type: 'thread', id: sprintExecution.id },
  date: '2026-02-03',
  observation: 'The sprint goal was met and carryover stayed low.',
  state: 'green'
})

database.domain.updates.create({
  parent: { type: 'commitment', id: ticketQuality.id },
  date: '2026-02-03',
  observation: 'Several tickets still entered the sprint without acceptance criteria.',
  state: 'yellow'
})
```

The materialized result is:

```text
Sprint execution.health              yellow
Sprint execution.lastReviewDate      2026-02-03
Sprint execution.nextReviewDate      2026-02-10
Sprint execution.needsReview         true
Sprint execution.reviewDue           false
Improve ticket quality.state         yellow
Improve ticket quality.nextUpdateDate 2026-02-10
```

On February 10, refinement has improved and both records receive green observations:

```ts
database.domain.updates.create({
  parent: { type: 'commitment', id: ticketQuality.id },
  date: '2026-02-10',
  observation: 'Every sprint candidate now has acceptance criteria and an owner.',
  state: 'green'
})

database.domain.updates.create({
  parent: { type: 'thread', id: sprintExecution.id },
  date: '2026-02-10',
  observation: 'The sprint review completed with no quality exceptions.',
  state: 'green'
})
```

Now the Thread health is green, both next dates advance to February 17, and the full observation
history remains available. If Project execution is marked done at this point—or even before it—the
Thread and Commitment may remain active because they are evidence and dimensions, not closure gates.

## Persistence and deletion

- Deleting a Focus cascades through its Threads, direct Commitments, descendant Commitments,
  Updates, and status histories.
- Deleting a Thread cascades only through that Thread's Commitments, Updates, and histories; direct
  Focus Commitments remain.
- Deleting a Commitment removes its Updates and status history.
- Changing a lifecycle status appends a directional transition; assigning the same status again does
  not create a duplicate event.
- All derived values are rebuilt from durable Updates when SQLite is reopened.

## Current UI boundary

- The named IPC surface lists, creates, edits, and deletes Updates without exposing repository
  dispatch or SQL. Focus Overall and the Commitment page present their own direct Updates as
  responsive editor cards; neither surface includes descendant Updates.
- Focus and contextual-sidebar Commitment rows show `CommitmentSnapshot.state` as a labeled
  semantic badge. The renderer consumes that model projection directly rather than recomputing the
  latest Update. Every Commitment representation also shows `lastUpdateDate` as “Last updated,”
  including the main list, contextual sidebar, Commitment screen, and context drawer; an empty
  history is displayed as `Never`.
- Commitment lists show lifecycle status as a read-only semantic label. The selected Commitment
  screen owns a compact status selector for `active`, `paused`, `done`, and `cancelled`; it writes
  through the named typed IPC method and therefore preserves the SQLite status-transition audit.
- A pure feature view-model projection supplies every Commitment list. Active records come first in
  `red`, `yellow`, `green`, then `none` state order; Paused records follow; Done and Cancelled records
  share the final closed group. Equal priorities retain repository order. The Focus screen renders
  Current (with Active and Paused subsections) separately from Done / Cancelled, and the contextual
  sidebar consumes the same ordered groups.
- Update cards use a receiver-owned list contract. Domain snapshots are translated into date,
  observation, and state fields; the list owns editors, state labels, colors, validation, and item
  actions. Observation uses the shared lightweight rich-text editor and remains optional.
- Updates on Threads are supported by the model but do not yet have a UI surface.
- Mutating a direct Focus Update refreshes the Focus projection so `lastReviewDate` changes in the
  Overall header and inspector without requiring navigation or relaunch.
- Focus and Thread inspectors show their derived `lastReviewDate` and expose the persisted
  `needsReview` inclusion flag through the generic drawer checkbox contract.
- Health is implemented only for Threads; a later Focus-level rollup can compose Thread health and
  direct Focus evidence.
- Cadence currently reports when an Update is due. Notification scheduling is a later concern.
- An Update directly on a Thread is treated as a completed review. If reviews later need a separate
  workflow, that can become an explicit Update kind without rewriting existing observations.
