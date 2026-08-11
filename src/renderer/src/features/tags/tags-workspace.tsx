import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ContextualSidebar,
  ContextualSidebarLevel,
  ContextualSidebarNavigation,
  useContextualSidebarNavigation
} from '@/components/ui/contextual-sidebar'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import type {
  FocusWorkspaceDestinationTarget,
  TagsWorkspaceDestination
} from '@/features/application/application-navigation'
import {
  tagSidebarItems,
  tagUseRows
} from '@/features/tags/tag-presenters'
import { TagUseTable } from '@/features/tags/tag-use-table'
import { useTagsModel } from '@/features/tags/use-tags-model'

const CONTEXTUAL_SIDEBAR_MIN = 208
const CONTEXTUAL_SIDEBAR_MAX = 320

interface TagsWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
  onOpenContext: (destination: FocusWorkspaceDestinationTarget) => void
  destination?: TagsWorkspaceDestination | null
  onDestinationApplied?: (requestId: number) => void
}

export function TagsWorkspace({
  contextDrawer,
  hideSensitiveContent,
  onOpenContext,
  destination = null,
  onDestinationApplied
}: TagsWorkspaceProps): React.JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(248)
  const [level] = useState(() => new ContextualSidebarLevel({
    id: 'tags',
    title: 'Tags',
    ariaLabel: 'Tags',
    items: [],
    emptyState: 'No tags yet'
  }))
  const [navigation] = useState(() => new ContextualSidebarNavigation(level))
  const appliedDestinationRequest = useRef<number | null>(null)
  const navigationSnapshot = useContextualSidebarNavigation(navigation)
  const selectedTag = navigationSnapshot.selectedItemId
  const model = useTagsModel(selectedTag)
  const sidebarItems = useMemo(
    () => tagSidebarItems(model.tags, hideSensitiveContent),
    [hideSensitiveContent, model.tags]
  )
  const rows = useMemo(
    () => tagUseRows(model.uses, hideSensitiveContent),
    [hideSensitiveContent, model.uses]
  )

  useEffect(() => {
    level.setItems(sidebarItems)
    navigation.refresh()
  }, [level, navigation, sidebarItems])

  useEffect(() => {
    if (
      !destination ||
      appliedDestinationRequest.current === destination.requestId ||
      !sidebarItems.some(({ id }) => id === destination.name)
    ) return
    navigation.navigateToPath(level, destination.name)
    appliedDestinationRequest.current = destination.requestId
    onDestinationApplied?.(destination.requestId)
  }, [destination, level, navigation, onDestinationApplied, sidebarItems])

  return (
    <WorkspaceShell
      contextualSidebar={
        <ContextualSidebar navigation={navigation} style={{ width: sidebarWidth }} />
      }
      contextualSidebarResize={{
        label: 'Resize contextual sidebar',
        value: sidebarWidth,
        min: CONTEXTUAL_SIDEBAR_MIN,
        max: CONTEXTUAL_SIDEBAR_MAX,
        direction: 1,
        onChange: setSidebarWidth
      }}
      main={
        <main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="tags-heading">
          <section className="mx-auto w-full max-w-7xl p-8 sm:p-10">
            <h1 id="tags-heading" className="text-2xl font-semibold tracking-[-0.025em]">
              Tags
            </h1>

            {model.tagsLoading ? (
              <p className="mt-8 text-sm text-muted-foreground">Loading Tags…</p>
            ) : model.tagsError ? (
              <p role="alert" className="mt-8 text-sm text-destructive">{model.tagsError}</p>
            ) : selectedTag === null ? (
              <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Add an @tag to a title, Todo, Update, Goal, description, or Note to see it here.
              </div>
            ) : (
              <div className="mt-7">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="onmove-text-tag text-lg font-semibold">@{selectedTag}</h2>
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {rows.length === 1 ? '1 visible use' : `${rows.length} visible uses`}
                  </p>
                </div>
                {model.usesLoading ? (
                  <p className="mt-5 text-sm text-muted-foreground">Loading uses…</p>
                ) : model.usesError ? (
                  <p role="alert" className="mt-5 text-sm text-destructive">{model.usesError}</p>
                ) : (
                  <TagUseTable
                    tagName={selectedTag}
                    rows={rows}
                    onOpenContext={(rowId) => {
                      const row = rows.find(({ id }) => id === rowId)
                      if (row) onOpenContext(row.destination)
                    }}
                  />
                )}
              </div>
            )}
          </section>
        </main>
      }
      drawer={<ContextDrawerOutlet {...contextDrawer} />}
    />
  )
}
