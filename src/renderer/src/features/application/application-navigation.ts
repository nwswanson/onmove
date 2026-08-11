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
  subjectId: number | null
}

export type FocusWorkspaceDestinationTarget = Omit<FocusWorkspaceDestination, 'requestId'>
