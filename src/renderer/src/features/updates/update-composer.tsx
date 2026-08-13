import { useMemo, useRef, useState } from 'react'
import type { FocusSnapshot, HealthState } from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { CommandMenu } from '@/components/ui/command-menu'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  RichTextEditor,
  type RichTextEditorHandle
} from '@/components/ui/rich-text-editor'
import { StateLabel } from '@/components/ui/state-label'
import { SensitivityToggle } from '@/features/shared/sensitivity-toggle'
import { publishUpdateCreated } from '@/features/updates/update-creation-events'
import { UpdateComposerContext } from '@/features/updates/update-composer-context'
import type { UpdateCommandTarget } from '@/features/updates/update-command-presenters'
import { UPDATE_LIST_STATE_OPTIONS } from '@/features/updates/updates-presenters'
import { useUpdateCommandModel } from '@/features/updates/use-update-command-model'
import { useCommandKeyShortcut } from '@/lib/use-command-key-shortcut'

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function UpdateComposerProvider({
  enabled,
  focuses,
  hideSensitiveContent,
  onCreated,
  children
}: {
  enabled: boolean
  focuses: readonly FocusSnapshot[]
  hideSensitiveContent: boolean
  onCreated?: (target: UpdateCommandTarget) => void | Promise<void>
  children: React.ReactNode
}): React.JSX.Element {
  const [chooserOpen, setChooserOpen] = useState(false)
  const [target, setTarget] = useState<UpdateCommandTarget | null>(null)
  const [date, setDate] = useState(today)
  const [state, setState] = useState<HealthState>('none')
  const [sensitive, setSensitive] = useState(false)
  const [observation, setObservation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const observationEditorRef = useRef<RichTextEditorHandle>(null)
  const model = useUpdateCommandModel({
    open: chooserOpen,
    focuses,
    hideSensitiveContent
  })
  const targets = useMemo(
    () => new Map(model.groups.flatMap(({ items }) =>
      items.map((item) => [item.id, item.target] as const))),
    [model.groups]
  )

  function open(): void {
    if (!enabled) return
    setChooserOpen(true)
  }

  useCommandKeyShortcut('p', open, enabled)

  function openFor(selected: UpdateCommandTarget): void {
    if (!enabled) return
    setChooserOpen(false)
    setTarget(selected)
    setDate(today())
    setState('none')
    setSensitive(false)
    setObservation('')
    setError(null)
  }

  function selectTarget(targetId: string): void {
    const selected = targets.get(targetId)
    if (selected) openFor(selected)
  }

  function cancel(): void {
    if (saving) return
    setTarget(null)
    setError(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!target || !date) return
    setSaving(true)
    setError(null)
    let created
    try {
      created = await window.onmove.domain.createUpdate({
        parent: target.parent,
        date,
        observation: observationEditorRef.current?.getValue() ?? observation,
        state,
        sensitive,
        ...(target.scope ? { scope: target.scope } : {})
      })
    } catch {
      setError('The Update could not be added. Nothing was lost; try again.')
      setSaving(false)
      return
    }

    // The durable write is the success boundary. Projection refreshes happen
    // afterward and must not misreport a successfully created Update as lost.
    setTarget(null)
    publishUpdateCreated({ update: created, focusId: target.focusId })
    try {
      await onCreated?.(target)
    } catch {
      // Subscribers already received the new snapshot; normal navigation can
      // retry any broader derived-view refresh that failed in the background.
    }
    setSaving(false)
  }

  const selectedState = UPDATE_LIST_STATE_OPTIONS.find((option) => option.value === state)

  return (
    <UpdateComposerContext.Provider value={{ open, openFor }}>
      {children}
      <CommandMenu
        open={chooserOpen}
        label="Choose update target"
        placeholder="Filter Focuses, Threads, Commitments, and Subjects…"
        resultsLabel="Update targets"
        emptyLabel="No matching update target."
        loadingLabel="Loading update targets…"
        shortcutLabel="⌘P"
        groups={model.groups}
        loading={model.loading}
        error={model.error}
        onOpenChange={setChooserOpen}
        onSelect={selectTarget}
      />
      <Dialog
        open={target !== null}
        title="Add update"
        description={target ? `${target.label} · ${target.description}` : undefined}
        contentClassName="max-w-3xl"
        onClose={cancel}
        footer={(
          <>
            <Button type="button" variant="ghost" disabled={saving} onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" form="global-update-form" disabled={saving || !date}>
              {saving ? 'Adding…' : 'Add update'}
            </Button>
          </>
        )}
      >
        <form id="global-update-form" className="space-y-4" onSubmit={(event) => void submit(event)}>
          <div className="flex flex-wrap items-end gap-3">
            <DialogField className="min-w-40 flex-1">
              <label htmlFor="global-update-date" className="text-xs font-medium">Date</label>
              <Input
                id="global-update-date"
                type="date"
                required
                value={date}
                disabled={saving}
                onChange={(event) => setDate(event.target.value)}
              />
            </DialogField>
            <DialogField className="min-w-44 flex-1">
              <label htmlFor="global-update-state" className="text-xs font-medium">State</label>
              <div className="flex items-center gap-2">
                <select
                  id="global-update-state"
                  aria-label="Update state"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/75 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                  value={state}
                  disabled={saving}
                  onChange={(event) => setState(event.target.value as HealthState)}
                >
                  {UPDATE_LIST_STATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {selectedState && <StateLabel model={selectedState} />}
              </div>
            </DialogField>
          </div>
          <SensitivityToggle
            checked={sensitive}
            disabled={saving}
            onCheckedChange={setSensitive}
          />
          <DialogField>
            <label htmlFor="global-update-observation" className="text-xs font-medium">
              Observation
            </label>
            <RichTextEditor
              ref={observationEditorRef}
              id="global-update-observation"
              ariaLabel="Update observation"
              placeholder="What changed?"
              value={observation}
              autoFocus
              fillHeight
              className="h-[min(30rem,48vh)] min-h-64"
              onChange={setObservation}
              onBlur={setObservation}
            />
          </DialogField>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </form>
      </Dialog>
    </UpdateComposerContext.Provider>
  )
}
