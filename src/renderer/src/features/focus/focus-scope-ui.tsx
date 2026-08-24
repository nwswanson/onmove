import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface FocusScopeSubjectItemModel {
  id: number
  name: string
}

export interface FocusScopeEditorModel {
  summary: string
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

interface ScopeSubjectEditorProps extends FocusScopeEditorProps {
  idPrefix: string
  inputLabel: string
  inputPlaceholder: string
  removeLabel: (subjectName: string) => string
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
  return (
    <ScopeSubjectEditor
      idPrefix="focus-scope"
      inputLabel="Add a Subject"
      inputPlaceholder="Add a Subject…"
      removeLabel={(subjectName) => `Remove ${subjectName} from scope`}
      model={model}
      loading={loading}
      saving={saving}
      error={error}
      onAdd={onAdd}
      onRemove={onRemove}
    />
  )
}

function ScopeSubjectEditor({
  idPrefix,
  inputLabel,
  inputPlaceholder,
  removeLabel,
  model,
  loading,
  saving,
  error,
  onAdd,
  onRemove
}: ScopeSubjectEditorProps): React.JSX.Element {
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

  return (
    <section className="mt-6" aria-labelledby={`${idPrefix}-heading`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${idPrefix}-heading`} className="text-xs font-semibold">
          Scope
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {loading ? 'Loading scope…' : model?.summary}
          </span>
        </div>
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
                  aria-label={removeLabel(subject.name)}
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
            aria-label={inputLabel}
            placeholder={inputPlaceholder}
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
