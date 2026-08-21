import type {
  NavigationPinSnapshot,
  NavigationPinTarget
} from '../../shared/contracts'
import type { SqliteAdapter } from './sqlite-adapter'

interface NavigationPinRow {
  pin_id: number
  focus_id: number | null
  thread_id: number | null
  thread_focus_id: number | null
  title: string
  status: NavigationPinSnapshot['status']
  sensitive: number
  needs_review: number
  ancestor_sensitive: number
  created_at: string
}

function requireTarget(target: NavigationPinTarget): void {
  if (!target || (target.type !== 'focus' && target.type !== 'thread')) {
    throw new Error('A navigation pin target must be a Focus or Thread.')
  }
  if (!Number.isSafeInteger(target.id) || target.id <= 0) {
    throw new Error('A navigation pin requires a positive target id.')
  }
}

/**
 * Durable shell preference for references shown in the primary sidebar.
 *
 * Pins never alter Focuses or Threads. Foreign keys remove references only
 * when their targets are actually deleted; lifecycle and hierarchy changes
 * are resolved from the live target whenever the projection is read.
 */
export class NavigationPinRepository {
  constructor(private readonly database: SqliteAdapter) {}

  list(): NavigationPinSnapshot[] {
    return this.database.all<NavigationPinRow>(`
      SELECT
        pins.id AS pin_id,
        pins.focus_id,
        pins.thread_id,
        threads.focus_id AS thread_focus_id,
        COALESCE(focuses.title, threads.title) AS title,
        COALESCE(focuses.status, threads.status) AS status,
        COALESCE(focuses.sensitive, threads.sensitive) AS sensitive,
        COALESCE(focuses.needs_review, threads.needs_review) AS needs_review,
        COALESCE(thread_focuses.sensitive, 0) AS ancestor_sensitive,
        pins.created_at
      FROM sidebar_navigation_pins pins
      LEFT JOIN focuses ON focuses.id = pins.focus_id
      LEFT JOIN threads ON threads.id = pins.thread_id
      LEFT JOIN focuses thread_focuses ON thread_focuses.id = threads.focus_id
      ORDER BY pins.id
    `).map((row) => {
      const shared = {
        title: row.title,
        status: row.status,
        sensitive: Boolean(row.sensitive),
        needsReview: Boolean(row.needs_review),
        createdAt: row.created_at
      }
      if (row.focus_id !== null) {
        return {
          ...shared,
          target: { type: 'focus', id: Number(row.focus_id) }
        }
      }
      if (row.thread_id === null || row.thread_focus_id === null) {
        throw new Error(`Navigation pin ${row.pin_id} has no live target.`)
      }
      return {
        ...shared,
        target: {
          type: 'thread',
          id: Number(row.thread_id),
          focusId: Number(row.thread_focus_id)
        },
        ancestorSensitive: Boolean(row.ancestor_sensitive)
      }
    })
  }

  set(target: NavigationPinTarget, pinned: boolean, now = new Date()): NavigationPinSnapshot[] {
    requireTarget(target)
    if (typeof pinned !== 'boolean') throw new Error('Pinned must be a boolean.')

    if (!pinned) {
      this.database.run(
        target.type === 'focus'
          ? 'DELETE FROM sidebar_navigation_pins WHERE focus_id = ?'
          : 'DELETE FROM sidebar_navigation_pins WHERE thread_id = ?',
        [target.id]
      )
      return this.list()
    }

    const table = target.type === 'focus' ? 'focuses' : 'threads'
    if (!this.database.get<{ id: number }>(`SELECT id FROM ${table} WHERE id = ?`, [target.id])) {
      throw new Error(`${target.type === 'focus' ? 'Focus' : 'Thread'} ${target.id} does not exist.`)
    }

    const focusId = target.type === 'focus' ? target.id : null
    const threadId = target.type === 'thread' ? target.id : null
    this.database.run(`
      INSERT INTO sidebar_navigation_pins (focus_id, thread_id, created_at)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM sidebar_navigation_pins
        WHERE focus_id IS ? AND thread_id IS ?
      )
    `, [focusId, threadId, now.toISOString(), focusId, threadId])
    return this.list()
  }
}
