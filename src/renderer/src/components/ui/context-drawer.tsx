import { useEffect, useRef, useState } from 'react'
import { Plus, Undo2, X } from 'lucide-react'
import type * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { TaggedInput, TaggedText } from '@/components/ui/tagged-text'
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

export interface ContextDrawerChoiceOption extends ContextDrawerSelectOption {
  description?: string
}

export interface ContextDrawerTokenItem {
  id: string
  label: string
}

export type ContextDrawerValue = string | boolean
export type ContextDrawerValues = Readonly<Record<string, ContextDrawerValue>>

export type ContextDrawerFieldModel = (
  | {
      kind: 'text'
      id: string
      label: string
      value: string
      required?: boolean
      placeholder?: string
    }
  | {
      kind: 'number'
      id: string
      label: string
      value: string
      required?: boolean
      min?: number
      max?: number
      step?: number
      integer?: boolean
      placeholder?: string
    }
  | {
      kind: 'date'
      id: string
      label: string
      value: string
      required?: boolean
    }
  | {
      kind: 'rich-text'
      id: string
      label: string
      value: string
      required?: boolean
      placeholder?: string
      onValueChange?: (value: string) => void
      onOpenInWindow?: () => void
      onOpenHistory?: () => void
      errorMessage?: string
      externalRevision?: string | number
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
      kind: 'choice'
      id: string
      label: string
      value: string
      options: readonly ContextDrawerChoiceOption[]
      errorMessage: string
      onValueChange: (value: string) => void | Promise<void>
    }
  | {
      kind: 'token-list'
      id: string
      label: string
      items: readonly ContextDrawerTokenItem[]
      suggestions?: readonly ContextDrawerTokenItem[]
      inputLabel: string
      placeholder?: string
      errorMessage: string
      onAdd: (label: string) => void | Promise<void>
      onRemove: (itemId: string) => void | Promise<void>
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
  ) & {
    visibleWhen?: { fieldId: string; equals: ContextDrawerValue }
  }

export interface ContextDrawerSectionModel {
  id: string
  fields: readonly ContextDrawerFieldModel[]
  note?: string
}

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
  /** Changes when the same entity has incoming values for the receiver to reconcile in place. */
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
        field.kind === 'static' || field.kind === 'token-list'
          ? []
          : [[field.id, field.value] as const]
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
      if (field.kind === 'choice') {
        const values = new Set(field.options.map((option) => option.value))
        if (
          values.size === 0 ||
          values.size !== field.options.length ||
          !values.has(field.value) ||
          !field.errorMessage.trim()
        ) {
          throw new Error(`Context drawer choice field "${fieldId}" has invalid options or value.`)
        }
      }
      if (field.kind === 'token-list') {
        const itemIds = new Set(field.items.map(({ id }) => id))
        const suggestionIds = new Set((field.suggestions ?? []).map(({ id }) => id))
        if (
          itemIds.size !== field.items.length ||
          suggestionIds.size !== (field.suggestions ?? []).length ||
          field.items.some(({ id, label }) => !id.trim() || !label.trim()) ||
          (field.suggestions ?? []).some(({ id, label }) => !id.trim() || !label.trim()) ||
          !field.inputLabel.trim() ||
          !field.errorMessage.trim()
        ) {
          throw new Error(`Context drawer token-list field "${fieldId}" is invalid.`)
        }
      }
      if (field.kind === 'checkbox' && typeof field.value !== 'boolean') {
        throw new Error(`Context drawer checkbox field "${fieldId}" requires a boolean value.`)
      }
      if (
        field.kind === 'number' &&
        (
          (field.min !== undefined && !Number.isFinite(field.min)) ||
          (field.max !== undefined && !Number.isFinite(field.max)) ||
          (field.step !== undefined && (!Number.isFinite(field.step) || field.step <= 0)) ||
          (field.min !== undefined && field.max !== undefined && field.min > field.max)
        )
      ) {
        throw new Error(`Context drawer number field "${fieldId}" has invalid constraints.`)
      }
      fieldIds.add(fieldId)
    }
  }

  for (const field of model.sections.flatMap((section) => section.fields)) {
    if (field.visibleWhen && !fieldIds.has(field.visibleWhen.fieldId)) {
      throw new Error(
        `Context drawer field "${field.id}" references missing visibility field "${field.visibleWhen.fieldId}".`
      )
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
      if (!field || !['text', 'rich-text', 'number', 'date'].includes(field.kind)) {
        throw new Error(`Context drawer autosave field "${fieldId}" must be editable.`)
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
  if (
    field.kind === 'static' ||
    field.kind === 'checkbox' ||
    field.kind === 'choice' ||
    field.kind === 'token-list' ||
    field.kind !== 'number' &&
    !field.required
  ) return true
  const rawValue = drawerStringValue(values, field.id).trim()
  if (field.kind !== 'number') return rawValue.length > 0
  if (rawValue.length === 0) return !field.required
  const value = Number(rawValue)
  return Number.isFinite(value) &&
    (!field.integer || Number.isSafeInteger(value)) &&
    (field.min === undefined || value >= field.min) &&
    (field.max === undefined || value <= field.max)
}

type ContextDrawerTokenListFieldModel = Extract<
  ContextDrawerFieldModel,
  { kind: 'token-list' }
>

function ContextDrawerTokenListField({
  field,
  inputId,
  disabled
}: {
  field: ContextDrawerTokenListFieldModel
  inputId: string
  disabled: boolean
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const normalizedName = name.trim()

  async function add(label: string): Promise<void> {
    if (!label.trim() || pending || disabled) return
    setPending(true)
    setError(null)
    try {
      await field.onAdd(label.trim())
      setName('')
    } catch {
      setError(field.errorMessage)
    } finally {
      setPending(false)
    }
  }

  async function remove(itemId: string): Promise<void> {
    if (pending || disabled) return
    setPending(true)
    setError(null)
    try {
      await field.onRemove(itemId)
    } catch {
      setError(field.errorMessage)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{field.label}</p>
      {field.items.length > 0 && (
        <div role="list" aria-label={field.label} className="flex flex-wrap gap-1.5">
          {field.items.map((item) => (
            <span
              key={item.id}
              role="listitem"
              className="inline-flex min-h-7 items-center gap-1 rounded-md border border-primary/50 bg-primary/20 pl-2 pr-1 text-xs font-medium"
            >
              {item.label}
              <button
                type="button"
                aria-label={`Remove ${item.label}`}
                disabled={disabled || pending}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background/65 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                onClick={() => void remove(item.id)}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="flex min-w-0 items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          void add(normalizedName)
        }}
      >
        <Input
          id={inputId}
          aria-label={field.inputLabel}
          placeholder={field.placeholder}
          autoComplete="off"
          disabled={disabled || pending}
          value={name}
          className="h-8"
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={disabled || pending || normalizedName.length === 0}
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      </form>
      {(field.suggestions ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
          {(field.suggestions ?? []).map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              aria-label={`Add ${suggestion.label}`}
              disabled={disabled || pending}
              className="inline-flex min-h-7 items-center gap-1 rounded-md border border-dashed border-primary/60 bg-background/50 px-2 text-xs outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => void add(suggestion.label)}
            >
              <Plus aria-hidden="true" className="size-3" />
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ContextDrawerInspector({
  adapterId,
  adapterRevision,
  model,
  width,
  onClose
}: {
  adapterId: string
  adapterRevision?: string
  model: ContextDrawerModel
  width: number
  onClose: () => void
}): React.JSX.Element {
  validateContextDrawerModel(model)
  const [values, setValues] = useState<Record<string, ContextDrawerValue>>(
    () => initialDrawerValues(model)
  )
  const valuesRef = useRef(values)
  const modelValuesRef = useRef<Record<string, ContextDrawerValue>>(
    initialDrawerValues(model)
  )
  const adapterRevisionRef = useRef(adapterRevision)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [confirmingAction, setConfirmingAction] = useState<ContextDrawerActionModel | null>(null)
  const [pendingFieldId, setPendingFieldId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const richTextRevisionRef = useRef(new Map<string, string | number | undefined>())
  const actions = model.actions ?? []
  const fieldsValid = model.sections.every((section) =>
    section.fields.every((field) => requiredFieldValid(field, values))
  )
  const autosave = useThrottledAutosave({
    initialValue: autosaveValues(model, values),
    isEqual: drawerValuesEqual,
    onSave: (nextValues) => model.autosave?.onInvoke(nextValues)
  })

  useEffect(() => {
    if (adapterRevisionRef.current === adapterRevision) return
    adapterRevisionRef.current = adapterRevision

    const previousModelValues = modelValuesRef.current
    const incomingModelValues = initialDrawerValues(model)
    modelValuesRef.current = incomingModelValues
    const richTextIds = new Set(
      model.sections.flatMap((section) =>
        section.fields
          .filter((field) => field.kind === 'rich-text')
          .map((field) => field.id)
      )
    )
    const autosaveIds = new Set(model.autosave?.fieldIds ?? [])
    const changes: Record<string, ContextDrawerValue> = {}
    let autosaveDraftIsPristine = true

    for (const [fieldId, incomingValue] of Object.entries(incomingModelValues)) {
      if (richTextIds.has(fieldId)) continue
      const currentValue = valuesRef.current[fieldId]
      const hadPreviousValue = Object.prototype.hasOwnProperty.call(
        previousModelValues,
        fieldId
      )
      const hasNewerLocalDraft = hadPreviousValue &&
        currentValue !== previousModelValues[fieldId]
      if (autosaveIds.has(fieldId) && hasNewerLocalDraft) {
        autosaveDraftIsPristine = false
      }
      if (!hasNewerLocalDraft && currentValue !== incomingValue) {
        changes[fieldId] = incomingValue
      }
    }

    if (model.autosave && autosaveDraftIsPristine) {
      autosave.acceptExternal(autosaveValues(model, incomingModelValues))
    }
    if (Object.keys(changes).length === 0) return
    const nextValues = { ...valuesRef.current, ...changes }
    valuesRef.current = nextValues
    setValues(nextValues)
  }, [adapterRevision, autosave, model])

  useEffect(() => {
    const changes: Record<string, ContextDrawerValue> = {}
    for (const section of model.sections) {
      for (const field of section.fields) {
        if (field.kind !== 'rich-text' || field.externalRevision === undefined) continue
        const previous = richTextRevisionRef.current.get(field.id)
        richTextRevisionRef.current.set(field.id, field.externalRevision)
        if (previous === undefined || previous === field.externalRevision) continue
        if (valuesRef.current[field.id] !== field.value) changes[field.id] = field.value
      }
    }
    if (Object.keys(changes).length === 0) return
    const nextValues = { ...valuesRef.current, ...changes }
    valuesRef.current = nextValues
    setValues(nextValues)
  }, [model])

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

  function updateRichText(
    field: Extract<ContextDrawerFieldModel, { kind: 'rich-text' }>,
    value: string
  ): void {
    updateValue(field.id, value)
    if (!field.onValueChange) return
    try {
      field.onValueChange(value)
      setError(null)
    } catch {
      setError(field.errorMessage ?? 'The text could not be saved. Keep editing to retry.')
    }
  }

  async function updateChoice(
    field: Extract<ContextDrawerFieldModel, { kind: 'choice' }>,
    value: string
  ): Promise<void> {
    const previous = valuesRef.current[field.id]
    updateValue(field.id, value)
    setPendingFieldId(field.id)
    setError(null)
    try {
      await field.onValueChange(value)
    } catch {
      updateValue(field.id, previous ?? field.value)
      setError(field.errorMessage)
    } finally {
      setPendingFieldId(null)
    }
  }

  function fieldVisible(field: ContextDrawerFieldModel): boolean {
    return !field.visibleWhen ||
      values[field.visibleWhen.fieldId] === field.visibleWhen.equals
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
                {section.fields.filter(fieldVisible).map((field) => {
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
                          <TaggedText value={field.value} />
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

                  if (field.kind === 'choice') {
                    return (
                      <fieldset key={field.id} className="space-y-2">
                        <legend className="text-xs font-medium">{field.label}</legend>
                        {field.options.map((option) => (
                          <label
                            key={option.value}
                            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/75 bg-background/55 p-2.5 has-checked:border-primary/65 has-checked:bg-primary/15"
                          >
                            <input
                              type="radio"
                              aria-label={option.label}
                              name={inputId}
                              value={option.value}
                              checked={drawerStringValue(values, field.id) === option.value}
                              disabled={pendingFieldId !== null || pendingActionId !== null}
                              className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring/45"
                              onChange={() => void updateChoice(field, option.value)}
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-medium">{option.label}</span>
                              {option.description && (
                                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                                  {option.description}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    )
                  }

                  if (field.kind === 'token-list') {
                    return (
                      <ContextDrawerTokenListField
                        key={field.id}
                        field={field}
                        inputId={inputId}
                        disabled={pendingFieldId !== null || pendingActionId !== null}
                      />
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
                          onChange={(value) => updateRichText(field, value)}
                          onOpenInWindow={field.onOpenInWindow}
                          onOpenHistory={field.onOpenHistory}
                          externalRevision={field.externalRevision}
                          compact
                        />
                      ) : field.kind === 'number' ? (
                        <Input
                          id={inputId}
                          type="number"
                          required={field.required}
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          placeholder={field.placeholder}
                          value={drawerStringValue(values, field.id)}
                          onChange={(event) => updateValue(field.id, event.target.value)}
                        />
                      ) : field.kind === 'date' ? (
                        <Input
                          id={inputId}
                          type="date"
                          required={field.required}
                          value={drawerStringValue(values, field.id)}
                          onChange={(event) => updateValue(field.id, event.target.value)}
                        />
                      ) : (
                        <TaggedInput
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
            key={renderedAdapter?.id ?? 'context:empty'}
            adapterId={renderedAdapter?.id ?? 'context-empty'}
            adapterRevision={renderedAdapter?.revision}
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
