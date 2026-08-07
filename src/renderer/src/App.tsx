import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BriefcaseBusiness,
  FolderOpen,
  House,
  Settings,
  Sparkles,
  type LucideIcon
} from 'lucide-react'
import type { AppState } from '../../shared/contracts'
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

type AppView = 'home' | 'portfolio'

interface ViewDefinition {
  title: string
  description: string
  emptyMessage: string
  icon: LucideIcon
}

const views: Record<AppView, ViewDefinition> = {
  home: {
    title: 'Home',
    description: 'Your starting point for the work that matters now.',
    emptyMessage: 'Your home view is ready for its first items.',
    icon: House
  },
  portfolio: {
    title: 'Portfolio',
    description: 'A broader view of projects, outcomes, and progress.',
    emptyMessage: 'Your portfolio is ready for its first collection.',
    icon: BriefcaseBusiness
  }
}

interface AppSidebarProps {
  activeView: AppView
  databaseError: boolean
  state: AppState | null
  onViewChange: (view: AppView) => void
  onShowData: () => void
}

function AppSidebar({
  activeView,
  databaseError,
  state,
  onViewChange,
  onShowData
}: AppSidebarProps): React.JSX.Element {
  return (
    <Sidebar aria-label="Primary sidebar">
      <div className="drag-region h-9 shrink-0" />
      <SidebarHeader className="px-5 pt-3 pb-5">
        <div className="flex items-center gap-3">
          <div className="relative flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/60">
            <Sparkles className="size-4" aria-hidden="true" />
            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-success" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">OnMove</p>
            <p className="text-xs text-muted-foreground">Your workspace</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Items</SidebarGroupLabel>
          <SidebarMenu>
            {(Object.entries(views) as Array<[AppView, ViewDefinition]>).map(
              ([viewId, view]) => {
                const Icon = view.icon
                const isActive = activeView === viewId
                return (
                  <SidebarMenuItem key={viewId}>
                    <SidebarMenuButton
                      type="button"
                      isActive={isActive}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onViewChange(viewId)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{view.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              }
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 px-3 pb-4">
        <Separator />
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
            <SidebarMenuButton type="button" onClick={onShowData} disabled={!state}>
              <FolderOpen aria-hidden="true" />
              <span>Data &amp; storage</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div
          className="flex items-center gap-2 px-2.5 pt-1 text-[0.6875rem] text-muted-foreground"
          data-testid="local-data-status"
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              databaseError
                ? 'bg-destructive shadow-[0_0_0_3px_color-mix(in_srgb,var(--destructive)_14%,transparent)]'
                : 'bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_14%,transparent)]'
            }`}
          />
          <span>{databaseError ? 'Local data unavailable' : 'Local data ready'}</span>
          {state && (
            <span className="ml-auto tabular-nums" data-testid="launch-count">
              {state.launchCount}
            </span>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function LoadingView(): React.JSX.Element {
  return (
    <main className="flex min-w-0 flex-1 flex-col" aria-label="Loading application">
      <div className="drag-region h-14 shrink-0 border-b border-border/70" />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-2xl space-y-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-12 w-64 max-w-full" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </div>
      </div>
    </main>
  )
}

function EmptyView({ viewId }: { viewId: AppView }): React.JSX.Element {
  const view = views[viewId]
  const Icon = view.icon

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden" aria-labelledby={`${viewId}-heading`}>
      <header className="drag-region flex h-14 shrink-0 items-center border-b border-border/70 px-7">
        <p className="text-xs font-medium text-muted-foreground">
          Workspace <span className="px-1.5 text-border">/</span> {view.title}
        </p>
      </header>
      <section className="view-atmosphere flex flex-1 overflow-auto p-8 sm:p-12">
        <div className="mx-auto flex w-full max-w-4xl flex-col">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/30 text-sidebar-primary-foreground ring-1 ring-primary/45">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <h1
            id={`${viewId}-heading`}
            className="mt-5 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl"
          >
            {view.title}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            {view.description}
          </p>

          <div className="mt-10 flex min-h-72 flex-1 items-center justify-center rounded-2xl border border-dashed border-primary/55 bg-card/45 p-8 backdrop-blur-sm">
            <div className="text-center">
              <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-primary/20 text-sidebar-primary-foreground">
                <Sparkles className="size-4" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium">Nothing here yet</p>
              <p className="mt-1.5 text-xs text-muted-foreground">{view.emptyMessage}</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<AppView>('home')
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.onmove.getAppState().then(
      (nextState) => active && setState(nextState),
      () => active && setError('The local database could not be opened.')
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <AppSidebar
        activeView={activeView}
        databaseError={Boolean(error)}
        state={state}
        onViewChange={setActiveView}
        onShowData={() => void window.onmove.showDataFolder()}
      />
      {state ? (
        <EmptyView viewId={activeView} />
      ) : error ? (
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="drag-region h-14 shrink-0 border-b border-border/70" />
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </div>
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            </div>
          </div>
        </main>
      ) : (
        <LoadingView />
      )}
    </div>
  )
}
