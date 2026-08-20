import {
  ArrowLeft,
  ChevronRight,
  History,
  RotateCcw
} from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type ComponentProps
} from 'react'
import type {
  RichTextHistoryReference,
  RichTextHistorySnapshot
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  RichTextContent,
  RichTextEditor,
  type RichTextEditorHandle,
  type RichTextEditorProps
} from '@/components/ui/rich-text-editor'

const REASON_LABELS: Record<RichTextHistorySnapshot['reason'], string> = {
  legacy: 'Previous version',
  destructive: 'Before content was cleared',
  'large-edit': 'Before a large edit',
  accumulated: 'Editing checkpoint',
  idle: 'Editing session',
  elapsed: 'Timed checkpoint',
  restore: 'Before a restore'
}

function capturedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export function RichTextHistoryDialog({
  reference,
  open,
  allowRestore = true,
  onClose,
  onRestored
}: {
  reference: RichTextHistoryReference
  open: boolean
  allowRestore?: boolean
  onClose: () => void
  onRestored?: (value: string) => void
}): React.JSX.Element | null {
  if (!open) return null
  return (
    <OpenRichTextHistoryDialog
      key={`${reference.type}:${reference.id}:${reference.field}`}
      reference={reference}
      allowRestore={allowRestore}
      onClose={onClose}
      onRestored={onRestored}
    />
  )
}

function OpenRichTextHistoryDialog({
  reference,
  allowRestore,
  onClose,
  onRestored
}: {
  reference: RichTextHistoryReference
  allowRestore: boolean
  onClose: () => void
  onRestored?: (value: string) => void
}): React.JSX.Element {
  const { type, id, field } = reference
  const stableReference = useMemo<RichTextHistoryReference>(
    () => ({ type, id, field }) as RichTextHistoryReference,
    [field, id, type]
  )
  const [history, setHistory] = useState<RichTextHistorySnapshot[]>([])
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const selected = history.find(({ revision }) => revision === selectedRevision) ?? null

  useEffect(() => {
    let active = true
    window.onmove.richText.listHistory(stableReference).then(
      (entries) => {
        if (!active) return
        setHistory(entries)
        setLoading(false)
      },
      () => {
        if (!active) return
        setError('Text history could not be loaded.')
        setLoading(false)
      }
    )
    return () => {
      active = false
    }
  }, [stableReference])

  async function restore(): Promise<void> {
    if (!selected || restoring || !allowRestore) return
    setRestoring(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.onmove.richText.restoreHistory(stableReference, selected.revision)
      setHistory(result.history)
      setSelectedRevision(null)
      setStatus('Restored as a new edit. The prior live text is now in history.')
      onRestored?.(result.value)
    } catch {
      setError('This version could not be restored. It may no longer be editable.')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog
      open
      title="Text history"
      description={selected
        ? `${capturedLabel(selected.capturedAt)} · ${REASON_LABELS[selected.reason]}`
        : 'Recovery checkpoints are created for meaningful editing changes.'}
      contentClassName="max-w-3xl"
      onClose={onClose}
      footer={selected ? (
        <>
          <Button type="button" variant="ghost" onClick={() => setSelectedRevision(null)}>
            Back to history
          </Button>
          {allowRestore ? (
            <Button type="button" disabled={restoring} onClick={() => void restore()}>
              <RotateCcw aria-hidden="true" />
              {restoring ? 'Restoring…' : 'Restore this version'}
            </Button>
          ) : null}
        </>
      ) : undefined}
    >
      <div className="max-h-[65vh] min-h-56 overflow-y-auto">
        {selected ? (
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-3 -ml-2"
              onClick={() => setSelectedRevision(null)}
            >
              <ArrowLeft aria-hidden="true" />
              History
            </Button>
            {selected.value ? (
              <div className="rounded-lg border border-border/75 bg-background p-4">
                <RichTextContent
                  value={selected.value}
                  ariaLabel={`Historical text revision ${selected.revision}`}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
                This version was blank.
              </div>
            )}
          </div>
        ) : loading ? (
          <p role="status" className="py-16 text-center text-sm text-muted-foreground">
            Loading history…
          </p>
        ) : history.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <History className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No recovery checkpoints yet</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Ordinary autosaves do not create a version. History appears after larger changes or a new editing session.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-border/65" aria-label="Text history versions">
            {history.map((entry) => (
              <li key={entry.revision}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-2 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                  onClick={() => {
                    setSelectedRevision(entry.revision)
                    setStatus(null)
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{capturedLabel(entry.capturedAt)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Version {entry.revision} · {REASON_LABELS[entry.reason]}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        )}
        {status ? <p role="status" className="mt-3 text-xs text-success">{status}</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  )
}

export interface RichTextEditorWithHistoryProps extends RichTextEditorProps {
  historyReference: RichTextHistoryReference
  /** Set false for an editor already contained by a modal. */
  historyEnabled?: boolean
  /** Flushes a throttled draft before history reads or restores persisted text. */
  onBeforeOpenHistory?: () => void | Promise<void>
}

export const RichTextEditorWithHistory = forwardRef<
  RichTextEditorHandle,
  RichTextEditorWithHistoryProps
>(function RichTextEditorWithHistory({
  historyReference,
  historyEnabled = true,
  onBeforeOpenHistory,
  value,
  externalRevision,
  ...props
}, forwardedRef): React.JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [restored, setRestored] = useState<{
    value: string
    token: number
    baseRevision: typeof externalRevision
    baseValue: string
  } | null>(null)
  const activeRestored = restored
    && restored.baseRevision === externalRevision
    && restored.baseValue === value
    ? restored
    : null

  return (
    <>
      <RichTextEditor
        {...props}
        ref={forwardedRef}
        value={activeRestored?.value ?? value}
        externalRevision={activeRestored?.token ?? externalRevision}
        onOpenHistory={historyEnabled ? () => {
          void Promise.resolve(onBeforeOpenHistory?.()).then(
            () => setHistoryOpen(true),
            () => undefined
          )
        } : undefined}
      />
      {historyEnabled ? (
        <RichTextHistoryDialog
          reference={historyReference}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onRestored={(nextValue) => setRestored((current) => ({
            value: nextValue,
            token: (current?.token ?? 0) + 1,
            baseRevision: externalRevision,
            baseValue: value
          }))}
        />
      ) : null}
    </>
  )
})

export function RichTextContentWithHistory({
  historyReference,
  ...props
}: ComponentProps<typeof RichTextContent> & {
  historyReference: RichTextHistoryReference
}): React.JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(false)
  return (
    <div className="relative pr-9">
      <RichTextContent {...props} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 size-8 text-muted-foreground"
        aria-label="View text history"
        title="View history"
        onClick={() => setHistoryOpen(true)}
      >
        <History aria-hidden="true" />
      </Button>
      <RichTextHistoryDialog
        reference={historyReference}
        open={historyOpen}
        allowRestore={false}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  )
}
