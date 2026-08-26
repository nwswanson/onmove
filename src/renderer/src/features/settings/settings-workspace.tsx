import { useEffect, useMemo, useState } from 'react'
import { Bot, Clock3, DatabaseBackup, FolderOpen, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { useBackupSettingsModel } from './use-backup-settings-model'
import {
  MCP_PERMISSION_RESOURCES,
  type McpPermissionOverrideSnapshot,
  type McpPermissionResource,
  type McpPermissionResourceSelector
} from '../../../../shared/contracts'
import { useMcpSettingsModel, type McpSettingsModel } from './use-mcp-settings-model'

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

const permissionLabels: Record<McpPermissionResource, string> = {
  focus: 'Focuses',
  thread: 'Threads',
  commitment: 'Commitments',
  routine: 'Routines',
  update: 'Updates',
  todo: 'Todos',
  note: 'Notes',
  subject: 'Subjects'
}

type OverrideTarget = McpPermissionOverrideSnapshot['target']

function updateTarget(target: OverrideTarget): { type: 'focus' | 'thread'; id: number } {
  return { type: target.type, id: target.id }
}

function inheritedValue(value: boolean | null): string {
  return value === null ? 'inherit' : value ? 'allow' : 'deny'
}

function PermissionChoice({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: boolean | null
  disabled: boolean
  onChange: (value: boolean | null) => void
}): React.JSX.Element {
  return (
    <select
      aria-label={label}
      className="h-7 min-w-24 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={inheritedValue(value)}
      disabled={disabled}
      onChange={(event) => onChange(
        event.target.value === 'inherit' ? null : event.target.value === 'allow'
      )}
    >
      <option value="inherit">Inherit</option>
      <option value="allow">Allow</option>
      <option value="deny">Deny</option>
    </select>
  )
}

function PermissionOverrideEditor({
  model,
  target,
  title,
  nested = false
}: {
  model: McpSettingsModel
  target: OverrideTarget
  title: string
  nested?: boolean
}): React.JSX.Element {
  const rows = model.state?.permissionPolicy.overrides.filter((override) =>
    override.target.type === target.type && override.target.id === target.id
  ) ?? []
  const value = (
    resource: McpPermissionResourceSelector,
    field: 'view' | 'edit' | 'delete'
  ): boolean | null =>
    rows.find((row) => row.resource === resource)?.[field] ?? null
  const write = (
    resource: McpPermissionResourceSelector,
    field: 'view' | 'edit' | 'delete',
    next: boolean | null
  ): void => {
    void model.update({
      permission: { target: updateTarget(target), resource, [field]: next }
    })
  }

  return (
    <div className={nested ? 'border-t border-border/60 px-3 py-3' : 'px-4 py-4'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <PermissionChoice
          label={`${title} view access`}
          value={value('all', 'view')}
          disabled={model.saving}
          onChange={(next) => write('all', 'view', next)}
        />
        <PermissionChoice
          label={`${title} edit access`}
          value={value('all', 'edit')}
          disabled={model.saving}
          onChange={(next) => write('all', 'edit', next)}
        />
        <PermissionChoice
          label={`${title} delete access`}
          value={value('all', 'delete')}
          disabled={model.saving}
          onChange={(next) => write('all', 'delete', next)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${title} MCP access override`}
          disabled={model.saving}
          onClick={() => void model.update({ removePermissionTarget: updateTarget(target) })}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer select-none text-xs text-muted-foreground">
          Fine-grained permissions
        </summary>
        <div className="mt-2 divide-y divide-border/50 border-y border-border/50">
          {MCP_PERMISSION_RESOURCES.map((resource) => (
            <div key={resource} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-2">
              <span className="text-xs">{permissionLabels[resource]}</span>
              <PermissionChoice
                label={`${title} ${permissionLabels[resource]} view access`}
                value={value(resource, 'view')}
                disabled={model.saving}
                onChange={(next) => write(resource, 'view', next)}
              />
              <PermissionChoice
                label={`${title} ${permissionLabels[resource]} edit access`}
                value={value(resource, 'edit')}
                disabled={model.saving}
                onChange={(next) => write(resource, 'edit', next)}
              />
              <PermissionChoice
                label={`${title} ${permissionLabels[resource]} delete access`}
                value={value(resource, 'delete')}
                disabled={model.saving}
                onChange={(next) => write(resource, 'delete', next)}
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

function McpPermissionSettings({ model }: { model: McpSettingsModel }): React.JSX.Element {
  const [focusId, setFocusId] = useState<number | null>(null)
  const [preset, setPreset] = useState<'allow' | 'deny'>('deny')
  const [defaultPreset, setDefaultPreset] = useState<'deny' | 'view' | 'edit' | 'full'>('view')
  const policy = model.state?.permissionPolicy
  const focusIds = useMemo(() => [...new Set(policy?.overrides.map((override) =>
    override.target.type === 'focus' ? override.target.id : override.target.focusId
  ) ?? [])], [policy])
  const configured = new Set(focusIds)
  const availableFocuses = model.focuses.filter((focus) => !configured.has(focus.id))
  const loadThreads = model.loadThreads

  useEffect(() => {
    for (const id of focusIds) void loadThreads(id)
  }, [focusIds, loadThreads])

  return (
    <div className="mt-4 border-t border-border/65 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">Default access</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            View, edit, and delete are independent per record type. Edit and delete require View.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label="Default MCP access preset"
            className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={defaultPreset}
            disabled={model.saving}
            onChange={(event) => setDefaultPreset(
              event.target.value as 'deny' | 'view' | 'edit' | 'full'
            )}
          >
            <option value="deny">Deny all</option>
            <option value="view">View only</option>
            <option value="edit">View and edit</option>
            <option value="full">View, edit, and delete</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={model.saving}
            onClick={() => void model.update({
              permission: {
                target: { type: 'default' },
                resource: 'all',
                view: defaultPreset !== 'deny',
                edit: defaultPreset === 'edit' || defaultPreset === 'full',
                delete: defaultPreset === 'full'
              }
            })}
          >
            Apply
          </Button>
        </div>
      </div>
      <div className="mt-2 divide-y divide-border/55 border-y border-border/55">
        {policy && MCP_PERMISSION_RESOURCES.map((resource) => {
          const grant = policy.defaults[resource]
          return (
            <div key={resource} className="grid grid-cols-[1fr_5rem_5rem_5rem] items-center gap-3 py-2.5">
              <span className="text-sm">{permissionLabels[resource]}</span>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={`View ${permissionLabels[resource]} by default`}
                  checked={grant.view}
                  disabled={model.saving}
                  onChange={(event) => void model.update({
                    permission: {
                      target: { type: 'default' },
                      resource,
                      view: event.target.checked,
                      ...(event.target.checked ? {} : { edit: false, delete: false })
                    }
                  })}
                />
                View
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={`Edit ${permissionLabels[resource]} by default`}
                  checked={grant.edit && grant.view}
                  disabled={model.saving || !grant.view}
                  onChange={(event) => void model.update({
                    permission: {
                      target: { type: 'default' },
                      resource,
                      edit: event.target.checked
                    }
                  })}
                />
                Edit
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={`Delete ${permissionLabels[resource]} by default`}
                  checked={grant.delete && grant.view}
                  disabled={model.saving || !grant.view}
                  onChange={(event) => void model.update({
                    permission: {
                      target: { type: 'default' },
                      resource,
                      delete: event.target.checked
                    }
                  })}
                />
                Delete
              </label>
            </div>
          )
        })}
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-medium">Focus and Thread overrides</h3>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          Add only exceptions. A denied default with one allowed Focus is a whitelist; an allowed
          default with one denied Focus is a blacklist. Thread rules take precedence inside a Focus.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Focus for MCP access override"
            className="h-8 min-w-52 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={focusId ?? ''}
            disabled={model.saving || availableFocuses.length === 0}
            onChange={(event) => setFocusId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Choose a Focus…</option>
            {availableFocuses.map((focus) => (
              <option key={focus.id} value={focus.id}>{focus.title}</option>
            ))}
          </select>
          <select
            aria-label="Initial MCP access override"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={preset}
            disabled={model.saving}
            onChange={(event) => setPreset(event.target.value as 'allow' | 'deny')}
          >
            <option value="deny">Deny all</option>
            <option value="allow">Allow all</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={model.saving || focusId === null}
            onClick={() => {
              if (focusId === null) return
              void model.update({
                permission: {
                  target: { type: 'focus', id: focusId },
                  resource: 'all',
                  view: preset === 'allow',
                  edit: preset === 'allow',
                  delete: preset === 'allow'
                }
              })
              setFocusId(null)
            }}
          >
            <Plus aria-hidden="true" />
            Add override
          </Button>
        </div>
      </div>

      {focusIds.length > 0 && (
        <div className="mt-3 divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
          {focusIds.map((configuredFocusId) => {
            const focus = model.focuses.find((item) => item.id === configuredFocusId)
            const focusTarget: OverrideTarget = { type: 'focus', id: configuredFocusId }
            const threads = model.threadsByFocus[configuredFocusId] ?? []
            const threadOverrides = policy?.overrides.filter((override) =>
              override.target.type === 'thread' && override.target.focusId === configuredFocusId
            ) ?? []
            const threadIds = [...new Set(threadOverrides.map((override) => override.target.id))]
            const availableThreads = threads.filter((thread) => !threadIds.includes(thread.id))
            return (
              <FocusPermissionGroup
                key={configuredFocusId}
                model={model}
                focusTarget={focusTarget}
                title={focus?.title ?? `Focus ${configuredFocusId}`}
                threadIds={threadIds}
                threads={threads}
                availableThreads={availableThreads}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function FocusPermissionGroup({
  model,
  focusTarget,
  title,
  threadIds,
  threads,
  availableThreads
}: {
  model: McpSettingsModel
  focusTarget: Extract<OverrideTarget, { type: 'focus' }>
  title: string
  threadIds: number[]
  threads: McpSettingsModel['threadsByFocus'][number]
  availableThreads: McpSettingsModel['threadsByFocus'][number]
}): React.JSX.Element {
  const [threadId, setThreadId] = useState<number | null>(null)
  const [preset, setPreset] = useState<'allow' | 'deny'>('deny')

  return (
    <section>
      <PermissionOverrideEditor model={model} target={focusTarget} title={title} />
      <div className="border-t border-border/60 bg-muted/15 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Thread override in ${title}`}
            className="h-7 min-w-44 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={threadId ?? ''}
            disabled={model.saving || availableThreads.length === 0}
            onChange={(event) => setThreadId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Add a Thread exception…</option>
            {availableThreads.map((thread) => (
              <option key={thread.id} value={thread.id}>{thread.title}</option>
            ))}
          </select>
          <select
            aria-label={`Initial Thread MCP access in ${title}`}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={preset}
            disabled={model.saving}
            onChange={(event) => setPreset(event.target.value as 'allow' | 'deny')}
          >
            <option value="deny">Deny all</option>
            <option value="allow">Allow all</option>
          </select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={model.saving || threadId === null}
            onClick={() => {
              if (threadId === null) return
              void model.update({
                permission: {
                  target: { type: 'thread', id: threadId },
                  resource: 'all',
                  view: preset === 'allow',
                  edit: preset === 'allow',
                  delete: preset === 'allow'
                }
              })
              setThreadId(null)
            }}
          >
            <Plus aria-hidden="true" />
            Add Thread
          </Button>
        </div>
      </div>
      {threadIds.map((id) => {
        const thread = threads.find((item) => item.id === id)
        return (
          <PermissionOverrideEditor
            key={id}
            model={model}
            target={{ type: 'thread', id, focusId: focusTarget.id }}
            title={thread?.title ?? `Thread ${id}`}
            nested
          />
        )
      })}
    </section>
  )
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
                    <label className="flex items-center justify-between gap-4 py-3">
                      <span>
                        <span className="block text-sm font-medium">Retrieval</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Enhanced retrieval adds local semantic ranking while preserving exact
                          hierarchy boundaries. Its model downloads on first use; unavailable
                          models fall back to classic search.
                        </span>
                      </span>
                      <select
                        aria-label="MCP retrieval mode"
                        className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={mcp.state?.retrievalMode ?? 'classic'}
                        disabled={mcp.loading || mcp.saving}
                        onChange={(event) => {
                          const value = event.target.value
                          if (value === 'classic' || value === 'enhanced') {
                            void mcp.update({ retrievalMode: value })
                          }
                        }}
                      >
                        <option value="classic">Classic</option>
                        <option value="enhanced">Enhanced</option>
                      </select>
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
                  </div>
                  <McpPermissionSettings model={mcp} />
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
