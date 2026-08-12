import type {
  DueWorkItemSnapshot,
  NavigationBadgeCountSnapshot,
  NavigationBadgeOverviewSnapshot,
  ReviewQueueItemSnapshot,
  TodoOverviewItemSnapshot
} from '../../shared/contracts'
import type { SqliteAdapter } from './sqlite-adapter'
import { TodoRepository } from './todo-model'
import { ReviewRepository } from './review-model'
import { DueRepository } from './due-model'

function today(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addCalendarDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function counts<T>(items: readonly T[], isSensitive: (item: T) => boolean): NavigationBadgeCountSnapshot {
  return {
    total: items.length,
    nonSensitive: items.filter((item) => !isSensitive(item)).length
  }
}

function todoIsSensitive(todo: TodoOverviewItemSnapshot): boolean {
  return Boolean(
    todo.focus.sensitive ||
    todo.thread?.sensitive ||
    todo.commitment?.sensitive ||
    todo.subject?.sensitive
  )
}

function reviewIsSensitive(item: ReviewQueueItemSnapshot): boolean {
  return Boolean(
    item.focus.sensitive ||
    item.thread?.sensitive ||
    item.commitment?.sensitive ||
    item.cell?.subject.sensitive
  )
}

function dueIsSensitive(item: DueWorkItemSnapshot): boolean {
  return Boolean(item.focus.sensitive || item.thread?.sensitive || item.commitment?.sensitive)
}

/**
 * Produces bounded counts for global navigation without exposing large
 * aggregate worklists to the application shell.
 */
export class NavigationRepository {
  private readonly todos: TodoRepository
  private readonly reviews: ReviewRepository
  private readonly due: DueRepository

  constructor(database: SqliteAdapter) {
    this.todos = new TodoRepository(database)
    this.reviews = new ReviewRepository(database)
    this.due = new DueRepository(database)
  }

  getBadgeOverview(now = new Date()): NavigationBadgeOverviewSnapshot {
    const asOf = today(now)
    const dueThrough = addCalendarDays(asOf, 7)
    const todoItems = this.todos.overview(now).items.filter((todo) =>
      !todo.done && todo.dueDate !== null && todo.dueDate <= asOf)
    const reviewItems = this.reviews.getOverview(asOf).items
    const dueItems = this.due.getOverview(asOf).items.filter((item) => {
      const status = (item.commitment ?? item.thread ?? item.focus).status
      return status !== 'done' && status !== 'cancelled' && item.dueDate <= dueThrough
    })

    return {
      asOf,
      dueThrough,
      todos: counts(todoItems, todoIsSensitive),
      review: counts(reviewItems, reviewIsSensitive),
      due: counts(dueItems, dueIsSensitive)
    }
  }
}
