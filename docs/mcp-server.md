# OnMove MCP server

OnMove can run a local MCP Streamable HTTP server inside the open desktop application. MCP and the
UI use the same application services, domain repositories, and `AppDatabase` instance. The server
does not open SQLite independently and does not expose SQL or renderer state.

## Enable it

Open OnMove → Settings → Model Context Protocol and turn on **Run MCP server**. The Settings pane
shows the active endpoint, which defaults to:

```text
http://127.0.0.1:47832/mcp
```

Configure an MCP client with that URL as a Streamable HTTP server. OnMove must remain open. Turning
the setting off or quitting OnMove closes the endpoint. The port is configurable in Settings if the
default is already in use.

## Permissions

The server itself, sensitive access, and write access all default to off. The independent grants live in
OnMove → Settings → Model Context Protocol:

- Run MCP server
- Allow sensitive content
- Allow safe MCP writes

The server reads these settings on every request, so a running session observes revocation without
being restarted. The View menu's sensitive-content preference does not affect MCP permission.
Hidden records are indistinguishable from unknown IDs. Effective sensitivity includes Focus,
Thread, Commitment or Routine, Scope, Subject cell, and record-level sensitivity.

Write access is intentionally limited to creating Updates and Todos, editing or completing Todos,
editing existing Focus descriptions, Update observations, and Notes, and poking Thread or
Commitment reviews. There are no delete, move, import, archive-clear, or status transition tools.
Successful MCP writes store a metadata-only audit row without user-authored text.

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
Responses and parent contexts expose `observation` as a readable plain-text projection,
`observationRichText` as the lossless document, `observationRevision` for concurrency, and an
`observationWriteGuide` with directly usable semantic edit requests.

### Resolving a hierarchy and creating Todos

Use `onmove.resolve_target` when a request names related records, rather than searching each name
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

`onmove.get_thread`, `onmove.get_commitment`, and resolved candidates expose
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

Search results and parent contexts expose each Note's own ID. Use `onmove.get_note` with that ID to
read its hierarchy, current revision, and both Note write guides. For a title-based request,
`onmove.resolve_note` combines exact hierarchy resolution and the Note read into one call. For
example, a directly owned Focus Note can be read with:

```json
{
  "focus": { "title": "Project Atlas" },
  "note": { "title": "Default" },
  "includeRichText": true
}
```

Add `thread` and then `commitment` selectors when the Note is owned at those levels. The deepest
selector is the direct owner; the tool never silently searches descendant Notes. Duplicate exact
matches return candidates instead of being guessed.

`onmove.get_focus` also accepts `includeRichText: true`. Its `entity` then contains the complete
Focus description, revision, and `descriptionWriteGuide`; directly owned `notes` contain their
complete rich-text documents and current write guides rather than compact summaries. This is useful
when the Focus is already known and avoids separate reads.

The returned `note.content` is a
read-only plain-text projection for comprehension and search. `note.richText` is the complete,
lossless document to edit and send back:

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

Read a Focus with `onmove.get_focus({ id, includeRichText: true })`. The response includes
`entity.description`, `entity.descriptionRichText`, `entity.descriptionRevision`, and
`entity.descriptionWriteGuide`. Read a known Update with `onmove.get_update({ id })`; parent Thread
and Commitment reads also embed full Update observations, revisions, and write guides. A successful
`onmove.create_update` response includes the same observation guide, so a newly created blank Update
can be edited immediately without another discovery call.

Stale writes return `rich_text_revision_conflict` with the exact read request needed for recovery.
Removing all readable text without `clear: true` returns `RICH_TEXT_DISAPPEARED`. Exact patch misses
and duplicate matches return `RICH_TEXT_NOT_FOUND` or `RICH_TEXT_AMBIGUOUS` with actionable retry
metadata. Successful edits are committed through the shared application service and broadcast to
all open main and rich-text windows.

## Search

`onmove.search` is backed by a durable SQLite FTS5 index, not by raw `LIKE` queries or arbitrary
SQL. It indexes readable plain-text projections of:

- Focus descriptions and titles
- Thread and Commitment titles
- Routine names and current checklist templates
- Update observations
- Todo names
- Note titles and content
- Subject names and descriptions

The index uses Unicode tokenization, prefix matching, BM25 ranking, bounded result sets, stable
entity references, self-describing hierarchy IDs, hierarchy paths, and Subject context. Rich-text
Lexical envelopes are parsed to plain text before indexing. Database triggers mark the projection
dirty after relevant writes; the index rebuild is transactional and effective sensitivity is still
resolved against the live hierarchy at query time.

Search is global by default. Omitting `scope`, passing `scope: null`, or using null/omitted hierarchy
IDs never inherits the Focus currently selected in OnMove. Narrowing is always named and explicit:

```json
{ "text": "person x", "scope": { "mode": "all" } }
{ "text": "migration", "scope": { "mode": "focus", "focusId": 12 } }
{ "text": "risk", "scope": { "mode": "thread", "threadId": 19 } }
{ "text": "escalation", "scope": { "mode": "subject", "subjectId": 34 } }
{ "text": "risk", "scope": { "mode": "current" }, "kinds": ["thread", "update"] }
```

`all` searches the entire visible workspace, `focus` searches one Focus hierarchy, `thread`
searches one Thread and its children, `subject` searches records attributed to one canonical Subject,
and `current` explicitly reads the live UI
Focus and Subject selection. Every MCP response includes `diagnostics.appliedScope`. Search also
returns applied kinds, result count, and textual warnings.

When the user names a person or other Subject, search that exact name first. The response's
`subjectUses` is authoritative for records attributed to the matched canonical Subject. If
`searchStatus.sufficient` or `searchStatus.doNotBroaden` is true, stop discovery and fetch those IDs
directly; do not search globally for a generic parent label. Every response includes an opaque
`continuationToken`. Passing it to a follow-up search while omitting `scope` preserves a discovered
Subject and any existing Thread or Focus restriction even when the follow-up `text` changes.
Broaden without the token only when the user requests all people or all records.

Compact responses default to ten results. Set `view: "hierarchy-only"` to return only paths,
diagnostics, stopping status, and continuation state without item or Subject-use contents.
`includeSubjects` is intentionally expansive and is usually unnecessary for reviewing one entity.

For “what has Michael been doing in the 1:1s Thread?”, call `onmove.review_subject` with the exact
Subject and Thread selectors. It resolves that intersection and returns Subject-attributed Updates
sorted by `updatedAt`, open Subject/shared Todos, and currently applicable open Commitments with
their Subject-cell state. A resolved review is a stopping signal and includes a continuation token
for the same Subject × Thread boundary.

For a text mutation, set `includeRichText: true` on `onmove.search`. Focus, Update, and Note hits
then include `editableRichText` with the complete document, readable projection, revision,
self-describing target, and semantic patch/full-write guides. This collapses the common
search → parent read → field read sequence into one read followed by one guarded patch. The option
applies uniformly to Focus descriptions, Update observations, and Note content.

Each search hit identifies the matched record under `reference` and its owners under `hierarchy`.
For example, when an Update matches, pass `hierarchy.thread.id` to `onmove.get_thread`; do not pass
the Update's `reference.id`. This distinction is also described directly in the tool schemas.

## Tools and resources

Read tools cover Focuses, Threads, Commitments, Updates, Routines, Reviews, Due work, Todos, Tags,
search, Subject review, Notes, combined Note resolution, and hierarchy-aware work-target resolution. Write tools
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
