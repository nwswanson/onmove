import { useEffect, useReducer, useRef, useState } from 'react'
import { AlertTriangle, FolderOpen, Info, Search, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  contextDrawerReducer,
  initialContextDrawerState,
  type ContextDrawerAdapter,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import {
  SidebarNavigation,
  type SidebarNavigationItemModel
} from '@/components/ui/sidebar-navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarDndProvider } from '@/components/ui/sidebar-dnd'
import { Toolbar, ToolbarGroup } from '@/components/ui/toolbar'
import { ApplicationShell, WorkspaceShell } from '@/components/ui/workspace-shell'
import { useApplicationModel } from '@/features/application/use-application-model'
import { ApplicationCommandPalette } from '@/features/application/command-palette'
import type {
  CommandPaletteDestination
} from '@/features/application/command-palette-presenters'
import type {
  FocusWorkspaceDestination,
  FocusWorkspaceDestinationTarget,
  TagsWorkspaceDestination
} from '@/features/application/application-navigation'
import { NewFocusDialog } from '@/features/focus/focus-ui'
import { focusPrimaryNavigationItems } from '@/features/focus/focus-presenters'
import { FocusWorkspace } from '@/features/focus/focus-workspace'
import { SettingsWorkspace } from '@/features/settings/settings-workspace'
import { TodoWorkspace } from '@/features/todos/todo-workspace'
import { TagsWorkspace } from '@/features/tags/tags-workspace'
import { ReviewWorkspace } from '@/features/review/review-workspace'
import { DueWorkspace } from '@/features/due/due-workspace'
import { UpdateComposerProvider } from '@/features/updates/update-composer'
import type { ThreadSnapshot } from '../../shared/contracts'
import type { NavigationBadgeCounts } from '@/features/application/navigation-badge-presenters'

const SIDEBAR_MIN = 208
const SIDEBAR_MAX = 288
const DRAWER_MIN = 280
const DRAWER_MAX = 384

interface AppToolbarProps {
  title: string
  contextOpen: boolean
  enabled: boolean
  onOpenCommandPalette: () => void
  onToggleContext: () => void
  onShowData: () => void
}

function AppToolbar({
  title,
  contextOpen,
  enabled,
  onOpenCommandPalette,
  onToggleContext,
  onShowData
}: AppToolbarProps): React.JSX.Element {
  return (
    <Toolbar aria-label="Application toolbar">
      <div className="w-17 shrink-0" aria-hidden="true" />
      <p className="max-w-72 truncate text-xs font-semibold tracking-tight">{title}</p>
      <ToolbarGroup className="ml-auto">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Open command palette"
          title="Jump to anything (⌘K)"
          disabled={!enabled}
          onClick={onOpenCommandPalette}
        >
          <Search aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Toggle context drawer"
          aria-pressed={contextOpen}
          title={contextOpen ? 'Hide contextual inspector' : 'Show contextual inspector'}
          disabled={!enabled}
          onClick={onToggleContext}
        >
          <Info aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Show data in Finder"
          title="Show data in Finder"
          disabled={!enabled}
          onClick={onShowData}
        >
          <FolderOpen aria-hidden="true" />
        </Button>
      </ToolbarGroup>
    </Toolbar>
  )
}

interface AppSidebarProps {
  focusItems: readonly SidebarNavigationItemModel[]
  navigationBadges: NavigationBadgeCounts | null
  selectedFocusId: string | null
  selectedView: 'todos' | 'tags' | 'review' | 'due' | 'focus' | 'settings'
  enabled: boolean
  width: number
  onTodos: () => void
  onTags: () => void
  onReview: () => void
  onDue: () => void
  onSettings: () => void
  onSelectFocus: (focusId: string) => void
  onNewFocus: () => void
  onShowData: () => void
}

function AppSidebar({
  focusItems,
  navigationBadges,
  selectedFocusId,
  selectedView,
  enabled,
  width,
  onTodos,
  onTags,
  onReview,
  onDue,
  onSettings,
  onSelectFocus,
  onNewFocus,
  onShowData
}: AppSidebarProps): React.JSX.Element {
  const selectedItemId =
    selectedView === 'todos' || selectedView === 'tags' ||
      selectedView === 'review' || selectedView === 'due'
      ? selectedView
      : null

  return (
    <Sidebar aria-label="Primary sidebar" style={{ width }}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Items</SidebarGroupLabel>
          <SidebarNavigation
            items={[
              {
                id: 'todos',
                label: 'Todos',
                icon: 'todos',
                badge: navigationBadges && navigationBadges.todos > 0
                  ? {
                      value: navigationBadges.todos,
                      label: `${navigationBadges.todos} overdue or due today`
                    }
                  : undefined
              },
              { id: 'tags', label: 'Tags', icon: 'tags' },
              {
                id: 'review',
                label: 'Review',
                icon: 'review',
                badge: navigationBadges && navigationBadges.review > 0
                  ? {
                      value: navigationBadges.review,
                      label: `${navigationBadges.review} remaining`
                    }
                  : undefined
              },
              {
                id: 'due',
                label: 'Due',
                icon: 'due',
                badge: navigationBadges && navigationBadges.due > 0
                  ? {
                      value: navigationBadges.due,
                      label: `${navigationBadges.due} overdue or due within seven days`
                    }
                  : undefined
              }
            ]}
            selectedItemId={selectedItemId}
            onSelect={(itemId) => {
              if (itemId === 'tags') onTags()
              else if (itemId === 'review') onReview()
              else if (itemId === 'due') onDue()
              else onTodos()
            }}
          />
        </SidebarGroup>

        <SidebarGroup className="mt-5">
          <SidebarGroupLabel>Focuses</SidebarGroupLabel>
          <SidebarNavigation
            items={focusItems}
            selectedItemId={selectedFocusId}
            emptyLabel="No focuses yet"
            onSelect={onSelectFocus}
            action={{
              id: 'new-focus',
              label: 'New focus',
              icon: 'add',
              disabled: !enabled,
              onInvoke: onNewFocus
            }}
          />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 px-3 pb-4">
        <Separator className="mb-1" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              isActive={selectedView === 'settings'}
              aria-current={selectedView === 'settings' ? 'page' : undefined}
              disabled={!enabled}
              onClick={onSettings}
            >
              <Settings aria-hidden="true" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton type="button" onClick={onShowData} disabled={!enabled}>
              <FolderOpen aria-hidden="true" />
              <span>Data &amp; storage</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function LoadingView(): React.JSX.Element {
  return (
    <main className="flex min-w-0 flex-1 items-start p-10" aria-label="Loading application">
      <div className="w-full max-w-xl space-y-4">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="mt-10 h-16 w-full rounded-xl" />
      </div>
    </main>
  )
}

export function App(): React.JSX.Element {
  const application = useApplicationModel()
  const [newFocusOpen, setNewFocusOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [contextDrawerState, dispatchContextDrawer] = useReducer(
    contextDrawerReducer,
    initialContextDrawerState
  )
  const [sidebarWidth, setSidebarWidth] = useState(248)
  const [drawerWidth, setDrawerWidth] = useState(336)
  const [focusSubjectSelections, setFocusSubjectSelections] = useState<
    Record<number, number | null | undefined>
  >({})
  const [focusDestination, setFocusDestination] =
    useState<FocusWorkspaceDestination | null>(null)
  const [tagsDestination, setTagsDestination] =
    useState<TagsWorkspaceDestination | null>(null)
  const focusDestinationRequest = useRef(0)
  const tagsDestinationRequest = useRef(0)
  const selectedFocus = application.selectedFocus
  const focusItems = focusPrimaryNavigationItems(
    application.navigableFocuses,
    application.focusStatusSummaries,
    application.sensitiveContentHidden
  )
  const toolbarTitle = application.selectedView === 'settings'
    ? 'Settings'
    : application.selectedView === 'due'
      ? 'Due'
      : application.selectedView === 'review'
        ? 'Review'
        : application.selectedView === 'tags'
          ? 'Tags'
          : (selectedFocus?.title ?? 'Todos')
  const contextDrawer = {
    open: contextDrawerState.open,
    pinnedAdapter: contextDrawerState.pinnedAdapter,
    width: drawerWidth,
    minWidth: DRAWER_MIN,
    maxWidth: DRAWER_MAX,
    onWidthChange: setDrawerWidth,
    onClose: () => dispatchContextDrawer({ type: 'close' }),
    onPin: (adapter: ContextDrawerAdapter) =>
      dispatchContextDrawer({ type: 'pin', adapter }),
    onUnpin: () => dispatchContextDrawer({ type: 'unpin' }),
    onInvalidate: (keys: readonly string[]) =>
      dispatchContextDrawer({ type: 'invalidate', keys })
  } satisfies ContextDrawerControl

  useEffect(() => {
    function handleCommandPaletteShortcut(event: KeyboardEvent): void {
      if (
        !application.enabled ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.key.toLowerCase() !== 'k'
      ) return
      event.preventDefault()
      setCommandPaletteOpen((open) => !open)
    }
    document.addEventListener('keydown', handleCommandPaletteShortcut)
    return () => document.removeEventListener('keydown', handleCommandPaletteShortcut)
  }, [application.enabled])

  async function deleteFocus(focusId: number): Promise<void> {
    await application.deleteFocus(focusId)
    contextDrawer.onInvalidate([`focus:${focusId}`])
  }

  function openWorkContext(
    destination: FocusWorkspaceDestinationTarget,
    includeClosed = false
  ): void {
    if (!application.selectFocus(destination.focusId, { includeClosed })) return
    setTagsDestination(null)
    setFocusSubjectSelections((current) => ({
      ...current,
      [destination.focusId]: destination.subjectId
    }))
    setFocusDestination({
      ...destination,
      requestId: ++focusDestinationRequest.current
    })
  }

  function openCommandPaletteDestination(destination: CommandPaletteDestination): void {
    if (destination.type === 'focus') {
      openWorkContext(destination.target)
      return
    }
    setFocusDestination(null)
    setTagsDestination({
      name: destination.name,
      requestId: ++tagsDestinationRequest.current
    })
    application.goTags()
  }

  async function finishThreadMove(
    thread: ThreadSnapshot,
    fromFocusId: number
  ): Promise<void> {
    await Promise.all([
      application.refreshFocusStatusSummary(fromFocusId),
      application.refreshFocusStatusSummary(thread.focusId)
    ])
    if (!application.selectFocus(thread.focusId)) {
      application.goTodos()
      return
    }
    setFocusSubjectSelections((current) => ({
      ...current,
      [thread.focusId]: null
    }))
    setFocusDestination({
      focusId: thread.focusId,
      threadId: thread.id,
      commitmentId: null,
      subjectId: null,
      requestId: ++focusDestinationRequest.current
    })
  }

  return (
    <UpdateComposerProvider
      enabled={application.enabled && (
        application.selectedView === 'focus' || application.selectedView === 'review'
      )}
      focuses={application.navigableFocuses}
      hideSensitiveContent={application.sensitiveContentHidden}
      onCreated={async (target) => {
        await application.refreshFocus(target.focusId)
      }}
    >
      <SidebarDndProvider>
      <ApplicationShell
        toolbar={
          <AppToolbar
            title={toolbarTitle}
            contextOpen={contextDrawerState.open}
            enabled={application.enabled}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onToggleContext={() => dispatchContextDrawer({ type: 'toggle' })}
            onShowData={() => void application.showDataFolder()}
          />
        }
        primarySidebar={
          <AppSidebar
            focusItems={focusItems}
            navigationBadges={application.navigationBadges}
            selectedFocusId={selectedFocus ? String(selectedFocus.id) : null}
            selectedView={application.selectedView}
            enabled={application.enabled}
            width={sidebarWidth}
            onTodos={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goTodos()
            }}
            onTags={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goTags()
            }}
            onReview={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goReview()
            }}
            onDue={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goDue()
            }}
            onSettings={application.goSettings}
            onSelectFocus={(focusId) => {
              setFocusDestination(null)
              application.selectFocus(Number(focusId))
            }}
            onNewFocus={() => setNewFocusOpen(true)}
            onShowData={() => void application.showDataFolder()}
          />
        }
        primarySidebarResize={{
          label: 'Resize sidebar',
          value: sidebarWidth,
          min: SIDEBAR_MIN,
          max: SIDEBAR_MAX,
          direction: 1,
          onChange: setSidebarWidth
        }}
      >

        {application.state ? (
          application.selectedView === 'settings' ? (
            <SettingsWorkspace contextDrawer={contextDrawer} />
          ) : application.selectedView === 'tags' ? (
            <TagsWorkspace
              contextDrawer={contextDrawer}
              hideSensitiveContent={application.sensitiveContentHidden}
              onOpenContext={openWorkContext}
              destination={tagsDestination}
              onDestinationApplied={(requestId) =>
                setTagsDestination((current) =>
                  current?.requestId === requestId ? null : current
                )
              }
            />
          ) : application.selectedView === 'review' ? (
            <ReviewWorkspace
              contextDrawer={contextDrawer}
              hideSensitiveContent={application.sensitiveContentHidden}
              onReviewChanged={async (focusId) => {
                await application.refreshFocus(focusId)
              }}
            />
          ) : application.selectedView === 'due' ? (
            <DueWorkspace
              contextDrawer={contextDrawer}
              hideSensitiveContent={application.sensitiveContentHidden}
              onOpenContext={(destination) => openWorkContext(destination, true)}
              onWorkChanged={async (focusId) => {
                await application.refreshFocus(focusId)
              }}
            />
          ) : selectedFocus ? (
            <FocusWorkspace
              key={selectedFocus.id}
              focus={selectedFocus}
              contextDrawer={contextDrawer}
              onUpdateFocus={(input) => application.updateFocus(selectedFocus.id, input)}
              onRefreshFocus={() => application.refreshFocus(selectedFocus.id)}
              onRefreshStatusSummary={() =>
                application.refreshFocusStatusSummary(selectedFocus.id)
              }
              onDeleteFocus={() => deleteFocus(selectedFocus.id)}
              selectedSubjectId={focusSubjectSelections[selectedFocus.id] ?? null}
              onSelectedSubjectChange={(subjectId) =>
                setFocusSubjectSelections((current) => ({
                  ...current,
                  [selectedFocus.id]: subjectId
                }))
              }
              destination={focusDestination?.focusId === selectedFocus.id
                ? focusDestination
                : null}
              onDestinationApplied={(requestId) =>
                setFocusDestination((current) =>
                  current?.requestId === requestId ? null : current
                )
              }
              hideSensitiveContent={application.sensitiveContentHidden}
              threadMoveTargets={application.navigableFocuses.map(({ id, title }) => ({
                id,
                title
              }))}
              onThreadMoved={finishThreadMove}
            />
          ) : (
            <TodoWorkspace
              contextDrawer={contextDrawer}
              hideSensitiveContent={application.sensitiveContentHidden}
              onOpenContext={openWorkContext}
            />
          )
        ) : application.error ? (
          <WorkspaceShell
            main={
              <main className="flex min-w-0 flex-1 items-center justify-center p-8">
                <div className="max-w-sm text-center">
                  <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <AlertTriangle className="size-5" aria-hidden="true" />
                  </div>
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {application.error}
                  </p>
                </div>
              </main>
            }
          />
        ) : (
          <WorkspaceShell main={<LoadingView />} />
        )}
      </ApplicationShell>

      {newFocusOpen && (
        <NewFocusDialog
          onClose={() => setNewFocusOpen(false)}
          onCreate={application.createFocus}
        />
      )}

      <ApplicationCommandPalette
        open={commandPaletteOpen}
        focuses={application.navigableFocuses}
        hideSensitiveContent={application.sensitiveContentHidden}
        onOpenChange={setCommandPaletteOpen}
        onSelect={openCommandPaletteDestination}
      />
      </SidebarDndProvider>
    </UpdateComposerProvider>
  )
}
