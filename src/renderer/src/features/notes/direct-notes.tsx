import { useRef } from 'react'
import type { NoteSnapshot } from '../../../../shared/contracts'
import {
  isRichText,
  RichTextEditor,
  richTextPlainText
} from '@/components/ui/rich-text-editor'
import { useDurableRichText } from '@/features/rich-text/use-durable-rich-text'
import { cn } from '@/lib/utils'

export interface NoteEditorModel {
  id: number
  title: string
  content: string
}

interface NoteEditorProps {
  note: NoteEditorModel
  fillHeight?: boolean
  onContentChange?: () => void
  className?: string
}

export function NoteEditor({
  note,
  fillHeight = false,
  onContentChange,
  className
}: NoteEditorProps): React.JSX.Element {
  const ignoredLegacyNormalization = useRef(false)
  const document = useDurableRichText(
    { type: 'note', id: note.id, field: 'content' },
    note.content
  )

  return (
    <article className={cn(
      fillHeight
        ? 'flex h-full min-h-0 flex-col overflow-hidden bg-background'
        : 'rounded-xl border border-border/80 bg-card/55 p-3 shadow-xs',
      className
    )}>
      {!fillHeight && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold">{note.title}</h3>
          <span className="text-[0.6875rem] text-muted-foreground">Saved as you type</span>
        </div>
      )}
      <RichTextEditor
        className={cn(
          fillHeight && 'min-h-0 flex-1 rounded-none border-0 bg-background shadow-none'
        )}
        ariaLabel={`${note.title} note`}
        placeholder="Write a note…"
        value={document.value}
        externalRevision={document.revision}
        fillHeight={fillHeight}
        onChange={(value) => {
          document.save(value)
          if (
            !ignoredLegacyNormalization.current &&
            !isRichText(note.content) &&
            richTextPlainText(value) === note.content
          ) {
            ignoredLegacyNormalization.current = true
            return
          }
          ignoredLegacyNormalization.current = true
          onContentChange?.()
        }}
        onOpenInWindow={document.openInWindow}
      />
      {document.error ? (
        <p role="alert" className={cn(
          'text-xs text-destructive',
          fillHeight ? 'shrink-0 px-3 py-2' : 'mt-2'
        )}>{document.error}</p>
      ) : null}
    </article>
  )
}

export function DirectNotes({ notes }: { notes: readonly NoteSnapshot[] }): React.JSX.Element {
  return (
    <section className="mt-8" aria-labelledby={`notes-${notes[0]?.parent.type ?? 'empty'}-${notes[0]?.parent.id ?? 'none'}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2
          id={`notes-${notes[0]?.parent.type ?? 'empty'}-${notes[0]?.parent.id ?? 'none'}`}
          className="text-sm font-semibold"
        >
          Notes
        </h2>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => <NoteEditor key={note.id} note={note} />)}
        </div>
      )}
    </section>
  )
}
