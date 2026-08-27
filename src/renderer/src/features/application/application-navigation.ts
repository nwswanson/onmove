/**
 * Data-only destination for restoring a Focus workspace from another feature.
 * The Focus workspace remains the owner of contextual-sidebar and subject-tab
 * selection; callers describe the destination without coordinating UI steps.
 */
export interface FocusWorkspaceDestination {
  requestId: number
  focusId: number
  threadId: number | null
  commitmentId: number | null
  /** Selects a Routine child while preserving its owning Thread hierarchy. */
  routineId?: number | null
  subjectId: number | null
  /**
   * `children` currently enters the receiver-owned Commitment level. It is a
   * deliberately generic destination: Routines and future child kinds can
   * join that level without changing saved navigation pins or their callers.
   */
  contextualMode?: 'default' | 'children'
}

export type FocusWorkspaceDestinationTarget = Omit<FocusWorkspaceDestination, 'requestId'>

/** Data-only destination for selecting a Tag after entering the Tags workspace. */
export interface TagsWorkspaceDestination {
  requestId: number
  name: string
}
