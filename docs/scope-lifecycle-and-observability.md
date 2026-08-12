# Scope lifecycle, removal, deletion, and observability

This document defines what happens when Subjects, Scopes, Threads, Commitments, memberships, and
applications are changed or deleted. It complements the unified domain specification in
[`focus-thread-commitment-model.md`](focus-thread-commitment-model.md).

The model distinguishes three operations that can look similar in a UI but have different durable
meaning:

- **End applicability:** retain the object and evidence, but stop producing a current matrix cell.
- **Change application:** retain the owner and evidence, but make a different Scope expression
  current.
- **Hard delete:** erase an owner and its owned subtree according to SQLite cascade rules.

The UI should not present these as interchangeable actions.

## Actors and ownership

```text
Focus owns Scope definitions
Scope resolves to effective-dated Subjects

Focus
├── Thread ─────── applies one effective Scope or remains Open
│   └── Commitment ─ derives the Thread's effective Scope
└── Commitment ─── remains Open/unscoped

Thread/Commitment × Scope × Subject = current matrix cell
Update = durable evidence attributed to one exact cell
```

Subjects are global canonical records. Scopes belong to a Focus. Threads consume a Scope but do not
own it; their Commitments consume that Thread context without a separate applicability choice.
Consequently, deleting a Thread or Commitment never deletes a Scope or Subject.

## Removing a Subject from an applicable Scope

The normal operation is to end an include membership or add an effective-dated exclusion. Membership
intervals are half-open: `[effectiveFrom, effectiveUntil)`.

When the Subject stops being effective:

- the Subject disappears from current Thread and Commitment matrices using that Scope;
- it no longer contributes current Thread health, review coverage, Commitment state, or cadence;
- the Thread, Commitment, Scope, and Subject remain durable;
- existing Updates retain their exact `{scopeId, subjectId}` attribution;
- existing individual scoped Todos retain their exact parent cell and aggregate-list placement;
- a shared Todo drops that Subject's current completion cell and exact-list placement, then derives
  its parent completion again (removing the last unchecked cell can close the parent);
- application history is unchanged because the owner still applies the same Scope expression; and
- historical membership intervals remain queryable.

The model validates an interval edit against the complete resulting Scope expression, including its
base Scope, includes, and exclusions. An edit is rejected if it would make any retained Update's
Subject ineffective on that Update's date. This exact check permits legitimate cases that a simple
“later Update exists” rule cannot—for example, shortening an exclusion while another include keeps
the Subject valid.

Ending an interval also rejects overlap with another interval having the same Scope, Subject, and
effect. Include and exclude intervals may overlap each other because exclusion deliberately wins.

Deleting a membership row is reserved for unused setup mistakes. Once its Scope has applicability
history or the exact cell has Update history, deletion is rejected; end the membership instead.

### Re-adding the Subject

A later include interval makes the Subject current again. Old exact-cell Updates remain available
and may once again supply the cell's most recent evidence. Review or cadence calculations will show
the cell as due if that retained evidence is stale. Re-entry does not clone or rewrite history.

## Changing a Thread Scope and its Commitments

A Thread has one declared application mode: `open`, `inherited`, `explicit`, or `derived`. The UI
expresses the user-owned choice as inheriting the Focus or using a custom Thread Scope. Changing it
does not delete the Thread.

Every actual declared application change appends an immutable transition:

```ts
{
  owner: { type: 'thread', id: 42 },
  from: { mode: 'explicit', scopeId: 7 },
  to: { mode: 'explicit', scopeId: 9 },
  changedAt: '...'
}
```

Assigning the same declaration again is a no-op: it does not change `updatedAt` or append a duplicate
transition.

Every surviving Focus, Thread, and Commitment retains exactly one current application row. A
Commitment row is an enforced projection rather than a user declaration: Thread-owned Commitments
must be `inherited`, and Focus-owned Commitments must be `open`. Direct mutation or deletion of that
row is rejected. Rows and transitions disappear only with their owner's hard-delete cascade.

After changing application:

- current matrices resolve from the new effective Scope;
- evidence stored under the former Scope remains returned by the owner's Update repository;
- former evidence does not participate in the new current matrix;
- switching back to the former Scope makes its retained exact-cell evidence relevant again; and
- every Thread-owned Commitment follows the Thread's new effective Scope without changing its own
  derived application row.

The Commitment's initial history records its enforced `inherited` state. Changes to its effective
Scope are observable through the Thread application history that actually changed. The model does
not manufacture duplicate transitions on every Commitment.

There is no independent “remove this Thread only for Subject A” record. To narrow one Thread without
changing every consumer of a shared Focus Scope, create a Focus-owned expression based on the
broader Scope, add a Subject exclusion, and apply that narrower Scope to the Thread. Its Commitments
follow automatically.

## Moving a Commitment between parent contexts

A Commitment may move among Overall and Threads inside its existing Focus. A cross-Focus move is
rejected both by the repository and SQLite. The operation is planned before it is written and then
executed in one transaction.

The Commitment is the durable owner of its Updates, Todos, and Notes. Moving it changes only the
Commitment's parent columns; those child rows keep the same Commitment id, record ids, content,
ordering placements, and exact historical `{scopeId, subjectId}` attribution. No subtree record is
copied or deleted. This also makes a Commitment with no Updates a normal, valid move rather than a
special case.

The planner compares the canonical Subjects effective in the source context with those effective in
the destination context:

- when the destination is an exact match or a superset, no Scope definition changes and the UI moves
  immediately without a confirmation dialog;
- when canonical Subjects are missing, the plan lists those exact Subject ids and names and requires
  confirmation before writing;
- a confirmed Thread destination forks/widens one isolated overlay and applies it to that Thread;
- a confirmed Overall destination adds the missing canonical Subjects to the Focus Scope; and
- custom-source evidence keeps its original Scope cell. Scope definitions and evidence history are
  never structurally rewritten merely because ownership changed.

Confirmation is stale-plan-safe: execution recomputes the plan transactionally and accepts only the
exact set of Subject ids the user confirmed. If applicability changed after preview, the operation
is rejected instead of silently widening a different population.

After reparenting, Thread ownership derives `inherited` Commitment applicability from the new Thread;
Overall ownership remains Open. Existing cells under another Scope remain durable evidence and use
the established current/former projections. New bounded evidence uses the destination Thread's
current effective Scope. Each actual move appends an immutable `commitment_parent_transitions` row;
the initial parent is also recorded, so Thread-to-Thread moves remain observable even though the
Commitment's declared Scope mode stays `inherited`.

## Moving a Thread between Focuses

Cross-Focus movement preserves the Thread, every Commitment below it, and their Updates, Todos,
Notes, Subject completion cells, and sort placements. The move changes ownership, not identity.
The plan/move boundary distinguishes two applicability outcomes:

- Open or inherited follows the destination Focus. Exact/superset Subject coverage moves directly;
  missing canonical Subjects require confirmation and are added to the destination Focus atomically.
- Explicit or derived custom applicability is copied as a complete Scope graph into the destination
  Focus and remains custom. It never changes the destination Focus's own population.

Exact retained evidence needs an additional rule: a `{scopeId, subjectId}` cell cannot keep a Scope
owned by the old Focus. Every referenced Scope, including bases and derived dependencies, is copied
and the exact Update/Todo/list cell is remapped to its corresponding copy. The Subject is canonical
and keeps its id. Matching destination Subject membership is useful for current applicability but
is not sufficient reason to rewrite historical evidence onto the destination's unrelated Scope.

The transaction uses a short-lived `thread_move_operations` row as an authorization capability.
Database triggers reject raw Thread Focus changes, reject ordinary Todo context mutation, and reject
finishing an operation while any current application or exact descendant record still refers to a
Scope outside the target Focus. Any validation, cloning, remapping, or reconciliation failure rolls
back the destination widening and the parent change together. Immutable
`thread_parent_transitions` answers where the Thread began and every Focus it subsequently entered.

## Deleting a Subject

Subject deletion is intentionally restrictive. It is rejected while the Subject is referenced by:

- any active or ended Scope membership;
- any Scope as derived context; or
- any scoped Update.
- any scoped Todo.

This means a Subject that participated in durable applicability or evidence normally cannot be hard
deleted. Ending membership removes it from current work but preserves identity and history. A future
archive or anonymization feature should be used for privacy/lifecycle needs that require hiding the
Subject without corrupting attribution.

Only a completely unreferenced Subject can currently be hard deleted. Subject deletion therefore
does not normally cascade into a Scope, Thread, Commitment, or live Update. Independently, every
Update delete is protected by the database archive trigger; if a future Subject lifecycle performs
a cascade, the exact Update cell is rescued before its Subject foreign key disappears.

## Deleting a Thread

Thread deletion is a hard cascade from the live hierarchy. It removes:

- the Thread;
- direct Thread Updates;
- Thread lifecycle-status transitions;
- the Thread's Scope application and application-transition history;
- child Commitments;
- those Commitments' Updates, lifecycle histories, and application histories; and
- all current matrix projections derived from those records.

It does **not** remove:

- the parent Focus;
- Focus-owned Scope definitions;
- Scope membership intervals;
- Subjects; or
- Focus-owned Commitments outside the Thread.

After deletion there is intentionally no live Thread or Thread lifecycle audit. Its direct Updates
and its Commitments' Updates are first copied into `archived_updates`, retaining their former parent
and exact Scope/Subject ids, readable hierarchy labels, effective sensitivity, and deletion time.
Those rescued Updates are retained for 30 days unless permanently cleared sooner. Use `done` or
`cancelled` when the complete hierarchy should remain queryable in ordinary screens; the Update
archive is recovery evidence, not a soft-deleted Thread model.

## Deleting a Commitment

Commitment deletion behaves like the narrower Thread cascade. It removes the Commitment and its
Updates from the live hierarchy plus lifecycle transitions, Scope application, and application-
transition history. Every deleted Update is first copied to `archived_updates`; its parent, Scope,
memberships, and Subjects otherwise remain.

Closing a Commitment with `done` or `cancelled` retains all of those records and is the correct
operation when the user wants historical accountability rather than erasure.

## Deleting a Scope

An individual Scope may be hard deleted only while it is unused. Deletion is rejected if:

- any Update references it; or
- any current or historical application transition references it.

Application history therefore continues to resolve to a real Scope record. Removing every current
application does not make a previously applied Scope deletable; its historical use is meaningful.

Structural Scope fields—dimension, base Scope, derived relationship, and contextual Subject—also
become immutable once membership, applicability, dependent Scope, or Update history exists. Rename
and sensitivity may still change because they do not redefine population semantics. To change a
used Scope's structure, create a new Scope and apply it; the application transition records the
change.

Deleting an unused Scope cascades its unused membership rows. Deleting the owning Focus is different:
the established Focus cascade removes the entire Focus tree, including its Scopes and application
history, while global Subjects survive.

## Current and historical observation surfaces

| Question | Model surface | Meaning |
| --- | --- | --- |
| What does this owner declare now? | `scopeApplication()` / `scopeApplications.get(owner)` | Current mode, declared Scope, effective Scope, and immediate inheritance source. |
| How did its declaration change? | `scopeApplicationHistory()` / `scopeApplications.history(owner)` | Immutable declared application transitions in insertion order. |
| Who belongs to this Scope on a date? | `scope.effectiveSubjects(date)` | Base plus effective includes minus effective exclusions. |
| Why was a Subject included or excluded? | `scopeMemberships.listForScope(scopeId)` | Durable include/exclude intervals and their boundaries. |
| Which Thread reviews exist now? | `thread.scopeMatrix(date)` | One current review cell per Subject effective in the Thread's current Scope. |
| Which Commitment obligations exist now? | `commitment.scopeMatrix(date)` | One current state/cadence cell per Subject effective in the Commitment's current Scope. |
| What evidence ever belonged to an owner? | `updates.listForThread/Commitment(id)` | All retained Updates, including cells from former applications or ended memberships. |
| How did lifecycle status change? | `statusHistory()` | Immutable active/paused/done/cancelled transitions; separate from applicability. |
| Which Focus owned this Thread over time? | `thread.parentHistory()` | Immutable initial ownership and completed cross-Focus moves. |

`scopeMatrix(date)` uses the owner's **current** application and resolves that Scope's membership on
the supplied date. It is a current-model projection with dated membership, not application-history
time travel. To explain a former application, inspect application transitions and the retained
Updates carrying exact cell attribution.

Commitment projections retain the established behavior that a future-dated Update immediately
supplies current state and cadence. Thread review cells and Focus review dates ignore Updates after
their projection date. Explicit aggregate review pokes are separate evidence: a Thread poke can
advance the aggregate date but never rewrites or satisfies its per-Subject cells, and a Commitment
poke never changes Update-derived state or cadence.

## UI implications for the next phase

- Present “remove Subject from Scope” as an effective-date operation, not record deletion.
- Present “change Scope” separately from deleting the Thread. A Commitment has no Scope action.
- Show application history alongside membership history when explaining former evidence.
- Warn that hard-delete removes the owner, evidence, and its audit trails; offer `done` or
  `cancelled` when preservation is likely intended.
- Do not hide retained Updates merely because their cell is no longer current. Historical views
  should label the former Scope and Subject explicitly.
- For inherited applications, explain both the child's declared `inherited` state and the ancestor
  transition that changed its effective Scope.

## Implemented Thread working context

The Thread screen applies those rules through a Subject working-context lens. Scope definition and
evidence entry are deliberately separate controls and locations:

1. The Thread context drawer owns Scope definition. `Inherit Focus scope` follows the Focus's
   effective Subject set; `Custom scope` exposes an inline Subject token editor for the Thread's
   override. There is no third Scope choice.
2. All Subjects displays currently applicable direct Thread Updates in its main list. Retained
   evidence for Subjects that are no longer applicable, plus old unscoped evidence after the owner
   becomes bounded, remains editable in a bottom Former scope updates accordion that is closed by
   default. Its Add Update dropdown requires one current Subject choice, immediately creates that
   exact cell, and leaves the new card editable in the overview.
3. A selected Subject displays and creates direct Thread Updates for its exact current
   Scope/Subject pair.
4. The same Subject lens includes only child Commitment matrices that contain that canonical
   Subject, using the Commitment cell rather than its aggregate rollup.
5. If the selected Subject leaves the Thread Scope, the lens returns to All Subjects. The prior
   Update remains visible there with its original cell and is labeled as former while that canonical
   Subject is not currently applicable. Re-applying the Subject moves the card back to the main list
   and restores its ordinary current label, even when the operation created a replacement overlay
   Scope id.
6. If the Thread has no effective Subjects, no context tab bar is shown and direct Updates are
   stored Thread-wide and unscoped. Adding effective Subjects restores the tabs and exact-cell
   creation.
7. The selected canonical Subject follows navigation among Threads and Commitments in the same
   Focus. Each Focus remembers its own selection for the current application session. A destination
   that does not contain that Subject normalizes the Focus selection to All Subjects.
8. A Thread-owned Commitment has no Scope controls. Its working-context projection always resolves
   the Thread's current effective Scope. Commitments created before a custom Thread Scope therefore
   gain the same tabs and exact-cell Update creation as Commitments created afterward. If the Thread
   is unbounded, its Commitments use an unscoped stream.

The working selector and Commitment projection remain current-matrix views. The All Subjects Update
list is deliberately broader. Its current/former label describes canonical Subject applicability,
not raw Scope identity, so replacement overlays do not make an unchanged or re-added Subject appear
former. The persisted Update still retains its original exact cell, and new evidence uses the
replacement Scope id; no evidence silently crosses an application boundary.

The main Thread canvas never renders Scope-definition controls. It only consumes the resulting
matrix as an operational working context. Scope mutations cross named Focus or Thread Scope IPC
methods; generic drawer choice and token-list fields own the interaction markup while feature
presenters own the mapping to typed domain operations.
