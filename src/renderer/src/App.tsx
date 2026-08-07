import { useEffect, useState } from 'react'
import { Check, Database, FolderOpen, Sparkles } from 'lucide-react'
import type { AppState } from '../../shared/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

function EmptySidebar(): React.JSX.Element {
  return (
    <Sidebar aria-label="Primary sidebar">
      <div className="drag-region h-9 shrink-0" />
      <SidebarHeader className="px-5 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">OnMove</p>
            <p className="text-xs text-muted-foreground">Your workspace</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <div className="h-full rounded-xl border border-dashed border-sidebar-border/80 bg-background/25" />
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/0.12)]" />
          Ready
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function LoadingView(): React.JSX.Element {
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center p-8" aria-label="Loading application">
      <div className="w-full max-w-xl space-y-4">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-16 w-80 max-w-full" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    </main>
  )
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  async function recordGreeting(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      setState(await window.onmove.recordGreeting())
    } catch {
      setError('Your greeting could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <EmptySidebar />
      {state ? (
        <main className="relative flex min-w-0 flex-1 items-center justify-center overflow-auto p-8 sm:p-12">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgb(99_102_241/0.08),transparent_38%)]" />
          <div className="relative w-full max-w-2xl">
            <Badge variant="outline" className="mb-6">
              <Check className="size-3 text-emerald-600" aria-hidden="true" />
              Electron + React + SQLite
            </Badge>
            <h1 className="text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-6xl">
              {state.greeting}
            </h1>
            <p className="mt-5 max-w-lg text-pretty text-base leading-7 text-muted-foreground">
              A small, fast macOS foundation. Every hello below is written to SQLite and remains
              available the next time you open the app.
            </p>

            <Card className="mt-10 overflow-hidden bg-card/80 backdrop-blur-xl">
              <CardContent>
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">Persistent hello count</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums" data-testid="greeting-count">
                      {state.greetingCount}
                    </p>
                  </div>
                  <Button onClick={recordGreeting} disabled={saving}>
                    <Database aria-hidden="true" />
                    {saving ? 'Saving…' : 'Save a hello'}
                  </Button>
                </div>
                <Separator className="my-5" />
                <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Opened {state.launchCount} {state.launchCount === 1 ? 'time' : 'times'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-2 justify-start text-muted-foreground"
                    onClick={() => void window.onmove.showDataFolder()}
                  >
                    <FolderOpen aria-hidden="true" />
                    Show data in Finder
                  </Button>
                </div>
              </CardContent>
            </Card>
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </main>
      ) : error ? (
        <main className="flex min-w-0 flex-1 items-center justify-center p-8">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        </main>
      ) : (
        <LoadingView />
      )}
    </div>
  )
}
