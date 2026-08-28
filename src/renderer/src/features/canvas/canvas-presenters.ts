import type {
  CanvasEntityReferenceSnapshot,
  CanvasEntitySnapshot
} from '../../../../shared/contracts'
import type {
  EntityLibraryGroupModel,
  EntityLibraryItemModel
} from '@/components/ui/entity-library-sidebar'

const GROUPS = [
  ['thread', 'Threads'],
  ['commitment', 'Commitments'],
  ['routine', 'Routines'],
  ['note', 'Notes'],
  ['todo', 'Todos']
] as const

export function canvasEntityKey(entity: CanvasEntitySnapshot): string {
  return `${entity.target.type}:${entity.target.id}`
}

/** Translates domain entities into the library receiver's bounded row contract. */
export function canvasLibraryGroups(
  entities: readonly CanvasEntitySnapshot[],
  references: readonly CanvasEntityReferenceSnapshot[],
  hideSensitiveContent: boolean
): EntityLibraryGroupModel[] {
  const placed = new Set(references.filter(({ deleted }) => !deleted).map(canvasEntityKey))
  return GROUPS.map(([kind, label]) => ({
    id: kind,
    label,
    items: entities
      .filter((entity) =>
        entity.target.type === kind &&
        (!hideSensitiveContent || !entity.effectiveSensitive))
      .map((entity): EntityLibraryItemModel => ({
        id: canvasEntityKey(entity),
        label: entity.title,
        description: entity.context,
        status: entity.status ?? 'No status',
        icon: entity.target.type,
        disabled: placed.has(canvasEntityKey(entity))
      }))
  }))
}
