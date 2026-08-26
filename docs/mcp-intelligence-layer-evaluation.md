# Context-aware retrieval and MCP intelligence layer evaluation

Date: 2026-08-26  
Status: Historical evaluation retained; the first SQLite + Orama dual-path retrieval layer is implemented

## Executive recommendation

Do not replace SQLite or place LadybugDB in the production read/write path now.

The first-order problem is not graph traversal performance or nearest-neighbor performance. It is
preserving **operational identity** while doing discovery. `Projects > Project A > Observability`
and `Projects > Project B > Observability` may be almost indistinguishable in embedding space while
being different user intentions, evidence histories, and write targets. A new database engine does
not solve that by itself.

The recommended sequence is:

1. Keep the existing SQLite database and application services authoritative.
2. Add a context-first retrieval planner over the current hierarchy and Scope/Subject model.
3. Improve the MCP read surface around a small set of resolve, retrieve, expand, hydrate, and brief
   operations.
4. Add embeddings only as a derived, rebuildable candidate source or reranker, after exact identity,
   access policy, and structural boundaries have been applied.
5. Start with exact vector scoring over a bounded candidate set. Benchmark before adding an ANN
   index.
6. If ANN becomes necessary, pilot a SQLite-local vector extension first. Keep Ladybug as a shadow
   projection experiment for a future in which OnMove has important arbitrary many-to-many edges
   and genuinely multi-hop knowledge queries.

The essential rule is:

> Semantic similarity may discover evidence, but it must never choose operational identity or a
> write target.

## Implemented dual-path retrieval

OnMove now implements the first bounded version of this recommendation while retaining the
evaluation below as design history and future guidance:

- **SQLite remains authoritative.** The existing FTS5 projection, live hierarchy-aware access
  policy, entity hydration, continuation freshness, and every write still run through SQLite and
  the application services. `classic` mode and explicit `lexical` retrieval use this path.
- **Orama is a derived candidate index.** Enhanced retrieval rebuilds an in-memory Orama index from
  the durable `search_documents` projection. Orama neither authorizes nor hydrates a result and is
  never a write target.
- **Embeddings and their cache remain local.** Universal Sentence Encoder Lite runs in a dedicated
  worker owned by the Electron main process so TensorFlow model loading and CPU inference cannot
  block the application event loop. The pinned Lite v1 model, vocabulary, and weight shards ship as
  immutable application resources, so they are available offline and never download at runtime.
  Completed vector batches are cached incrementally in SQLite by source key, model,
  content hash, and dimensions. OnMove text is not sent to a hosted embedding or retrieval service.
- **Context is a hard filter.** `onmove.retrieve` requires an explicit workspace, Focus, or asserted
  Focus + Thread boundary and may intersect it with one canonical Subject. SQLite enumerates the
  visible source keys inside that complete context before Orama scores them. Hierarchy labels are
  not prepended to embedding text, so repeated corporate vocabulary cannot become identity.
- **Ranking is provider-neutral.** Enhanced text retrieval fuses lexical and semantic rank with
  weighted reciprocal-rank fusion and, by default, interleaves results by operational lineage to
  limit sibling and template crowding. Results retain complete hierarchy provenance and report the
  channels that contributed to the rank.
- **Fallback is explicit and safe.** A cold semantic build receives a bounded foreground wait, then
  continues in the background while the request returns a `semanticPreparing` lexical fallback.
  Timed-out request-specific query/ranking work is cancelled while the shared build remains alive,
  and projection, cache, authorization, and Orama pages yield cooperatively. Missing model weights,
  a download or inference failure, an unavailable semantic index, classic mode, and
  non-relevance/structured queries also retain the lexical or structured SQLite path. Responses
  report the requested strategy, applied strategy, fallback reason, index generations, and semantic
  coverage. A caller may request an error instead of the default fallback.
- **The MCP surface is additive.** `onmove.retrieve` and `onmove.continue_retrieval` provide the new
  context-first read path. Their signed continuations bind the access fingerprint, persisted
  `classic | enhanced` setting, applied strategy, request, byte budget, stable cursor, and lexical
  and semantic generations. Existing search, direct-read, specialized review, and mutation tools
  remain compatible.

The broader `resolve_context`, `expand_context`, mixed hydration, briefing, and comparison surface
described later remains a proposal rather than an implemented claim.

## What OnMove already has

OnMove is not starting from raw tables or a naive text endpoint.

- SQLite is opened once in the main process, uses WAL, and is accessed through a deliberately small
  adapter. Electron and MCP share the same `AppDatabase`, query service, command service, domain
  repositories, and access policy. See
  [`sqlite-adapter.ts`](../src/main/data/sqlite-adapter.ts),
  [`database.ts`](../src/main/database.ts), and
  [`mcp-server.md`](mcp-server.md).
- The durable FTS5 projection covers Focuses, Threads, Commitments, Routines, Updates, Todos, Notes,
  and Subjects. Search results already include complete owner paths, public codes, Subject context,
  safe write-target guidance, byte budgets, and signed continuation state. See
  [`search-index.ts`](../src/main/application/search-index.ts).
- Effective sensitivity and MCP permissions are resolved against the live hierarchy during search,
  rather than trusted from a stale search-index flag.
- Exact hierarchy resolution refuses to guess when titles are ambiguous.
- `review_subject` is already the right kind of task-level tool: it resolves one Subject within one
  Thread and returns relevant Updates, open Todos, and applicable Commitments in one bounded read.
  See [`services.ts`](../src/main/application/services.ts).

These are valuable foundations. In particular, the stable `source_key`, hierarchy metadata,
generation counter, dirty-index contract, and permission boundary can all support a more intelligent
retrieval projection without changing the authoritative domain model.

## Where the current search can still fail

The current search planner is intentionally lexical. It removes a conservative stop-word set and
ORs the remaining prefix terms. BM25 weights the title column more heavily, but hierarchy distance,
exact anchor matches, result diversity, and operational lineage are not part of ranking.

That leads to four gaps:

1. **A natural-language anchor is not automatically a boundary.** If an MCP client searches for
   `observability in Project A`, the FTS query can retrieve documents matching either useful term
   from Project A and Project B. The explicit Thread boundary works well once the caller already has
   the Thread ID, but initial discovery can still be crowded by similar sibling records.
2. **Paraphrases are missed.** FTS cannot connect terms such as `telemetry health` with an Update
   that only says `monitoring coverage` unless the caller or server expands the vocabulary.
3. **Repeated corporate language crowds the result set.** Templates, policy language, project names,
   team names, and recurring scopes can make the top lexical or semantic hits near-duplicates.
4. **The MCP surface is broad.** The detailed by-ID, by-path, kind-specific search, list, task, and
   mutation tools are individually safe, but a client has many similar choices. Tool selection and
   multi-call planning become part of retrieval quality.

Embeddings help only with the second gap. Without structural controls, they can worsen the first and
third gaps.

## LadybugDB assessment

### Why it is attractive

Ladybug is an active, MIT-licensed embedded property-graph database with Node.js bindings, Cypher,
BM25 full-text search, HNSW vector search, and graph algorithms. Its vector extension can use a
Cypher-defined projected graph to restrict vector search, then traverse relationships from returned
nodes. It can also attach to SQLite and scan or copy its tables. These are real capabilities, not
marketing placeholders:

- [Ladybug overview](https://docs.ladybugdb.com/)
- [Node.js API](https://docs.ladybugdb.com/client-apis/nodejs/)
- [Vector search and graph traversal](https://docs.ladybugdb.com/extensions/vector/)
- [Full-text search](https://docs.ladybugdb.com/extensions/full-text-search/)
- [SQLite attachment](https://docs.ladybugdb.com/extensions/attach/sqlite/)
- [Current releases](https://github.com/LadybugDB/ladybug/releases)

For a retrieval graph with arbitrary cross-links—dependencies, blockers, mentioned entities,
decisions, provenance, supersession, contradiction, and temporal relationships—Cypher plus filtered
vector entry points could be materially better than hand-built recursive SQL.

### Why it is not the right first production layer

1. **OnMove's current graph is shallow and already explicit.** Focus → Thread → Commitment/Routine →
   evidence is a constrained hierarchy, not an unknown network. Scope applications and historical
   Scope × Subject cells are relational/temporal semantics that the existing repositories already
   enforce. Copying these rows to node and edge tables mostly duplicates joins.
2. **It would be a second materialized store.** SQLite must remain authoritative because it owns
   migrations, cascades, archive rescue, status-transition audits, rich-text revisions, permissions,
   backups, and live UI mutation behavior. SQLite and Ladybug cannot share one atomic commit. The
   graph therefore needs an outbox, version reconciliation, stale-index diagnostics, and a full
   rebuild path.
3. **The current HNSW mutation story is a poor fit for frequently edited documents.** Ladybug's open
   issue [“Allow writes to tables which have a HNSW vector index”](https://github.com/LadybugDB/ladybug/issues/377)
   shows that setting an indexed vector property is currently rejected. A projection of Notes,
   Updates, Todos, and titles changes continually, so drop/reinsert or rebuild behavior would need
   careful validation.
4. **Extensions add desktop packaging and offline-management work.** Ladybug installs extensions
   from its extension service into a user directory and loads them per session. A signed/notarized
   Electron application should instead pin, bundle, verify, and test every native artifact it uses.
   See [Ladybug extension management](https://docs.ladybugdb.com/extensions/) and
   [on-disk extension locations](https://docs.ladybugdb.com/developer-guide/files/).
5. **Ladybug's generic MCP server is the wrong API boundary.** It exposes one unrestricted Cypher
   query tool. That would expose schema details and bypass OnMove's access policy, safe write guides,
   archive behavior, semantic path validation, and command services. See the
   [Ladybug MCP server](https://github.com/LadybugDB/mcp-server-ladybug).

### When to revisit Ladybug

Revisit it when at least two of these are true:

- OnMove persists arbitrary user-addressable cross-record links, not just containment and Scope
  attribution.
- Important questions require variable-length or multi-hop path matching.
- A retrieval corpus is large enough that bounded SQLite-local scoring fails measured latency or
  recall targets.
- The graph projection has an explicit derived-data lifecycle, asynchronous change feed, generation
  checks, and full rebuild behavior.
- Native Electron packaging, notarization, offline installation, and extension-version compatibility
  are covered by automated tests.

Even then, expose typed OnMove tools, not Cypher.

## Alternatives

| Option | Strengths | Main liabilities for OnMove | Recommendation |
| --- | --- | --- | --- |
| Existing SQLite FTS5 + application-layer vector scoring | One authoritative transaction boundary; reuses current permission joins and hierarchy; easiest to A/B test | Exact scoring eventually becomes expensive; embedding generation still needs a model and lifecycle | **Start here** |
| SQLite Vec1 | Lives in the same SQLite file; exact and ANN modes; metadata-filtered queries; portable C | Current version is 0.7, not 1.0; docs say testing remains insufficient; ANN training/rebuild and online-write behavior are still evolving | Watch closely; feature-flagged pilot after evaluation |
| `sqlite-vec` | Simple loadable extension; metadata and partition-key filtering; Node package; FTS5 hybrid examples | Stable line currently uses exhaustive search; ANN support is still alpha; third-party native packaging | Reasonable exact-search prototype if a loadable extension is acceptable |
| LadybugDB shadow projection | Embedded graph + Cypher + filtered HNSW + traversal in one query | Second store, synchronization, indexed-vector update limitation, extension packaging, graph duplicates current hierarchy | Future graph-heavy experiment |
| LanceDB shadow projection | Strong embedded vector, scalar-filter, FTS, and hybrid/RRF capabilities; TypeScript SDK | Second store; no graph advantage; native desktop packaging; must duplicate current access metadata | Benchmark only if SQLite-local search misses scale targets |
| DuckDB VSS | Strong analytical SQL and Node client | Its VSS extension still describes persistent HNSW indexes as experimental and not recommended for production | Do not use for this path now |
| CozoDB | Datalog, graph, HNSW, FTS, and near-duplicate search in one embedded engine | Public release/activity and bindings have lagged; adds a second query language and store | Do not select for a new dependency now |

Sources:

- [SQLite Vec1 overview and roadmap](https://sqlite.org/vec1/doc/trunk/doc/vec1.md)
- [SQLite Vec1 user manual, filtering, and reranking](https://sqlite.org/vec1/doc/trunk/doc/vec1intro.md)
- [`sqlite-vec` metadata and partition filtering](https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html)
- [`sqlite-vec` hybrid FTS5/vector search](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- [LanceDB TypeScript search API](https://lancedb.github.io/lancedb/js/classes/Table/)
- [DuckDB VSS limitations](https://duckdb.org/docs/lts/core_extensions/vss)
- [CozoDB repository](https://github.com/cozodb/cozo)

The current `node:sqlite` API can load a pinned extension when the connection is explicitly created
with extension loading enabled, so a SQLite-local experiment does not require replacing the adapter.
Extension loading should be disabled again after the exact signed library is loaded. See the
[Node.js `DatabaseSync.loadExtension` documentation](https://nodejs.org/api/sqlite.html).

## Recommended retrieval architecture

### 1. Preserve an explicit operational context key

Every retrievable chunk should carry a non-semantic identity tuple:

```text
focusId
threadId
commitmentId | null
scopeId | null
subjectId | null
entityType
entityId
field
fieldRevision/contentHash
```

The context key should be treated as data, not embedded prose. For current evidence, `scopeId` and
`subjectId` together preserve the historical cell. A link directly to a canonical Subject is not a
lossless replacement because an Update can belong to a prior Scope overlay or former application.

### 2. Resolve anchors before retrieving evidence

The query planner should follow this order:

1. Public code or known ID.
2. Exact case-insensitive hierarchy path.
3. Exact title/name candidates within already resolved ancestors.
4. Conservative lexical/fuzzy discovery that returns ambiguity rather than guessing.
5. Semantic discovery only when no exact operational anchor was supplied.

Resolution returns one of `resolved`, `ambiguous`, or `not_found`. Only `resolved` may produce a
single write target. A signed context token can preserve the resolved IDs and requested expansion
policy across follow-up calls, while every request still rechecks current permissions and existence.

### 3. Make boundary expansion explicit

Retrieval should require or report one expansion mode:

- `exact`: only the selected record/cell.
- `descendants`: the Thread or Commitment plus owned evidence.
- `siblings`: compare peer contexts under the same parent.
- `focus`: all contexts inside one Focus.
- `global`: all visible records.

The default after resolving a Thread should be `descendants`, not `global`. `siblings`, `focus`, and
`global` must be deliberate because they change the operational question.

### 4. Use multiple candidate channels and late fusion

Within the allowed candidate set:

- FTS5 supplies exact words, phrases, names, tags, and rare identifiers.
- Embeddings supply paraphrase/concept recall.
- Structured queries supply status, date, kind, due/review state, and attribution.
- Graph/hierarchy traversal supplies distance and relationship type.

Do not add raw BM25 and cosine scores. Their scales are unrelated. Fuse rank positions using a
method such as reciprocal rank fusion, then apply separately visible structural priors. Return score
components and `whyMatched` data for diagnostics instead of presenting one opaque confidence number.

### 5. Prevent similar corporate records from crowding one another

Use all of these controls:

- **Filter before vector ranking** whenever a Focus, Thread, Commitment, Scope, Subject, lifecycle,
  date, or permission boundary is known.
- **Do not prepend the full hierarchy to every embedded chunk.** That makes repeated corporate
  nouns dominate the vector. Embed the evidence content; retain the path as structured metadata.
- **Keep content and context embeddings separate** if a context embedding is added later. Identity
  remains a hard key, never an embedding.
- **Group global results by operational lineage.** Return a representative from each Thread/cell
  before filling the page with more evidence from one lineage.
- **Apply per-lineage caps and diversity reranking.** A page of ten near-identical template rows is
  worse than one representative row from five relevant Threads.
- **Detect an ambiguity band.** If several contexts are structurally plausible and similarly ranked,
  return the candidate paths and ask the client to preserve or select one. Do not silently choose
  the top cosine score.
- **Never use semantic similarity to authorize writes.** Writes retain the current exact parent,
  Subject-cell, revision, and permission validations.

### 6. Chunk rich text without losing provenance

Focus descriptions and Notes may need chunking; most Updates, Todo names, titles, and checklist
items can remain one chunk. Split rich text on Lexical block/list/quote boundaries before falling
back to a token-length split. Each chunk needs:

- stable `source_key` plus ordinal;
- exact entity/field reference;
- content hash and live field revision;
- character or block offsets for evidence display;
- the full operational context key;
- model identifier, dimensions, and embedding version.

Do not store generated summaries as if they were user evidence. If summaries are later indexed,
label them as derived artifacts with provenance and a rebuildable version.

### 7. Keep embeddings derived and asynchronously fresh

Embedding inference may be local or provided by an explicitly approved service. In either case:

- commit the user edit first;
- mark the affected retrieval documents/chunks dirty in the same SQLite transaction;
- generate embeddings outside the write transaction;
- accept an embedding only when its source revision/content hash is still current;
- exclude stale vectors rather than pairing a new path with old content;
- report semantic coverage and generation in search diagnostics;
- treat embeddings as sensitive derived data and cascade/delete them with their source;
- keep the FTS/structured path available while embeddings are missing.

This matches the existing principle that search and audit projections are implementation details,
not portable user content.

### 8. Enforce policy before and after retrieval

The safest sequence is:

1. Resolve visible candidate IDs and effective hierarchy permissions in SQLite.
2. Score only that candidate set, or constrain the vector operation to those IDs.
3. Recheck returned entities through the current access policy before formatting output.
4. Recompute counts, grouping, and pagination after filtering.

A mirrored `visible` bit in a vector database is insufficient because MCP permissions are sparse,
hierarchical, resource-specific, and revocable on every request.

## Proposed MCP read surface

This can coexist with current mutation tools and initially wrap existing services.

### `onmove.resolve_context`

Resolves a code, ID, exact path, or bounded title/name hints. Returns status, candidates, exact
hierarchy/cell IDs, allowed expansion modes, and a signed context token. This generalizes the strong
parts of `get_entity_by_code` and `resolve_work_target`.

### `onmove.retrieve`

Accepts query text, an explicit context token/boundary, kinds/dates/status filters, retrieval mode,
and grouping policy. Returns evidence groups by operational lineage, mandatory complete paths,
snippets, score components, match reasons, projection completeness, and continuation state.

### `onmove.expand_context`

Traverses only declared typed relationships such as parent, child work, evidence, current Scope,
historical cell, Subject attribution, Todo, Note, Routine, and tag use. It accepts bounded depth and
edge types. It does not accept SQL or Cypher.

### `onmove.get_entities`

Bulk-hydrates a bounded mixed list of returned references/codes, with compact Markdown by default.
This reduces the need for a model to select among many kind-specific getters after discovery.

### `onmove.brief_context`

Returns a deterministic current-situation packet for one resolved boundary: recent direct evidence,
active/paused work, open Todos, due/review state, and attribution. `review_subject` is the existing
specialized example and should remain available where its semantics are clearer.

The server can preserve the current detailed tools for compatibility while advertising a smaller
recommended read set to clients that support tool-set selection. Mutations should remain explicit
and domain-specific.

## The collision example

Assume:

```text
Focus: Projects
  Thread: Project A
    Context: Observability
  Thread: Project B
    Context: Observability
```

For `What is the observability risk in Project A?`:

1. Resolve `Projects > Project A` exactly.
2. Apply the Project A Thread boundary.
3. Resolve Observability inside that boundary.
4. Run FTS and semantic retrieval only over Project A's applicable and historical evidence according
   to the requested time/lifecycle policy.
5. Return Project A's complete path on every hit.

Project B's high cosine similarity is irrelevant because it is outside the candidate set.

For `Compare observability across projects`:

1. Resolve `Projects` as the Focus boundary.
2. Expand to sibling Threads deliberately.
3. Retrieve within each Observability context.
4. Group by Thread and return at least one representative per relevant Thread before additional
   same-Thread evidence.

For `What changed in observability?` with no project anchor:

1. Discover all visible Observability contexts.
2. Return the distinct operational paths as an ambiguity/comparison set.
3. Do not imply that the most semantically similar Thread is the intended one.

For a write request, resolution must end in one exact parent and exact Subject/cell attribution.
If more than one path remains, the write is rejected as ambiguous.

## Evaluation plan

Build a read-only benchmark harness before choosing an engine. Include real anonymized patterns and
a synthetic collision corpus with repeated names, templates, policy language, and scopes.

### Required queries

| Query | Expected behavior |
| --- | --- |
| `observability risk in Project A` | No Project B leakage once Project A resolves |
| `compare observability across projects` | Results grouped and diversified across relevant Threads |
| `what changed in monitoring coverage?` | Finds `observability`/`telemetry` evidence through paraphrase |
| `update observability for Project A` | One exact write target or explicit ambiguity; never vector-selected |
| `Project A` where two Focuses contain that title | Exact ambiguity with complete candidate paths |
| sensitive Subject/cell query with sensitive access denied | Zero hits, counts, snippets, or timing-dependent pagination artifacts exposed |
| repeated corporate template query | Bounded duplicate crowding and representative lineage coverage |
| query during stale/missing embeddings | Correct FTS/structured results plus explicit semantic coverage diagnostic |

### Metrics

- Wrong operational target rate: **must be zero** for writes.
- Cross-lineage leakage after an exact boundary: **must be zero**.
- Evidence recall@k for paraphrase queries.
- Context/lineage coverage@k for global and comparison queries.
- Duplicate crowding ratio within a result page.
- Permission leakage across results, counts, snippets, diagnostics, and continuations: **must be zero**.
- Median and tail latency by corpus size and boundary size.
- Search freshness after create, edit, move, sensitivity change, Scope replacement, and delete.
- MCP tool calls, total response bytes, and model correction/retry count per task.

Compare at least:

1. current FTS5;
2. FTS5 plus context-first planning/grouping;
3. context-first FTS5 plus exact embedding scoring;
4. an ANN engine only if option 3 fails measured latency.

An embedding layer should ship only if it improves paraphrase recall without regressing boundary
precision, access behavior, freshness, or client efficiency.

## Delivery phases and decision gates

### Phase 0: Baseline

- Add no engine.
- Measure the current search/MCP flows on the collision corpus.
- Record corpus size, document/chunk length distribution, and query latency.

### Phase 1: Context-first MCP

- Add resolve/retrieve/expand/brief contracts over current repositories and FTS5.
- Add grouping, structural distance, match reasons, and ambiguity bands.
- Consolidate the recommended read surface while retaining compatibility tools.

Decision gate: if task success and tool-call efficiency are good, embeddings may not be urgent.

### Phase 2: Embedding sidecar in SQLite

- Add derived chunk/embedding metadata keyed by stable source key, revision, and model.
- Use a local or explicitly approved embedding provider behind one interface.
- Perform exact scoring only after policy and context filtering.
- Run embedding work asynchronously and report coverage.

Decision gate: measure recall and latency. Do not assume ANN is necessary.

### Phase 3: SQLite-local ANN pilot

- Evaluate Vec1 when its release/testing status meets the product's threshold, or `sqlite-vec` if
  exact search remains adequate and its packaging is preferable.
- Pin and bundle the native extension; do not download code at runtime.
- Preserve SQLite-side access filtering and application-service hydration.

Decision gate: ANN must materially improve tail latency at the observed corpus size without reducing
filtered recall or freshness.

### Phase 4: Ladybug shadow-graph pilot

- Proceed only after graph-shaped product requirements exist.
- Project immutable typed nodes/edges from SQLite through an outbox and generation contract.
- Model Scope applications and historical Scope × Subject cells explicitly.
- Keep all writes and policy evaluation in OnMove services.
- Expose typed MCP tools only.

Decision gate: Ladybug must simplify important multi-hop queries or outperform the SQLite retrieval
projection enough to justify synchronization and native packaging costs.

## Bottom line

LadybugDB is credible technology and a reasonable future retrieval-graph experiment. It is not the
missing intelligence layer for OnMove's current problem. The missing layer is a **retrieval planner
that makes identity and structural context primary, and semantics secondary**.

Build that planner on the data and invariants OnMove already has. Add vector capability only after
the planner can prove that `Project A / Observability` and `Project B / Observability` are different
operational spaces even when every embedding says they are almost the same.
