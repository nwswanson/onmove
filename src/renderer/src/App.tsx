import { Suspense, lazy, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { AlertTriangle, Info, Search, Settings } from 'lucide-react'
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
import {
  commandPagerPreferenceStorage,
  loadCommandPagerIncludeClosed,
  saveCommandPagerIncludeClosed
} from '@/features/application/command-pager-preference'
import type {
  CommandPaletteDestination
} from '@/features/application/command-palette-presenters'
import type {
  FocusWorkspaceDestination,
  FocusWorkspaceDestinationTarget,
  TagsWorkspaceDestination
} from '@/features/application/application-navigation'
import { NewFocusDialog } from '@/features/focus/focus-ui'
import { SidebarFolderDialog } from '@/features/shared/sidebar-folder-dialog'
import {
  FOCUS_FOLDER_DROP_TYPE,
  SIDEBAR_FOLDER_ROOT_ID,
  parseSidebarFolderId,
  sidebarFolderModels
} from '@/features/shared/sidebar-folder-presenters'
import { focusPrimaryNavigationItems } from '@/features/focus/focus-presenters'
import { pinnedPrimaryNavigationItems } from '@/features/focus/focus-presenters'
import { FocusWorkspace } from '@/features/focus/focus-workspace'
import { SettingsWorkspace } from '@/features/settings/settings-workspace'
import { TodoWorkspace } from '@/features/todos/todo-workspace'
import { TagsWorkspace } from '@/features/tags/tags-workspace'
import { ReviewWorkspace } from '@/features/review/review-workspace'
import { RoutinesWorkspace } from '@/features/routines/routines-workspace'
import { DueWorkspace } from '@/features/due/due-workspace'
import { ArchiveWorkspace } from '@/features/archive/archive-workspace'
import { UpdateComposerProvider } from '@/features/updates/update-composer'
import type { ThreadSnapshot } from '../../shared/contracts'
import type { NavigationBadgeCounts } from '@/features/application/navigation-badge-presenters'
import type { SidebarFolderModel } from '@/components/ui/sidebar-folder'

const SIDEBAR_MIN = 208
const SIDEBAR_MAX = 288
const DRAWER_MIN = 280
const DRAWER_MAX = 384

// The packaged renderer includes Excalidraw's fonts beside index.html. Set the
// path before the lazy editor chunk evaluates so it never needs its CDN fallback.
if (typeof window !== 'undefined' && !window.EXCALIDRAW_ASSET_PATH) {
  window.EXCALIDRAW_ASSET_PATH = new URL('.', window.location.href).toString()
}

// Excalidraw is intentionally loaded only when Canvas is selected; its editor
// bundle must not increase startup cost for the rest of the macOS shell.
const CanvasWorkspace = lazy(async () => {
  const module = await import('@/features/canvas/canvas-workspace')
  return { default: module.CanvasWorkspace }
})

interface AppToolbarProps {
  title: string
  contextOpen: boolean
  enabled: boolean
  onOpenCommandPalette: () => void
  onToggleContext: () => void
}

function AppToolbar({
  title,
  contextOpen,
  enabled,
  onOpenCommandPalette,
  onToggleContext
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
      </ToolbarGroup>
    </Toolbar>
  )
}

interface AppSidebarProps {
  pinnedItems: readonly SidebarNavigationItemModel[]
  focusItems: readonly SidebarNavigationItemModel[]
  focusFolders: readonly SidebarFolderModel[]
  navigationBadges: NavigationBadgeCounts | null
  selectedFocusId: string | null
  selectedPinnedItemId: string | null
  selectedView: 'todos' | 'tags' | 'review' | 'routines' | 'due' | 'canvas' | 'archive' | 'focus' | 'settings'
  enabled: boolean
  width: number
  onTodos: () => void
  onTags: () => void
  onReview: () => void
  onRoutines: () => void
  onDue: () => void
  onCanvas: () => void
  onArchive: () => void
  onSettings: () => void
  onSelectFocus: (focusId: string) => void
  onSelectPinned: (itemId: string) => void
  onPinnedContextMenuAction: (
    itemId: string,
    actionId: string,
    checked?: boolean
  ) => void
  onFocusContextMenuAction: (
    focusId: string,
    actionId: string,
    checked?: boolean
  ) => void
  onFocusFolderContextMenuAction: (folderId: string, actionId: string) => void
  onNewFocusFolder: () => void
  onNewFocus: () => void
}

function AppSidebar({
  pinnedItems,
  focusItems,
  focusFolders,
  navigationBadges,
  selectedFocusId,
  selectedPinnedItemId,
  selectedView,
  enabled,
  width,
  onTodos,
  onTags,
  onReview,
  onRoutines,
  onDue,
  onCanvas,
  onArchive,
  onSettings,
  onSelectFocus,
  onSelectPinned,
  onPinnedContextMenuAction,
  onFocusContextMenuAction,
  onFocusFolderContextMenuAction,
  onNewFocusFolder,
  onNewFocus
}: AppSidebarProps): React.JSX.Element {
  const selectedItemId =
    selectedView === 'todos' || selectedView === 'tags' ||
      selectedView === 'review' || selectedView === 'routines' ||
      selectedView === 'due' || selectedView === 'archive'
      || selectedView === 'canvas'
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
                id: 'routines',
                label: 'Routines',
                icon: 'routines',
                badge: navigationBadges && navigationBadges.routines > 0
                  ? {
                      value: navigationBadges.routines,
                      label: `${navigationBadges.routines} editable ${
                        navigationBadges.routines === 1 ? 'routine' : 'routines'
                      }`
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
              },
              {
                id: 'canvas',
                label: 'Canvas',
                icon: 'canvas'
              },
              {
                id: 'archive',
                label: 'Archive',
                icon: 'archive'
              }
            ]}
            selectedItemId={selectedItemId}
            onSelect={(itemId) => {
              if (itemId === 'tags') onTags()
              else if (itemId === 'review') onReview()
              else if (itemId === 'routines') onRoutines()
              else if (itemId === 'due') onDue()
              else if (itemId === 'canvas') onCanvas()
              else if (itemId === 'archive') onArchive()
              else onTodos()
            }}
          />
        </SidebarGroup>

        {pinnedItems.length > 0 && (
          <SidebarGroup className="mt-5">
            <SidebarGroupLabel>Pinned</SidebarGroupLabel>
            <SidebarNavigation
              items={pinnedItems}
              selectedItemId={selectedPinnedItemId}
              onSelect={onSelectPinned}
              onContextMenuAction={onPinnedContextMenuAction}
            />
          </SidebarGroup>
        )}

        <SidebarGroup className="mt-5">
          <SidebarGroupLabel>Focuses</SidebarGroupLabel>
          <SidebarNavigation
            items={focusItems}
            folders={focusFolders}
            folderRootDropTarget={{ type: FOCUS_FOLDER_DROP_TYPE, id: SIDEBAR_FOLDER_ROOT_ID }}
            selectedItemId={selectedFocusId}
            emptyLabel="No focuses yet"
            onSelect={onSelectFocus}
            onContextMenuAction={onFocusContextMenuAction}
            onFolderContextMenuAction={onFocusFolderContextMenuAction}
            actions={[
              {
                id: 'new-folder',
                label: 'New folder',
                icon: 'add',
                disabled: !enabled,
                onInvoke: onNewFocusFolder
              },
              {
                id: 'new-focus',
                label: 'New focus',
                icon: 'add',
                disabled: !enabled,
                onInvoke: onNewFocus
              }
            ]}
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
  const [newFocusFolderOpen, setNewFocusFolderOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPagerStorage] = useState(commandPagerPreferenceStorage)
  const [commandPagerIncludeClosed, setCommandPagerIncludeClosed] = useState(
    () => loadCommandPagerIncludeClosed(commandPagerStorage)
  )
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
  const [activeFocusThreadId, setActiveFocusThreadId] = useState<number | null>(null)
  const selectedFocus = application.selectedFocus
  const selectFocus = application.selectFocus
  const applicationEnabled = application.enabled
  const pendingEntityLink = application.pendingEntityLink
  const consumeEntityLink = application.consumeEntityLink
  const reportMcpUiContext = application.reportMcpUiContext
  const selectedSubjectId = selectedFocus
    ? (focusSubjectSelections[selectedFocus.id] ?? null)
    : null
  const commandPagerFocuses = commandPagerIncludeClosed
    ? application.focuses.filter((focus) =>
        !application.sensitiveContentHidden || !focus.sensitive)
    : application.navigableFocuses
  const baseFocusItems = focusPrimaryNavigationItems(
    application.navigableFocuses.filter((focus) =>
      !application.pinnedFocusIds.has(focus.id)),
    application.focusStatusSummaries,
    application.sensitiveContentHidden,
    application.pinnedFocusIds
  )
  const openWorkContext = useCallback((
    destination: FocusWorkspaceDestinationTarget,
    includeClosed = false
  ): void => {
    if (!selectFocus(destination.focusId, { includeClosed })) return
    setTagsDestination(null)
    setFocusSubjectSelections((current) => ({
      ...current,
      [destination.focusId]: destination.subjectId
    }))
    setFocusDestination({
      ...destination,
      requestId: ++focusDestinationRequest.current
    })
  }, [selectFocus])
  const focusItems = baseFocusItems.map((item) => ({
    ...item,
    transfer: {
      acceptedTargetTypes: [FOCUS_FOLDER_DROP_TYPE],
      onDrop: (target: { targetType: string; targetId: string }) => {
        if (target.targetType !== FOCUS_FOLDER_DROP_TYPE) return
        const folderId = target.targetId === SIDEBAR_FOLDER_ROOT_ID
          ? null
          : Number(target.targetId)
        if (folderId !== null && (!Number.isSafeInteger(folderId) || folderId <= 0)) return
        void application.setSidebarFolderMembership(
          { type: 'focus', id: Number(item.id) },
          folderId
        )
      }
    }
  }))
  const focusFolders = sidebarFolderModels(
    application.sidebarFolders,
    { type: 'focus' },
    new Set(focusItems.map(({ id }) => id))
  )
  const pinnedItems = pinnedPrimaryNavigationItems(
    application.navigableNavigationPins,
    application.focusStatusSummaries,
    application.pinnedThreadStatusSummaries,
    application.sensitiveContentHidden
  )
  const selectedPinnedThread = selectedFocus && activeFocusThreadId !== null
    ? application.navigableNavigationPins.find((pin) =>
        pin.target.type === 'thread' &&
        pin.target.focusId === selectedFocus.id &&
        pin.target.id === activeFocusThreadId)
    : undefined
  const selectedPinnedFocus = selectedFocus
    ? application.navigableNavigationPins.find((pin) =>
        pin.target.type === 'focus' && pin.target.id === selectedFocus.id)
    : undefined
  const selectedPinnedItemId = selectedPinnedThread
    ? `pin:thread:${selectedPinnedThread.target.id}`
    : selectedPinnedFocus
      ? `pin:focus:${selectedPinnedFocus.target.id}`
      : null
  const toolbarTitle = application.selectedView === 'settings'
    ? 'Settings'
    : application.selectedView === 'archive'
      ? 'Archive'
      : application.selectedView === 'canvas'
        ? 'Canvas'
      : application.selectedView === 'due'
      ? 'Due'
      : application.selectedView === 'routines'
        ? 'Routines'
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

  useEffect(() => {
    reportMcpUiContext({
      focusId: selectedFocus?.id ?? null,
      subjectId: selectedSubjectId
    })
  }, [reportMcpUiContext, selectedFocus?.id, selectedSubjectId])

  useEffect(() => {
    if (!pendingEntityLink || !applicationEnabled) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      openWorkContext({
        focusId: pendingEntityLink.focusId,
        threadId: pendingEntityLink.threadId,
        commitmentId: pendingEntityLink.commitmentId,
        routineId: pendingEntityLink.routineId,
        subjectId: pendingEntityLink.subjectId
      }, true)
      consumeEntityLink(pendingEntityLink)
    })
    return () => { cancelled = true }
  }, [applicationEnabled, consumeEntityLink, openWorkContext, pendingEntityLink])

  async function deleteFocus(focusId: number): Promise<void> {
    await application.deleteFocus(focusId)
    await application.refreshSidebarFolders()
    contextDrawer.onInvalidate([`focus:${focusId}`])
  }

  function openCommandPaletteDestination(destination: CommandPaletteDestination): void {
    if (destination.type === 'focus') {
      openWorkContext(destination.target, commandPagerIncludeClosed)
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
      application.refreshFocusStatusSummary(thread.focusId),
      application.refreshSidebarFolders(),
      application.pinnedThreadIds.has(thread.id)
        ? application.refreshNavigationPins()
        : Promise.resolve()
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
      enabled={application.enabled && application.selectedView !== 'settings'}
      focuses={commandPagerFocuses}
      hideSensitiveContent={application.sensitiveContentHidden}
      includeClosedWork={commandPagerIncludeClosed}
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
          />
        }
        primarySidebar={
          <AppSidebar
            pinnedItems={pinnedItems}
            focusItems={focusItems}
            focusFolders={focusFolders}
            navigationBadges={application.navigationBadges}
            selectedFocusId={selectedFocus && !selectedPinnedItemId
              ? String(selectedFocus.id)
              : null}
            selectedPinnedItemId={selectedPinnedItemId}
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
            onRoutines={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goRoutines()
            }}
            onDue={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goDue()
            }}
            onCanvas={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goCanvas()
            }}
            onArchive={() => {
              setFocusDestination(null)
              setTagsDestination(null)
              application.goArchive()
            }}
            onSettings={application.goSettings}
            onSelectPinned={(itemId) => {
              const pin = application.navigableNavigationPins.find((candidate) =>
                `pin:${candidate.target.type}:${candidate.target.id}` === itemId)
              if (!pin) return
              setTagsDestination(null)
              if (pin.target.type === 'focus') {
                openWorkContext({
                  focusId: pin.target.id,
                  threadId: null,
                  commitmentId: null,
                  subjectId: focusSubjectSelections[pin.target.id] ?? null
                })
                return
              }
              openWorkContext({
                focusId: pin.target.focusId,
                threadId: pin.target.id,
                commitmentId: null,
                subjectId: focusSubjectSelections[pin.target.focusId] ?? null,
                contextualMode: 'children'
              })
            }}
            onPinnedContextMenuAction={(itemId, actionId, checked) => {
              if (typeof checked !== 'boolean') return
              const pin = application.navigationPins.find((candidate) =>
                `pin:${candidate.target.type}:${candidate.target.id}` === itemId)
              if (!pin) return
              if (actionId === 'pin') {
                void application.setNavigationPin(pin.target, checked)
              } else if (pin.target.type === 'focus' && actionId === 'needs-review') {
                void application.updateFocus(pin.target.id, { needsReview: checked })
              } else if (pin.target.type === 'focus' && actionId === 'sensitive') {
                void application.updateFocus(pin.target.id, { sensitive: checked })
              }
            }}
            onSelectFocus={(focusId) => {
              const numericFocusId = Number(focusId)
              openWorkContext({
                focusId: numericFocusId,
                threadId: null,
                commitmentId: null,
                subjectId: focusSubjectSelections[numericFocusId] ?? null
              })
            }}
            onFocusContextMenuAction={(focusId, actionId, checked) => {
              if (typeof checked !== 'boolean') return
              if (actionId === 'needs-review') {
                void application.updateFocus(Number(focusId), { needsReview: checked })
              } else if (actionId === 'sensitive') {
                void application.updateFocus(Number(focusId), { sensitive: checked })
              } else if (actionId === 'pin') {
                void application.setNavigationPin({ type: 'focus', id: Number(focusId) }, checked)
              }
            }}
            onFocusFolderContextMenuAction={(folderItemId, actionId) => {
              if (actionId !== 'delete') return
              const folderId = parseSidebarFolderId(folderItemId)
              if (folderId !== null) void application.deleteSidebarFolder(folderId)
            }}
            onNewFocusFolder={() => setNewFocusFolderOpen(true)}
            onNewFocus={() => setNewFocusOpen(true)}
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
            <SettingsWorkspace
              contextDrawer={contextDrawer}
              commandPagerIncludeClosed={commandPagerIncludeClosed}
              onCommandPagerIncludeClosedChange={(includeClosed) => {
                saveCommandPagerIncludeClosed(commandPagerStorage, includeClosed)
                setCommandPagerIncludeClosed(includeClosed)
              }}
            />
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
          ) : application.selectedView === 'routines' ? (
            <RoutinesWorkspace
              contextDrawer={contextDrawer}
              hideSensitiveContent={application.sensitiveContentHidden}
              onOpenContext={openWorkContext}
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
          ) : application.selectedView === 'archive' ? (
            <ArchiveWorkspace
              contextDrawer={contextDrawer}
              hideSensitiveContent={application.sensitiveContentHidden}
            />
          ) : application.selectedView === 'canvas' ? (
            <Suspense fallback={<WorkspaceShell main={<LoadingView />} />}>
              <CanvasWorkspace
                contextDrawer={contextDrawer}
                hideSensitiveContent={application.sensitiveContentHidden}
                onOpenContext={(destination) => openWorkContext(destination, true)}
              />
            </Suspense>
          ) : selectedFocus ? (
            <FocusWorkspace
              key={selectedFocus.id}
              focus={selectedFocus}
              contextDrawer={contextDrawer}
              onUpdateFocus={(input) => application.updateFocus(selectedFocus.id, input)}
              onRefreshStatusSummary={() =>
                application.refreshFocusStatusSummary(selectedFocus.id)
              }
              onDeleteFocus={() => deleteFocus(selectedFocus.id)}
              selectedSubjectId={selectedSubjectId}
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
              pinnedThreadIds={application.pinnedThreadIds}
              onThreadPinChange={(threadId, pinned) =>
                application.setNavigationPin({ type: 'thread', id: threadId }, pinned)}
              onThreadChanged={() => Promise.all([
                application.refreshNavigationPins(),
                application.refreshSidebarFolders()
              ]).then(() => undefined)}
              onActiveThreadChange={setActiveFocusThreadId}
              sidebarFolders={application.sidebarFolders}
              onCreateThreadFolder={(name) => application.createSidebarFolder({
                area: { type: 'thread', focusId: selectedFocus.id },
                name
              })}
              onDeleteThreadFolder={(folderId) =>
                application.deleteSidebarFolder(folderId)}
              onSetThreadFolder={(threadId, folderId) =>
                application.setSidebarFolderMembership(
                  { type: 'thread', id: threadId },
                  folderId
                )}
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
      {newFocusFolderOpen && (
        <SidebarFolderDialog
          noun="focuses"
          onClose={() => setNewFocusFolderOpen(false)}
          onCreate={(name) => application.createSidebarFolder({
            area: { type: 'focus' },
            name
          })}
        />
      )}

      <ApplicationCommandPalette
        open={commandPaletteOpen}
        focuses={commandPagerFocuses}
        hideSensitiveContent={application.sensitiveContentHidden}
        includeClosedWork={commandPagerIncludeClosed}
        onOpenChange={setCommandPaletteOpen}
        onSelect={openCommandPaletteDestination}
      />
      </SidebarDndProvider>
    </UpdateComposerProvider>
  )
}
