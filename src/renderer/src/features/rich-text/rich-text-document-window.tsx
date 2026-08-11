import { useEffect } from 'react'
import type { RichTextDocumentReference } from '../../../../shared/contracts'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useDurableRichText } from '@/features/rich-text/use-durable-rich-text'

export function RichTextDocumentWindow({
  reference
}: {
  reference: RichTextDocumentReference
}): React.JSX.Element {
  const editor = useDurableRichText(reference)

  useEffect(() => {
    globalThis.document.title = editor.title ? `${editor.title} — OnMove` : 'OnMove — Editor'
  }, [editor.title])

  return (
    <main className="relative flex h-screen min-h-0 flex-col bg-background pt-10">
      <div
        aria-hidden="true"
        data-slot="rich-text-window-titlebar"
        className="drag-region absolute inset-x-0 top-0 h-10"
      />
      <header className="border-b border-border/70 px-6 py-4">
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          OnMove document
        </p>
        <h1 className="mt-1 text-lg font-semibold">{editor.title || 'Rich text editor'}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Saved locally as you type</p>
      </header>
      <div
        data-slot="rich-text-window-editor-region"
        className="flex min-h-0 flex-1 flex-col p-6"
      >
        <RichTextEditor
          ariaLabel="Document content"
          className="min-h-0 flex-1"
          fillHeight
          value={editor.value}
          externalRevision={editor.revision}
          onChange={editor.save}
        />
        {editor.error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">{editor.error}</p>
        ) : null}
      </div>
    </main>
  )
}
