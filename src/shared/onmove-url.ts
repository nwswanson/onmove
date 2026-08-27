import type { EntityReferenceKind, ParsedEntityReference } from './entity-reference'
import { entityReference } from './entity-reference'

export const ONMOVE_URL_SCHEME = 'onmove'

/** Canonical clickable URL for one user-addressable OnMove record. */
export function onMoveEntityUrl(kind: EntityReferenceKind, id: number | string): string {
  // Reuse the public-reference validator so URLs and #codes accept exactly the
  // same positive, durable SQLite identities.
  const numericId = Number(typeof id === 'string' ? id.trim() : id)
  if (!Number.isSafeInteger(numericId) || numericId < 1) {
    throw new Error(`A ${kind} URL requires a positive numeric id`)
  }
  entityReference(kind, numericId)
  return `${ONMOVE_URL_SCHEME}://${kind}/${numericId}`
}

/**
 * Parses only canonical entity links. Unknown hosts, extra path segments,
 * query state, fragments, credentials, and non-positive IDs are rejected.
 */
export function parseOnMoveEntityUrl(value: string): ParsedEntityReference | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (
    parsed.protocol !== `${ONMOVE_URL_SCHEME}:` ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) return null

  const kind = parsed.hostname as EntityReferenceKind
  if (!['focus', 'thread', 'commitment', 'routine', 'update', 'todo', 'note', 'subject']
    .includes(kind)) return null
  const match = /^\/([1-9]\d*)$/u.exec(parsed.pathname)
  if (!match) return null
  const id = Number(match[1])
  if (!Number.isSafeInteger(id) || id < 1) return null
  return { kind, id, code: entityReference(kind, id) }
}

export function onMoveMarkdownEntityLink(
  kind: EntityReferenceKind,
  id: number,
  name: string
): string {
  const safeName = name.trim()
    .replace(/\\/gu, '\\\\')
    .replace(/\[/gu, '\\[')
    .replace(/\]/gu, '\\]') || entityLabel(kind)
  return `[${safeName} ${entityReference(kind, id)}](${onMoveEntityUrl(kind, id)})`
}

function entityLabel(kind: EntityReferenceKind): string {
  return kind === 'todo'
    ? 'Todo'
    : `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`
}
