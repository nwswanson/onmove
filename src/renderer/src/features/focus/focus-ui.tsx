import { useState, type ReactNode } from 'react'
import { Circle, PauseCircle, Plus } from 'lucide-react'
import type {
  CreateFocusInput,
  FocusSnapshot,
  FocusStatus,
  UpdateFocusInput
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { ContextDrawer, ContextDrawerSection } from '@/components/ui/context-drawer'
import { Dialog, DialogField } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { Textarea } from '@/components/ui/textarea'
import { isVisibleFocus } from '@/features/focus/focus-utils'
import { FocusWorkspace } from '@/features/focus/focus-workspace'

interface FocusListProps {
  focuses: FocusSnapshot[]
  selectedFocusId: number | null
  disabled?: boolean
  onSelect: (focusId: number) => void
  onNew: () => void
}

export function FocusList({
  focuses,
  selectedFocusId,
  disabled = false,
  onSelect,
  onNew
}: FocusListProps): React.JSX.Element {
  const visibleFocuses = focuses.filter(isVisibleFocus)

  return (
    <SidebarMenu>
      {visibleFocuses.length === 0 ? (
        <li className="px-2 py-2 text-[0.6875rem] text-muted-foreground">No focuses yet</li>
      ) : (
        visibleFocuses.map((focus) => {
          const paused = focus.status === 'paused'
          return (
            <SidebarMenuItem key={focus.id}>
              <SidebarMenuButton
                type="button"
                isActive={focus.id === selectedFocusId}
                aria-current={focus.id === selectedFocusId ? 'page' : undefined}
                aria-label={`${focus.title}${paused ? ', paused' : ''}`}
                className={paused ? 'text-muted-foreground opacity-55' : undefined}
                onClick={() => onSelect(focus.id)}
              >
                {paused ? <PauseCircle aria-hidden="true" /> : <Circle aria-hidden="true" />}
                <span className="truncate">{focus.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })
      )}
      <SidebarMenuItem className="mt-1 border-t border-sidebar-border pt-1">
        <SidebarMenuButton type="button" disabled={disabled} onClick={onNew}>
          <Plus aria-hidden="true" />
          <span>New focus</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

interface NewFocusDialogProps {
  onClose: () => void
  onCreate: (input: CreateFocusInput) => Promise<void>
}

export function NewFocusDialog({ onClose, onCreate }: NewFocusDialogProps): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (title.trim().length === 0) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        title,
        description: description.trim().length === 0 ? null : description
      })
      onClose()
    } catch {
      setError('The focus could not be created. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      title="New focus"
      description="Create a top-level focus in this portfolio. Titles do not need to be unique."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="new-focus-form" disabled={saving || title.trim().length === 0}>
            {saving ? 'Creating…' : 'Create focus'}
          </Button>
        </>
      }
    >
      <form id="new-focus-form" className="space-y-4" onSubmit={submit}>
        <DialogField>
          <label htmlFor="new-focus-title" className="text-xs font-medium">
            Title <span className="text-destructive">*</span>
          </label>
          <Input
            id="new-focus-title"
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </DialogField>
        <DialogField>
          <label htmlFor="new-focus-description" className="text-xs font-medium">
            Description / notes <span className="text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="new-focus-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </DialogField>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}

interface FocusViewProps {
  focus: FocusSnapshot
  toolbar: ReactNode
}

export function FocusView({ focus, toolbar }: FocusViewProps): React.JSX.Element {
  return (
    <FocusWorkspace focus={focus} toolbar={toolbar} />
  )
}

interface FocusContextPanelProps {
  focus: FocusSnapshot
  width: number
  onClose: () => void
  onSave: (input: UpdateFocusInput) => Promise<void>
  onDelete: () => Promise<void>
}

export function FocusContextPanel({
  focus,
  width,
  onClose,
  onSave,
  onDelete
}: FocusContextPanelProps): React.JSX.Element {
  const [title, setTitle] = useState(focus.title)
  const [description, setDescription] = useState(focus.description ?? '')
  const [status, setStatus] = useState<FocusStatus>(focus.status)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    if (title.trim().length === 0) return
    setSaving(true)
    setError(null)
    try {
      await onSave({
        title,
        description: description.trim().length === 0 ? null : description,
        status
      })
    } catch {
      setError('The focus could not be updated. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteFocus(): Promise<void> {
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
    } catch {
      setError('The focus could not be deleted. Please try again.')
      setConfirmingDelete(false)
      setDeleting(false)
    }
  }

  return (
    <>
      <ContextDrawer
        title="Focus"
        description={focus.title}
        aria-label="Focus context drawer"
        style={{ width }}
        onClose={onClose}
        footer={
          <>
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              disabled={saving || deleting}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
            <Button
              type="button"
              disabled={saving || deleting || title.trim().length === 0}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <ContextDrawerSection>
          <div className="space-y-1.5">
            <label htmlFor="focus-context-title" className="text-xs font-medium">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="focus-context-title"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="focus-context-description" className="text-xs font-medium">
              Description / notes
            </label>
            <Textarea
              id="focus-context-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="focus-context-status" className="text-xs font-medium">
              Status
            </label>
            <select
              id="focus-context-status"
              className="h-9 w-full rounded-lg border border-border bg-background/75 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as FocusStatus)}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
              <option value="done">Done</option>
            </select>
          </div>
          <p className="text-[0.6875rem] leading-5 text-muted-foreground">
            Kind: generic
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </ContextDrawerSection>
      </ContextDrawer>

      <Dialog
        open={confirmingDelete}
        title="Delete focus?"
        description={`“${focus.title}” and its status history will be permanently deleted.`}
        onClose={() => !deleting && setConfirmingDelete(false)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteFocus()}
            >
              {deleting ? 'Deleting…' : 'Delete focus'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-muted-foreground">This action cannot be undone.</p>
      </Dialog>
    </>
  )
}
