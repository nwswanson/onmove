# Routine attestation model

## Purpose and boundary

A Routine is the second implementation in the generic Commitment family. It is a reusable
inspection checklist attached to exactly one Focus or Thread. It shares only the Commitment base
boundary—exclusive parentage, name/title, sensitivity, parent history, and cascade deletion—with a
tracking Commitment.

A Routine is not:

- a lifecycle-state Commitment;
- an Update cadence;
- a recurring Todo generator; or
- a health score for its parent.

Its color answers one narrow question: is the inspection practice being performed on schedule?
Optional notes recorded beside an inspection are evidence. They do not make the Routine red or
green.

## Durable structure

```text
commitments
  behavior_type = routine
  exactly one Focus or Thread parent
        │
        └── routine_definitions (1:1)
              schedule_effective_on
              optional Focus-owned scope_id
              needs_attestation
              current_template_version
                    │
                    ├── routine_schedule_weekdays (0:5, Monday–Friday)
                    │
                    ├── routine_template_versions (1:n, immutable)
                    │       └── routine_template_items (1:n, immutable)
                    │
                    └── routine_review_runs (1:n, occurrence snapshot)
                            ├── routine_review_run_items (1:n, checklist snapshot)
                            └── routine_review_cells (1:n, unscoped or one per Subject)
                                    └── routine_review_cell_attestations (one per Run item)
                                            resolution, attested_at, optional rich-text note
                                            └── routine_review_cell_issues (legacy compatibility)
```

Migration 27 adds the constrained `behavior_type` discriminator. Migration 26's constrained
`commitment_type = tracking` column remains compatibility storage because rebuilding the base table
would disturb many foreign keys, evidence tables, history tables, and deletion triggers. Public
repositories use `behavior_type`: `CommitmentRepository` filters to `tracking`, and
`RoutineRepository` filters to `routine`.

Migration 28 adds the attestation inclusion flag and independent Subject cells. Existing aggregate
Run resolutions are copied into every Subject cell represented by their historical Scope snapshot,
preserving recorded completion while making every later edit cell-specific.

Migration 29 adds an optional rich-text note to every cell item. Migration 30 establishes explicit
cell finalization and freezes the complete item state—including its note—after finalization.
Migration 31 replaces interval recurrence with zero to five `routine_schedule_weekdays` rows.
Legacy `cadence_days` and `anchor_on` fields remain on the definition only for older archive
compatibility and no longer drive new Run generation. Existing Routines migrate to their legacy
anchor weekday; weekend anchors become Monday.

Routine creation validates all of the following in one transaction:

- parent id exists and is either a Focus or Thread;
- name is nonblank;
- schedule is a unique, normalized subset of Monday through Friday (and may be empty);
- checklist is nonempty and includes at least one required inspection; and
- optional Scope exists and belongs to the Routine parent's Focus.

Template inspection text is required. Entries default to required. Optional entries are allowed,
but unresolved optional entries never block Run completion.

## Template versioning and Run snapshots

Creating or replacing a checklist appends a `routine_template_versions` row and a complete ordered
set of template items. Older versions are never edited. SQLite rejects updates to template version
and template item rows.

Scheduled Runs are materialized idempotently when the Routine projection catches its schedule up to
the requested date. When no due Run is unfinished, it also materializes exactly the next calendar
occurrence, making that immutable checklist actionable before its scheduled day. Completing this
one future occurrence early does not
unlock a second future occurrence on the same projection date; advancing the projection through the
completed occurrence makes the following occurrence actionable. The unique
`(routine_id, scheduled_on)` key makes repeated reads safe. A Run
copies:

- scheduled date and the next anchored review-window boundary;
- selected template version;
- ordered inspection text and required flags;
- Scope id and name; and
- the then-effective Subject ids and names as JSON snapshot data.

The repository then creates one independently editable attestation cell per copied Subject. An open Routine, or
a scoped Routine whose effective population is empty, receives one explicitly unscoped cell. Two
Subjects therefore mean two independently completable copies of the same Run checklist. The Run is
complete only after both Subject cells are complete.

Changing the template, Scope membership, Scope application, or current Scope name can therefore
never rewrite an existing Run. Scope deletion clears only the live definition reference through
`SET NULL`; the Run's scalar Scope id plus copied name and Subject population remain readable.

Run schedule and checklist snapshot columns have SQLite immutability triggers. A finalized Subject
cell can no longer change resolution, attestation time, completion time, note, or legacy issue
content.

## Completion and evidence notes

Each Run item has one resolution per Subject cell:

- `pending` — no attestation yet;
- `attested` — the user states the inspection was performed; or
- `not_applicable` — the user explicitly states that inspection did not apply to this Run.

Checking an inspection does not claim that the inspected condition was healthy. A required item is
complete when it is either attested or not applicable.

Every item has an optional inline rich-text note. It uses the same versioned Lexical envelope as
other multiline fields, accepts legacy plain text, saves through the 750 ms throttled autosave
path, and flushes on blur. Notes are evidence only: changing one does not alter a resolution,
attestation time, cell completion, Run completion, schedule, or derived status. There is no pop-out
action. Notes can be edited only while their exact Subject cell is open.

The previous Issue-found and typed follow-up fields remain in SQLite and portable import solely so
older archives do not lose data. Current UI and callers do not create or edit them.

Resolving the last required item enables `Finalize check-in` but does not complete anything by
itself. Finalization first requires no required item to remain pending, flushes pending notes in the
renderer, and then writes the cell completion. The repository writes occurrence completion only
after every cell has been explicitly finalized. Partial or merely checked work in one Subject
cannot refresh another Subject or the aggregate Routine.

## Anchored recurrence

The schedule is any subset of Monday through Friday. Each selected weekday creates its own immutable
Run; Monday, Wednesday, and Friday therefore produce three separately completable occurrences per
week. Completing a Run never becomes a new anchor. If the app was not open at a scheduled boundary,
the next Routine read safely materializes missed occurrences from the applicable historical
template version. The oldest unfinished occurrence is projected as the current check-in, so a
backlog advances deterministically one Run at a time.

Changing weekday selections affects future generation only. `schedule_effective_on` records the
date from which the new selection applies, so changing the schedule cannot synthesize a different
set of historical Runs. Already materialized Runs always win on a date collision. An empty schedule
materializes nothing and reports no next review date.

`needs_attestation` remains the user's stored queue-inclusion preference. The public
`needsAttestation` projection is computed as that preference combined with a nonempty weekday
schedule. Clearing every weekday therefore removes the Routine from sidebars and execution queues
without overwriting the preference; choosing a weekday later restores inclusion automatically.

## Derived status

Status is calculated, never stored or selected:

| Color | Projection |
| --- | --- |
| Green / Current | No scheduled date has passed incomplete, the current required Run is complete, or effective attestation is disabled. |
| Yellow / Overdue | The oldest unfinished Run has passed its scheduled date, but fewer than two selected schedule boundaries have elapsed since the last fully completed Run (or the first unfinished Run when none exists). |
| Red / Lapsed | No full completion has occurred across two complete selected weekday intervals. |

Completing an overdue Run returns the Routine to green only when no other scheduled Run is already
unfinished. Its actual completion date and `completedLate` projection remain in history. If another
anchored Run has already become due, the oldest remaining occurrence becomes current and correctly
remains overdue; late completion never silently skips it or moves the recurrence.

Occurrence progress sums required resolutions across its cells. Each queue item displays its own
Subject-cell progress. Previous Runs retain scheduled date, completion date, late marker, template
version, Scope snapshot, every cell resolution, and optional item notes.

## Deletion, moves, import, and visibility

Deleting a Routine, its Thread, or its Focus cascades through definitions, versions, Runs, Run
items, Subject cells, cell attestations, notes, and legacy issues. There is no Update rescue requirement because
attestation records are not Update evidence. Tracking Updates elsewhere in the deleted hierarchy
still use the universal archive trigger.

Moving a Thread to another Focus includes Routine Scope references in the existing move planner's
Scope graph. The move clones referenced Scopes into the destination Focus and remaps only the live
Routine definition. Historical Run Scope snapshots are not rewritten.

A direct Routine move is deliberately narrower: it is allowed only between Overall and Threads in
the same Focus. The guarded move planner rejects cross-Focus destinations and stale source parents.
The operation changes only the Routine-backed Commitment's parent columns, so the live optional
Focus-owned Scope, weekday schedule, every template version, the current Run, completed Run history,
Subject cells, resolutions, and evidence notes remain attached without copying or reinterpretation.
The existing immutable parent-transition log records the ownership change.

Portable export/import includes every Routine table in dependency order. Import accepts named raw
fields, supplies conservative defaults for missing future/older fields, normalizes enum and boolean
values, and relies on the same SQLite constraints before committing replacement data.

Sensitive Routines are filtered at the top-level Routines collection boundary. A sensitive Focus or
Thread cascades visibility to its Routines, matching the rest of the application. Stored Run and
note or legacy issue data is never redacted or destroyed by a visibility preference.

## UI ownership

Routine creation and definition management belong to a Focus or Thread workspace. `Add Routine`
sits beside `Add commitment`, while an owned-definition list immediately below the Commitment
collection shows only the Routines belonging to that exact parent. `Add Routine` opens a creation
dialog because no durable record exists yet. Selecting an existing row opens its check-in history
in the main canvas. This keeps Focus Overall Routines distinct from Thread Routines even though both
feed the same execution queue.

The top-level contextual sidebar mirrors that ownership. Every Overall or Thread node presents
`Add commitment` followed by `Add Routine`, then its current Commitments and direct Routines.
Routine rows carry a checklist icon and derived status and use the same receiver-owned drag affordance
as Commitments. Dropping one on Overall or a sibling Thread moves the complete Routine aggregate and
keeps it selected at its destination; no confirmation is needed because no Scope or history is changed.
Selecting one preserves the top-level hierarchy and renders the current check-in above check-in
history in the main canvas. History includes prior completed immutable Runs, per-Subject progress,
scheduled and completion dates, lateness, template versions, resolutions, and item notes. The current cell uses
the same live checklist receiver as the global Routines workspace, including resolution controls,
autosaving notes, and explicit finalization. Finalized cells render their notes as read-only blocks.
An explicit `Edit` button replaces history with the embedded definition editor in the same main
canvas; it never opens an Edit Routine dialog.

The embedded editor owns the name, Monday–Friday schedule, optional parent Scope,
`needsAttestation`, sensitivity, and checklist versioning. Clearing `needsAttestation` removes the
Routine's cells from the queue without deleting immutable history. Editing the checklist appends a
future template version and never binds editable controls to a Run's copied inspection text.
Permanent deletion is a confirmed destructive action in the Routine's context drawer; successful
deletion invalidates a pinned Routine and returns the main selection to its owning Focus or Thread.

The top-level Routines workspace is execution-only. It uses the shared contextual sidebar, flattens
the actionable projection to one row per `Routine × Subject` (or one unscoped row), groups rows into
Past due, Today, This week, and Upcoming, and presents one immutable checklist at a time. The next
Upcoming occurrence is already an immutable Run and remains fully editable, allowing (for example)
a Friday check-in to be completed on Thursday. Later occurrences remain previews until their turn. Its
generic context drawer receives a data-only, read-only Routine adapter so definition mutations stay
with the owning parent. The shared `StateLabel` receiver owns color/label markup, while the feature
model replaces snapshots after every cell resolution or note save. Completed Run resolution
controls and notes are read-only. The primary navigation and workspace header count distinct
Routines with at least one editable cell. There is no generic lifecycle selector, Issue-found UI,
note pop-out, or recurring Todo UI.
