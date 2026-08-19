# OnMove MCP server implementation plan

Status: Proposed  
Last updated: 2026-08-19

## Executive decision

OnMove does not need a general-purpose query engine, a user-visible query language, GraphQL, or an
MCP tool that executes arbitrary SQL.

It does need a typed application-query facade between protocol adapters and the existing domain
repositories. Electron IPC and MCP should both call this facade so they share hierarchy resolution,
Scope rules, sensitivity policy, mutation invariants, and result contracts.

Broad natural-language discovery can later use a bounded SQLite FTS5 projection. That would be a
search index, not a general query engine.

## Goals

- Let local MCP clients inspect OnMove's Focus, Thread, Commitment, Routine, Update, Todo, Note,
  Subject, Scope, Review, Due, and Tag data.
- Add useful Updates, Todos, and review actions without bypassing domain validation.
- Preserve exact Thread/Commitment Subject-cell semantics for scoped work.
- Prevent accidental disclosure of sensitive records by default.
- Work whether the Electron UI is open or closed.
- Keep SQLite as the only durable source of truth.
- Ship the MCP server as part of the macOS distribution without requiring a separately installed
  Node runtime.
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
- A packaged helper executable.
- Cross-process write contention handling.
- UI invalidation after a different process changes SQLite.
- Optional full-text search over plain-text rich-text projections.

## Architecture

```text
Electron renderer
      |
Electron IPC adapter ---------+
                              |
MCP tools/resources adapter --+--> OnMoveQueryService
                              |    OnMoveCommandService
                              |    OnMoveAccessPolicy
                              |             |
                              +--------> DomainStore
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
  mutations: 'read-only' | 'allow'
}

interface OnMoveQueryService {
  listFocuses(input: ListFocusesQuery, access: OnMoveAccessPolicy): FocusSummary[]
  getEntity(input: EntityQuery, access: OnMoveAccessPolicy): EntityContext | null
  getReviews(input: ReviewQuery, access: OnMoveAccessPolicy): ReviewOverview
  getDue(input: DueQuery, access: OnMoveAccessPolicy): DueOverview
  getTodos(input: TodoQuery, access: OnMoveAccessPolicy): TodoOverview
  getTags(input: TagQuery, access: OnMoveAccessPolicy): TagOverview
  search(input: SearchQuery, access: OnMoveAccessPolicy): SearchResult[]
}

interface OnMoveCommandService {
  createUpdate(input: CreateApplicationUpdate, access: OnMoveAccessPolicy): UpdateSnapshot
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
- `onmove.get_focus`
- `onmove.get_thread`
- `onmove.get_commitment`
- `onmove.list_routines`
- `onmove.get_reviews`
- `onmove.get_due`
- `onmove.get_todos`
- `onmove.list_tags`
- `onmove.get_tag_uses`
- `onmove.search`

Read tools should support bounded filters such as status, date range, parent, Subject, open/closed,
and result limit. They should not accept raw SQL fragments or arbitrary field expressions.

### Write tools

Add writes only after concurrency, invalidation, and audit work is complete:

- `onmove.create_update`
- `onmove.create_todo`
- `onmove.update_todo`
- `onmove.complete_todo`
- `onmove.poke_review`

The server should initially omit generic delete, move, import, archive-clear, and status-transition
tools. If those are added later, they need explicit destructive annotations, dry-run/plan support
where applicable, and client confirmation.

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
- Date, state, observation, and sensitivity.

The command service should resolve the parent's current effective Scope and translate the Subject
into the exact `Scope x Subject` cell required by the model.

Rules:

- An Open Thread with no effective Subjects accepts an unscoped Update.
- A scoped Thread or Commitment requires a currently applicable Subject.
- A removed or unrelated Subject is rejected.
- Historical Updates retain their original exact cell.
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

Mutation permission should be controlled separately:

```ts
{
  sensitiveContent: 'deny' | 'allow',
  mutations: 'read-only' | 'allow'
}
```

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

### Recommended first transport: stdio

Use the official TypeScript MCP server SDK and a local stdio transport:

- `@modelcontextprotocol/server`
- `zod`
- A dedicated `src/mcp` entry point.
- Protocol logging only on `stderr`; `stdout` is reserved for MCP JSON-RPC.

Stdio is appropriate because a local MCP host owns the child-process lifetime and no network
listener or OAuth deployment is required.

### macOS packaging

The production `.app` must not assume Node is installed globally. Package a stable helper command,
for example:

```text
/Applications/OnMove.app/Contents/MacOS/onmove-mcp
```

Candidate packaging approaches, in preferred evaluation order:

1. A bundled standalone executable built from the MCP entry point.
2. A small signed launcher backed by a bundled runtime.
3. A documented Electron `--mcp-stdio` mode only if stdout remains clean and no GUI lifecycle or
   single-instance behavior interferes with MCP.

The MCP host configuration should invoke the stable packaged path. Development may use the built JS
entry through the workspace runtime.

The helper should accept an explicit `--database` path for testing and advanced use, while defaulting
to OnMove's macOS Application Support database. Preserve the existing test override for isolated
user-data directories.

### Alternative transport

A loopback Streamable HTTP server inside the running Electron process would share the existing
database connection and notification system, but it would require OnMove to be running and would add
host/origin validation plus authorization decisions. Keep it as a later option rather than the first
local implementation.

Relevant protocol references:

- [MCP server concepts](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [MCP resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Official TypeScript server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)

## SQLite concurrency and migration ownership

A stdio MCP helper may open the same database while Electron is running. WAL mode already permits
concurrent readers and serializes writers, but OnMove needs explicit behavior for contention.

Before enabling MCP writes:

- Add a bounded SQLite `busy_timeout` or equivalent retry policy.
- Keep write transactions short.
- Test Electron and MCP connections writing concurrently.
- Define one migration owner or make migration startup locking explicit.
- Do not let two processes partially run the same migration.
- Refuse startup with a clear compatibility error when the database schema is newer than the
  packaged MCP helper understands.
- Close the SQLite connection cleanly when the MCP transport closes.

The read-only server may still need a schema compatibility check, but should not mutate schema merely
because an MCP client listed tools.

## Cross-process change propagation

Direct MCP writes will not trigger Electron's current in-process IPC invalidations. Add one of:

1. Poll `PRAGMA data_version` in the Electron main process and broadcast a generic domain-change
   invalidation when another connection commits.
2. Add a durable monotonically ordered domain-change journal and have Electron consume it.

Start with `data_version` if a full refresh of the active model and badges is inexpensive. Move to a
typed journal only when targeted invalidation or observability is necessary.

Requirements:

- MCP-created Updates and Todos appear without restarting OnMove.
- Review, Due, Todo, Routine, Tag, and navigation badges refresh.
- A deleted or moved active selection resolves through the existing navigation defaults.
- Rich-text editors do not lose local selection due to unrelated external refreshes.
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

- The server can inspect the complete visible hierarchy without Electron running.
- Sensitive records, derived counts, errors, and logs do not leak while access is denied.
- No read tool mutates SQLite.

### Phase 3: Packaged macOS helper

- Produce the standalone `onmove-mcp` executable.
- Include it in `.app` packaging and signing/notarization inputs.
- Document MCP-host configuration.
- Verify paths with spaces and a clean machine without Node installed.
- Add packaged-process protocol smoke tests.

Exit criteria:

- A client can launch the helper from the exported `.app`.
- The helper finds the durable Application Support database.
- stdout contains only valid MCP messages.

### Phase 4: Safe writes and live invalidation

- Add SQLite busy handling and concurrent-writer tests.
- Add external database-change detection in Electron.
- Add the initial non-destructive write tools.
- Resolve Subject input to exact effective Scope cells in the command service.
- Add mutation origin auditing.
- Refresh active UI models and badges after MCP commits.

Exit criteria:

- MCP-created Updates and Todos persist and appear live in every OnMove window.
- Scoped writes cannot be assigned to the wrong or former Subject cell.
- Existing archive and transition invariants remain intact.
- Read-only and sensitive-access settings are enforced on every write path.

### Phase 5: Full-text search, if justified

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
- Simultaneous Electron-style and MCP-style readers.
- Concurrent writers, busy timeout, rollback, and retry behavior.
- Update rescue after MCP-triggered cascades.
- Status-transition and review audit preservation.
- External-change invalidation after commit.

### Protocol tests

- Initialize and capability negotiation.
- `tools/list`, `tools/call`, resource listing, templates, and resource reads.
- Structured output validation.
- No non-protocol stdout output.
- Graceful shutdown and database close.
- Legacy-client behavior only if explicitly supported by the selected SDK configuration.

### Packaged E2E tests

- Launch the helper from `OnMove.app` on macOS.
- Read the same fixture database used by Electron.
- Write an Update/Todo and observe it live in the UI.
- Toggle MCP sensitive access and verify immediate enforcement.
- Run with spaces in the application path.
- Run on a machine without a global Node installation.

## Acceptance criteria

- No MCP endpoint accepts SQL or schema-specific query fragments.
- MCP and Electron share application services and domain repositories.
- Sensitive access defaults to denied and cannot be overridden by a tool argument.
- Effective sensitivity includes ancestors and the scoped Subject.
- Hidden content does not leak through counts, tags, snippets, errors, resources, or logs.
- MCP reads work with Electron open or closed.
- MCP writes serialize safely with Electron writes.
- The open UI observes MCP writes without restart.
- Scoped commands preserve exact `Scope x Subject` attribution.
- Rich text is model-readable and remains durable in its current versioned storage format.
- The packaged MCP helper requires no external runtime installation.
- All new behavior has unit, integration, protocol, and packaged E2E coverage appropriate to its
  phase.

## Open decisions

- Whether the first public release is read-only or includes the initial safe writes.
- Whether the packaged helper is a standalone executable or an Electron command mode.
- Whether `data_version` invalidation is sufficient or a typed change journal is needed immediately.
- Whether MCP sensitive access is one checkbox or separate read/write-sensitive permissions.
- Whether mutation audit history is user-visible in the first MCP release.
- Which MCP hosts must be verified before release.
- What result limits and pagination defaults are appropriate for real OnMove databases.

