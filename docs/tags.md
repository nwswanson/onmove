# Tags and backreferences

Tags are durable inline syntax plus a read-only derived index. A recognized token is `@` followed by
one or more Unicode letters or numbers. It cannot be embedded in an email-like word, and a token
followed by `_` or `-` is rejected rather than partially matched. Exact spelling is identity:
`@Launch` and `@launch` appear as separate Tags.

## Source of truth

There is no `tags` or `tag_uses` table. Current stored user text is authoritative:

- Focus title, description, and goal
- Thread title
- Commitment title
- Update observation
- Todo name
- Note title and content

The main-process `TagRepository` reads those bounded columns, resolves each record's Focus, optional
Thread, optional Commitment, and optional Subject, then applies the shared parser. Rich-text fields
first pass through the shared Lexical-to-plain-text projection, so JSON structure, formatting, and
node metadata can never appear as a use or snippet. A use is one exact occurrence, including
repeated occurrences in the same field.

This keeps lifecycle behavior simple. Editing text immediately changes the next query. Reparenting a
Thread or Commitment changes the resolved containing hierarchy without rewriting the token. Import
needs no index rebuild. Deleting a parent lets the existing cascade remove its text and therefore
its uses. Older databases need no migration.

## Query and UI boundary

The preload exposes two named operations:

- `listTags()` returns exact names with total and effectively-sensitive occurrence counts.
- `listTagUses(name)` validates one exact name and returns only that name's occurrences.

Each occurrence contains a short normalized plain-text snippet, a typed source/field reference, its
resolved hierarchy, and one effective-sensitivity flag. It does not contain a renderer route or UI
model. The Tags presenter owns the translation into a contextual-sidebar row, a Location/Field/
Snippet table row, and `FocusWorkspaceDestination`.

Tags is a primary destination immediately beneath Todos. Its parentless contextual sidebar selects
one tag and shows visible-use counts. The main table is limited to the selected tag. Location is the
only link; it opens the containing Focus Overall or Thread, optional nested Commitment, and exact
Subject tab atomically through the same application-level destination contract as the Todo overview.

Sensitive content remains a presentation preference. Main-process queries stay complete and attach
effective hierarchy sensitivity. The feature presenter removes sensitive occurrences and any tag
with zero remaining visible uses. If that invalidates the selected tag, the shared contextual
navigation selects the first remaining tag or the empty state.
