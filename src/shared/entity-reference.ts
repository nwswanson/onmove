export const ENTITY_REFERENCE_PREFIXES = {
  focus: 'F',
  thread: 'T',
  commitment: 'C',
  routine: 'R',
  update: 'U',
  todo: 'TD',
  note: 'N',
  subject: 'S'
} as const

export type EntityReferenceKind = keyof typeof ENTITY_REFERENCE_PREFIXES

export interface ParsedEntityReference {
  kind: EntityReferenceKind
  id: number
  code: string
}

const ENTITY_REFERENCE_KINDS = Object.entries(ENTITY_REFERENCE_PREFIXES)
  .sort((left, right) => right[1].length - left[1].length) as Array<
    [EntityReferenceKind, (typeof ENTITY_REFERENCE_PREFIXES)[EntityReferenceKind]]
  >

/** Stable, human-facing reference for a user-addressable domain record. */
export function entityReference(kind: EntityReferenceKind, id: number | string): string {
  const normalizedId = typeof id === 'number' ? String(id) : id.trim()
  if (!/^\d+$/.test(normalizedId) || Number(normalizedId) < 1) {
    throw new Error(`A ${kind} reference requires a positive numeric id`)
  }
  return `#${ENTITY_REFERENCE_PREFIXES[kind]}${normalizedId}`
}

/**
 * Parses a public reference. MCP inputs tolerate omitted `#` and lowercase,
 * while every returned code is canonical (for example, `#T4`).
 */
export function parseEntityReference(value: string): ParsedEntityReference | null {
  const normalized = value.trim().toUpperCase().replace(/^#/, '')
  for (const [kind, prefix] of ENTITY_REFERENCE_KINDS) {
    if (!normalized.startsWith(prefix)) continue
    const rawId = normalized.slice(prefix.length)
    if (!/^\d+$/.test(rawId) || Number(rawId) < 1) return null
    const id = Number(rawId)
    return { kind, id, code: entityReference(kind, id) }
  }
  return null
}
