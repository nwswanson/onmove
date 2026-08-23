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

/**
 * Stable, human-facing reference for a user-addressable domain record.
 *
 * SQLite ids are allocated independently by table, so the kind prefix is part
 * of the identifier: F.4 and T.4 refer to different records without ambiguity.
 */
export function entityReference(
  kind: EntityReferenceKind,
  id: number | string
): string {
  const normalizedId = typeof id === 'number' ? String(id) : id.trim()
  if (!/^\d+$/.test(normalizedId) || Number(normalizedId) < 1) {
    throw new Error(`A ${kind} reference requires a positive numeric id`)
  }
  return `${ENTITY_REFERENCE_PREFIXES[kind]}.${normalizedId}`
}
