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
and poking Thread or Commitment reviews. There are no delete, move, import, archive-clear, or status
transition tools. Successful MCP writes store a metadata-only audit row without user-authored text.

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
entity references, hierarchy paths, and Subject context. Rich-text Lexical envelopes are parsed to
plain text before indexing. Database triggers mark the projection dirty after relevant writes; the
index rebuild is transactional and effective sensitivity is still resolved against the live
hierarchy at query time.

## Tools and resources

Read tools cover Focuses, Threads, Commitments, Routines, Reviews, Due work, Todos, Tags, and search.
Write tools cover the safe mutations described above. Stable resource templates use:

```text
onmove://focus/{id}
onmove://thread/{id}
onmove://commitment/{id}
onmove://routine/{id}
onmove://tags/{name}
```

Aggregate resources are `onmove://reviews`, `onmove://due`, and `onmove://todos`.

## Lifecycle, safety, and live refresh

The listener binds only to `127.0.0.1`, accepts only the `/mcp` route, and validates localhost Host
and Origin headers. Electron owns its lifecycle and stops it before closing the shared database.
Successful MCP writes broadcast an in-process domain-change event, immediately refreshing badges
and active projections in every open OnMove window. The FTS projection and audit log remain SQLite
implementation details and are not portable user content.
