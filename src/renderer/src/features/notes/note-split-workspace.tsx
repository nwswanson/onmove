import { useState } from 'react'
import type { ReactNode } from 'react'
import { VerticalSplitPane } from '@/components/ui/vertical-split-pane'
import { NoteEditor, type NoteEditorModel } from '@/features/notes/direct-notes'
import {
  loadNoteSplitCollapsed,
  loadNoteSplitPrimaryPercent,
  NOTE_SPLIT_PRIMARY_MAX_PERCENT,
  NOTE_SPLIT_PRIMARY_MIN_PERCENT,
  noteSplitPreferenceStorage,
  saveNoteSplitCollapsed,
  saveNoteSplitPrimaryPercent
} from '@/features/notes/note-split-preference'
import { cn } from '@/lib/utils'

interface NoteSplitWorkspaceProps {
  /** Stable presentation scope, such as `review`, `thread`, or `commitment`. */
  preferenceId: string
  workspaceLabel: string
  noteOwnerLabel?: string
  primary: ReactNode
  note: NoteEditorModel | null
  onNoteContentChange?: () => void
  emptyNoteMessage?: string
  notePaneClassName?: string
  className?: string
}

/**
 * Shared receiver for a primary workspace with one editable lower note pane.
 * Domain screens supply data and mutations; this receiver owns all split-pane UI
 * behavior and its screen-scoped presentation preferences.
 */
export function NoteSplitWorkspace({
  preferenceId,
  workspaceLabel,
  noteOwnerLabel = workspaceLabel,
  primary,
  note,
  onNoteContentChange,
  emptyNoteMessage = 'This item does not have a Default note.',
  notePaneClassName,
  className
}: NoteSplitWorkspaceProps): React.JSX.Element {
  const [storage] = useState(noteSplitPreferenceStorage)
  const primaryPanePercent = loadNoteSplitPrimaryPercent(preferenceId, storage)
  const notePaneCollapsed = loadNoteSplitCollapsed(preferenceId, storage)
  const workspaceName = workspaceLabel.toLocaleLowerCase()

  return (
    <VerticalSplitPane
      key={preferenceId}
      className={cn('h-full', className)}
      separatorLabel={`Resize ${workspaceName} and note panes`}
      initialPrimaryPercent={primaryPanePercent}
      initialSecondaryCollapsed={notePaneCollapsed}
      minPrimaryPercent={NOTE_SPLIT_PRIMARY_MIN_PERCENT}
      maxPrimaryPercent={NOTE_SPLIT_PRIMARY_MAX_PERCENT}
      secondaryLabel="Default note"
      collapseSecondaryLabel="Collapse default note"
      expandSecondaryLabel="Expand default note"
      onPrimaryPercentChange={(value) =>
        saveNoteSplitPrimaryPercent(preferenceId, storage, value)}
      onSecondaryCollapsedChange={(collapsed) =>
        saveNoteSplitCollapsed(preferenceId, storage, collapsed)}
      primary={primary}
      secondary={(
        <section
          aria-label={`${noteOwnerLabel} default note`}
          className={cn(
            'h-full min-h-0 px-8 pt-2 pb-8 sm:px-10',
            notePaneClassName
          )}
        >
          {note ? (
            <NoteEditor
              key={note.id}
              note={note}
              fillHeight
              onContentChange={onNoteContentChange}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/10 px-5 text-center">
              <p className="text-sm text-muted-foreground">{emptyNoteMessage}</p>
            </div>
          )}
        </section>
      )}
    />
  )
}
