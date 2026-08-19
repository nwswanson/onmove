import { Bot, Clock3, DatabaseBackup, FolderOpen, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { useBackupSettingsModel } from './use-backup-settings-model'
import { useMcpSettingsModel } from './use-mcp-settings-model'

function formatDate(value: string | null): string {
  if (value === null) return 'Not yet created'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

interface SettingsWorkspaceProps {
  contextDrawer: ContextDrawerControl
}

export function SettingsWorkspace({
  contextDrawer
}: SettingsWorkspaceProps): React.JSX.Element {
  const backups = useBackupSettingsModel()
  const mcp = useMcpSettingsModel()

  function saveMcpPort(input: HTMLInputElement): void {
    const port = Number(input.value)
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
      input.value = String(mcp.state?.serverPort ?? 47_832)
      return
    }
    if (port !== mcp.state?.serverPort) void mcp.update({ serverPort: port })
  }

  return (
    <WorkspaceShell
      main={
        <main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="settings-heading">
          <section className="mx-auto w-full max-w-3xl p-8 sm:p-10">
            <h1 id="settings-heading" className="text-2xl font-semibold tracking-[-0.025em]">
              Settings
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Local application storage and recovery.
            </p>

            <div className="mt-8 overflow-hidden rounded-xl border border-border/80 bg-card/55 shadow-xs">
              <div className="flex flex-wrap items-start gap-4 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success-foreground">
                  <DatabaseBackup className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-48 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">Automatic database backups</h2>
                    <span className="rounded-full bg-success/15 px-2 py-0.5 text-[0.6875rem] font-medium text-success-foreground">
                      On
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    OnMove creates a consistent SQLite snapshot every 24 hours and keeps the newest 10.
                    A new backup is checked before an older one is removed.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={backups.loading || backups.creating}
                    onClick={() => void backups.showFolder()}
                  >
                    <FolderOpen aria-hidden="true" />
                    Show backups
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={backups.loading || backups.creating}
                    onClick={() => void backups.createNow()}
                  >
                    <DatabaseBackup aria-hidden="true" />
                    {backups.creating ? 'Backing up…' : 'Back up now'}
                  </Button>
                </div>
              </div>

              <dl className="grid border-t border-border/70 bg-muted/18 sm:grid-cols-3">
                <div className="border-b border-border/60 px-5 py-3.5 sm:border-r sm:border-b-0">
                  <dt className="text-[0.6875rem] font-medium text-muted-foreground">Last backup</dt>
                  <dd className="mt-1 text-xs font-medium">
                    {backups.loading ? 'Loading…' : formatDate(backups.state?.lastBackupAt ?? null)}
                  </dd>
                </div>
                <div className="border-b border-border/60 px-5 py-3.5 sm:border-r sm:border-b-0">
                  <dt className="text-[0.6875rem] font-medium text-muted-foreground">Next automatic</dt>
                  <dd className="mt-1 text-xs font-medium">
                    {backups.loading ? 'Loading…' : formatDate(backups.state?.nextBackupAt ?? null)}
                  </dd>
                </div>
                <div className="px-5 py-3.5">
                  <dt className="text-[0.6875rem] font-medium text-muted-foreground">Retention</dt>
                  <dd className="mt-1 text-xs font-medium">
                    {backups.state
                      ? `${backups.state.backups.length} of ${backups.state.retentionLimit} snapshots`
                      : 'Up to 10 snapshots'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-7 overflow-hidden rounded-xl border border-border/80 bg-card/55 shadow-xs">
              <div className="flex items-start gap-4 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-foreground">
                  <Bot className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">Model Context Protocol</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    OnMove can serve MCP directly while this application is open. It uses the same
                    live data and immediately reflects edits from either interface.
                  </p>
                  <div className="mt-4 divide-y divide-border/65 border-y border-border/65">
                    <label className="flex cursor-pointer items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={mcp.state?.serverEnabled ?? false}
                        disabled={mcp.loading || mcp.saving}
                        onChange={(event) => void mcp.update({ serverEnabled: event.target.checked })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          Run MCP server
                          {mcp.state && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                              {mcp.state.status === 'running'
                                ? 'Running'
                                : mcp.state.status === 'starting'
                                  ? 'Starting…'
                                  : mcp.state.status === 'error'
                                    ? 'Unavailable'
                                    : 'Off'}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Listens only on this Mac while OnMove is running.
                        </span>
                        {mcp.state?.endpoint && (
                          <code className="mt-2 block select-all truncate rounded bg-muted/70 px-2 py-1 text-[0.6875rem] text-foreground">
                            {mcp.state.endpoint}
                          </code>
                        )}
                      </span>
                    </label>
                    <label className="flex items-center justify-between gap-4 py-3">
                      <span>
                        <span className="block text-sm font-medium">Local port</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Change this if another application already uses the default port.
                        </span>
                      </span>
                      <input
                        type="number"
                        min={1024}
                        max={65_535}
                        step={1}
                        className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={mcp.state?.serverPort ?? 'loading'}
                        defaultValue={mcp.state?.serverPort ?? 47_832}
                        disabled={mcp.loading || mcp.saving}
                        aria-label="MCP server port"
                        onBlur={(event) => saveMcpPort(event.currentTarget)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        }}
                      />
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={mcp.state?.allowSensitive ?? false}
                        disabled={mcp.loading || mcp.saving}
                        onChange={(event) => void mcp.update({ allowSensitive: event.target.checked })}
                      />
                      <span>
                        <span className="block text-sm font-medium">Allow sensitive content</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Applies only to MCP; the View menu does not grant model access.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={mcp.state?.allowMutations ?? false}
                        disabled={mcp.loading || mcp.saving}
                        onChange={(event) => void mcp.update({ allowMutations: event.target.checked })}
                      />
                      <span>
                        <span className="block text-sm font-medium">Allow safe MCP writes</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Permits Updates, Todos, completions, and review pokes. Deletes and moves are never exposed.
                        </span>
                      </span>
                    </label>
                  </div>
                  {mcp.error && (
                    <p className="mt-3 text-sm text-destructive" role="alert">{mcp.error}</p>
                  )}
                  {mcp.state?.error && (
                    <p className="mt-3 text-sm text-destructive" role="alert">
                      {mcp.state.error}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {backups.error && (
              <p className="mt-3 text-sm text-destructive" role="alert">{backups.error}</p>
            )}

            <div className="mt-7">
              <div className="mb-2 flex items-center gap-2 px-1">
                <Clock3 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Recent backups
                </h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-border/80 bg-card/35">
                {backups.loading ? (
                  <p className="p-5 text-sm text-muted-foreground">Loading backups…</p>
                ) : backups.state && backups.state.backups.length > 0 ? (
                  <ul className="divide-y divide-border/65" aria-label="Recent backups">
                    {backups.state.backups.map((backup) => (
                      <li key={backup.fileName} className="flex items-center gap-3 px-4 py-3">
                        <ShieldCheck className="size-4 shrink-0 text-success-foreground" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <time dateTime={backup.createdAt} className="block text-sm font-medium">
                            {formatDate(backup.createdAt)}
                          </time>
                          <span className="block truncate text-[0.6875rem] text-muted-foreground">
                            {backup.fileName}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatBytes(backup.sizeBytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-5 text-sm text-muted-foreground">
                    The first snapshot will be created automatically.
                  </p>
                )}
              </div>
            </div>
          </section>
        </main>
      }
      drawer={<ContextDrawerOutlet {...contextDrawer} />}
    />
  )
}
