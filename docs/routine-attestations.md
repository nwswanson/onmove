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
Issues found during the inspection are evidence or follow-up intent. They do not make the Routine
red or green.

## Durable structure

```text
commitments
  behavior_type = routine
  exactly one Focus or Thread parent
        │
        └── routine_definitions (1:1)
              cadence_days
              anchor_on
              schedule_effective_on
              optional Focus-owned scope_id
              current_template_version
                    │
                    ├── routine_template_versions (1:n, immutable)
                    │       └── routine_template_items (1:n, immutable)
                    │
                    └── routine_review_runs (1:n, schedule snapshot)
                            ├── routine_review_run_items (1:n, checklist snapshot)
                            └── routine_run_issues (0..1 per Run item)
```

Migration 27 adds the constrained `behavior_type` discriminator. Migration 26's constrained
`commitment_type = tracking` column remains compatibility storage because rebuilding the base table
would disturb many foreign keys, evidence tables, history tables, and deletion triggers. Public
repositories use `behavior_type`: `CommitmentRepository` filters to `tracking`, and
`RoutineRepository` filters to `routine`.

Routine creation validates all of the following in one transaction:

- parent id exists and is either a Focus or Thread;
- name is nonblank;
- cadence is a positive whole number of days;
- anchor is a real `YYYY-MM-DD` calendar date;
- checklist is nonempty and includes at least one required inspection; and
- optional Scope exists and belongs to the Routine parent's Focus.

Template inspection text is required. Entries default to required. Optional entries are allowed,
but unresolved optional entries never block Run completion.

## Template versioning and Run snapshots

Creating or replacing a checklist appends a `routine_template_versions` row and a complete ordered
set of template items. Older versions are never edited. SQLite rejects updates to template version
and template item rows.

Scheduled Runs are materialized idempotently when the Routine projection catches its schedule up to
the requested date. The unique `(routine_id, scheduled_on)` key makes repeated reads safe. A Run
copies:

- scheduled date and the next anchored review-window boundary;
- selected template version;
- ordered inspection text and required flags;
- Scope id and name; and
- the then-effective Subject ids and names as JSON snapshot data.

Changing the template, Scope membership, Scope application, or current Scope name can therefore
never rewrite an existing Run. Scope deletion clears only the live definition reference through
`SET NULL`; the Run's scalar Scope id plus copied name and Subject population remain readable.

Run schedule and checklist snapshot columns have SQLite immutability triggers. A completed Run can
no longer change resolution, attestation time, completion time, or issue content.

## Attestation and issues

Each Run item has one resolution:

- `pending` — no attestation yet;
- `attested` — the user states the inspection was performed; or
- `not_applicable` — the user explicitly states that inspection did not apply to this Run.

Checking an inspection does not claim that the inspected condition was healthy. A required item is
complete when it is either attested or not applicable. The repository writes `completed_at` only
when no required item remains pending. Partial work never changes the Routine schedule or derived
status baseline.

An attested item can record one Issue with free text and a typed follow-up intent of `none`,
`update`, `commitment`, or `move`. This keeps the discovery durable and gives later typed creation
flows a stable dispatch contract. The issue and intended artifact are deliberately separate: issue
presence never feeds Routine status. Creating and linking a concrete follow-up artifact remains a
named domain operation rather than a polymorphic foreign key or hidden side effect of checking a
box.

## Anchored recurrence

Dates are generated from `anchor_on + n × cadence_days`; completing a Run never becomes a new
anchor. If a user finishes a January 1 weekly Run on January 4, the next date remains January 8.
If the app was not open at a scheduled boundary, the next Routine read safely materializes missed
occurrences from the applicable historical template version.

Changing cadence or anchor affects future generation only. `schedule_effective_on` records the date
from which the new schedule applies, so changing the schedule cannot synthesize a different set of
historical Runs. Already materialized Runs always win on a date collision.

## Derived status

Status is calculated, never stored or selected:

| Color | Projection |
| --- | --- |
| Green / Current | No scheduled date has passed incomplete, or the latest required Run is fully complete. |
| Yellow / Overdue | The current scheduled Run is incomplete after its scheduled date, but fewer than two complete intervals have elapsed since the last fully completed scheduled Run (or the anchor when none exists). |
| Red / Lapsed | No full completion has occurred for two complete cadence intervals. |

Completing an overdue Run returns the Routine to green when it is still the latest required Run.
Its actual completion date and `completedLate` projection remain in history. If another anchored Run
has already become due, that newer Run correctly remains overdue; late completion never silently
skips it or moves the recurrence.

The current Run progress is the number of required items whose resolution is no longer pending over
the total required count. Previous Runs retain scheduled date, completion date, late marker,
template version, Scope snapshot, all checklist resolutions, and issues.

## Deletion, moves, import, and visibility

Deleting a Routine, its Thread, or its Focus cascades through definitions, versions, Runs, Run
items, and issues. There is no Update rescue requirement because attestation records are not Update
evidence. Tracking Updates elsewhere in the deleted hierarchy still use the universal archive
trigger.

Moving a Thread to another Focus includes Routine Scope references in the existing move planner's
Scope graph. The move clones referenced Scopes into the destination Focus and remaps only the live
Routine definition. Historical Run Scope snapshots are not rewritten.

Portable export/import includes every Routine table in dependency order. Import accepts named raw
fields, supplies conservative defaults for missing future/older fields, normalizes enum and boolean
values, and relies on the same SQLite constraints before committing replacement data.

Sensitive Routines are filtered at the top-level Routines collection boundary. A sensitive Focus or
Thread cascades visibility to its Routines, matching the rest of the application. Stored Run and
issue data is never redacted or destroyed by a visibility preference.

## UI ownership

The top-level Routines workspace owns Routine presentation and calls only named preload methods.
It displays association, derived semantic status, next/overdue timing, progress, the immutable
current checklist, and expandable Run history. The shared `StateLabel` receiver owns color/label
markup. The feature model owns persistence calls and replaces snapshots after every attestation.

The editor changes the Routine definition and appends a future template version; it never binds
editable controls to a Run's copied inspection text. Completed Run controls are disabled. There is
no generic lifecycle selector and no recurring Todo UI.
