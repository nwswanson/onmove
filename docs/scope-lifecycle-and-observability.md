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
│   └── Commitment ─ applies one effective Scope or remains Open
└── Commitment ─── applies one effective Scope or remains Open

Thread/Commitment × Scope × Subject = current matrix cell
Update = durable evidence attributed to one exact cell
```

Subjects are global canonical records. Scopes belong to a Focus. Threads and Commitments consume a
Scope; they do not own it. Consequently, deleting a Thread or Commitment never deletes a Scope or
Subject.

## Removing a Subject from an applicable Scope

The normal operation is to end an include membership or add an effective-dated exclusion. Membership
intervals are half-open: `[effectiveFrom, effectiveUntil)`.

When the Subject stops being effective:

- the Subject disappears from current Thread and Commitment matrices using that Scope;
- it no longer contributes current Thread health, review coverage, Commitment state, or cadence;
- the Thread, Commitment, Scope, and Subject remain durable;
- existing Updates retain their exact `{scopeId, subjectId}` attribution;
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

## Removing a Thread or Commitment from a Scope

A Thread or Commitment has one declared application mode: `open`, `inherited`, `explicit`, or
`derived`. “Remove from Scope” means changing that application to Open, inherited, or another
Focus-owned Scope. It does not delete the owner.

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

Every surviving Focus, Thread, and Commitment must retain exactly one current application row.
Direct deletion of that row is rejected at the SQLite boundary; callers change its declared mode
instead. The row and its transitions disappear only with their owning entity's hard-delete cascade.

After changing application:

- current matrices resolve from the new effective Scope;
- evidence stored under the former Scope remains returned by the owner's Update repository;
- former evidence does not participate in the new current matrix;
- switching back to the former Scope makes its retained exact-cell evidence relevant again; and
- an inheriting descendant follows the parent's new effective Scope without changing its own
  declared application row.

An inherited descendant's history records that it chose `inherited`; changes to its effective Scope
are observable through the application history of the ancestor that actually changed. The model
does not manufacture duplicate transitions on every inheriting descendant.

There is no independent “remove this Thread only for Subject A” record. To narrow one owner without
changing every consumer of a shared Scope, create a Focus-owned Scope expression based on the broader
Scope, add a Subject exclusion, and apply that narrower Scope to the Thread or Commitment.

## Deleting a Subject

Subject deletion is intentionally restrictive. It is rejected while the Subject is referenced by:

- any active or ended Scope membership;
- any Scope as derived context; or
- any scoped Update.

This means a Subject that participated in durable applicability or evidence normally cannot be hard
deleted. Ending membership removes it from current work but preserves identity and history. A future
archive or anonymization feature should be used for privacy/lifecycle needs that require hiding the
Subject without corrupting attribution.

Only a completely unreferenced Subject can be hard deleted. Subject deletion never cascades into a
Scope, Thread, Commitment, or Update.

## Deleting a Thread

Thread deletion is a hard, destructive cascade. It removes:

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

After deletion there is intentionally no application audit for the deleted Thread: hard deletion is
the product's erasure boundary. Use `done` or `cancelled` when the record and its history should
remain observable. A future soft-delete/archive model would be a separate lifecycle feature rather
than a change to Scope semantics.

## Deleting a Commitment

Commitment deletion behaves like the narrower Thread cascade. It removes the Commitment, its
Updates, lifecycle transitions, Scope application, and application-transition history. Its parent,
Scope, memberships, and Subjects remain.

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

`scopeMatrix(date)` uses the owner's **current** application and resolves that Scope's membership on
the supplied date. It is a current-model projection with dated membership, not application-history
time travel. To explain a former application, inspect application transitions and the retained
Updates carrying exact cell attribution.

Commitment projections retain the established behavior that a future-dated Update immediately
supplies current state and cadence. Thread review cells and Focus review dates ignore Updates after
their projection date.

## UI implications for the next phase

- Present “remove Subject from Scope” as an effective-date operation, not record deletion.
- Present “change Scope” separately from deleting the Thread or Commitment.
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
   override.
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

The working selector and Commitment projection remain current-matrix views. The All Subjects Update
list is deliberately broader. Its current/former label describes canonical Subject applicability,
not raw Scope identity, so replacement overlays do not make an unchanged or re-added Subject appear
former. The persisted Update still retains its original exact cell, and new evidence uses the
replacement Scope id; no evidence silently crosses an application boundary.

The main Thread canvas never renders Scope-definition controls. It only consumes the resulting
matrix as an operational working context. Scope mutations cross named Thread Scope IPC methods;
generic drawer choice and token-list fields own the interaction markup while the Thread presenter
owns the mapping to domain operations.
