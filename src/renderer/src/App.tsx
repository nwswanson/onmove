import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, FolderOpen, House, PanelRightOpen, Settings } from 'lucide-react'
import type { AppState, CreateFocusInput, FocusSnapshot, UpdateFocusInput } from '../../shared/contracts'
import { Button } from '@/components/ui/button'
import { ContextDrawer, ContextDrawerSection } from '@/components/ui/context-drawer'
import { Input } from '@/components/ui/input'
import { ResizeHandle } from '@/components/ui/resize-handle'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Toolbar, ToolbarGroup } from '@/components/ui/toolbar'
import {
  FocusContextPanel,
  FocusList,
  FocusView,
  NewFocusDialog
} from '@/features/focus/focus-ui'
import { isVisibleFocus } from '@/features/focus/focus-utils'

interface HomeExample {
  title: string
  status: 'good' | 'attention'
}

const SIDEBAR_MIN = 208
const SIDEBAR_MAX = 288
const DRAWER_MIN = 280
const DRAWER_MAX = 384

interface AppToolbarProps {
  contextLabel: string
  enabled: boolean
  onOpenContext: () => void
  onShowData: () => void
}

function AppToolbar({
  contextLabel,
  enabled,
  onOpenContext,
  onShowData
}: AppToolbarProps): React.JSX.Element {
  return (
    <Toolbar aria-label="Application toolbar">
      <ToolbarGroup className="ml-auto">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label={`Open ${contextLabel} context`}
          title="Open contextual inspector"
          disabled={!enabled}
          onClick={onOpenContext}
        >
          <PanelRightOpen aria-hidden="true" />
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
  focuses: FocusSnapshot[]
  selectedFocusId: number | null
  enabled: boolean
  width: number
  onHome: () => void
  onSelectFocus: (focusId: number) => void
  onNewFocus: () => void
  onShowData: () => void
}

function AppSidebar({
  focuses,
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
      <SidebarHeader className="p-3 pb-4 pt-14">
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
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                isActive={homeActive}
                aria-current={homeActive ? 'page' : undefined}
                onClick={onHome}
              >
                <House aria-hidden="true" />
                <span>Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-5">
          <SidebarGroupLabel>Focuses</SidebarGroupLabel>
          <FocusList
            focuses={focuses}
            selectedFocusId={selectedFocusId}
            disabled={!enabled}
            onSelect={onSelectFocus}
            onNew={onNewFocus}
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
  contextTitle: string
  onOpenContext: () => void
}

function HomeView({ contextTitle, onOpenContext }: HomeViewProps): React.JSX.Element {
  return (
    <main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="home-heading">
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
            <span className="block truncate text-sm font-medium">{contextTitle}</span>
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
    </main>
  )
}

interface HomeContextPanelProps {
  value: HomeExample
  width: number
  onChange: (value: HomeExample) => void
  onClose: () => void
}

function HomeContextPanel({
  value,
  width,
  onChange,
  onClose
}: HomeContextPanelProps): React.JSX.Element {
  return (
    <ContextDrawer
      title="Home item"
      description="Example contextual editor"
      aria-label="Home item context drawer"
      style={{ width }}
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <ContextDrawerSection>
        <div className="space-y-1.5">
          <label htmlFor="home-context-title" className="text-xs font-medium">
            Title
          </label>
          <Input
            id="home-context-title"
            value={value.title}
            onChange={(event) => onChange({ ...value, title: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="home-context-status" className="text-xs font-medium">
            Status
          </label>
          <select
            id="home-context-status"
            className="h-9 w-full rounded-lg border border-border bg-background/75 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
            value={value.status}
            onChange={(event) =>
              onChange({ ...value, status: event.target.value as HomeExample['status'] })
            }
          >
            <option value="good">Good</option>
            <option value="attention">Needs attention</option>
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-xs">
          <span
            className={`size-2 rounded-full ${
              value.status === 'good' ? 'bg-success' : 'bg-destructive'
            }`}
            aria-hidden="true"
          />
          <span>{value.status === 'good' ? 'Good state' : 'Needs attention'}</span>
        </div>
      </ContextDrawerSection>
    </ContextDrawer>
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
  const [selectedFocusId, setSelectedFocusId] = useState<number | null>(null)
  const [focuses, setFocuses] = useState<FocusSnapshot[]>([])
  const [newFocusOpen, setNewFocusOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(248)
  const [drawerWidth, setDrawerWidth] = useState(336)
  const [homeExample, setHomeExample] = useState<HomeExample>({
    title: 'Example home item',
    status: 'good'
  })
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([window.onmove.getAppState(), window.onmove.domain.listFocuses()]).then(
      ([nextState, nextFocuses]) => {
        if (!active) return
        setState(nextState)
        setFocuses(nextFocuses)
      },
      () => active && setError('The local database could not be opened.')
    )
    return () => {
      active = false
    }
  }, [])

  const selectedFocus =
    selectedFocusId === null
      ? null
      : (focuses.find((focus) => focus.id === selectedFocusId && isVisibleFocus(focus)) ?? null)
  const enabled = Boolean(state)
  const contextLabel = selectedFocus ? 'Focus' : 'Home'
  const toolbar = (
    <AppToolbar
      contextLabel={contextLabel}
      enabled={enabled}
      onOpenContext={() => setContextOpen(true)}
      onShowData={() => void window.onmove.showDataFolder()}
    />
  )

  function goHome(): void {
    setSelectedFocusId(null)
    setContextOpen(false)
  }

  function selectFocus(focusId: number): void {
    const focus = focuses.find((candidate) => candidate.id === focusId)
    if (!focus || !isVisibleFocus(focus)) return
    setSelectedFocusId(focusId)
    setContextOpen(false)
  }

  async function createFocus(input: CreateFocusInput): Promise<void> {
    const focus = await window.onmove.domain.createFocus(input)
    setFocuses((current) => [...current, focus])
    setSelectedFocusId(focus.id)
    setContextOpen(false)
  }

  async function updateFocus(focusId: number, input: UpdateFocusInput): Promise<void> {
    const updated = await window.onmove.domain.updateFocus(focusId, input)
    setFocuses((current) =>
      current.map((focus) => (focus.id === updated.id ? updated : focus))
    )
    if (!isVisibleFocus(updated)) {
      setSelectedFocusId(null)
      setContextOpen(false)
    }
  }

  async function deleteFocus(focusId: number): Promise<void> {
    const deleted = await window.onmove.domain.deleteFocus(focusId)
    if (!deleted) throw new Error('Focus no longer exists')
    setFocuses((current) => current.filter((focus) => focus.id !== focusId))
    setSelectedFocusId(null)
    setContextOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <AppSidebar
        focuses={focuses}
        selectedFocusId={selectedFocus?.id ?? null}
        enabled={enabled}
        width={sidebarWidth}
        onHome={goHome}
        onSelectFocus={selectFocus}
        onNewFocus={() => setNewFocusOpen(true)}
        onShowData={() => void window.onmove.showDataFolder()}
      />
      <ResizeHandle
        label="Resize sidebar"
        value={sidebarWidth}
        min={SIDEBAR_MIN}
        max={SIDEBAR_MAX}
        direction={1}
        onChange={setSidebarWidth}
      />

      {state ? (
        selectedFocus ? (
          <FocusView
            key={`${selectedFocus.id}-${selectedFocus.updatedAt}`}
            focus={selectedFocus}
            toolbar={toolbar}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {toolbar}
            <HomeView
              contextTitle={homeExample.title}
              onOpenContext={() => setContextOpen(true)}
            />
          </div>
        )
      ) : error ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {toolbar}
          <main className="flex min-w-0 flex-1 items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </div>
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            </div>
          </main>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {toolbar}
          <LoadingView />
        </div>
      )}

      {state && contextOpen && (
        <>
          <ResizeHandle
            label="Resize context drawer"
            value={drawerWidth}
            min={DRAWER_MIN}
            max={DRAWER_MAX}
            direction={-1}
            onChange={setDrawerWidth}
          />
          {selectedFocus ? (
            <FocusContextPanel
              key={selectedFocus.id}
              focus={selectedFocus}
              width={drawerWidth}
              onClose={() => setContextOpen(false)}
              onSave={(input) => updateFocus(selectedFocus.id, input)}
              onDelete={() => deleteFocus(selectedFocus.id)}
            />
          ) : (
            <HomeContextPanel
              value={homeExample}
              width={drawerWidth}
              onChange={setHomeExample}
              onClose={() => setContextOpen(false)}
            />
          )}
        </>
      )}

      {newFocusOpen && (
        <NewFocusDialog onClose={() => setNewFocusOpen(false)} onCreate={createFocus} />
      )}
    </div>
  )
}
