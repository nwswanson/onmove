import { useRef, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { cn } from '@/lib/utils'
import { useThrottledAutosave } from '@/lib/use-throttled-autosave'

export interface ContextDrawerProps extends Omit<React.ComponentProps<'aside'>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
}

export interface ContextDrawerSelectOption {
  value: string
  label: string
}

export type ContextDrawerFieldModel =
  | {
      kind: 'text'
      id: string
      label: string
      value: string
      required?: boolean
      placeholder?: string
    }
  | {
      kind: 'rich-text'
      id: string
      label: string
      value: string
      required?: boolean
      placeholder?: string
    }
  | {
      kind: 'select'
      id: string
      label: string
      value: string
      options: readonly ContextDrawerSelectOption[]
      required?: boolean
    }
  | {
      kind: 'checkbox'
      id: string
      label: string
      value: boolean
      description?: string
    }
  | {
      kind: 'static'
      id: string
      label: string
      value: string
      capitalization?: 'normal' | 'capitalize'
    }

export interface ContextDrawerSectionModel {
  id: string
  fields: readonly ContextDrawerFieldModel[]
  note?: string
}

export type ContextDrawerValue = string | boolean
export type ContextDrawerValues = Readonly<Record<string, ContextDrawerValue>>

export interface ContextDrawerAutosaveModel {
  fieldIds: readonly string[]
  errorMessage: string
  onInvoke: (values: ContextDrawerValues) => void | Promise<void>
}

export interface ContextDrawerConfirmationModel {
  title: string
  description: string
  body?: string
  confirmLabel: string
}

export interface ContextDrawerActionModel {
  id: string
  label: string
  pendingLabel?: string
  variant?: 'default' | 'destructive' | 'outline' | 'ghost'
  align?: 'start' | 'end'
  requiresValidFields?: boolean
  disabled?: boolean | ((values: ContextDrawerValues) => boolean)
  /** The action persists every autosaved field itself, so a pending timer can be coalesced into it. */
  includesAutosaveFields?: boolean
  confirmation?: ContextDrawerConfirmationModel
  errorMessage: string
  onInvoke: (values: ContextDrawerValues) => void | Promise<void>
}

/** Receiver-owned description of what the generic drawer can display and edit. */
export interface ContextDrawerModel {
  title: string
  description?: string
  ariaLabel: string
  sections: readonly ContextDrawerSectionModel[]
  autosave?: ContextDrawerAutosaveModel
  actions?: readonly ContextDrawerActionModel[]
}

/**
 * A feature-owned identity and receiver-owned presentation model. Features
 * provide data and actions; only ContextDrawerOutlet renders UI.
 */
export interface ContextDrawerAdapter {
  id: string
  /** Changes when the same entity needs a fresh receiver draft or presentation mode. */
  revision?: string
  /** Entity/ancestor keys whose deletion makes this representation invalid. */
  invalidationKeys: readonly string[]
  model: ContextDrawerModel
}

export interface ContextDrawerState {
  open: boolean
  pinnedAdapter: ContextDrawerAdapter | null
}

export type ContextDrawerAction =
  | { type: 'toggle' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'pin'; adapter: ContextDrawerAdapter }
  | { type: 'unpin' }
  | { type: 'invalidate'; keys: readonly string[] }

export const initialContextDrawerState: ContextDrawerState = {
  open: false,
  pinnedAdapter: null
}

/**
 * Centralizes visibility, pinning, and deletion invalidation so domain screens
 * can evolve without duplicating drawer lifecycle rules.
 */
export function contextDrawerReducer(
  state: ContextDrawerState,
  action: ContextDrawerAction
): ContextDrawerState {
  switch (action.type) {
    case 'toggle':
      return { ...state, open: !state.open }
    case 'open':
      return state.open ? state : { ...state, open: true }
    case 'close':
      return state.open ? { ...state, open: false } : state
    case 'pin':
      return { open: true, pinnedAdapter: action.adapter }
    case 'unpin':
      return state.pinnedAdapter ? { ...state, pinnedAdapter: null } : state
    case 'invalidate': {
      if (!state.pinnedAdapter || action.keys.length === 0) return state
      const invalidated = new Set(action.keys)
      return state.pinnedAdapter.invalidationKeys.some((key) => invalidated.has(key))
        ? { ...state, pinnedAdapter: null }
        : state
    }
  }
}

export interface ContextDrawerControl {
  open: boolean
  pinnedAdapter: ContextDrawerAdapter | null
  width: number
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number) => void
  onClose: () => void
  onPin: (adapter: ContextDrawerAdapter) => void
  onUnpin: () => void
  onInvalidate: (keys: readonly string[]) => void
}

export interface ContextDrawerOutletProps
  extends Omit<ContextDrawerControl, 'onPin' | 'onInvalidate'> {
  adapter?: ContextDrawerAdapter | null
}

/**
 * Composable shell for any contextual inspector. The required `onClose` prop
 * guarantees that every drawer instance renders an accessible close button.
 */
function ContextDrawer({
  title,
  description,
  footer,
  onClose,
  children,
  className,
  ...props
}: ContextDrawerProps): React.JSX.Element {
  return (
    <aside
      data-slot="context-drawer"
      className={cn(
        'flex h-full shrink-0 flex-col border-l border-border/75 bg-card/82 text-card-foreground backdrop-blur-xl',
        className
      )}
      {...props}
    >
      <div className="flex min-h-16 items-start gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-1 size-8 text-muted-foreground"
          aria-label="Close context drawer"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div data-slot="context-drawer-content" className="min-h-0 flex-1 overflow-auto p-4">
        {children}
      </div>
      {footer && (
        <div
          data-slot="context-drawer-footer"
          className="flex items-center justify-end gap-2 border-t border-border/70 p-4"
        >
          {footer}
        </div>
      )}
    </aside>
  )
}

function ContextDrawerSection({
  className,
  ...props
}: React.ComponentProps<'section'>): React.JSX.Element {
  return (
    <section
      data-slot="context-drawer-section"
      className={cn('space-y-4 rounded-xl border border-border/75 bg-background/45 p-4', className)}
      {...props}
    />
  )
}

function initialDrawerValues(model: ContextDrawerModel): Record<string, ContextDrawerValue> {
  return Object.fromEntries(
    model.sections.flatMap((section) =>
      section.fields.flatMap((field) =>
        field.kind === 'static' ? [] : [[field.id, field.value] as const]
      )
    )
  )
}

export function validateContextDrawerModel(model: ContextDrawerModel): void {
  if (model.title.trim().length === 0 || model.ariaLabel.trim().length === 0) {
    throw new Error('A context drawer model requires a title and accessible label.')
  }

  const sectionIds = new Set<string>()
  const fieldIds = new Set<string>()
  for (const section of model.sections) {
    const sectionId = section.id.trim()
    if (!sectionId || sectionIds.has(sectionId)) {
      throw new Error(`Context drawer contains an invalid or duplicate section id "${section.id}".`)
    }
    sectionIds.add(sectionId)

    for (const field of section.fields) {
      const fieldId = field.id.trim()
      if (!fieldId || fieldIds.has(fieldId)) {
        throw new Error(`Context drawer contains an invalid or duplicate field id "${field.id}".`)
      }
      if (field.label.trim().length === 0) {
        throw new Error(`Context drawer field "${fieldId}" requires a label.`)
      }
      if (field.kind === 'select') {
        const values = new Set(field.options.map((option) => option.value))
        if (values.size !== field.options.length || !values.has(field.value)) {
          throw new Error(`Context drawer select field "${fieldId}" has invalid options or value.`)
        }
      }
      if (field.kind === 'checkbox' && typeof field.value !== 'boolean') {
        throw new Error(`Context drawer checkbox field "${fieldId}" requires a boolean value.`)
      }
      fieldIds.add(fieldId)
    }
  }

  const actionIds = new Set<string>()
  for (const action of model.actions ?? []) {
    const actionId = action.id.trim()
    if (!actionId || actionIds.has(actionId) || action.label.trim().length === 0) {
      throw new Error(`Context drawer contains an invalid action "${action.id}".`)
    }
    actionIds.add(actionId)
  }

  if (model.autosave) {
    const autosaveIds = new Set(model.autosave.fieldIds)
    if (
      autosaveIds.size === 0 ||
      autosaveIds.size !== model.autosave.fieldIds.length ||
      !model.autosave.errorMessage.trim()
    ) {
      throw new Error('Context drawer autosave requires unique fields and an error message.')
    }
    for (const fieldId of autosaveIds) {
      const field = model.sections.flatMap((section) => section.fields).find(
        (candidate) => candidate.id === fieldId
      )
      if (!field || (field.kind !== 'text' && field.kind !== 'rich-text')) {
        throw new Error(`Context drawer autosave field "${fieldId}" must be editable text.`)
      }
    }
  }
}

function drawerValuesEqual(left: ContextDrawerValues, right: ContextDrawerValues): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  )
}

function autosaveValues(
  model: ContextDrawerModel,
  values: ContextDrawerValues
): ContextDrawerValues {
  return Object.fromEntries(
    (model.autosave?.fieldIds ?? []).map((fieldId) => [fieldId, values[fieldId] ?? ''])
  )
}

function drawerStringValue(values: ContextDrawerValues, fieldId: string): string {
  const value = values[fieldId]
  return typeof value === 'string' ? value : ''
}

function requiredFieldValid(
  field: ContextDrawerFieldModel,
  values: ContextDrawerValues
): boolean {
  if (field.kind === 'static' || field.kind === 'checkbox' || !field.required) return true
  return drawerStringValue(values, field.id).trim().length > 0
}

function ContextDrawerInspector({
  adapterId,
  model,
  width,
  onClose
}: {
  adapterId: string
  model: ContextDrawerModel
  width: number
  onClose: () => void
}): React.JSX.Element {
  validateContextDrawerModel(model)
  const [values, setValues] = useState<Record<string, ContextDrawerValue>>(
    () => initialDrawerValues(model)
  )
  const valuesRef = useRef(values)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [confirmingAction, setConfirmingAction] = useState<ContextDrawerActionModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actions = model.actions ?? []
  const fieldsValid = model.sections.every((section) =>
    section.fields.every((field) => requiredFieldValid(field, values))
  )
  const autosave = useThrottledAutosave({
    initialValue: autosaveValues(model, values),
    isEqual: drawerValuesEqual,
    onSave: (nextValues) => model.autosave?.onInvoke(nextValues)
  })

  function autosaveFieldsValid(nextValues: ContextDrawerValues): boolean {
    const autosaveIds = new Set(model.autosave?.fieldIds ?? [])
    return model.sections.every((section) =>
      section.fields.every(
        (field) =>
          !autosaveIds.has(field.id) ||
          requiredFieldValid(field, nextValues)
      )
    )
  }

  function updateValue(fieldId: string, value: ContextDrawerValue): void {
    const nextValues = { ...valuesRef.current, [fieldId]: value }
    valuesRef.current = nextValues
    setValues(nextValues)
    if (!model.autosave?.fieldIds.includes(fieldId)) return
    if (!autosaveFieldsValid(nextValues)) {
      autosave.cancelPending()
      return
    }
    autosave.schedule(autosaveValues(model, nextValues))
  }

  function flushAutosave(): void {
    if (!model.autosave) return
    if (!autosaveFieldsValid(valuesRef.current)) return
    void autosave.flush(autosaveValues(model, valuesRef.current))
  }

  async function closeDrawer(): Promise<void> {
    if (model.autosave && autosaveFieldsValid(valuesRef.current)) {
      await autosave.flush(autosaveValues(model, valuesRef.current))
    }
    onClose()
  }

  function actionDisabled(action: ContextDrawerActionModel): boolean {
    if (pendingActionId) return true
    if (action.requiresValidFields && !fieldsValid) return true
    return typeof action.disabled === 'function'
      ? action.disabled(values)
      : (action.disabled ?? false)
  }

  async function invoke(action: ContextDrawerActionModel): Promise<void> {
    setPendingActionId(action.id)
    setError(null)
    try {
      if (action.includesAutosaveFields) autosave.cancelPending()
      else await autosave.flush()
      await action.onInvoke(valuesRef.current)
      setConfirmingAction(null)
    } catch {
      setError(action.errorMessage)
      setConfirmingAction(null)
    } finally {
      setPendingActionId(null)
    }
  }

  function requestAction(action: ContextDrawerActionModel): void {
    if (action.confirmation) {
      setConfirmingAction(action)
    } else {
      void invoke(action)
    }
  }

  return (
    <>
      <ContextDrawer
        title={model.title}
        description={model.description}
        aria-label={model.ariaLabel}
        style={{ width }}
        onClose={() => void closeDrawer()}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) flushAutosave()
        }}
        footer={
          actions.length > 0 ? (
            <>
              {actions.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  variant={action.variant}
                  className={action.align === 'start' ? 'mr-auto' : undefined}
                  disabled={actionDisabled(action)}
                  onClick={() => requestAction(action)}
                >
                  {pendingActionId === action.id
                    ? (action.pendingLabel ?? action.label)
                    : action.label}
                </Button>
              ))}
            </>
          ) : undefined
        }
      >
        {model.sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settings here.</p>
        ) : (
          <div className="space-y-4">
            {model.sections.map((section) => (
              <ContextDrawerSection key={section.id}>
                {section.fields.map((field) => {
                  const inputId = `${adapterId}-${field.id}`
                  if (field.kind === 'static') {
                    return (
                      <dl key={field.id}>
                        <dt className="text-[0.6875rem] font-medium text-muted-foreground">
                          {field.label}
                        </dt>
                        <dd
                          className={cn(
                            'mt-0.5 text-sm',
                            field.capitalization === 'capitalize' && 'capitalize'
                          )}
                        >
                          {field.value}
                        </dd>
                      </dl>
                    )
                  }

                  if (field.kind === 'checkbox') {
                    return (
                      <label
                        key={field.id}
                        htmlFor={inputId}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg outline-none"
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          aria-label={field.label}
                          className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring/45"
                          checked={values[field.id] === true}
                          onChange={(event) => updateValue(field.id, event.target.checked)}
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium">{field.label}</span>
                          {field.description && (
                            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                              {field.description}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  }

                  return (
                    <div key={field.id} className="space-y-1.5">
                      <label htmlFor={inputId} className="text-xs font-medium">
                        {field.label}
                        {field.required && <span className="text-destructive"> *</span>}
                      </label>
                      {field.kind === 'select' ? (
                        <select
                          id={inputId}
                          className="h-9 w-full rounded-lg border border-border bg-background/75 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                          required={field.required}
                          value={drawerStringValue(values, field.id)}
                          onChange={(event) => updateValue(field.id, event.target.value)}
                        >
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : field.kind === 'rich-text' ? (
                        <RichTextEditor
                          id={inputId}
                          ariaLabel={field.label}
                          placeholder={field.placeholder}
                          value={drawerStringValue(values, field.id)}
                          onChange={(value) => updateValue(field.id, value)}
                          compact
                        />
                      ) : (
                        <Input
                          id={inputId}
                          required={field.required}
                          placeholder={field.placeholder}
                          value={drawerStringValue(values, field.id)}
                          onChange={(event) => updateValue(field.id, event.target.value)}
                        />
                      )}
                    </div>
                  )
                })}
                {section.note && (
                  <p className="text-xs text-muted-foreground">{section.note}</p>
                )}
              </ContextDrawerSection>
            ))}
            {autosave.saving && (
              <p role="status" className="px-1 text-xs text-muted-foreground">
                Saving…
              </p>
            )}
            {(error !== null || autosave.error !== null) && (
              <p role="alert" className="px-1 text-xs text-destructive">
                {error ?? model.autosave?.errorMessage}
              </p>
            )}
          </div>
        )}
      </ContextDrawer>

      {confirmingAction?.confirmation && (
        <Dialog
          open
          title={confirmingAction.confirmation.title}
          description={confirmingAction.confirmation.description}
          onClose={() => !pendingActionId && setConfirmingAction(null)}
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                disabled={Boolean(pendingActionId)}
                onClick={() => setConfirmingAction(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={confirmingAction.variant}
                disabled={Boolean(pendingActionId)}
                onClick={() => void invoke(confirmingAction)}
              >
                {pendingActionId === confirmingAction.id
                  ? (confirmingAction.pendingLabel ?? confirmingAction.label)
                  : confirmingAction.confirmation.confirmLabel}
              </Button>
            </>
          }
        >
          {confirmingAction.confirmation.body && (
            <p className="text-sm leading-6 text-muted-foreground">
              {confirmingAction.confirmation.body}
            </p>
          )}
        </Dialog>
      )}
    </>
  )
}

/**
 * Persistent, domain-agnostic drawer outlet. Swapping adapters replaces only
 * the drawer representation; it never changes the caller-owned open state.
 */
function ContextDrawerOutlet({
  open,
  adapter,
  pinnedAdapter,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onClose,
  onUnpin
}: ContextDrawerOutletProps): React.JSX.Element | null {
  if (!open) return null

  const renderedAdapter = pinnedAdapter ?? adapter

  return (
    <>
      <ResizeHandle
        label="Resize context drawer"
        value={width}
        min={minWidth}
        max={maxWidth}
        direction={-1}
        onChange={onWidthChange}
      />
      <div
        data-slot="context-drawer-outlet"
        className="flex h-full shrink-0 flex-col overflow-hidden"
        style={{ width }}
      >
        {pinnedAdapter && (
          <div className="shrink-0 border-b border-l border-border/70 bg-card/82 p-1 backdrop-blur-xl">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start text-muted-foreground"
              aria-label="Unpin drawer and follow current selection"
              onClick={onUnpin}
            >
              <Undo2 aria-hidden="true" />
              <span>Follow current selection</span>
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ContextDrawerInspector
            key={
              renderedAdapter
                ? `${renderedAdapter.id}:${renderedAdapter.revision ?? 'current'}`
                : 'context:empty'
            }
            adapterId={renderedAdapter?.id ?? 'context-empty'}
            model={
              renderedAdapter?.model ?? {
                title: 'Context',
                description: 'Current selection',
                ariaLabel: 'Context drawer',
                sections: []
              }
            }
            width={width}
            onClose={onClose}
          />
        </div>
      </div>
    </>
  )
}

export { ContextDrawer, ContextDrawerOutlet, ContextDrawerSection }
