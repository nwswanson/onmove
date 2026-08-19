import { useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import type { EditUpdateInput, RichTextDocumentReference } from '../../../../shared/contracts'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { TaggedText } from '@/components/ui/tagged-text'
import { useDurableRichText } from '@/features/rich-text/use-durable-rich-text'
import { WorkKindIcon } from '@/features/shared/work-kind-icon'
import { UpdateMetadataBar } from '@/features/updates/update-metadata-bar'
import { UPDATE_LIST_STATE_OPTIONS } from '@/features/updates/updates-presenters'

export function RichTextDocumentWindow({
  reference
}: {
  reference: RichTextDocumentReference
}): React.JSX.Element {
  const editor = useDurableRichText(reference)

  useEffect(() => {
    const contextTitle = editor.context.map(({ title }) => title)
    if (editor.kind === 'update') {
      contextTitle.push(editor.subject?.name ?? 'Unscoped')
    }
    const documentLabel = editor.kind === 'note'
      ? 'Default Note'
      : editor.kind === 'description'
        ? 'Description'
        : null
    globalThis.document.title = [contextTitle.join(' › '), documentLabel, 'OnMove']
      .filter(Boolean)
      .join(' — ')
  }, [editor.context, editor.kind, editor.subject])

  function updateMetadata(changes: { date?: string; state?: string; sensitive?: boolean }): void {
    const input: EditUpdateInput = {}
    if (changes.date !== undefined) input.date = changes.date
    if (
      changes.state === 'red' ||
      changes.state === 'yellow' ||
      changes.state === 'green' ||
      changes.state === 'none'
    ) input.state = changes.state
    if (changes.sensitive !== undefined) input.sensitive = changes.sensitive
    void editor.saveUpdateMetadata(input)
  }

  return (
    <main className="relative flex h-screen min-h-0 flex-col bg-background pt-10">
      <div
        aria-hidden="true"
        data-slot="rich-text-window-titlebar"
        className="drag-region absolute inset-x-0 top-0 h-10"
      />
      <header className="border-b border-border/70">
        <div className="px-6 py-4">
          {editor.context.length > 0 ? (
            <nav aria-label="Document context" className="min-w-0">
              <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[0.6875rem] text-muted-foreground">
                {editor.context.map((segment, index) => (
                  <li key={`${segment.kind}:${segment.title}:${index}`} className="flex min-w-0 items-center gap-1">
                    {index > 0 ? (
                      <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                    ) : null}
                    <span className="flex min-w-0 items-center gap-1.5">
                      <WorkKindIcon
                        kind={segment.kind}
                        className="size-4 text-muted-foreground"
                      />
                      <span className={
                        index === editor.context.length - 1 && editor.kind !== 'update'
                          ? 'max-w-72 truncate font-semibold text-foreground'
                          : 'max-w-56 truncate'
                      }>
                        <TaggedText value={segment.title} />
                      </span>
                    </span>
                  </li>
                ))}
                {editor.kind === 'update' ? (
                  <li className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                    <span className="max-w-72 truncate font-semibold text-foreground">
                      <TaggedText value={editor.subject?.name ?? 'Unscoped'} />
                    </span>
                  </li>
                ) : null}
              </ol>
            </nav>
          ) : null}
          {editor.kind !== 'update' ? (
            <p className="mt-2 text-sm font-semibold text-foreground">
              {editor.kind === 'note' ? 'Default Note' : 'Description'}
            </p>
          ) : null}
        </div>
        {editor.kind === 'update' && editor.updateMetadata ? (
          <UpdateMetadataBar
            idPrefix={`detached-update-${reference.id}`}
            value={editor.updateMetadata}
            stateOptions={UPDATE_LIST_STATE_OPTIONS}
            disabled={editor.metadataSaving}
            sensitivityDisabled={editor.metadataSaving}
            className="border-t border-b-0 px-6"
            onValueChange={updateMetadata}
          />
        ) : null}
        {editor.metadataError ? (
          <p role="alert" className="px-6 py-2 text-xs text-destructive">
            {editor.metadataError}
          </p>
        ) : null}
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
