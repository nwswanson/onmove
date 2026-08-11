import { useReducer, useRef, useState } from 'react'
import { AlertTriangle, FolderOpen, Info, Settings } from 'lucide-react'
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
  SidebarHeader,
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
import type {
  FocusWorkspaceDestination,
  FocusWorkspaceDestinationTarget
} from '@/features/application/application-navigation'
import { NewFocusDialog } from '@/features/focus/focus-ui'
import { focusPrimaryNavigationItems } from '@/features/focus/focus-presenters'
import { FocusWorkspace } from '@/features/focus/focus-workspace'
import { SettingsWorkspace } from '@/features/settings/settings-workspace'
import { TodoWorkspace } from '@/features/todos/todo-workspace'
import { TagsWorkspace } from '@/features/tags/tags-workspace'
import { ReviewWorkspace } from '@/features/review/review-workspace'
import type { ThreadSnapshot } from '../../shared/contracts'

const SIDEBAR_MIN = 208
const SIDEBAR_MAX = 288
const DRAWER_MIN = 280
const DRAWER_MAX = 384

interface AppToolbarProps {
  title: string
  contextOpen: boolean
  enabled: boolean
  onToggleContext: () => void
  onShowData: () => void
}

function AppToolbar({
  title,
  contextOpen,
  enabled,
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
  selectedFocusId: string | null
  selectedView: 'todos' | 'tags' | 'review' | 'focus' | 'settings'
  enabled: boolean
  width: number
  onTodos: () => void
  onTags: () => void
  onReview: () => void
  onSettings: () => void
  onSelectFocus: (focusId: string) => void
  onNewFocus: () => void
  onShowData: () => void
}

function AppSidebar({
  focusItems,
  selectedFocusId,
  selectedView,
  enabled,
  width,
  onTodos,
  onTags,
  onReview,
  onSettings,
  onSelectFocus,
  onNewFocus,
  onShowData
}: AppSidebarProps): React.JSX.Element {
  const selectedItemId =
    selectedView === 'todos' || selectedView === 'tags' || selectedView === 'review'
      ? selectedView
      : null

  return (
    <Sidebar aria-label="Primary sidebar" style={{ width }}>
      <SidebarHeader className="p-3 pb-4">
        <div className="rounded-xl border border-primary/35 bg-primary/12 p-3.5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.625rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              Placeholder
            </p>
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          </div>
          <p className="mt-2 text-sm font-semibold tracking-tight">Overview</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden="true">
            <span className="h-1.5 rounded-full bg-primary/55" />
            <span className="h-1.5 rounded-full bg-success/55" />
            <span className="h-1.5 rounded-full bg-muted" />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Items</SidebarGroupLabel>
          <SidebarNavigation
            items={[
              { id: 'todos', label: 'Todos', icon: 'todos' },
              { id: 'tags', label: 'Tags', icon: 'tags' },
              { id: 'review', label: 'Review', icon: 'review' }
            ]}
            selectedItemId={selectedItemId}
            onSelect={(itemId) => {
              if (itemId === 'tags') onTags()
              else if (itemId === 'review') onReview()
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
  const focusDestinationRequest = useRef(0)
  const selectedFocus = application.selectedFocus
  const focusItems = focusPrimaryNavigationItems(
    application.navigableFocuses,
    application.focusStatusSummaries,
    application.sensitiveContentHidden
  )
  const toolbarTitle = application.selectedView === 'settings'
    ? 'Settings'
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

  async function deleteFocus(focusId: number): Promise<void> {
    await application.deleteFocus(focusId)
    contextDrawer.onInvalidate([`focus:${focusId}`])
  }

  function openTodoContext(destination: FocusWorkspaceDestinationTarget): void {
    if (!application.selectFocus(destination.focusId)) return
    setFocusSubjectSelections((current) => ({
      ...current,
      [destination.focusId]: destination.subjectId
    }))
    setFocusDestination({
      ...destination,
      requestId: ++focusDestinationRequest.current
    })
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
    <SidebarDndProvider>
      <ApplicationShell
        toolbar={
          <AppToolbar
            title={toolbarTitle}
            contextOpen={contextDrawerState.open}
            enabled={application.enabled}
            onToggleContext={() => dispatchContextDrawer({ type: 'toggle' })}
            onShowData={() => void application.showDataFolder()}
          />
        }
        primarySidebar={
          <AppSidebar
            focusItems={focusItems}
            selectedFocusId={selectedFocus ? String(selectedFocus.id) : null}
            selectedView={application.selectedView}
            enabled={application.enabled}
            width={sidebarWidth}
            onTodos={() => {
              setFocusDestination(null)
              application.goTodos()
            }}
            onTags={() => {
              setFocusDestination(null)
              application.goTags()
            }}
            onReview={() => {
              setFocusDestination(null)
              application.goReview()
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
              onOpenContext={openTodoContext}
            />
          ) : application.selectedView === 'review' ? (
            <ReviewWorkspace
              contextDrawer={contextDrawer}
              hideSensitiveContent={application.sensitiveContentHidden}
              onReviewChanged={async (focusId) => {
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
              onOpenContext={openTodoContext}
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
    </SidebarDndProvider>
  )
}
