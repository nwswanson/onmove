import { useEffect, useState } from 'react'
import type {
  EnhancedRetrievalPhase,
  EnhancedRetrievalStatusSnapshot,
  McpSettingsSnapshot,
  McpRetrievalMode
} from '../../../../shared/contracts'
import { Progress } from '../../components/ui/progress'
import { cn } from '../../lib/utils'

const numberFormatter = new Intl.NumberFormat()

const phaseLabels: Record<EnhancedRetrievalPhase, string> = {
  idle: 'Not prepared',
  synchronizing: 'Reading searchable data',
  'loading-cache': 'Loading cached embeddings',
  'checking-documents': 'Checking for changed documents',
  'loading-model': 'Loading the local semantic model',
  embedding: 'Generating local embeddings',
  'preparing-index': 'Preparing the local search index',
  indexing: 'Building the Orama index',
  ready: 'Ready',
  error: 'Unavailable'
}

function isBusy(status: EnhancedRetrievalStatusSnapshot | null): boolean {
  return status !== null && !['idle', 'ready', 'error'].includes(status.phase)
}

function formatElapsed(startedAt: string | null, now: number): string | null {
  if (!startedAt) return null
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return null
  const seconds = Math.max(0, Math.floor((now - started) / 1_000))
  if (seconds < 60) return `${seconds}s elapsed`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s elapsed`
}

function formatCompletedAt(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function progressText(status: EnhancedRetrievalStatusSnapshot): string | null {
  const progress = status.progress
  if (!progress || progress.total < 1) return null
  const unit = progress.unit === 'chunks'
    ? 'embedding chunks'
    : progress.unit === 'cache-entries'
      ? 'cached vectors'
      : 'search documents'
  return `${numberFormatter.format(progress.completed)} of ${numberFormatter.format(progress.total)} ${unit}`
}

function statusDescription(
  mode: McpRetrievalMode,
  serverEnabled: boolean,
  serverStatus: McpSettingsSnapshot['status'],
  loadError: boolean,
  status: EnhancedRetrievalStatusSnapshot | null
): string {
  if (!status) {
    return loadError
      ? 'The live retrieval status could not be loaded. Enhanced retrieval settings remain available.'
      : 'Loading the current index state…'
  }
  if (status.phase === 'idle') {
    if (mode !== 'enhanced') {
      return 'Enhanced retrieval is off. No local semantic index has been prepared this session.'
    }
    if (!serverEnabled) {
      return 'Start the MCP server. Preparation begins with the first enhanced retrieval request.'
    }
    if (serverStatus === 'error') {
      return 'The MCP server is unavailable. Preparation can begin after the server error is resolved.'
    }
    if (serverStatus !== 'running') {
      return 'Waiting for the MCP server to start. Preparation begins with the first enhanced retrieval request.'
    }
    return 'Waiting for the first enhanced retrieval request. Indexing starts on demand.'
  }
  if (status.phase === 'ready') {
    return mode === 'enhanced'
      ? 'The local index is ready. The first query after an app restart may still briefly load the semantic model.'
      : 'The index is prepared but remains unused while Classic retrieval is selected.'
  }
  if (status.phase === 'error') {
    return 'Enhanced retrieval could not finish. Classic retrieval remains available.'
  }
  const classicModeNote = mode === 'classic'
    ? ' This build was already started and will finish even though Classic is selected.'
    : ''
  if (status.phase === 'embedding') {
    return `OnMove is creating embeddings locally. High CPU use is expected during this step; Classic retrieval remains available.${classicModeNote}`
  }
  if (status.phase === 'preparing-index' || status.phase === 'indexing') {
    return `OnMove is building its local Orama index. CPU use is expected; Classic retrieval remains available.${classicModeNote}`
  }
  if (status.phase === 'loading-model') {
    return `The model may be downloading or initializing. Classic retrieval remains available.${classicModeNote}`
  }
  return `OnMove is preparing local retrieval data. Classic retrieval remains available.${classicModeNote}`
}

export function EnhancedRetrievalStatus({
  mode,
  serverEnabled,
  serverStatus,
  loadError,
  status
}: {
  mode: McpRetrievalMode
  serverEnabled: boolean
  serverStatus: McpSettingsSnapshot['status']
  loadError: boolean
  status: EnhancedRetrievalStatusSnapshot | null
}): React.JSX.Element {
  const busy = isBusy(status)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [busy, status?.startedAt])

  const phase = status?.phase ?? null
  const label = phase ? phaseLabels[phase] : loadError ? 'Status unavailable' : 'Loading status'
  const progressLabel = status ? progressText(status) : null
  const progressValueText = progressLabel ? `${label}, ${progressLabel}` : label
  const elapsed = status ? formatElapsed(status.startedAt, now) : null
  const completedAt = status ? formatCompletedAt(status.readyAt) : null
  const showProgress = (status === null && !loadError) || busy || status?.phase === 'ready'
  const determinate = status?.phase === 'ready'
    ? { value: 1, max: 1 }
    : status?.progress && status.progress.total > 0
      ? { value: status.progress.completed, max: status.progress.total }
      : { value: null, max: 100 }

  return (
    <section
      aria-label="Enhanced retrieval index status"
      className={cn(
        'mt-3 rounded-lg border border-border/75 bg-background/55 p-3.5',
        status?.phase === 'ready' && 'border-success/45 bg-success/8',
        status?.phase === 'error' && 'border-destructive/55 bg-destructive/8'
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h3 className="text-xs font-semibold">Enhanced retrieval index</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span role="status" aria-live="polite" className="font-medium text-foreground">
              {label}
            </span>
            {elapsed && busy ? ` · ${elapsed}` : ''}
            {completedAt && status?.phase === 'ready' ? ` · completed ${completedAt}` : ''}
          </p>
        </div>
        {progressLabel && (
          <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
            {progressLabel}
          </span>
        )}
      </div>

      {showProgress && (
        <Progress
          className="mt-2.5"
          value={determinate.value}
          max={determinate.max}
          aria-label="Current enhanced retrieval step progress"
          aria-valuetext={progressValueText}
        />
      )}
      <p className="mt-2 text-[0.6875rem] leading-4 text-muted-foreground">
        {statusDescription(mode, serverEnabled, serverStatus, loadError, status)}
      </p>

      {status?.error && (
        <p className="mt-2 text-xs text-destructive" role="alert">{status.error}</p>
      )}

      {status && status.totalDocuments !== null && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[0.6875rem] sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Search documents</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {numberFormatter.format(status.totalDocuments)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reused embeddings</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {numberFormatter.format(status.reusedEmbeddings)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">New embeddings</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {numberFormatter.format(status.generatedEmbeddings)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Index generation</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {status.generation === null ? '—' : numberFormatter.format(status.generation)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}
