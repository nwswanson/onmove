# OnMove MCP server

OnMove can run a local MCP Streamable HTTP server inside the open desktop application. MCP and the
UI use the same application services, domain repositories, and `AppDatabase` instance. The server
does not open SQLite independently and does not expose SQL or renderer state.

## Enable it

Open OnMove → Settings → Model Context Protocol and turn on **Run MCP server**. The Settings pane
also selects **Classic** or **Enhanced** retrieval, controls whether omitted search/retrieval
requests include closed work, and shows the active endpoint, which defaults to:

```text
http://127.0.0.1:47832/mcp
```

Configure an MCP client with that URL as a Streamable HTTP server. OnMove must remain open. Turning
the setting off or quitting OnMove closes the endpoint. The port is configurable in Settings if the
default is already in use.

## Custom client instructions

**Custom instructions for MCP clients** is a persisted plain-text field in the Model Context
Protocol settings. It accepts up to 8,000 characters of organization- or workflow-specific guidance,
such as requiring a consistent Update structure for selected Threads or asking before an Update is
created when no next step is known.

OnMove's primary delivery mechanism is the standard MCP server-instructions field. When a client
initializes or discovers the server, OnMove advertises the saved text alongside its stable built-in
guide to choosing tools and handling results. Keeping global guidance there avoids repeating it in
every tool description, while individual tool schemas continue to describe and validate their own
operations.

The exact user-authored text is also available as the read-only
`onmove://client-instructions` resource for inspection. Reading that resource does not itself cause
a host to apply the guidance; negotiated server instructions remain the automatic delivery path.

Server instructions are advisory: the MCP host decides whether and how to add them to the calling
model's context. OnMove cannot turn this text into the host's actual system prompt or guarantee that
a client follows it. The text also cannot grant access, bypass View/Edit/Delete or sensitive-content
policy, change a tool schema, skip a confirmation gate, or override the current user request. A
natural-language rule that must be enforced needs a separate structured, server-side policy rather
than custom instructions.

Clients commonly cache server instructions for the life of a connection. After saving or clearing
the field, reconnect OnMove in the client or refresh server discovery before relying on the change.

## Permissions

The server itself and sensitive access default to off. Ordinary records default to View allowed,
with Edit and Delete denied. The independent grants live in
OnMove → Settings → Model Context Protocol:

- Run MCP server
- Allow sensitive content
- Per-resource View, Edit, and Delete defaults
- Sparse Focus and Thread overrides

The server reads these settings on every request, so a running session observes revocation without
being restarted. The View menu's sensitive-content preference does not affect MCP permission.
Hidden records are indistinguishable from unknown IDs. Effective sensitivity includes Focus,
Thread, Commitment or Routine, Scope, Subject cell, and record-level sensitivity.

Every mutation goes through the shared application command service. Successful MCP writes and
deletions store a metadata-only audit row without user-authored text.

Delete is independent from Edit and also requires View. `onmove.delete_entity` accepts one exact,
discriminated `{ type, id }` target for a Focus, Thread, tracking Commitment, Routine, Update, Todo,
Note, or unused Subject. It requires `confirm: true` after explicit user confirmation and advertises
itself as destructive. Parent deletion follows the normal domain cascade even when a descendant
resource has a separate denied Delete grant. Every affected Update, including a directly deleted
Update, is rescued into the bounded 30-day Archive. Subject deletion is rejected while Scope,
Update, or Todo history still references that Subject. There are no MCP import or archive-clear
tools.

### Moving Threads

Call `onmove.plan_thread_reparent` with the Thread ID and destination Focus ID before moving it. The
read-only response reports whether the Thread follows its Focus Scope or owns a custom Scope, the
fact that every owned record moves with it without leaking hidden child counts, and any canonical
Subjects that must be added to the destination Focus. It also returns the exact
`onmove.reparent_thread` arguments.

`onmove.reparent_thread` preserves the Thread ID and all Commitments, Routines, Updates, Todos,
Notes, review evidence, and Scope history. Inherited Scope is reconciled against the destination;
custom Scope is copied without widening the destination Focus. The supplied source Focus ID rejects
stale plans, and the confirmed Subject IDs must exactly match the planner before destination Scope
can be widened. The caller needs Thread View/Edit at the source and Thread View/Edit in the
destination Focus. Successful moves are audited and returned with a safe reverse-plan request.

### Creating Updates

`onmove.create_update` creates an Update record beneath a Thread or Commitment; it does not edit the
Thread or Commitment itself. Read the parent first and inspect `writeGuide.createUpdate`:

- An Open parent has `attributionMode: "unscoped"`. Omit `subjectId` or send
  `attribution: { "mode": "unscoped" }`.
- A scoped parent has `attributionMode: "subject"`. Choose exactly one entry from
  `allowedSubjects` and send
  `attribution: { "mode": "subject", "subjectId": 34 }`.

The older top-level `subjectId` shorthand remains accepted and may be null, but the named
`attribution` object is preferred. If attribution does not match the parent, the tool returns a
structured error with an inspection call, allowed Subjects, and a ready-to-run retry whenever the
choice is unambiguous. It never silently drops a supplied Subject because that would change the
meaning of the evidence.

The observation uses the same editor-neutral rich-text document contract as Notes. For example:

```json
{
  "parent": { "type": "thread", "id": 12 },
  "attribution": { "mode": "unscoped" },
  "richText": {
    "version": 1,
    "blocks": [{
      "type": "paragraph",
      "children": [
        { "type": "text", "text": "Delivery confidence improved", "marks": ["bold"] },
        { "type": "text", "text": " after the " },
        {
          "type": "link",
          "url": "https://example.com/review",
          "children": [{ "type": "text", "text": "readiness review" }]
        }
      ]
    }]
  },
  "state": "green"
}
```

Omitting `richText`, or sending an empty `blocks` array, creates a valid blank Update. The former
plain `observation` write parameter is intentionally absent because it cannot represent formatting.
Compact responses and parent contexts expose `observation` as readable Markdown, preserving links
and structure while legacy plain text remains unchanged. Expanded reads add
`observationRichText` as the lossless document; `observationRevision` provides concurrency and an
`observationWriteGuide` with directly usable semantic edit requests.

### Resolving a hierarchy and creating Todos

Use `onmove.resolve_work_target` when a request names related records, rather than searching each name
as an unrelated global term. For example, “Do X for Person Y's 1:1 in Leadership Team” resolves
with:

```json
{
  "thread": { "title": "Leadership Team" },
  "commitment": { "title": "1:1" },
  "subject": { "name": "Person Y" }
}
```

Resolution proceeds in hierarchy order: optional Focus, required Thread, optional child
Commitment, then optional Subject within that target's current effective Scope. Names are exact,
case-insensitive matches, so punctuation-bearing titles such as `1:1` do not suffer from FTS token
splitting. Every selector also accepts its entity's own ID. Duplicate matches return
`status: "ambiguous"` with candidates and a warning; the resolver never guesses. A resolved target
includes `recommendedTodoRequest`, which is directly executable after adding the Todo `name`.

`onmove.get_thread_by_id`, `onmove.get_commitment_by_id`, and resolved candidates expose
`writeGuide.createTodo`:

- Open parents allow only `attribution: { "mode": "unscoped" }`.
- Scoped parents allow an individual
  `attribution: { "mode": "subject", "subjectId": 34 }` using `allowedSubjects`.
- Scoped parents also allow `attribution: { "mode": "all-subjects" }`, which creates one shared
  Todo with an independently completable cell for every current Subject.

The older top-level `subjectId` and `sharedAcrossSubjects` fields remain accepted for compatibility,
but named `attribution` is preferred. Invalid Todo attribution returns the same structured
inspection call, allowed choices, and unambiguous retry behavior as Update creation.

### Updating Notes

Search results and parent contexts expose each Note's own ID. Use `onmove.get_note_by_id` with that ID to
read its hierarchy, current revision, and both Note write guides. For a title-based request,
`onmove.get_note_by_path` combines exact hierarchy resolution and the Note read into one call. For
example, a directly owned Focus Note can be read with:

```json
{
  "focusTitle": "Project Atlas",
  "noteTitle": "Default",
  "includeRichText": true
}
```

Add `threadTitle` and then `commitmentTitle` when the Note is owned at those levels. The deepest
selector is the direct owner; the tool never silently searches descendant Notes. Duplicate exact
matches return candidates instead of being guessed.

`onmove.get_focus_by_id` also accepts `includeRichText: true`. Its `entity` then contains the complete
Focus description, revision, and `descriptionWriteGuide`; directly owned `notes` contain their
complete rich-text documents and current write guides rather than compact summaries. This is useful
when the Focus is already known and avoids separate reads.

The returned `note.content` is read-only Markdown for comprehension. `note.richText` is omitted by
default; request `includeRichText: true` on the selected Note only when a complete structural
replacement is actually pending. It is then the lossless document to edit and send back:

```json
{
  "id": 81,
  "expectedRevision": 4,
  "richText": {
    "version": 1,
    "blocks": [
      {
        "type": "paragraph",
        "children": [
          { "type": "text", "text": "Keep this bold", "marks": ["bold"] },
          { "type": "text", "text": " and preserve the " },
          {
            "type": "link",
            "url": "https://example.com/evidence",
            "children": [{ "type": "text", "text": "evidence link" }]
          }
        ]
      }
    ]
  }
}
```

For a localized wording or mark change, prefer `onmove.patch_note_text`:

```json
{
  "id": 81,
  "expectedRevision": 4,
  "findText": "hello world",
  "replaceText": "hi there",
  "addMarks": ["italic"],
  "removeMarks": ["bold"]
}
```

The match is exact and case-sensitive within one paragraph or list item. When it occurs once, no
position is needed. Multiple matches return `NOTE_TEXT_AMBIGUOUS` with a count; retry with a
one-based `occurrence`. A patch can cross adjacent formatted text runs and link boundaries, while
structural line or block changes remain full-document operations. Replacement text inherits the
first matched run's formatting, then applies `addMarks` and `removeMarks`; surrounding text, links,
colors, and unspecified marks remain unchanged. Omit `replaceText` for a marks-only patch.

`onmove.update_note` replaces the complete Note with an editor-neutral document rather than exposing
the app's internal Lexical JSON. Blocks support paragraphs, bulleted lists, numbered lists,
checklists, and multi-block quotes. Inline content supports links, soft line breaks, durable `@tag`
tokens, readable text colors, and bold, italic, underline, strikethrough, and highlight marks. Lists
may nest. The server validates document shape, size, depth, tag syntax, supported marks and colors,
and `http`, `https`, or `mailto` link protocols before writing anything.

`richText` is the only accepted write field for both tools because it matches `note.richText` on
reads. The MCP tool schemas do not expose or accept a second root-level document field.
The yellow highlighter is the canonical `highlight` mark. The intuitive `highlight-yellow` input is
also accepted and reads back as `highlight`; it is not a separate foreground color.

The advertised rich-text JSON Schema and the backend's first-stage validator are the same shared
definition. Inline and block variants are strict discriminated unions: every node's `type` selects
exactly one shape (`text`, `link`, `line-break`, `paragraph`, each list type, or `quote`). Ordinary
text examples omit `color`; callers may also send `color: null`, which is accepted and canonicalized
to omission. `clear` is explicitly advertised on `onmove.update_note` and
`onmove.update_rich_text` and is honored by the same command boundary that performs the write.

Clients should copy `note.richText`, change only the intended nodes, and submit the whole document.
The writable schema deliberately has no plain `content` field: plain-text replacement could erase
formatting that the caller did not see. Legacy plain-text Notes are projected into paragraph blocks
when read and become versioned rich text on their next API edit.

The current revision is mandatory. If the Note changed in the app after it was read, the write is
rejected as `note_revision_conflict` without changing the database. The response instructs the
client to read, reconcile, and retry; the server never invents a text or structural merge. A
successful write returns the refreshed Note context, including its new revision and canonical
`note.richText` document.

If a populated Note would become only whitespace, line breaks, or empty structure through either
write tool, the server returns `NOTE_TEXT_DISAPPEARED` without changing the Note. Retry the same
operation with `clear: true` only after confirming that intentionally emptying the Note is desired.

Missing or structurally invalid rich text returns an error with `preferredField`, supported marks,
mark aliases, a recovery instruction, and a minimal valid example.

Semantic validation failures also include a JSON Pointer, the rejected value, and a minimal
replacement. For example, ordinary words mistakenly marked as a durable tag inside a link identify
the exact path such as `/richText/blocks/0/children/0/children/0` and return:

```json
{ "type": "text", "text": "hey there", "marks": ["bold", "highlight"] }
```

The server tracks identical rejected arguments per connected MCP session. On the third unchanged
request with the same validation error, both textual and structured recovery explicitly say that
the payload is unchanged, list persistent features such as `type:"link"` and `tag:true`, and tell
the caller to edit the identified field instead of retrying the same payload.

A committed Note edit is broadcast through both the domain and rich-text live-change channels, so
the main application and any open pop-out Note window receive the new revision immediately.

### Editing Focus descriptions and Update observations

Focus descriptions and Update observations use the same lossless document, optimistic-concurrency,
semantic-patch, and accidental-empty guarantees as Notes. Their target is intentionally
self-describing:

```json
{
  "target": { "type": "focus-description", "focusId": 12 },
  "expectedRevision": 4,
  "findText": "hello world",
  "replaceText": "hi there"
}
```

```json
{
  "target": { "type": "update-observation", "updateId": 93 },
  "expectedRevision": 2,
  "findText": "delivery risk",
  "addMarks": ["bold", "highlight"]
}
```

Call `onmove.patch_rich_text` for a localized text or formatting change. Call
`onmove.update_rich_text` with `target`, `expectedRevision`, and `richText` only when changing
document structure. Notes keep their Note-specific tools so callers cannot confuse a Note ID with
another entity ID.

Read a Focus with `onmove.get_focus_by_id({ id, includeRichText: true })`. The response includes
`entity.description`, `entity.descriptionRichText`, `entity.descriptionRevision`, and
`entity.descriptionWriteGuide`. Read a known Update with `onmove.get_update_by_id({ id })`; parent Thread
and Commitment reads also embed full Update observations, revisions, and write guides. A successful
`onmove.create_update` response includes the same observation guide, so a newly created blank Update
can be edited immediately without another discovery call.

Stale writes return `rich_text_revision_conflict` with the exact read request needed for recovery.
Removing all readable text without `clear: true` returns `RICH_TEXT_DISAPPEARED`. Exact patch misses
and duplicate matches return `RICH_TEXT_NOT_FOUND` or `RICH_TEXT_AMBIGUOUS` with actionable retry
metadata. Successful edits are committed through the shared application service and broadcast to
all open main and rich-text windows.

## Context-aware retrieval

Use `onmove.retrieve` when the answer must stay inside one known operational boundary or when
paraphrase recall would help. Every request names an explicit workspace, Focus, or asserted
Focus + Thread boundary and may intersect it with one canonical Subject ID. Retrieval never
inherits the current UI selection and never treats a semantically similar sibling as the requested
identity.

```json
{
  "text": "monitoring blind spots",
  "context": {
    "boundary": { "type": "thread", "focusId": 4, "threadId": 17 },
    "subjectId": 8
  },
  "strategy": "auto",
  "diversifyBy": "lineage"
}
```

The persisted retrieval setting defaults to `classic`. In Classic mode, `auto` uses the existing
SQLite FTS5 path. In Enhanced mode, `auto` uses lexical + semantic retrieval through a derived
in-memory Orama index, weighted reciprocal-rank fusion, and lineage diversification. Explicit
`lexical` always stays on FTS5. A null/omitted `text` is a structured SQLite listing rather than a
semantic query.

Universal Sentence Encoder Lite runs locally in a dedicated worker owned by the Electron main
process, so model loading and inference do not block the application UI. The pinned Lite v1 model,
vocabulary, and weights ship with OnMove and are available offline; enhanced retrieval never
downloads model assets at runtime. The model still initializes from those application resources
once per app session. Completed vector batches are cached separately in the local SQLite database.
A persisted Enhanced setting starts model and semantic-index preparation automatically when OnMove
launches. Selecting Enhanced during a session starts the same preparation immediately, even while the
MCP server is off. If an early request reaches a cold or changed semantic index, it receives a short
foreground budget; if preparation is still running, the request returns lexical results with an explicit
`semanticPreparing` fallback while the shared build continues. The abandoned request does not continue
into duplicate query/ranking work, and projection, authorization, cache, and Orama batches yield to the
application event loop. Model initialization, inference, or index failures also fall back and report their
reason. Set `onUnavailable: "error"` only when fallback is undesirable.

Settings shows the live, process-local Enhanced retrieval state. Preparation begins at application
startup whenever Enhanced is selected and begins immediately when the setting changes from Classic
to Enhanced. The panel identifies projection/cache work, local model loading, embedding progress,
and Orama index construction; it also reports document counts, reused and newly generated embeddings,
generation, completion time, and errors. Embedding and indexing can deliberately use substantial local
CPU, while MCP requests continue to receive Classic results until the status reaches Ready. Ready means
both the derived Orama index and the local semantic model are prepared, including when every document
vector came from the durable cache.

SQLite resolves permissions and the complete context before Orama ranks any candidate. Responses
report match channels, complete hierarchy provenance, requested/applied strategy, fallback reason,
lexical and semantic generations, and semantic coverage. They return bounded excerpts, never
lossless rich text. When `hasMore=true`, call `onmove.continue_retrieval` with only the exact signed
token. The token binds the normalized lifecycle policy as well as the complete request; changing
access, retrieval mode, strategy, or either index generation makes that continuation stale.

The established `onmove.search` and kind-specific search tools remain the deterministic lexical
compatibility/discovery surface described below.

## Search and retrieval lifecycle

Every initial cross-kind search, kind-specific search, and context-aware retrieval accepts the same
optional `lifecycle` object. An explicit `current`, `closed`, or `all` mode always wins. When the
object is omitted, the server resolves it from the persisted **Include closed work in MCP results**
setting for that initial request: the setting defaults to off and resolves to `current`; enabling
it resolves to `all`. The normalized policy is always returned under `appliedQuery.lifecycle`. For
example, an omitted lifecycle while the setting is off resolves to:

```json
{
  "lifecycle": {
    "mode": "current",
    "terminalStatuses": ["done", "cancelled"]
  }
}
```

Lifecycle is a structural eligibility boundary applied before lexical or semantic ranking:

| `lifecycle.mode` | Eligible records |
| --- | --- |
| `current` | Current operational lineage only. Active and paused work remains eligible; anything done/cancelled itself or beneath done/cancelled work is excluded. This is the omitted-request default while **Include closed work in MCP results** is off. |
| `closed` | Only records that are done/cancelled themselves or inherit a selected terminal status from an owning Focus, Thread, or Commitment. |
| `all` | Current records plus the selected closed partition, for an intentional comparison of live work and history. |

`terminalStatuses` is an optional nonempty subset of `done` and `cancelled`; omission selects both.
It narrows the closed portion of `closed` and `all`. With `current`, it does not alter the records
returned, though it selects which excluded terminal statuses can contribute lifecycle-coverage
hints. A terminal ancestor closes its complete searchable lineage: for example, an Update or Note
under a done Thread is closed even if the evidence has no direct status, and a descendant beneath a
cancelled Focus is closed regardless of the descendant's own active/paused status. The same policy
applies to auxiliary hierarchy paths, so Subject/Scope projections cannot reintroduce excluded
history.

Every primary search or retrieval item exposes provenance under `lifecycle`:

- `directStatus` is the record's own `active`, `paused`, `done`, or `cancelled` status, or `null`
  when that kind has no direct lifecycle. Routine health remains separate and Routines therefore
  use `null` here.
- `effective` is `current`, `closed`, or `not_applicable`; `closed` includes inherited closure and
  `not_applicable` identifies records without an operational lineage.
- `closure` is `null` when the result is not closed. Otherwise, `closure.explicit` is the result's
  own `done` or `cancelled` status (or `null` when closure is inherited only), while
  `closure.inherited` lists every terminal owning Focus, Thread, or Commitment by type, ID,
  canonical code, and status. A directly cancelled Commitment beneath a done Focus reports both causes
  without forcing the client to infer them from a similarity score or a single effective label.
- `lineage.focus`, `lineage.thread`, and `lineage.commitment` each contain the ancestor ID and
  status when that owner exists. Auxiliary hierarchy paths expose the same provenance.

Responses also return `lifecycleCoverage`, computed only from otherwise-matching records that the
current access policy permits:

- `closedMatchesAvailable` says authorized closed matches were excluded from a `current` request.
- `closedExactTitleMatchAvailable` says those excluded matches contain an exact NFKC-normalized,
  Unicode-lowercased indexed-title match for the supplied text. Exact-current availability is
  evaluated across the complete selected partition, so this guidance remains stable across pages.
- `wideningRecommended` becomes true only for `current` when no record was returned but closed
  matches exist, or when an excluded exact-title match exists and the returned current records do
  not contain that exact title.
- `nextAction` is the explicit fresh-request instruction when widening is recommended; otherwise it
  is `null`.

These fields are hints, not an automatic fallback. OnMove never merges closed records into a
current result page and never uses inaccessible or sensitivity-hidden history to disclose that a
closed match exists. To inspect history, repeat the same initial request with
`lifecycle.mode: "closed"`, or use `"all"` to compare partitions. Do not modify or reuse a
continuation token for that widening.

Search and retrieval continuation tokens bind the normalized lifecycle mode and terminal-status
selection. `continue_search` and `continue_retrieval` accept only the exact returned token, so every
subsequent page retains the originating lifecycle boundary. Changing **Include closed work in MCP
results** after the initial request does not alter or invalidate that resolved boundary. Any
intentional lifecycle change is a new initial request.

## Search

The read contract deliberately separates these intents:

| Intent | Tools |
| --- | --- |
| Queryless compact inventory | `list_focuses`, `list_threads`, `list_commitments`, `list_routines` |
| Known durable ID | `get_focus_by_id`, `get_thread_by_id`, `get_commitment_by_id`, `get_routine_by_id`, `get_update_by_id`, `get_note_by_id` |
| Exact title hierarchy | `get_focus_by_path`, `get_thread_by_path`, `get_commitment_by_path`, `get_routine_by_path`, `get_note_by_path` |
| Text discovery in one kind | `search_focuses`, `search_threads`, `search_commitments`, `search_routines`, `search_updates`, `search_notes`, `search_todos`, `search_subjects` |
| Next page from any search | `continue_search` with only the returned opaque token |
| Evidence in an exact operational context | `retrieve` with an explicit boundary and optional Subject intersection |
| Next page from retrieval | `continue_retrieval` with only the returned opaque token |

Path schemas contain title fields only. Matching is exact and case-insensitive; duplicate exact
paths return `ambiguous` with candidates. They never accept IDs or perform fuzzy search. Updates
have no by-path getter because a parent/Subject/date path is not a unique Update identity. Use
`get_updates_by_ids` for bounded bulk hydration. Specialized searches share stable signed cursors,
explicit `hasMore`, structured date filters, projections, and byte budgets with global search, but
they cannot return another entity kind. All initial search tools accept criteria only;
`continue_search` verifies the token's signed origin and returns the corresponding response shape.

The four dedicated list tools are intentionally narrower than either search or detailed getters.
They return compact summary metadata and the complete owning hierarchy, but no child collections:
no Updates, Todos, Notes, Routine checklist text, Run history, or lossless rich-text documents.
Focuses are listed once. A scoped Thread, Commitment, or Routine is listed once per currently
applicable Subject. Each row retains the durable entity `reference`, adds a unique `projectionKey`,
sets `projection.projectedScope: true`, and renders the Subject at the end of `displayPath` in
brackets. An unscoped entity is a single `unscoped` row; a bounded Scope with no current Subjects
is an `empty-scope` row; a Scope hidden by MCP permissions is a non-disclosing `scope-hidden` row.
Pagination counts projected rows. The only document-derived value is an optional Focus description
`breadcrumb`, converted to plain text and capped at 200 characters.

`onmove.search` is backed by a durable SQLite FTS5 index, not by raw `LIKE` queries or arbitrary
SQL. It indexes readable plain-text projections of:

- Focus descriptions and titles
- Thread and Commitment titles
- Routine names and current checklist templates
- Update observations
- Todo names
- Note titles plus current rich text, legacy Markdown, and legacy plain-text content
- Subject names and descriptions

The index uses Unicode tokenization, prefix matching, BM25 ranking, bounded result sets, stable
entity references, self-describing hierarchy IDs, hierarchy paths, and Subject context. Rich-text
Lexical envelopes are parsed to plain text before indexing; legacy Markdown/plain text remains
searchable as stored. Migration 43 marks every existing Note for transactional backfill and
reinstalls Note invalidation triggers. Relevant database writes mark the projection dirty, and the
MCP mutation boundary also invalidates it defensively after every successful command. Effective
sensitivity is still resolved against the live hierarchy at query time.

Search is global by default. Omitting `scope`, passing `scope: null`, or using null/omitted hierarchy
IDs never inherits the Focus currently selected in OnMove. Narrowing is always named and explicit:

```json
{ "text": "person x", "scope": { "mode": "all" } }
{ "text": "migration", "scope": { "mode": "focus", "focusId": 12 } }
{ "text": "risk", "scope": { "mode": "thread", "threadId": 19 } }
{ "text": "escalation", "scope": { "mode": "subject", "subjectId": 34 } }
{ "text": "risk", "scope": { "mode": "current" }, "kinds": ["thread", "update"] }
```

The first line is the canonical initial named-discovery request: send the user's specific name and
search `all`. Initial search tools accept criteria only and do not expose `continuationToken` in
their input schemas. Never construct, guess, or copy an example continuation token. Only a token
returned by OnMove with `hasMore=true` is valid for `onmove.continue_search`.

`all` searches the entire visible workspace, `focus` searches one Focus hierarchy, `thread`
searches one Thread and its children, `subject` searches records attributed to one canonical Subject,
and `current` explicitly reads the live UI
Focus and Subject selection. Every MCP response includes `diagnostics.appliedScope`. Search also
returns applied kinds, result count, and textual warnings.

When the user names a person or other Subject, search that exact name first. The response's
`subjectUses` is authoritative for records attributed to the matched canonical Subject.
`namedSubjectDiscovery` is returned both at response level and on the matching Subject item; it
contains the canonical Subject ID, applicable paths with Focus and Thread IDs, and ready
`reviewSubjectRequest` calls. That is sufficient to call `onmove.review_subject` without another
hierarchy lookup. If
`searchStatus.sufficient` or `searchStatus.doNotBroaden` is true, stop discovery and fetch those IDs
directly; do not search globally for a generic parent label. A paged search response includes an
opaque `continuationToken` only when another page exists. The token is signed and preserves the complete
request: text, all local-date filters, timezone, scope, lifecycle, sort, kinds, projection, page
size, byte budget, stable cursor, durable search-index generation, and the originating search response shape.
Send only that token to `onmove.continue_search`; never repeat criteria beside it. Changing the
query, scope, or lifecycle starts a new call to the original search tool. A live write between pages returns
`SEARCH_CURSOR_STALE`; restart the original search with its criteria. Broaden only when the user
requests all people or all records.

Search always returns records. Compact responses default to ten records and cap pages at 25. Every
primary match always includes the exact `reference`, the `field` that matched, `containingThread`
when applicable, a complete root-to-record `path` whose every segment has a canonical code, a
`recommendedWriteTarget`, and the record's `lifecycle` provenance.
`searchStatus.targetSelectionReady` is true only when every returned primary match has that complete
path. This metadata is mandatory: byte-budget enforcement may
shorten snippets, remove auxiliary projections, or shorten the primary page and provide a
continuation token, but it never removes a primary match's hierarchy.

The `projection` object controls optional Subject/Scope discovery. Ordinary match paths are not
duplicated into the global `hierarchyPaths` array; that array is reserved for bounded applicability
expansion when Subject/Scope discovery needs paths beyond the primary records. Search does not
accept a rich-text projection and never returns a lossless document.
Search `snippet` values are deliberately bounded plain-text match excerpts, not full content
renderings; queryless previews use the same 200-character ceiling. Once a record is selected, its
compact ID/path getter returns readable Markdown. Optional projections are reduced before the
record page when necessary to honor `page.maxBytes`. That budget applies to the complete MCP result,
including both its textual and structured copies, and has an 8 KiB minimum. `projections.primary`,
`projections.subjectUses`, and `projections.hierarchy` each report returned count, known total,
completeness, and byte-budget truncation independently. `hasMore` and the continuation token refer
only to the primary record page; never infer auxiliary completeness from them.

For “what has Michael been doing in the 1:1s Thread?”, call `onmove.review_subject` with the exact
Subject and Thread selectors. It resolves that intersection and returns Subject-attributed Updates
sorted by `updatedAt`, open Subject/shared Todos, and currently applicable open Commitments with
their Subject-cell state. A resolved review is a stopping signal and includes a continuation token
for the same Subject × Thread boundary.

Hierarchy selectors take exactly one key: `{ "id": 19 }` or `{ "title": "1:1s" }` for entities,
and `{ "id": 34 }` or `{ "name": "Michael" }` for a Subject. Sending both is a selector conflict,
not an instruction to prefer the ID. Resolution remains exact and case-insensitive. If a shorthand
such as `my Xs` does not exactly equal a title such as `Foobar / Xs!`, `resolve_work_target` and
`review_subject` stay `not_found` but return bounded `threadCandidates` with exact IDs and a ready
retry instead of silently guessing.

Focus, Thread, Commitment, Update, and Note ID/path reads default to `includeRichText: false`, which
is the compact and most forward-compatible read. Set it to `true` only immediately before a complete
structural replacement. If one stored document uses an unsupported newer structure, the response
retains the entity and readable fallback, omits only that lossless document, and explains the
degradation in `diagnostics.warnings`.

For a localized text mutation, use the compact Markdown and revision with the semantic patch tool;
it preserves surrounding links and formatting without sending the AST. For full structural
replacement, first resolve the target, then call its by-ID/path getter with `includeRichText: true`.
Search is intentionally not a fallback document hydration path.

Set `text` to `null` (or omit it) for a queryless list. Filter records with `kinds`, named `scope`,
or structured `date`, `createdAt`, and `updatedAt` ranges rather than dummy search text. `date`
means an Update's recorded local date or a dated entity's due date. Creation and modification
instants use inclusive local-calendar ranges interpreted through the request's IANA `timeZone`.
All search records expose `date`, `createdAt`, and `updatedAt`.
Natural-language wrappers use a conservative stop-word pass: a query such as “what has Michael been
doing” retains Michael as the effective FTS term. `onmove.search` is deterministic lexical planning,
not an embedding or general-language query engine; enhanced semantics are exposed only through the
explicitly bounded `onmove.retrieve` contract.

Use `onmove.get_updates_by_ids({ ids: [...] })` to hydrate up to 50 known Update IDs in one bounded
read. It defaults to Markdown without lossless documents and enforces a 32 KiB response budget
(configurable with `maxBytes`). Hidden or missing records appear in `unavailableIds`; visible records
that did not fit appear in `omittedIds` for a subsequent bounded request. A malformed or newer
rich-text observation degrades to readable fallback text with a diagnostic warning rather than
failing the search, single getter, bulk getter, or containing entity read.

Each search hit identifies the matched record under `reference`, its exact matching field under
`field`, and its owners under `hierarchy`. For example, when an Update matches, pass
`hierarchy.thread.id` to `onmove.get_thread_by_id`; do not pass the Update's `reference.id`.
`recommendedWriteTarget` identifies the safe mutation target and whether a direct read is required
before a revision-guarded rich-text write. This distinction is also described directly in the tool
schemas.

Natural-language container nouns are treated as location hints when a more specific term exists.
For example, `find rolloutuniquestring about the thread` searches for the specific evidence term
across descendants instead of requiring the Thread title to contain every wrapper word. An explicit
`kinds:["thread"]` still means Thread records only; omit that narrowing when the answer may live in
a Note, Update, Todo, Routine, or other evidence record.

A non-null named search boundary must exist. Positive unknown IDs fail clearly as
`FOCUS_NOT_FOUND`, `THREAD_NOT_FOUND`, or `SUBJECT_NOT_FOUND`; they are never reported as ordinary
empty searches.

## Tools and resources

Read tools cover compact projected lists; explicit by-ID and by-path Focuses, Threads, Commitments, Routines and Notes;
by-ID and bulk Updates; kind-specific and cross-kind search; context-aware retrieval; Reviews, Due work, Todos, Tags, and
hierarchy-aware work-target resolution. Write tools
cover the safe mutations and semantic rich-text editing described above.
Stable resource templates use:

```text
onmove://focus/{id}
onmove://thread/{id}
onmove://commitment/{id}
onmove://routine/{id}
onmove://note/{id}
onmove://tags/{name}
```

Aggregate resources are `onmove://reviews`, `onmove://due`, and `onmove://todos`.

## Lifecycle, safety, and live refresh

The listener binds only to `127.0.0.1`, accepts only the `/mcp` route, and validates localhost Host
and Origin headers. Electron owns its lifecycle and stops it before closing the shared database.
Successful MCP writes broadcast an in-process domain-change event, immediately refreshing badges
and active projections in every open OnMove window. The FTS projection and audit log remain SQLite
implementation details and are not portable user content.
