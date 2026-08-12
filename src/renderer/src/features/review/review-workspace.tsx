import { useState } from 'react'
import { ArrowRight, Check, MessageSquarePlus, SkipForward, X } from 'lucide-react'
import type {
  EditUpdateInput,
  ReviewQueueItemSnapshot,
  TodoParent,
  UpdateSnapshot
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { Input } from '@/components/ui/input'
import { LifecycleStatusLabel } from '@/components/ui/lifecycle-status'
import {
  RichTextContent,
  RichTextEditor
} from '@/components/ui/rich-text-editor'
import { StateLabel } from '@/components/ui/state-label'
import { TaggedText } from '@/components/ui/tagged-text'
import { VerticalSplitPane } from '@/components/ui/vertical-split-pane'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { NoteEditor } from '@/features/notes/direct-notes'
import {
  reviewItemIsVisible,
  reviewItemModel,
  type ReviewItemModel
} from '@/features/review/review-presenters'
import { useReviewModel } from '@/features/review/use-review-model'
import { SensitivityToggle } from '@/features/shared/sensitivity-toggle'
import { DirectTodos } from '@/features/todos/direct-todos'
import { UPDATE_LIST_STATE_OPTIONS } from '@/features/updates/updates-presenters'
import { useCommandKeyShortcut } from '@/lib/use-command-key-shortcut'
import { useRevealElement } from '@/lib/use-reveal-element'

interface ReviewWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
  onReviewChanged?: (focusId: number) => void | Promise<void>
}

function reviewTodoContext(item: ReviewQueueItemSnapshot): TodoParent {
  if (item.kind === 'focus') return { type: 'focus', id: item.focus.id }
  if (item.kind === 'thread' && item.thread) {
    return item.cell
      ? {
          type: 'thread-scope',
          id: item.thread.id,
          scope: { scopeId: item.cell.scopeId, subjectId: item.cell.subjectId }
        }
      : { type: 'thread', id: item.thread.id }
  }
  if (!item.commitment) throw new Error('A Commitment review item requires a Commitment')
  return item.cell
    ? {
        type: 'commitment-scope',
        id: item.commitment.id,
        scope: { scopeId: item.cell.scopeId, subjectId: item.cell.subjectId }
      }
    : { type: 'commitment', id: item.commitment.id }
}

function ReviewUpdateEditor({
  update,
  onEdit,
  onObservationChange,
  onOpenObservation,
  onCancel,
  onFinish
}: {
  update: UpdateSnapshot
  onEdit: (input: EditUpdateInput) => Promise<void>
  onObservationChange: (value: string) => void
  onOpenObservation: () => void
  onCancel: () => void
  onFinish: () => void
}): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const state = UPDATE_LIST_STATE_OPTIONS.find(({ value }) => value === update.state)
  const editorRef = useRevealElement<HTMLElement>()

  async function edit(input: EditUpdateInput): Promise<void> {
    setSaving(true)
    try {
      await onEdit(input)
    } catch {
      // The screen-level error remains visible and the editor stays open for retry.
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      ref={editorRef}
      aria-labelledby="review-update-heading"
      className="border-t border-primary/35 bg-primary/7 px-5 py-5 sm:px-7"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="review-update-heading" className="text-sm font-semibold">Add review evidence</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This Update already exists. Every edit is saved automatically.
          </p>
        </div>
        {saving && <span role="status" className="text-xs text-muted-foreground">Saving…</span>}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-col gap-1">
          <span className="text-[0.6875rem] font-medium text-muted-foreground">Date</span>
          <Input
            type="date"
            aria-label="Review Update date"
            className="h-9"
            value={update.date}
            disabled={saving}
            onChange={(event) => void edit({ date: event.target.value })}
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-[0.6875rem] font-medium text-muted-foreground">State</span>
          <span className="flex items-center gap-2">
            <select
              aria-label="Review Update state"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/80 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
              value={update.state}
              disabled={saving}
              onChange={(event) => void edit({ state: event.target.value as UpdateSnapshot['state'] })}
            >
              {UPDATE_LIST_STATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {state && <StateLabel model={state} />}
          </span>
        </label>
        <SensitivityToggle
          checked={update.sensitive}
          disabled={saving}
          onCheckedChange={(sensitive) => void edit({ sensitive })}
        />
      </div>

      <RichTextEditor
        ariaLabel="Review Update observation"
        autoFocus
        value={update.observation}
        externalRevision={update.updatedAt}
        placeholder="What changed?"
        compact
        onChange={onObservationChange}
        onOpenInWindow={onOpenObservation}
      />

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          <X aria-hidden="true" />
          Cancel update
        </Button>
        <Button type="button" disabled={saving} onClick={onFinish}>
          <Check aria-hidden="true" />
          Finish update
        </Button>
      </div>
    </section>
  )
}

function ReviewSupportingDetails({
  model
}: {
  model: ReviewItemModel
}): React.JSX.Element | null {
  if (!model.goal && !model.description && model.commitments.length === 0) return null

  return (
    <div className="space-y-7 border-t border-border/75 px-5 py-6 sm:px-7">
      {model.goal && (
        <section aria-labelledby="review-goal-heading">
          <h3 id="review-goal-heading" className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
            Goal
          </h3>
          <RichTextContent value={model.goal} ariaLabel="Focus goal" />
        </section>
      )}
      {model.description && (
        <section aria-labelledby="review-description-heading">
          <h3 id="review-description-heading" className="mb-2 text-xs font-semibold text-muted-foreground uppercase">
            Description
          </h3>
          <RichTextContent value={model.description} ariaLabel="Focus description" />
        </section>
      )}

      {model.commitments.length > 0 && (
        <section aria-labelledby="review-commitments-heading">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 id="review-commitments-heading" className="text-xs font-semibold text-muted-foreground uppercase">
              Commitments
            </h3>
            <span className="text-xs text-muted-foreground">{model.commitments.length}</span>
          </div>
          <ul
            aria-label="Related commitments"
            className="divide-y divide-border/65 overflow-hidden rounded-lg border border-border/80 bg-card/35"
          >
            {model.commitments.map((commitment) => (
              <li key={commitment.id} className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-40 flex-1 truncate text-sm">
                  <TaggedText value={commitment.title} />
                </span>
                <LifecycleStatusLabel model={commitment.status} size="compact" />
                <StateLabel model={commitment.state} size="compact" />
                <span className="text-[0.6875rem] text-muted-foreground">
                  Updated {commitment.lastUpdatedLabel}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">
            Commitment rows are reference-only during review.
          </p>
        </section>
      )}
    </div>
  )
}

function ReviewUpdates({ model }: { model: ReviewItemModel }): React.JSX.Element {
  return (
    <section
      aria-labelledby="review-recent-updates-heading"
      className="border-t border-border/75 px-5 py-6 sm:px-7"
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id="review-recent-updates-heading" className="text-xs font-semibold text-muted-foreground uppercase">
          Recent updates
        </h3>
        {model.updates.length > 0 && (
          <span className="text-xs text-muted-foreground">Latest {model.updates.length}</span>
        )}
      </div>
      {model.updates.length === 0 ? (
        <p className="border-t border-border/75 py-4 text-sm text-muted-foreground">
          No direct updates yet.
        </p>
      ) : (
        <ul aria-label="Recent direct updates" className="divide-y divide-border/65 border-y border-border/75">
          {model.updates.map((update) => (
            <li key={update.id} className="py-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <time className="text-xs font-medium">{update.date}</time>
                <StateLabel model={update.state} size="compact" />
              </div>
              {update.observation ? (
                <RichTextContent value={update.observation} ariaLabel={`Update from ${update.date}`} />
              ) : (
                <p className="text-sm text-muted-foreground">No observation recorded.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ReviewWorkspace({
  contextDrawer,
  hideSensitiveContent,
  onReviewChanged
}: ReviewWorkspaceProps): React.JSX.Element {
  const review = useReviewModel({ onReviewChanged })
  const visibleItems = review.overview?.items.filter((item) =>
    reviewItemIsVisible(item, hideSensitiveContent)) ?? []
  const remainingItems = visibleItems.filter(({ key }) => !review.dismissedKeys.has(key))
  const editingItem = review.editingUpdate
    ? remainingItems.find(({ key }) => key === review.editingUpdate?.itemKey)
    : null
  const current = editingItem ?? remainingItems[0] ?? null
  const currentModel = current ? reviewItemModel(current, hideSensitiveContent) : null
  const completed = visibleItems.length - remainingItems.length
  const skipped = visibleItems.filter(({ key }) =>
    review.dismissedKeys.has(key) && !review.reviewedKeys.has(key)).length
  const progress = visibleItems.length === 0 ? 100 : (completed / visibleItems.length) * 100
  const pending = current ? review.pendingKey === current.key : false
  const editing = Boolean(review.editingUpdate && current?.key === review.editingUpdate.itemKey)

  useCommandKeyShortcut('p', () => {
    if (!current || pending || editing) return
    void review.beginUpdate(current)
  }, current !== null)

  return (
    <WorkspaceShell
      main={
        <main
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
          aria-labelledby="review-heading"
        >
          <section className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-6 py-7 sm:px-10">
            <h1 id="review-heading" className="sr-only">Review</h1>

            {review.loading ? (
              <p className="text-sm text-muted-foreground">Loading review…</p>
            ) : review.error && review.overview === null ? (
              <div>
                <p role="alert" className="text-sm text-destructive">{review.error}</p>
                <Button className="mt-4" variant="outline" onClick={() => void review.refresh()}>
                  Try again
                </Button>
              </div>
            ) : current && currentModel ? (
              <VerticalSplitPane
                separatorLabel="Resize review and note panes"
                primary={(
                  <article
                    aria-label={`${currentModel.kindLabel} review: ${currentModel.title}`}
                    className="overflow-hidden rounded-xl border border-border/85 bg-card/25 shadow-xs"
                  >
                <div className="border-b border-border/75 bg-muted/15">
                  <div
                    role="toolbar"
                    aria-label="Review actions"
                    className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 sm:px-7"
                  >
                    <div className="min-w-52 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                          {currentModel.contextLabel} · {currentModel.kindLabel}
                        </p>
                        <p className="text-[0.6875rem] font-medium text-muted-foreground" aria-live="polite">
                          {remainingItems.length} remaining · {completed} reviewed
                        </p>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                        <p className="min-w-0 text-base font-semibold tracking-[-0.015em]">
                          <TaggedText value={currentModel.title} />
                        </p>
                        <LifecycleStatusLabel model={currentModel.status} />
                        {currentModel.state && <StateLabel model={currentModel.state} />}
                        {currentModel.subjectLabel && (
                          <span className="rounded-md border border-primary/40 bg-primary/15 px-2 py-1 text-xs font-medium">
                            Subject · {currentModel.subjectLabel}
                          </span>
                        )}
                      </div>
                      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.6875rem] text-muted-foreground">
                        <div className="flex gap-1.5">
                          <dt>{currentModel.kindLabel === 'Commitment' ? 'Last updated' : 'Last reviewed'}</dt>
                          <dd className="font-medium text-foreground">{currentModel.lastReviewLabel}</dd>
                        </div>
                        {currentModel.nextReviewLabel && (
                          <div className="flex gap-1.5">
                            <dt>
                              {currentModel.kindLabel === 'Commitment'
                                ? (currentModel.due ? 'Update due' : 'Next update')
                                : (currentModel.due ? 'Review due' : 'Next review')}
                            </dt>
                            <dd className={currentModel.due
                              ? 'font-medium text-destructive'
                              : 'font-medium text-foreground'}>
                              {currentModel.nextReviewLabel}
                            </dd>
                          </div>
                        )}
                        {currentModel.dueDate && (
                          <div className="flex gap-1.5">
                            <dt>Due</dt>
                            <dd className="font-medium text-foreground">{currentModel.dueDate}</dd>
                          </div>
                        )}
                        {currentModel.cadenceDays && (
                          <div className="flex gap-1.5">
                            <dt>Cadence</dt>
                            <dd className="font-medium text-foreground">
                              Every {currentModel.cadenceDays} days
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending || editing}
                        onClick={() => review.ignore(current.key)}
                      >
                        <SkipForward aria-hidden="true" />
                        Ignore
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending || editing}
                        onClick={() => void review.pass(current)}
                      >
                        <ArrowRight aria-hidden="true" />
                        {pending ? 'Passing…' : 'Pass along'}
                      </Button>
                      <Button
                        type="button"
                        disabled={pending || editing}
                        onClick={() => void review.beginUpdate(current)}
                        aria-keyshortcuts="Meta+P"
                        title="Add update (⌘P)"
                      >
                        <MessageSquarePlus aria-hidden="true" />
                        {pending ? 'Starting…' : editing ? 'Updating…' : 'Update'}
                      </Button>
                    </div>
                  </div>
                  <div className="h-1 overflow-hidden bg-muted" aria-hidden="true">
                    <div
                      className="h-full bg-primary transition-[width] duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="px-5 pb-6 sm:px-7">
                  <DirectTodos
                    key={current.key}
                    context={reviewTodoContext(current)}
                    onMutation={() => review.recordTodoMutation(current)}
                  />
                </div>

                {editing && review.editingUpdate ? (
                  <ReviewUpdateEditor
                    key={review.editingUpdate.update.id}
                    update={review.editingUpdate.update}
                    onEdit={review.editUpdate}
                    onObservationChange={review.saveObservation}
                    onOpenObservation={review.openObservation}
                    onCancel={review.cancelUpdate}
                    onFinish={review.finishUpdate}
                  />
                ) : null}

                <ReviewUpdates model={currentModel} />
                <ReviewSupportingDetails model={currentModel} />
                  </article>
                )}
                secondary={(
                  <section
                    aria-label={`${currentModel.kindLabel} default note`}
                    className="h-full min-h-0 pt-2"
                  >
                    {currentModel.defaultNote ? (
                      <NoteEditor
                        key={currentModel.defaultNote.id}
                        note={currentModel.defaultNote}
                        fillHeight
                        onContentChange={() => void review.recordNoteMutation(current)}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/10 px-5 text-center">
                        <p className="text-sm text-muted-foreground">
                          This item does not have a Default note.
                        </p>
                      </div>
                    )}
                  </section>
                )}
              />
            ) : (
              <div className="mx-auto flex max-w-sm flex-1 flex-col items-center justify-center py-16 text-center">
                <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-success/15 text-success-foreground">
                  <Check className="size-5" aria-hidden="true" />
                </span>
                <h2 className="text-lg font-semibold">You’re caught up</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {skipped > 0
                    ? `${skipped} skipped ${skipped === 1 ? 'item is' : 'items are'} available to reconsider.`
                    : 'No new items need attention.'}
                </p>
                <Button className="mt-5" variant="outline" onClick={() => void review.refresh()}>
                  {skipped > 0 ? 'Review skipped items' : 'Check again'}
                </Button>
              </div>
            )}

            {review.error && review.overview !== null && (
              <p role="alert" className="mt-3 text-xs text-destructive">{review.error}</p>
            )}
          </section>
        </main>
      }
      drawer={<ContextDrawerOutlet {...contextDrawer} />}
    />
  )
}
