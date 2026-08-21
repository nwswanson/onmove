# OnMove MCP server implementation plan


## Executive decision

OnMove does not need a general-purpose query engine, a user-visible query language, GraphQL, or an
MCP tool that executes arbitrary SQL.

It does need a typed application-query facade between protocol adapters and the existing domain
repositories. Electron IPC and MCP should both call this facade so they share hierarchy resolution,
Scope rules, sensitivity policy, mutation invariants, and result contracts.

Broad natural-language discovery uses a bounded SQLite FTS5 projection. That is a
search index, not a general query engine.

## Goals

- Let local MCP clients inspect OnMove's Focus, Thread, Commitment, Routine, Update, Todo, Note,
  Subject, Scope, Review, Due, and Tag data.
- Add useful Updates, Todos, and review actions without bypassing domain validation.
- Preserve exact Thread/Commitment Subject-cell semantics for scoped work.
- Prevent accidental disclosure of sensitive records by default.
- Run as an explicitly enabled capability of the open Electron application.
- Keep SQLite as the only durable source of truth.
- Ship the MCP server inside the macOS application without a helper process or separately installed
  runtime.
- Keep the MCP protocol adapter thin enough that another adapter could be added later.

## Non-goals

- Do not expose arbitrary SQL.
- Do not expose raw tables or migration-specific column names as the public contract.
- Do not let an MCP caller bypass archive, status-transition, Scope, review, or hierarchy rules.
- Do not make the renderer or its view models an MCP dependency.
- Do not add embeddings or a vector database for the first release.
- Do not expose destructive delete or cross-parent move tools in the first write-capable release.
- Do not treat the sensitive flag as encryption or an operating-system security boundary.

## Current readiness

OnMove already has most of the model layer required by an MCP server:

- `DomainStore` exposes repositories for the complete current domain.
- Shared snapshots and typed inputs already define a receiver-neutral data contract.
- Review, Due, Todo, Tag, archive, Routine, and Focus timeline repositories already provide
  cross-entity projections.
- Repositories own model validation and derived state.
- SQLite is accessed through a narrow adapter and already uses WAL mode.
- Update deletion rescue is enforced at the database boundary.
- The database path is durable under the Electron user-data directory.

The missing pieces are:

- A shared application service above the repositories.
- Server-side effective-sensitivity filtering.
- An MCP protocol and transport entry point.
- A live server controller owned by the Electron main process.
- Loopback transport lifecycle, port-conflict handling, and UI invalidation after MCP writes.
- Optional full-text search over plain-text rich-text projections.

## Architecture

```text
Electron renderer -- IPC -------+
                                |
MCP client -- loopback HTTP -----+--> running Electron main process
                                      |  OnMoveQueryService
                                      |  OnMoveCommandService
                                      |  OnMoveAccessPolicy
                                      |           |
                                      +------> one AppDatabase / DomainStore
                                                   |
                                                 SQLite
```

The adapters own transport-specific concerns only:

- Electron IPC maps IPC calls to application-service calls and broadcasts UI invalidations.
- MCP maps JSON Schema inputs and MCP results to the same application services.
- Neither adapter owns domain validation or writes SQL.

### Proposed service contracts

The exact types can evolve, but the ownership boundary should resemble:

```ts
interface OnMoveAccessPolicy {
  sensitiveContent: 'deny' | 'allow'
  permissionPolicy: {
    defaults: Record<ResourceType, { view: boolean; edit: boolean }>
    overrides: SparseFocusOrThreadOverride[]
  }
}

interface OnMoveQueryService {
  listFocuses(input: ListFocusesQuery, access: OnMoveAccessPolicy): FocusSummary[]
  getEntity(input: EntityQuery, access: OnMoveAccessPolicy): EntityContext | null
  getReviews(input: ReviewQuery, access: OnMoveAccessPolicy): ReviewOverview
  getDue(input: DueQuery, access: OnMoveAccessPolicy): DueOverview
  getTodos(input: TodoQuery, access: OnMoveAccessPolicy): TodoOverview
  getTags(input: TagQuery, access: OnMoveAccessPolicy): TagOverview
  search(input: SearchQuery, access: OnMoveAccessPolicy): SearchResult[]
  browseHierarchy(input: HierarchyBrowseQuery, access: OnMoveAccessPolicy): HierarchyPath[]
  reviewSubject(input: SubjectReviewQuery, access: OnMoveAccessPolicy): SubjectReview
}

interface OnMoveCommandService {
  createFocus(/* ... */): FocusSnapshot
  updateFocus(/* ... */): FocusSnapshot
  createThread(/* ... */): ThreadSnapshot
  updateThread(/* ... */): ThreadSnapshot
  createCommitment(/* ... */): CommitmentSnapshot
  updateCommitment(/* ... */): CommitmentSnapshot
  createRoutine(/* ... */): RoutineSnapshot
  updateRoutine(/* ... */): RoutineSnapshot
  createUpdate(input: CreateApplicationUpdate, access: OnMoveAccessPolicy): UpdateSnapshot
  reparentUpdate(input: ReparentApplicationUpdate, access: OnMoveAccessPolicy): UpdateSnapshot
  createTodo(input: CreateApplicationTodo, access: OnMoveAccessPolicy): TodoSnapshot
  updateTodo(input: UpdateApplicationTodo, access: OnMoveAccessPolicy): TodoSnapshot
  pokeReview(input: PokeApplicationReview, access: OnMoveAccessPolicy): ReviewTargetSnapshot
}
```

The services should return application contracts rather than MCP content blocks. The MCP adapter
owns conversion to structured MCP output and compatible text output.

## Query design

### No general query engine

The model should not be asked to construct SQL, know table layouts, or understand internal join
paths. Arbitrary querying would create several problems:

- It would expose schema details that migrations are allowed to change.
- It would make hierarchical sensitivity enforcement unreliable.
- It could bypass Update archival and status-transition auditing.
- It would let callers write derived fields that are intentionally read-only.
- It would make Scope and Subject-cell validation optional rather than mandatory.
- It would be difficult to bound output size and query cost.

Instead, add coarse application queries that return enough context in one call. Avoid an MCP design
that requires many small N+1 calls to reconstruct one Thread or Commitment.

### Entity context

Every entity read should include a stable context path:

```text
Focus
Focus > Thread
Focus > Thread > Commitment
Focus > Thread > Subject
Focus > Thread > Commitment > Subject
```

Where relevant, the response should also contain:

- Lifecycle status.
- Derived state and review dates.
- Due date and parent-date warning information.
- Effective Scope and Subject cells.
- Direct Updates, Todos, Routines, and default Note.
- Whether content is directly or effectively sensitive.
- Stable OnMove entity references suitable for later deep links.

Rich text should be returned as readable plain text by default. Raw Lexical envelopes should not be
the model-facing representation.

## Initial MCP surface

The first server should expose a small purposeful tool set rather than mirror every repository
method.

### Read tools

- `onmove.list_focuses`
- `onmove.get_focus_by_id`
- `onmove.get_focus_by_path`
- `onmove.search_focuses`
- `onmove.get_thread_by_id`
- `onmove.get_thread_by_path`
- `onmove.search_threads`
- `onmove.get_commitment_by_id`
- `onmove.get_commitment_by_path`
- `onmove.search_commitments`
- `onmove.get_routine_by_id`
- `onmove.get_routine_by_path`
- `onmove.search_routines`
- `onmove.get_update_by_id`
- `onmove.get_updates_by_ids`
- `onmove.search_updates`
- `onmove.get_note_by_id`
- `onmove.get_note_by_path`
- `onmove.search_notes`
- `onmove.search_todos`
- `onmove.search_subjects`
- `onmove.list_routines`
- `onmove.get_reviews`
- `onmove.get_due`
- `onmove.get_todos`
- `onmove.list_tags`
- `onmove.get_tag_uses`
- `onmove.search`
- `onmove.review_subject`

`onmove.search` is also a queryless structured list and bounded hierarchy browser. `text=null`
lists records without FTS; one `projection` object controls hierarchy, Subject, Scope, and rich-text
expansion. A Subject
name match automatically returns bounded attributed `subjectUses` plus every currently applicable
Subject-cell path. Responses define
both explicit object notation and a readable form such as `Team management > 1:1s[Michael]`.
Subject mode accepts `text=null` to list attributed records without inventing a dummy text term;
request the Subject projection when current applicability paths are also needed.

Discovery is Subject-first when the request names a person or other canonical Subject. The initial
name search returns `subjectUses`, which is authoritative for attributed records, plus an explicit
`searchStatus`. `sufficient=true` or `doNotBroaden=true` tells the client to stop discovery and fetch
the returned IDs directly rather than searching globally for a generic hierarchy label. A response
also returns `namedSubjectDiscovery`, colocating the canonical Subject ID, applicable Focus/Thread
paths, and ready Subject-review calls. It returns an opaque signed continuation token when another
page exists. Initial
searches omit that field or send null; clients must never synthesize it, and validation rejects only
a supplied non-null invalid token. A next-page request contains only the exact token; it preserves
text, date ranges, timezone, scope, sort, kinds, projection, byte budget, and stable cursor.
Starting without the token is required to intentionally change the query. Named scopes support
`all`, `focus`, `thread`,
`subject`, and the explicitly requested live `current` context.

Search always returns records. Optional projections are trimmed before record pages to enforce the
configured byte budget. Compact search defaults to ten records, caps pages at 25, and returns
explicit `hasMore`.

`onmove.review_subject` is the high-level alternative to a multi-query agent workflow. It resolves
an exact Subject inside an exact Thread and returns one compact projection containing that Subject's
Updates in the Thread and its child Commitments (ordered by `updatedAt`), open exact/shared Todos,
and currently applicable open Commitments with Subject-cell state. Its resolved response is a hard
stopping signal and supplies a continuation token restricted to that Subject × Thread intersection.
All hierarchy selectors take either one ID or one title/name. Dual selectors are rejected as
conflicts. Exact resolution does not guess through shorthand; a safe token/title overlap can instead
return bounded Thread candidates with exact-ID retry data. Direct Thread and Commitment reads are
compact by default, allow opt-in lossless rich text, and degrade unsupported individual documents to
diagnostic warnings without losing the rest of the response.

Read tools should support bounded filters such as status, date range, parent, Subject, open/closed,
and result limit. They should not accept raw SQL fragments or arbitrary field expressions.

### Write tools

Add writes only after concurrency, invalidation, and audit work is complete:

- `onmove.create_update`
- `onmove.reparent_update`
- `onmove.create_todo`
- `onmove.update_todo`
- `onmove.complete_todo`
- `onmove.poke_review`

The server omits generic delete, import, archive-clear, and arbitrary move/status tools. The narrow
`reparent_update` correction is an explicit exception: it changes only an existing Update's typed
parent and exact current Subject cell, preserves the record and rich-text revision, validates both
source and destination permissions, audits the move, and returns the previous destination for undo.

### Resources

Use stable custom resource URIs and resource templates:

```text
onmove://focus/{id}
onmove://thread/{id}
onmove://commitment/{id}
onmove://routine/{id}
onmove://reviews
onmove://due
onmove://todos
onmove://tags/{name}
```

`resources/list`, resource templates, and `resources/read` must use the same query service and
access policy as tools. A tool must never reveal a record that the equivalent resource would hide.

Prompts are optional and are not required for the first release.

## Scope-aware command behavior

MCP callers should not need to provide internal Scope IDs for ordinary actions.

For example, `onmove.create_update` should accept:

- A typed parent reference.
- An optional canonical Subject ID.
- The semantic hierarchy path whenever the user's wording names a Subject.
- Date, state, observation, and sensitivity.

The command service should resolve the parent's current effective Scope and translate the Subject
into the exact `Scope x Subject` cell required by the model.

Rules:

- An Open Thread with no effective Subjects accepts an unscoped Update.
- A scoped Thread or Commitment requires a currently applicable Subject.
- A removed or unrelated Subject is rejected.
- A semantic path such as `1:1s[Michael]` cannot be flattened onto an unscoped or different parent.
- Historical Updates retain their original exact cell.
- A misplaced Update can be reparented without recreating its content or revision history.
- MCP does not narrow a Scope merely because the caller chooses one Subject.
- Routine attestations remain independently matrixed per applicable Subject.

## Sensitive-content policy

### Product setting

Add an MCP-specific application setting:

> Allow MCP access to sensitive content

It should default to off. The application's View-menu preference for displaying sensitive content
must not implicitly grant an external model access.

The access decision is server configuration, not a tool argument. Do not add an
`include_sensitive: true` argument that the model can use to grant itself access.

Ordinary View/Edit permission is controlled separately from sensitive access. It is a sparse,
hierarchical capability policy rather than one mutation switch:

```ts
{
  sensitiveContent: 'deny' | 'allow',
  permissionPolicy: {
    defaults: {
      focus: { view: true, edit: false },
      // thread, commitment, routine, update, todo, note, subject
    },
    overrides: [
      { target: { type: 'focus', id: 12 }, resource: 'all', view: false, edit: false },
      { target: { type: 'thread', id: 31 }, resource: 'note', view: true, edit: true }
    ]
  }
}
```

Resolve defaults first, then Focus wildcard/resource overrides, then Thread wildcard/resource
overrides; the most specific non-inherited field wins, and Edit is effective only with View. Store
only explicit exceptions. This supports default-deny whitelists and default-allow blacklists without
creating a rule for every Focus or Thread.

The effective policy should be re-read or invalidated when settings change so a long-running MCP
session cannot retain stale permission.

### Effective sensitivity

Sensitivity cascades through hierarchy and through the Subject dimension.

Conceptually:

```text
effectiveSensitive =
  focus.sensitive
  OR owningThread.sensitive
  OR owningCommitmentOrRoutine.sensitive
  OR scopedSubject.sensitive
  OR record.sensitive
```

Specific behavior:

- A sensitive Focus hides its entire hierarchy.
- A sensitive Thread hides its Commitments, Routines, Updates, Todos, Note, and scoped cells.
- A sensitive Commitment hides its Updates, Todos, and Note.
- A sensitive Routine hides its templates, Runs, cells, attestations, notes, and issues.
- A sensitive Subject hides that Subject and all cell-specific evidence/work for it.
- A sensitive Update hides only itself unless an ancestor is also sensitive.
- Todos and Notes without their own sensitive flag inherit effective sensitivity from their owner
  and Subject cell.

This calculation belongs in a main-process/application policy module, not in renderer helpers or
individual MCP handlers.

### Read behavior when denied

- Filter sensitive branches before response assembly; do not return redacted placeholders.
- Recompute Review, Due, Todo, Routine, Tag, search, and navigation counts after filtering.
- Omit tags whose uses are all sensitive.
- Omit sensitive resources from `resources/list`.
- Return the same not-found result for a hidden ID and an unknown ID to avoid an existence oracle.
- Do not include sensitive titles, snippets, counts, context paths, or Subject names in errors.
- Apply policy to structured content, text fallbacks, logs, resource links, and MCP metadata.

### Write behavior when denied

- A hidden parent cannot be targeted by ID.
- A hidden Subject cannot be selected for a scoped command.
- Requests explicitly setting `sensitive: true` are rejected.
- A mutation may not move visible content into a hidden hierarchy.
- A mutation may not clear sensitivity on a record the caller cannot read.
- Validation errors must not disclose hidden hierarchy details.

When sensitive access and mutations are both allowed, the server may operate on sensitive records.
The result should retain `sensitive` and `effectiveSensitive` metadata so an authorized caller can
reason about the content, but MCP annotations must not be treated as a substitute for server-side
filtering.

### Security boundary

This policy reduces accidental disclosure to a model. It is not encryption. A local MCP host runs
as the signed-in macOS user and may have other filesystem tools capable of reading application
files. OnMove can guarantee what its MCP server returns, but it cannot revoke unrelated permissions
granted to another tool.

## Transport and packaging

### Transport: application-owned Streamable HTTP

Use the official TypeScript MCP server SDK and its Streamable HTTP handler:

- `@modelcontextprotocol/server`
- `@modelcontextprotocol/node`
- `zod`
- A dedicated transport adapter in `src/mcp`.
- A runtime controller initialized by Electron after its `AppDatabase` is ready.

The listener binds explicitly to `127.0.0.1`, exposes only `/mcp`, and applies localhost Host and
Origin validation. The server starts and stops from a persisted Settings toggle, remains unavailable
while OnMove is closed, and uses the exact application-service and database instances backing the UI.

### macOS packaging

No standalone executable is packaged. MCP is part of the existing signed Electron main bundle, so
there is no second runtime, database opener, migration owner, or helper-signing surface. MCP clients
connect to the URL shown in OnMove Settings, for example:

```text
http://127.0.0.1:47832/mcp
```

The port is configurable so a collision does not require changing application code. Enabling the
server is independent from granting sensitive reads or safe writes.

Relevant protocol references:

- [MCP server concepts](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [MCP resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Official TypeScript server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)

## In-process coordination and migration ownership

MCP does not open SQLite. Electron runs migrations once and constructs one `AppDatabase`; UI IPC and
MCP requests call the application services on that same instance. WAL mode and a bounded busy timeout
remain useful database safeguards, but they are not the MCP coordination mechanism.

Before enabling MCP writes:

- Add a bounded SQLite `busy_timeout` or equivalent retry policy.
- Keep write transactions short.
- Serialize domain writes through the existing synchronous repositories and short transactions.
- Keep Electron as the sole migration and database-lifecycle owner.
- Stop accepting HTTP requests before closing the application database.

The read-only server may still need a schema compatibility check, but should not mutate schema merely
because an MCP client listed tools.

## Live change propagation

After a successful `OnMoveCommandService` mutation, the MCP adapter invokes the main process's generic
domain-change callback. Electron then refreshes every open renderer's active projections and badges.
No polling or second-connection detection is involved.

Requirements:

- MCP-created Updates and Todos appear without restarting OnMove.
- Review, Due, Todo, Routine, Tag, and navigation badges refresh.
- A deleted or moved active selection resolves through the existing navigation defaults.
- Rich-text editors do not lose local selection due to unrelated MCP refreshes.
- Multiple OnMove windows observe the same committed change.

## Mutation auditing

Status-transition and archive invariants already exist, but MCP actions should be observable as an
origin.

Add a small audit record for successful MCP mutations containing:

- Timestamp.
- Tool name.
- Entity type and ID.
- Mutation category.
- MCP server/client identity when available.
- Whether the operation affected sensitive content.

Do not record full sensitive text in audit rows or logs. Validation failures may be logged without
payload content.

## Search plan

### First release

Implement bounded structured search over:

- Focus, Thread, Commitment, and Routine titles.
- Subject names.
- Tags and Tag uses.
- Status, state, due date, and review state filters.

This can use repository-owned SQL and existing indexes.

### Later FTS5 projection

If users need broad content search, add a migration-backed FTS projection with a companion metadata
table containing:

- Entity type and ID.
- Field name.
- Plain text extracted from Lexical.
- Focus/Thread/Commitment ownership.
- Subject ID where applicable.
- Direct sensitivity metadata.
- Updated timestamp.

Effective ancestor sensitivity should be resolved at query time or reliably reindexed when an
ancestor changes. Do not search raw Lexical JSON as if it were plain text.

Index updates should occur through the same rich-text persistence/application service used by
Electron and MCP. A migration should backfill existing rich text by parsing the versioned envelopes.

## Implementation phases

### Phase 1: Shared application boundary

- Introduce `OnMoveQueryService`, `OnMoveCommandService`, and `OnMoveAccessPolicy`.
- Move orchestration out of IPC handlers without changing renderer contracts.
- Add typed entity references and context snapshots.
- Add plain-text rich-text projection helpers.
- Add central effective-sensitivity tests for every hierarchy level and Subject cell.

Exit criteria:

- Electron behavior remains unchanged.
- IPC and direct service tests produce identical snapshots.
- No application service exposes UI types or raw SQL.

### Phase 2: Read-only MCP server

- Add the official MCP server SDK and input schemas.
- Register read tools and resource templates.
- Enforce `sensitiveContent: deny` by default.
- Add output limits and pagination/cursors where collections can grow.
- Return structured content plus a readable text fallback.
- Add a schema compatibility check.
- Test through the MCP SDK client and MCP Inspector.

Exit criteria:

- The enabled server can inspect the complete visible hierarchy through the running application.
- Sensitive records, derived counts, errors, and logs do not leak while access is denied.
- No read tool mutates SQLite.

### Phase 3: Live macOS application host

- Add the persisted Run MCP server toggle and configurable loopback port.
- Start the HTTP server only after the application's database and services are ready.
- Apply localhost Host and Origin validation and expose only the MCP route.
- Show the active endpoint and startup errors in Settings.
- Add runtime lifecycle and port-conflict tests.

Exit criteria:

- A client can connect to the URL shown by the exported `.app` while it is open.
- Disabling or quitting OnMove removes the endpoint.
- The server and UI use one `AppDatabase` instance.

### Phase 4: Safe writes and live invalidation

- Keep SQLite transactions short and bounded.
- Add a generic in-process domain-change notification from MCP to Electron windows.
- Add the initial non-destructive write tools.
- Resolve Subject input to exact effective Scope cells in the command service.
- Add mutation origin auditing.
- Refresh active UI models and badges after MCP commits.

Exit criteria:

- MCP-created Updates and Todos persist and appear live in every OnMove window.
- Scoped writes cannot be assigned to the wrong or former Subject cell.
- Existing archive and transition invariants remain intact.
- Read-only and sensitive-access settings are enforced on every write path.

### Phase 5: Full-text search

- Add the FTS5/plain-text projection migration.
- Backfill current documents.
- Update the index through shared persistence services.
- Add ranked, bounded `onmove.search` results with context links.
- Verify sensitivity changes immediately affect search visibility.

## Test strategy

### Unit tests

- MCP input schemas and output conversion.
- Entity context assembly.
- Plain-text rich-text projection.
- Effective sensitivity at each hierarchy level.
- Sensitive Subject-cell behavior.
- Hidden-vs-missing error equivalence.
- Scope resolution for Update and Todo creation.
- Output limits and cursor validation.

### Repository and integration tests

- Every tool against a temporary migrated SQLite database.
- Old and newer compatible schema handling.
- Electron-style and MCP-style calls against one application service instance.
- Runtime enable/disable, restart, port conflict, and rollback behavior.
- Update rescue after MCP-triggered cascades.
- Status-transition and review audit preservation.
- In-process domain-change invalidation after commit.

### Protocol tests

- Initialize and capability negotiation.
- `tools/list`, `tools/call`, resource listing, templates, and resource reads.
- Structured output validation.
- Streamable HTTP negotiation over the loopback endpoint.
- Host and Origin rejection for non-local browser traffic.
- Graceful listener shutdown before database close.
- Legacy-client behavior only if explicitly supported by the selected SDK configuration.

### Packaged E2E tests

- Enable the endpoint in `OnMove.app` on macOS.
- Connect to the running application's configured loopback URL.
- Write an Update/Todo and observe it immediately in the same live UI.
- Toggle MCP sensitive access and verify immediate enforcement.
- Disable the server and verify the endpoint closes.

## Acceptance criteria

- No MCP endpoint accepts SQL or schema-specific query fragments.
- MCP and Electron share application services and domain repositories.
- Sensitive access defaults to denied and cannot be overridden by a tool argument.
- Effective sensitivity includes ancestors and the scoped Subject.
- Hidden content does not leak through counts, tags, snippets, errors, resources, or logs.
- MCP reads work only while the explicitly enabled Electron application is open.
- MCP and Electron writes use the same database and application-service instances.
- The open UI observes MCP writes without restart.
- Scoped commands preserve exact `Scope x Subject` attribution.
- Rich text is model-readable and remains durable in its current versioned storage format.
- The packaged application requires no external MCP runtime installation.
- All new behavior has unit, integration, protocol, and packaged E2E coverage appropriate to its
  phase.

## Open decisions

- Whether the first public release is read-only or includes the initial safe writes.
- Whether remote, authenticated transport should ever supplement the loopback-only endpoint.
- Whether generic full refresh remains sufficient or a typed change journal becomes worthwhile.
- Whether MCP sensitive access is one checkbox or separate read/write-sensitive permissions.
- Whether mutation audit history is user-visible in the first MCP release.
- Which MCP hosts must be verified before release.
- What result limits and pagination defaults are appropriate for real OnMove databases.
