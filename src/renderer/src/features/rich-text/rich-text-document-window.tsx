import { useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import type { RichTextDocumentReference } from '../../../../shared/contracts'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { TaggedText } from '@/components/ui/tagged-text'
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
        {editor.contextPath.length > 0 ? (
          <nav aria-label="Document context">
            <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[0.6875rem] text-muted-foreground">
              {editor.contextPath.map((segment, index) => (
                <li key={`${segment}:${index}`} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? (
                    <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                  ) : null}
                  <span className={index === editor.contextPath.length - 1
                    ? 'max-w-72 truncate font-semibold text-foreground'
                    : 'max-w-56 truncate'}>
                    <TaggedText value={segment} />
                  </span>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className={editor.contextPath.length > 0
          ? 'mt-2 text-lg font-semibold'
          : 'text-lg font-semibold'}>
          {editor.title || 'Rich text editor'}
        </h1>
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
