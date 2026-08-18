import type {
  FocusOverviewTimelineSnapshot,
  HealthState,
  ThreadStatus
} from '../../shared/contracts'
import { ModelNotFoundError, ModelValidationError } from './model'
import type { SqliteAdapter } from './sqlite-adapter'

interface FocusRow {
  id: number
  sensitive: number
}

interface ThreadRow {
  id: number
  title: string
  status: string
  sensitive: number
}

interface TimelineUpdateRow {
  id: number
  thread_id: number
  recorded_on: string
  observation: string
  state: string
  sensitive: number
  thread_sensitive: number
  commitment_sensitive: number
  source_type: 'thread' | 'commitment'
  source_id: number
  source_title: string
}

/** One receiver-neutral projection for the Focus Overview timeline. */
export class FocusOverviewRepository {
  constructor(private readonly database: SqliteAdapter) {}

  timeline(focusId: number): FocusOverviewTimelineSnapshot {
    if (!Number.isSafeInteger(focusId) || focusId <= 0) {
      throw new ModelValidationError('Focus id must be a positive integer')
    }
    const focus = this.database.get<FocusRow>(
      'SELECT id, sensitive FROM focuses WHERE id = ?',
      [focusId]
    )
    if (!focus) throw new ModelNotFoundError('Focus', focusId)

    const threads = this.database.all<ThreadRow>(
      `SELECT id, title, status, sensitive
       FROM threads WHERE focus_id = ?
       ORDER BY lower(title), id`,
      [focusId]
    )
    const updates = this.database.all<TimelineUpdateRow>(
      `SELECT update_row.id, thread.id AS thread_id, update_row.recorded_on,
              update_row.observation, update_row.state, update_row.sensitive,
              thread.sensitive AS thread_sensitive, 0 AS commitment_sensitive,
              'thread' AS source_type, thread.id AS source_id, thread.title AS source_title
       FROM updates update_row
       JOIN threads thread ON thread.id = update_row.thread_id
       WHERE thread.focus_id = ?
       UNION ALL
       SELECT update_row.id, thread.id AS thread_id, update_row.recorded_on,
              update_row.observation, update_row.state, update_row.sensitive,
              thread.sensitive AS thread_sensitive,
              commitment.sensitive AS commitment_sensitive,
              'commitment' AS source_type, commitment.id AS source_id,
              commitment.title AS source_title
       FROM updates update_row
       JOIN commitments commitment ON commitment.id = update_row.commitment_id
       JOIN threads thread ON thread.id = commitment.thread_id
       WHERE thread.focus_id = ?
         AND commitment.status NOT IN ('done', 'cancelled')
       ORDER BY 3 DESC, 1 DESC`,
      [focusId, focusId]
    )

    return {
      focusId: Number(focus.id),
      threads: threads.map((thread) => ({
        id: Number(thread.id),
        title: thread.title,
        status: thread.status as ThreadStatus,
        sensitive: Boolean(thread.sensitive)
      })),
      updates: updates.map((update) => ({
        id: Number(update.id),
        threadId: Number(update.thread_id),
        date: update.recorded_on,
        observation: update.observation,
        state: update.state as HealthState,
        sensitive: Boolean(update.sensitive),
        effectiveSensitive: Boolean(
          focus.sensitive ||
          update.thread_sensitive ||
          update.commitment_sensitive ||
          update.sensitive
        ),
        source: {
          type: update.source_type,
          id: Number(update.source_id),
          title: update.source_title
        }
      }))
    }
  }
}
