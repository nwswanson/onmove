import { useRef } from 'react'
import {
  isRichText,
  richTextPlainText
} from '@/components/ui/rich-text-editor'
import { RichTextEditorWithHistory } from '@/features/rich-text/rich-text-history'
import { useDurableRichText } from '@/features/rich-text/use-durable-rich-text'
import { cn } from '@/lib/utils'

export interface NoteEditorModel {
  id: number
  title: string
  content: string
}

interface NoteEditorProps {
  note: NoteEditorModel
  onContentChange?: () => void
  className?: string
}

export function NoteEditor({
  note,
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
      'flex h-full min-h-0 flex-col overflow-hidden bg-background',
      className
    )}>
      <RichTextEditorWithHistory
        historyReference={{ type: 'note', id: note.id, field: 'content' }}
        className="min-h-0 flex-1 rounded-none border-0 bg-background shadow-none"
        ariaLabel={`${note.title} note`}
        placeholder="Write a note…"
        value={document.value}
        externalRevision={document.externalRevision}
        fillHeight
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
        <p role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">
          {document.error}
        </p>
      ) : null}
    </article>
  )
}
