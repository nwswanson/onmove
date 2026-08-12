import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { Dialog } from '@/components/ui/dialog'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { ArchiveList } from '@/features/archive/archive-list'
import {
  archivedUpdateItems,
  type ArchivedUpdateItemModel
} from '@/features/archive/archive-presenters'
import { useArchiveModel } from '@/features/archive/use-archive-model'

interface ArchiveWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
}

type Confirmation = { type: 'item'; item: ArchivedUpdateItemModel } | { type: 'all' }

export function ArchiveWorkspace({
  contextDrawer,
  hideSensitiveContent
}: ArchiveWorkspaceProps): React.JSX.Element {
  const archive = useArchiveModel()
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const items = useMemo(
    () => archivedUpdateItems(archive.overview?.items ?? [], hideSensitiveContent),
    [archive.overview?.items, hideSensitiveContent]
  )
  const itemPending = confirmation?.type === 'item' && archive.pendingIds.has(confirmation.item.id)
  const pending = itemPending || archive.clearing

  async function confirmDelete(): Promise<void> {
    if (!confirmation) return
    const deleted = confirmation.type === 'all'
      ? await archive.clearAll()
      : await archive.deleteItem(confirmation.item.id)
    if (deleted) setConfirmation(null)
  }

  return (
    <>
      <WorkspaceShell
        main={
          <main
            className="min-w-0 flex-1 overflow-auto bg-background"
            aria-labelledby="archive-heading"
          >
            <section className="mx-auto w-full max-w-5xl p-8 sm:p-10">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 id="archive-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                    Archive
                  </h1>
                  <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                    Deleted updates are read-only and retained for 30 days before permanent removal.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={!archive.overview?.items.length || archive.clearing}
                  onClick={() => setConfirmation({ type: 'all' })}
                >
                  <Trash2 aria-hidden="true" />
                  Clear all
                </Button>
              </div>

              {archive.loading ? (
                <p className="mt-8 text-sm text-muted-foreground">Loading archive…</p>
              ) : archive.error && archive.overview === null ? (
                <p role="alert" className="mt-8 text-sm text-destructive">{archive.error}</p>
              ) : archive.overview ? (
                <>
                  {archive.error && (
                    <p role="alert" className="mt-5 text-sm text-destructive">{archive.error}</p>
                  )}
                  <ArchiveList
                    items={items}
                    totalItemCount={archive.overview.items.length}
                    pendingIds={archive.pendingIds}
                    onDelete={(itemId) => {
                      const item = items.find(({ id }) => id === itemId)
                      if (item) setConfirmation({ type: 'item', item })
                    }}
                  />
                </>
              ) : null}
            </section>
          </main>
        }
        drawer={<ContextDrawerOutlet {...contextDrawer} />}
      />

      <Dialog
        open={confirmation !== null}
        title={confirmation?.type === 'all' ? 'Clear the archive?' : 'Delete archived update?'}
        description="This permanently removes the retained copy and cannot be undone."
        onClose={() => !pending && setConfirmation(null)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void confirmDelete()}
            >
              {confirmation?.type === 'all' ? 'Clear archive' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-muted-foreground">
          {confirmation?.type === 'all'
            ? `All ${archive.overview?.items.length ?? 0} retained updates will be removed.`
            : confirmation?.item.contextLabel}
        </p>
      </Dialog>
    </>
  )
}
