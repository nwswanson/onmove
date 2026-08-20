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
updating existing Notes, and poking Thread or Commitment reviews. There are no delete, move,
import, archive-clear, or status transition tools. Successful MCP writes store a metadata-only
audit row without user-authored text.

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
Responses and parent contexts expose `observation` as a readable plain-text projection and
`observationRichText` as the lossless document.

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
read its hierarchy, current revision, and `writeGuide.updateNote`. The returned `note.content` is a
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

`onmove.update_note` replaces the complete Note with an editor-neutral document rather than exposing
the app's internal Lexical JSON. Blocks support paragraphs, bulleted lists, numbered lists,
checklists, and multi-block quotes. Inline content supports links, soft line breaks, durable `@tag`
tokens, readable text colors, and bold, italic, underline, strikethrough, and highlight marks. Lists
may nest. The server validates document shape, size, depth, tag syntax, supported marks and colors,
and `http`, `https`, or `mailto` link protocols before writing anything.

`richText` is the preferred write field for both tools because it matches `note.richText` on reads.
The older `document` name remains accepted as a compatibility alias, but clients must not send both.
The yellow highlighter is the canonical `highlight` mark. The intuitive `highlight-yellow` input is
also accepted and reads back as `highlight`; it is not a separate foreground color.

Clients should copy `note.richText`, change only the intended nodes, and submit the whole document.
The writable schema deliberately has no plain `content` field: plain-text replacement could erase
formatting that the caller did not see. Legacy plain-text Notes are projected into paragraph blocks
when read and become versioned rich text on their next API edit.

The current revision is mandatory. If the Note changed in the app after it was read, the write is
rejected as `note_revision_conflict` without changing the database. The response instructs the
client to read, reconcile, and retry; the server never invents a text or structural merge. A
successful write returns the refreshed Note context, including its new revision and canonical
`note.richText` document.

Missing, conflicting, or structurally invalid rich text returns an error with `preferredField`, the
accepted alias, supported marks, mark aliases, a recovery instruction, and a minimal valid example.

A committed Note edit is broadcast through both the domain and rich-text live-change channels, so
the main application and any open pop-out Note window receive the new revision immediately.

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
{ "text": "escalation", "scope": { "mode": "subject", "subjectId": 34 } }
{ "text": "risk", "scope": { "mode": "current" }, "kinds": ["thread", "update"] }
```

`all` searches the entire visible workspace, `focus` searches one Focus hierarchy, `subject`
searches records attributed to one canonical Subject, and `current` explicitly reads the live UI
Focus and Subject selection. Every MCP response includes `diagnostics.appliedScope`. Search also
returns applied kinds, result count, and textual warnings. A narrowly filtered empty result tells
the client how to retry globally.

Each search hit identifies the matched record under `reference` and its owners under `hierarchy`.
For example, when an Update matches, pass `hierarchy.thread.id` to `onmove.get_thread`; do not pass
the Update's `reference.id`. This distinction is also described directly in the tool schemas.

## Tools and resources

Read tools cover Focuses, Threads, Commitments, Routines, Reviews, Due work, Todos, Tags, search,
Notes, and hierarchy-aware target resolution. Write tools cover the safe mutations described above.
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
