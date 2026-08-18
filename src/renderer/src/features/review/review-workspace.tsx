import { ArrowRight, Check, ChevronRight, MessageSquarePlus, SkipForward } from 'lucide-react'
import type {
  ReviewQueueItemSnapshot,
  TodoParent
} from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { LifecycleStatusLabel } from '@/components/ui/lifecycle-status'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { StateLabel } from '@/components/ui/state-label'
import { TaggedText } from '@/components/ui/tagged-text'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { NoteSplitWorkspace } from '@/features/notes/note-split-workspace'
import {
  reviewItemIsVisible,
  reviewItemModel,
  type ReviewItemModel
} from '@/features/review/review-presenters'
import { useReviewModel } from '@/features/review/use-review-model'
import { WorkKindIcon } from '@/features/shared/work-kind-icon'
import { DirectTodos } from '@/features/todos/direct-todos'
import { useUpdateComposer } from '@/features/updates/update-composer-context'
import { reviewUpdateCommandTarget } from '@/features/updates/update-command-presenters'

interface ReviewWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
  onReviewChanged?: (focusId: number) => void | Promise<void>
}

function reviewTodoContext(item: ReviewQueueItemSnapshot): TodoParent {
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

function ReviewSupportingDetails({
  model
}: {
  model: ReviewItemModel
}): React.JSX.Element | null {
  if (model.commitments.length === 0) return null

  return (
    <div className="space-y-7 border-t border-border/75 px-5 py-6 sm:px-7">
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
  const updateComposer = useUpdateComposer()
  const visibleItems = review.overview?.items.filter((item) =>
    reviewItemIsVisible(item, hideSensitiveContent)) ?? []
  const remainingItems = visibleItems.filter(({ key }) => !review.dismissedKeys.has(key))
  const current = remainingItems[0] ?? null
  const currentModel = current ? reviewItemModel(current, hideSensitiveContent) : null
  const completed = visibleItems.length - remainingItems.length
  const skipped = visibleItems.filter(({ key }) =>
    review.dismissedKeys.has(key) && !review.reviewedKeys.has(key)).length
  const progress = visibleItems.length === 0 ? 100 : (completed / visibleItems.length) * 100
  const pending = current ? review.pendingKey === current.key : false

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
              <NoteSplitWorkspace
                preferenceId="review"
                workspaceLabel="Review"
                noteOwnerLabel={currentModel.kindLabel}
                note={currentModel.defaultNote}
                onNoteContentChange={() => void review.recordNoteMutation(current)}
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
                    <div className="flex min-w-52 flex-1 items-start gap-3">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/75 bg-background/70 shadow-xs">
                        <WorkKindIcon kind={currentModel.kind} className="size-6" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <nav aria-label="Review context">
                            <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[0.6875rem] text-muted-foreground">
                              {currentModel.contextPath.map((segment, index) => (
                                <li key={`${segment}:${index}`} className="flex min-w-0 items-center gap-1">
                                  {index > 0 && (
                                    <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden="true" />
                                  )}
                                  <span className={index === currentModel.contextPath.length - 1
                                    ? 'max-w-72 truncate font-semibold text-foreground'
                                    : 'max-w-56 truncate'}>
                                    <TaggedText value={segment} />
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </nav>
                          <p className="text-[0.6875rem] font-medium text-muted-foreground" aria-live="polite">
                            {remainingItems.length} remaining · {completed} reviewed
                          </p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2.5">
                          <h2 className="min-w-0 text-base font-semibold tracking-[-0.015em]">
                            <TaggedText value={currentModel.title} />
                          </h2>
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
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => review.ignore(current.key)}
                      >
                        <SkipForward aria-hidden="true" />
                        Ignore
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={() => void review.pass(current)}
                      >
                        <ArrowRight aria-hidden="true" />
                        {pending ? 'Passing…' : 'Pass along'}
                      </Button>
                      <Button
                        type="button"
                        disabled={pending}
                        onClick={() => updateComposer.openFor(reviewUpdateCommandTarget(current))}
                        title="Add an Update to this review item"
                      >
                        <MessageSquarePlus aria-hidden="true" />
                        Update
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

                <ReviewUpdates model={currentModel} />
                <ReviewSupportingDetails model={currentModel} />
                  </article>
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
