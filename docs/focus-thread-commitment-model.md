# Focus, Thread, Commitment, and Update model

This document describes the first model-only implementation of work tracking beneath a Focus. It
does not add renderer UI. The model is designed around observations and commitments rather than a
todo list.

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
| `needsReview` | True on or after `nextReviewDate`, but only while the Thread is active. |

In this first version, recording a direct Thread Update is the explicit act that completes a review.
Opening, selecting, or materializing a Thread does not change `lastReviewDate`. Updates on one of its
Commitments also do not count as a Thread review.

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
| `state` | State of the latest effective Update, or `none` when there is no Update. |
| `lastUpdateDate` | Effective date of that latest Update. |
| `nextUpdateDate` | Latest Update date plus cadence; creation date is the initial baseline. |
| `needsUpdate` | True when cadence is due and the Commitment is active. |

Commitments are promises, standards, or expectations—not todo items. Completing a Focus does not
require every Commitment or Thread to be closed first.

### Update

| Field | Meaning |
| --- | --- |
| `parent` | Exactly one Focus, Thread, or Commitment. |
| `date` | Effective calendar date. Defaults to the local current day but accepts past or future dates. |
| `observation` | Required freeform text describing what was observed. |
| `state` | `red`, `yellow`, `green`, or `none`. Defaults to `none`. |

Update order is determined by effective `date`, then insertion order for two Updates on the same
day. A future-dated Update is stored immediately but does not affect health, state, review, or
cadence projections before its date.

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

## Deliberate boundaries in this iteration

- The current UI and named IPC surface list and create Threads plus Focus-level Commitments. Thread
  detail, Commitment attributes beyond title, and Updates remain later UI work.
- Health is implemented only for Threads; a later Focus-level rollup can compose Thread health and
  direct Focus evidence.
- Cadence currently reports when an Update is due. Notification scheduling is a later concern.
- An Update directly on a Thread is treated as a completed review. If reviews later need a separate
  workflow, that can become an explicit Update kind without rewriting existing observations.
