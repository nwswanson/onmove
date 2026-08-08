import { useReducer, useState } from 'react'
import { AlertTriangle, ChevronRight, FolderOpen, House, Info, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
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
import { Toolbar, ToolbarGroup } from '@/components/ui/toolbar'
import { ApplicationShell, WorkspaceShell } from '@/components/ui/workspace-shell'
import { useApplicationModel } from '@/features/application/use-application-model'
import { NewFocusDialog } from '@/features/focus/focus-ui'
import { focusPrimaryNavigationItems } from '@/features/focus/focus-presenters'
import { FocusWorkspace } from '@/features/focus/focus-workspace'

interface HomeExample {
  title: string
  status: 'good' | 'attention'
}

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
  enabled: boolean
  width: number
  onHome: () => void
  onSelectFocus: (focusId: string) => void
  onNewFocus: () => void
  onShowData: () => void
}

function AppSidebar({
  focusItems,
  selectedFocusId,
  enabled,
  width,
  onHome,
  onSelectFocus,
  onNewFocus,
  onShowData
}: AppSidebarProps): React.JSX.Element {
  const homeActive = selectedFocusId === null

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
            items={[{ id: 'home', label: 'Home', icon: 'home' }]}
            selectedItemId={homeActive ? 'home' : null}
            onSelect={onHome}
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
            <SidebarMenuButton type="button" disabled title="Settings will be available here">
              <Settings aria-hidden="true" />
              <span>Settings</span>
              <span className="ml-auto text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">
                Soon
              </span>
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

interface HomeViewProps {
  value: HomeExample
  contextDrawer: ContextDrawerControl
  onChange: (value: HomeExample) => void
  onOpenContext: () => void
}

function HomeView({
  value,
  contextDrawer,
  onChange,
  onOpenContext
}: HomeViewProps): React.JSX.Element {
  const contextDrawerAdapter: ContextDrawerAdapter = {
    id: 'home:example',
    invalidationKeys: [],
    model: {
      title: 'Home item',
      description: 'Example contextual editor',
      ariaLabel: 'Home item context drawer',
      sections: [
        {
          id: 'details',
          fields: [
            { kind: 'text', id: 'title', label: 'Title', value: value.title },
            {
              kind: 'select',
              id: 'status',
              label: 'Status',
              value: value.status,
              options: [
                { value: 'good', label: 'Good' },
                { value: 'attention', label: 'Needs attention' }
              ]
            },
            {
              kind: 'static',
              id: 'current-state',
              label: 'Current state',
              value: value.status === 'good' ? 'Good state' : 'Needs attention'
            }
          ]
        }
      ],
      actions: [
        {
          id: 'done',
          label: 'Done',
          errorMessage: 'The example item could not be updated.',
          onInvoke: (values) => {
            onChange({
              title: typeof values.title === 'string' ? values.title : '',
              status: values.status as HomeExample['status']
            })
            contextDrawer.onClose()
          }
        }
      ]
    }
  }

  return (
    <WorkspaceShell
      main={<main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="home-heading">
        <section className="mx-auto w-full max-w-5xl p-8 sm:p-10">
          <h1 id="home-heading" className="text-2xl font-semibold tracking-[-0.025em]">
            Home
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This view is intentionally open for future items.
          </p>

          <button
            type="button"
            className="group mt-10 flex w-full max-w-md items-center gap-3 rounded-xl border border-border/80 bg-card/45 p-3.5 text-left shadow-xs outline-none transition-colors hover:border-primary/65 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring/55"
            aria-label="Edit Example home item"
            onClick={onOpenContext}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/25 text-sidebar-primary-foreground">
              <House className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{value.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Select to inspect and edit context
              </span>
            </span>
            <ChevronRight
              className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        </section>
      </main>}
      drawer={<ContextDrawerOutlet adapter={contextDrawerAdapter} {...contextDrawer} />}
    />
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
  const [homeExample, setHomeExample] = useState<HomeExample>({
    title: 'Example home item',
    status: 'good'
  })
  const selectedFocus = application.selectedFocus
  const focusItems = focusPrimaryNavigationItems(
    application.navigableFocuses,
    application.focusStatusSummaries,
    application.sensitiveContentHidden
  )
  const toolbarTitle = selectedFocus?.title ?? 'Home'
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

  return (
    <>
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
            enabled={application.enabled}
            width={sidebarWidth}
            onHome={application.goHome}
            onSelectFocus={(focusId) => application.selectFocus(Number(focusId))}
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
          selectedFocus ? (
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
              hideSensitiveContent={application.sensitiveContentHidden}
            />
          ) : (
            <HomeView
              value={homeExample}
              contextDrawer={contextDrawer}
              onChange={setHomeExample}
              onOpenContext={() => dispatchContextDrawer({ type: 'open' })}
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
    </>
  )
}
