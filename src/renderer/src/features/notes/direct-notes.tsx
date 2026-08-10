import type { NoteSnapshot } from '../../../../shared/contracts'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useDurableRichText } from '@/features/rich-text/use-durable-rich-text'

function NoteEditor({ note }: { note: NoteSnapshot }): React.JSX.Element {
  const document = useDurableRichText(
    { type: 'note', id: note.id, field: 'content' },
    note.content
  )

  return (
    <article className="rounded-xl border border-border/80 bg-card/55 p-3 shadow-xs">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold">{note.title}</h3>
        <span className="text-[0.6875rem] text-muted-foreground">Saved as you type</span>
      </div>
      <RichTextEditor
        ariaLabel={`${note.title} note`}
        placeholder="Write a note…"
        value={document.value}
        externalRevision={document.revision}
        onChange={document.save}
        onOpenInWindow={document.openInWindow}
      />
      {document.error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">{document.error}</p>
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
