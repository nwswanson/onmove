import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface FocusScopeSubjectItemModel {
  id: number
  name: string
}

export interface FocusScopeEditorModel {
  isOpen: boolean
  subjects: readonly FocusScopeSubjectItemModel[]
}

interface FocusScopeEditorProps {
  model: FocusScopeEditorModel | null
  loading: boolean
  saving: boolean
  error: string | null
  onAdd: (name: string) => Promise<void>
  onRemove: (subjectId: number) => Promise<void>
}

/** Receiver-owned inline editor for a Focus's bounded Subject set. */
export function FocusScopeEditor({
  model,
  loading,
  saving,
  error,
  onAdd,
  onRemove
}: FocusScopeEditorProps): React.JSX.Element {
  const [name, setName] = useState('')
  const normalizedName = name.trim()

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (normalizedName.length === 0 || saving) return
    try {
      await onAdd(normalizedName)
      setName('')
    } catch {
      // The model owns the user-facing persistence error.
    }
  }

  const scopeDescription = loading
    ? 'Loading scope…'
    : model?.isOpen
      ? 'Open scope — add a Subject to define its boundary.'
      : model?.subjects.length === 1
        ? '1 Subject in scope'
        : `${model?.subjects.length ?? 0} Subjects in scope`

  return (
    <section className="mt-6" aria-labelledby="focus-scope-heading">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="focus-scope-heading" className="text-xs font-semibold">
          Scope
        </h2>
        <span className="text-xs text-muted-foreground">{scopeDescription}</span>
      </div>
      <div className="rounded-xl border border-border/80 bg-muted/20 p-2 shadow-xs">
        {model && model.subjects.length > 0 && (
          <div
            role="list"
            aria-label="Subjects in scope"
            className="mb-2 flex flex-wrap gap-1.5"
          >
            {model.subjects.map((subject) => (
              <span
                key={subject.id}
                role="listitem"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/50 bg-primary/25 pl-2.5 pr-1 text-xs font-medium text-foreground"
              >
                {subject.name}
                <button
                  type="button"
                  aria-label={`Remove ${subject.name} from scope`}
                  disabled={saving}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => void onRemove(subject.id).catch(() => undefined)}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <form className="flex min-w-0 items-center gap-2" onSubmit={submit}>
          <Input
            aria-label="Add a Subject"
            placeholder="Add a Subject…"
            autoComplete="off"
            disabled={loading || saving}
            value={name}
            className="h-8 border-0 bg-background/65 shadow-none focus-visible:ring-1"
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={loading || saving || normalizedName.length === 0}
          >
            <Plus aria-hidden="true" />
            Add
          </Button>
        </form>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  )
}
