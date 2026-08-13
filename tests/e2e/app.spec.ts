import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator
} from '@playwright/test'
import { AppDatabase } from '../../src/main/database'

async function isFullyVisibleInMain(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const itemBounds = element.getBoundingClientRect()
    const mainBounds = element.closest('main')?.getBoundingClientRect()
    if (!mainBounds) return false
    const tolerance = 1
    return (
      itemBounds.top >= mainBounds.top - tolerance &&
      itemBounds.bottom <= mainBounds.bottom + tolerance
    )
  })
}

function localDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

test('badges actionable navigation and decrements Review after persistence', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-navigation-badges-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  const today = localDate()
  const seeded = new AppDatabase(databasePath)
  const focus = seeded.domain.focuses.create({ title: 'Badge launch', dueDate: today })
  seeded.domain.todos.create({
    parent: { type: 'focus', id: focus.id },
    name: 'Badge Todo',
    dueDate: today
  })
  seeded.close()
  let application: ElectronApplication | undefined

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()

    await expect(window.getByRole('button', {
      name: 'Todos, 1 overdue or due today',
      exact: true
    })).toBeVisible()
    await expect(window.getByRole('button', {
      name: 'Review, 1 remaining',
      exact: true
    })).toBeVisible()
    await expect(window.getByRole('button', {
      name: 'Due, 1 overdue or due within seven days',
      exact: true
    })).toBeVisible()

    await window.getByRole('button', { name: 'Review, 1 remaining', exact: true }).click()
    await window.getByRole('button', { name: 'Pass along' }).click()
    await expect(window.getByRole('button', { name: 'Review', exact: true })).toBeVisible()
  } finally {
    await application?.close().catch(() => undefined)
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('creates, attests, versions, and reloads a recurring Routine Run', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-routine-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  const seeded = new AppDatabase(databasePath)
  const focus = seeded.domain.focuses.create({ title: 'Routine portfolio' })
  seeded.domain.threads.create({
    focusId: focus.id,
    title: 'Sprint execution',
    reviewFrequencyDays: 7
  })
  seeded.close()
  let application: ElectronApplication | undefined

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()

    await window.getByRole('button', { name: 'Routine portfolio', exact: true }).click()
    await window.getByRole('button', { name: 'Sprint execution', exact: true }).click()
    const contextualSidebar = window.getByLabel('Contextual sidebar')
    await contextualSidebar.getByRole('button', {
      name: 'Add Routine to Sprint execution'
    }).click()
    const editor = window.getByRole('dialog', { name: 'Add Routine' })
    await editor.getByLabel('Routine name').fill('Weekly delivery inspection')
    await editor.getByRole('button', { name: 'Add Routine' }).click()

    await contextualSidebar.getByRole('button', {
      name: 'Open Sprint execution Routine Weekly delivery inspection'
    }).click()
    await expect(window.getByRole('heading', { name: 'Check-in history' })).toBeVisible()
    await expect(window.getByText(/^Scheduled \d{4}-\d{2}-\d{2}$/)).toBeVisible()
    await window.getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = window.getByRole('dialog', { name: 'Edit Routine' })
    await edit.getByRole('button', { name: 'Add inspection' }).click()
    await edit.getByRole('textbox', { name: 'Inspection 3' })
      .fill('Verify the retrospective was reviewed.')
    await edit.getByRole('button', { name: 'Save Routine' }).click()

    await window.getByRole('button', { name: /^Routines/ }).click()
    await expect(window.getByRole('heading', { name: 'Weekly delivery inspection' })).toBeVisible()

    await expect(window.getByText('0 of 2 attested')).toBeVisible()
    await expect(window.getByText('Template v1')).toBeVisible()
    await expect(window.getByText('Verify the retrospective was reviewed.')).toHaveCount(0)
    await expect(window.getByRole('main').getByText('Current', { exact: true })).toBeVisible()

    await window.getByRole('radio', {
      name: 'Check: Verify delivery risks are represented in the weekly update.'
    }).click()
    await expect(window.getByText('1 of 2 attested')).toBeVisible()

    await window.getByLabel(
      'Optional note for Confirm scope changes received approval.'
    ).fill('Approval record was reviewed')
    await window.getByRole('heading', { name: 'Weekly delivery inspection' }).click()
    await window.waitForTimeout(900)
    await window.getByRole('radio', {
      name: 'Check: Confirm scope changes received approval.'
    }).click()
    await expect(window.getByText('2 of 2 attested')).toBeVisible()
    await window.getByRole('button', { name: 'Finalize check-in' }).click()
    await expect(window.getByText('0 of 3 attested')).toBeVisible()

    await window.getByRole('button', { name: 'Toggle context drawer' }).click()
    const drawer = window.getByRole('complementary', {
      name: 'Weekly delivery inspection Routine context drawer'
    })
    await expect(drawer.getByText('Included')).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Edit future checklist' })).toHaveCount(0)
    await expect(window.getByText('Template v2')).toBeVisible()
    await expect(window.getByText('Verify the retrospective was reviewed.')).toBeVisible()

    await window.getByRole('button', {
      name: /Routine portfolio \/ Sprint execution/
    }).click()
    await contextualSidebar.getByRole('button', {
      name: 'Open Sprint execution Routine Weekly delivery inspection'
    }).click()
    await expect(window.getByLabel(
      'Recorded note for Confirm scope changes received approval.'
    )).toContainText('Approval record was reviewed')
    await expect(window.getByLabel(
      'Optional note for Confirm scope changes received approval.'
    )).toHaveCount(0)

    const stored = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(stored.prepare(
        `SELECT behavior_type, title FROM commitments WHERE id IN (
           SELECT commitment_id FROM routine_definitions
         )`
      ).get()).toMatchObject({
        behavior_type: 'routine',
        title: 'Weekly delivery inspection'
      })
      expect(stored.prepare(
        'SELECT current_template_version FROM routine_definitions'
      ).get()).toMatchObject({ current_template_version: 2 })
      expect(stored.prepare(
        `SELECT count(*) AS count FROM routine_review_cell_attestations
         WHERE resolution <> 'pending'`
      ).get()).toMatchObject({ count: 2 })
      const note = stored.prepare(
        `SELECT attestation.note
         FROM routine_review_cell_attestations attestation
         JOIN routine_review_run_items item ON item.id = attestation.run_item_id
         WHERE item.inspection = ?`
      ).get('Confirm scope changes received approval.') as { note?: string } | undefined
      expect(note?.note).toContain('Approval record was reviewed')
    } finally {
      stored.close()
    }

    await application.close()
    application = undefined
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const reloaded = await application.firstWindow()
    await reloaded.getByRole('button', { name: /^Routines/ }).click()
    await expect(reloaded.getByRole('heading', {
      name: 'Weekly delivery inspection'
    })).toBeVisible()
    await expect(reloaded.getByText('0 of 3 attested')).toBeVisible()
    await expect(reloaded.getByText('Template v2')).toBeVisible()
  } finally {
    await application?.close().catch(() => undefined)
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('opens and closes multiple main windows through the New Window menu', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-multi-window-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  let application: ElectronApplication | undefined

  function storedWindowSize(): { width: number; height: number } | null {
    if (!existsSync(databasePath)) return null
    const stored = new DatabaseSync(databasePath, { readOnly: true })
    try {
      return stored.prepare(
        'SELECT width, height FROM app_window_preferences WHERE singleton = 1'
      ).get() as { width: number; height: number } | undefined ?? null
    } finally {
      stored.close()
    }
  }

  async function createNewWindow(): Promise<void> {
    await application?.evaluate(({ BrowserWindow, Menu }) => {
      const menuItem = Menu.getApplicationMenu()?.getMenuItemById('new-window')
      if (!menuItem) throw new Error('Missing New Window menu item')
      // Supply the same arguments Electron supplies for Cmd+N. These objects are
      // intentionally not structured-cloneable and must stay at the menu boundary.
      menuItem.click?.(menuItem, BrowserWindow.getFocusedWindow() ?? undefined, {} as never)
    })
  }

  async function mainWindowSizes(): Promise<Array<{ id: number; width: number; height: number }>> {
    return application?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .sort((left, right) => left.id - right.id)
        .map((window) => {
          const [width, height] = window.getSize()
          return { id: window.id, width, height }
        })
    ) ?? []
  }

  async function allWindowsHaveSpellcheck(): Promise<boolean> {
    return application?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every((window) =>
        window.webContents.session.isSpellCheckerEnabled())) ?? false
  }

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })

    const firstWindow = await application.firstWindow()
    await expect(firstWindow.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    expect(await allWindowsHaveSpellcheck()).toBe(true)

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1180, 700)
    })
    await expect.poll(storedWindowSize).toMatchObject({ width: 1180, height: 700 })

    await createNewWindow()
    await expect.poll(() => application?.windows().length).toBe(2)
    const secondWindow = application.windows().find((window) => window !== firstWindow)
    if (!secondWindow) throw new Error('New Window did not create a second main window')
    await expect(secondWindow.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    expect(await allWindowsHaveSpellcheck()).toBe(true)
    expect((await mainWindowSizes()).map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 1180, height: 700 },
      { width: 1180, height: 700 }
    ])

    await application.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().sort((left, right) => left.id - right.id)
      windows[0]?.setSize(1160, 680)
    })
    await expect.poll(storedWindowSize).toMatchObject({ width: 1160, height: 680 })
    await application.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().sort((left, right) => left.id - right.id)
      windows[1]?.setSize(1100, 640)
    })
    await expect.poll(storedWindowSize).toMatchObject({ width: 1100, height: 640 })
    expect((await mainWindowSizes()).map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 1160, height: 680 },
      { width: 1100, height: 640 }
    ])

    await createNewWindow()
    await expect.poll(() => application?.windows().length).toBe(3)
    expect((await mainWindowSizes()).map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 1160, height: 680 },
      { width: 1100, height: 640 },
      { width: 1100, height: 640 }
    ])

    await secondWindow.close()
    await expect.poll(() => application?.windows().length).toBe(2)
    await expect(firstWindow.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()

    await application.close()
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const restoredWindow = await application.firstWindow()
    await expect(restoredWindow.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    expect(await allWindowsHaveSpellcheck()).toBe(true)
    expect((await mainWindowSizes()).map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 1100, height: 640 }
    ])
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('sorts all current Todos and bounds recently completed work before rendering', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-todo-overview-e2e-'))
  let application: ElectronApplication | undefined
  const now = new Date()
  const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)

  const seed = new AppDatabase(join(userDataDirectory, 'onmove.sqlite3'))
  const zulu = seed.domain.focuses.create({ title: 'Zulu Project' })
  const alpha = seed.domain.focuses.create({ title: 'Alpha Project' })
  const alphaThread = seed.domain.threads.create({
    focusId: alpha.id,
    title: 'Sprint execution',
    reviewFrequencyDays: 7
  })
  const zuluTodo = seed.domain.todos.create({
    parent: { type: 'focus', id: zulu.id },
    name: 'Zulu open work'
  }, now)
  const alphaTodo = seed.domain.todos.create({
    parent: { type: 'focus', id: alpha.id },
    name: 'Alpha open work'
  }, now)
  seed.domain.todos.create({
    parent: { type: 'thread', id: alphaThread.id },
    name: 'Review sprint execution'
  }, now)
  seed.domain.todos.create({
    parent: { type: 'focus', id: alpha.id },
    name: 'Recently closed work',
    done: true
  }, recent)
  seed.domain.todos.create({
    parent: { type: 'focus', id: alpha.id },
    name: 'Old closed work',
    done: true
  }, old)
  seed.close()

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()
    const table = window.getByRole('table', { name: 'All Todos' })

    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    await expect(table.getByText('Alpha open work')).toBeVisible()
    await expect(table.getByText('Zulu open work')).toBeVisible()
    await expect(table.getByText('Review sprint execution')).toBeVisible()
    await expect(table.getByText('Recently closed work')).toHaveCount(0)
    await expect(table.getByText('Old closed work')).toHaveCount(0)

    await table.getByRole('button', { name: 'Sort by Project' }).click()
    await expect(table.locator('tbody tr').first()).toContainText('Alpha Project')
    await table.getByLabel('Mark Alpha open work done').click()
    await expect(table.getByText('Alpha open work')).toHaveCount(0)
    await expect.poll(() => {
      const stored = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
        readOnly: true
      })
      const row = stored.prepare(
        'SELECT done, completed_at AS completedAt FROM todos WHERE id = ?'
      ).get(alphaTodo.id) as { done: number; completedAt: string | null }
      stored.close()
      return row
    }).toMatchObject({ done: 1, completedAt: expect.any(String) })

    await window.getByLabel('Show completed from last 7 days').click()
    await expect(table.getByText('Alpha open work')).toBeVisible()
    await expect(table.getByText('Recently closed work')).toBeVisible()
    await expect(table.getByText('Old closed work')).toHaveCount(0)
    await expect(table.getByText('Zulu open work')).toBeVisible()
    expect(zuluTodo.done).toBe(false)

    await table.getByRole('link', { name: 'Sprint execution' }).click()
    await expect(window.getByRole('heading', { name: 'Sprint execution', exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Alpha Project' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(window.getByRole('button', {
      name: 'Sprint execution',
      exact: true
    })).toHaveAttribute(
      'aria-current',
      'page'
    )
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('shows cascade-rescued Updates read-only in Archive and permanently deletes them', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-update-archive-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  let application: ElectronApplication | undefined

  const seed = new AppDatabase(databasePath)
  const focus = seed.domain.focuses.create({ title: 'Project Atlas' })
  const thread = seed.domain.threads.create({
    focusId: focus.id,
    title: 'Sprint execution',
    reviewFrequencyDays: 7
  })
  const commitment = seed.domain.commitments.create({
    parent: { type: 'thread', id: thread.id },
    type: 'tracking',
    title: 'Improve ticket quality'
  })
  seed.domain.updates.create({
    parent: { type: 'commitment', id: commitment.id },
    date: localDate(),
    observation: 'Archived delivery evidence.',
    state: 'yellow'
  })
  seed.domain.focuses.delete(focus.id)
  seed.close()

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()
    await window.getByRole('button', { name: 'Archive', exact: true }).click()

    await expect(window.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible()
    const archived = window.getByRole('listitem', {
      name: 'Archived update in Project Atlas › Sprint execution › Improve ticket quality'
    })
    await expect(archived).toContainText('Archived delivery evidence.')
    await expect(archived).toContainText('Yellow')
    await expect(archived.getByLabel(`Archived update observation from ${localDate()}`))
      .toHaveAttribute('contenteditable', 'false')
    await expect(archived.getByLabel('Update date')).toHaveCount(0)

    await archived.getByRole('button', { name: /Permanently delete archived update/ }).click()
    await window.getByRole('button', { name: 'Delete permanently' }).click()
    await expect(window.getByText('No deleted updates from the last 30 days.')).toBeVisible()
    await expect.poll(() => {
      const stored = new DatabaseSync(databasePath, { readOnly: true })
      try {
        return stored.prepare('SELECT count(*) AS count FROM archived_updates').get()
      } finally {
        stored.close()
      }
    }).toMatchObject({ count: 0 })
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('operates every explicit hierarchy deadline from the global Due worklist', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-due-work-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  let application: ElectronApplication | undefined

  const seed = new AppDatabase(databasePath)
  const focus = seed.domain.focuses.create({
    title: 'Project Atlas',
    dueDate: '2099-01-10'
  })
  const thread = seed.domain.threads.create({
    focusId: focus.id,
    title: 'Sprint execution',
    reviewFrequencyDays: 7,
    dueDate: '2099-01-05'
  })
  const commitment = seed.domain.commitments.create({
    parent: { type: 'thread', id: thread.id },
    type: 'tracking',
    title: 'Improve ticket quality',
    dueDate: '2099-01-12'
  })
  seed.domain.commitments.create({
    parent: { type: 'thread', id: thread.id },
    type: 'tracking',
    title: 'Undated expectation'
  })
  seed.close()

  async function launch(): Promise<ElectronApplication> {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    return electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
  }

  function storedDeadlines(): {
    focusDue: string | null
    threadDue: string | null
    commitmentStatus: string
  } {
    const stored = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const focusRow = stored.prepare('SELECT due_on AS dueDate FROM focuses WHERE id = ?')
        .get(focus.id) as { dueDate: string | null }
      const threadRow = stored.prepare('SELECT due_on AS dueDate FROM threads WHERE id = ?')
        .get(thread.id) as { dueDate: string | null }
      const commitmentRow = stored.prepare('SELECT status FROM commitments WHERE id = ?')
        .get(commitment.id) as { status: string }
      return {
        focusDue: focusRow.dueDate,
        threadDue: threadRow.dueDate,
        commitmentStatus: commitmentRow.status
      }
    } finally {
      stored.close()
    }
  }

  try {
    application = await launch()
    let window = await application.firstWindow()
    await window.getByRole('button', { name: 'Due', exact: true }).click()

    const table = window.getByRole('table', { name: 'Due work' })
    await expect(window.getByRole('heading', { name: 'Due', exact: true })).toBeVisible()
    await expect(table.locator(`[data-due-item="focus:${focus.id}"]`)
      .getByText('Project Atlas', { exact: true })).toBeVisible()
    await expect(table.locator(`[data-due-item="thread:${thread.id}"]`)
      .getByText('Sprint execution', { exact: true })).toBeVisible()
    await expect(table.locator(`[data-due-item="commitment:${commitment.id}"]`)
      .getByText('Improve ticket quality', { exact: true })).toBeVisible()
    await expect(table.getByText('Undated expectation')).toHaveCount(0)
    await expect(table.getByLabel(
      'Due date 2099-01-12 is after the parent Thread due date 2099-01-05.'
    )).toBeVisible()

    const threadRow = table.locator(`[data-due-item="thread:${thread.id}"]`)
    await threadRow.getByLabel('Thread due date', { exact: true }).fill('2099-01-11')
    const commitmentRow = table.locator(`[data-due-item="commitment:${commitment.id}"]`)
    await commitmentRow.getByLabel('Commitment Improve ticket quality status')
      .selectOption('paused')
    const focusRow = table.locator(`[data-due-item="focus:${focus.id}"]`)
    await focusRow.getByLabel('Focus due date', { exact: true }).fill('')

    await expect.poll(storedDeadlines).toEqual({
      focusDue: null,
      threadDue: '2099-01-11',
      commitmentStatus: 'paused'
    })
    await expect(table.locator('[data-due-item="focus:' + focus.id + '"]')).toHaveCount(0)

    await commitmentRow.getByRole('link', {
      name: 'Open Commitment Improve ticket quality in Project Atlas › Sprint execution'
    }).click()
    await expect(window.getByRole('heading', { name: 'Improve ticket quality' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Project Atlas' }))
      .toHaveAttribute('aria-current', 'page')

    await window.getByRole('button', { name: 'Due', exact: true }).click()
    await window.getByLabel('Hide paused').check()
    await expect(window.getByRole('table', { name: 'Due work' }).getByText(
      'Improve ticket quality',
      { exact: true }
    )).toHaveCount(0)
    await expect(window.getByText('1 dated item')).toBeVisible()

    await application.close()
    application = await launch()
    window = await application.firstWindow()
    await window.getByRole('button', { name: 'Due', exact: true }).click()
    await expect(window.getByLabel('Hide paused')).toBeChecked()
    await expect(window.getByRole('table', { name: 'Due work' }).getByText(
      'Improve ticket quality',
      { exact: true }
    )).toHaveCount(0)
    await expect(window.getByText('1 dated item')).toBeVisible()
    await window.getByLabel('Hide paused').uncheck()
    await expect(window.getByRole('table', { name: 'Due work' }).getByText(
      'Improve ticket quality',
      { exact: true }
    )).toBeVisible()
    await expect(window.getByText('2 dated items')).toBeVisible()
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('jumps to hierarchy records, all persisted Todos, and Tags through Cmd-K', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-command-palette-e2e-'))
  let application: ElectronApplication | undefined
  const seed = new AppDatabase(join(userDataDirectory, 'onmove.sqlite3'))
  const project = seed.domain.focuses.create({ title: 'Project Beacon' })
  const sprint = seed.domain.threads.create({
    focusId: project.id,
    title: 'Sprint execution',
    reviewFrequencyDays: 7
  })
  seed.domain.commitments.create({
    parent: { type: 'thread', id: sprint.id },
    type: 'tracking',
    title: 'Improve ticket quality'
  })
  const oldCompletionDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  seed.domain.todos.create({
    parent: { type: 'focus', id: project.id },
    name: 'Confirm @launch brief',
    done: true
  }, oldCompletionDate)
  seed.close()

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()

    await window.keyboard.press('Meta+K')
    let palette = window.getByRole('dialog', { name: 'Jump to anything' })
    await expect(palette).toBeVisible()
    await expect(palette.getByRole('option', { name: /^Project Beacon/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /^Sprint execution/ })).toBeVisible()
    await palette.getByRole('combobox').fill('ticket quality')
    await palette.getByRole('option', { name: /^Improve ticket quality/ }).click()
    await expect(window.getByRole('heading', {
      name: 'Improve ticket quality',
      exact: true
    })).toBeVisible()
    await expect(window.getByRole('button', {
      name: 'Open Sprint execution commitment Improve ticket quality'
    })).toHaveAttribute('aria-current', 'page')

    await window.keyboard.press('Meta+K')
    palette = window.getByRole('dialog', { name: 'Jump to anything' })
    await palette.getByRole('combobox').fill('Confirm launch brief')
    await palette.getByRole('option', { name: /^Confirm @launch brief/ }).click()
    await expect(window.getByRole('button', { name: 'Overall', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(window.getByRole('textbox', { name: 'Todo name', exact: true })).toHaveValue(
      'Confirm @launch brief'
    )

    await window.keyboard.press('Meta+K')
    palette = window.getByRole('dialog', { name: 'Jump to anything' })
    await palette.getByRole('combobox').fill('@launch')
    await palette.getByRole('option', { name: /^@launch/ }).click()
    await expect(window.getByRole('heading', { name: '@launch', exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: '@launch' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('reviews active work before cadence is due and refreshes typed pokes in the workspace', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-review-e2e-'))
  let application: ElectronApplication | undefined
  const createdAt = new Date()
  const reviewDate = [
    createdAt.getFullYear(),
    String(createdAt.getMonth() + 1).padStart(2, '0'),
    String(createdAt.getDate()).padStart(2, '0')
  ].join('-')
  const seed = new AppDatabase(join(userDataDirectory, 'onmove.sqlite3'))
  const currentFocus = seed.domain.focuses.create({
    title: 'Project Atlas',
    needsReview: false
  })
  const currentThread = seed.domain.threads.create({
    focusId: currentFocus.id,
    title: 'Sprint execution',
    reviewFrequencyDays: 30
  }, createdAt)
  const currentThreadNote = currentThread.snapshot().notes[0]
  const threadScope = seed.domain.threadScopes.addSubject(
    currentThread.id,
    { name: 'North region' },
    createdAt
  )
  const reviewSubject = threadScope.subjects[0]
  const currentCommitment = seed.domain.commitments.create({
    parent: { type: 'thread', id: currentThread.id },
    type: 'tracking',
    title: 'Improve ticket quality'
  }, createdAt)
  seed.close()

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    let window = await application.firstWindow()

    await window.getByRole('button', { name: 'Review' }).click()
    await expect(window.getByRole('heading', { name: 'Review', exact: true })).toBeAttached()
    await expect(window.getByLabel('Contextual sidebar')).toHaveCount(0)
    await expect(window.getByRole('article', {
      name: 'Thread review: Sprint execution'
    })).toBeVisible()
    await expect(window.getByRole('img', { name: 'Thread type' })).toBeVisible()
    await expect(window.getByRole('navigation', { name: 'Review context' })).toContainText(
      'Project Atlas'
    )
    await expect(window.getByRole('navigation', { name: 'Review context' })).toContainText(
      'Sprint execution'
    )
    await expect(window.getByText('Subject · North region')).toBeVisible()
    const reviewDivider = window.getByRole('separator', {
      name: 'Resize review and note panes'
    })
    await expect(reviewDivider).toHaveAttribute('aria-orientation', 'horizontal')
    await expect(reviewDivider).toHaveAttribute('aria-valuenow', '62')
    await reviewDivider.focus()
    await window.keyboard.press('ArrowDown')
    await expect(reviewDivider).toHaveAttribute('aria-valuenow', '67')
    await window.getByRole('button', { name: 'Todos', exact: true }).click()
    await window.getByRole('button', { name: /Review/ }).click()
    await expect(window.getByRole('separator', {
      name: 'Resize review and note panes'
    })).toHaveAttribute('aria-valuenow', '67')
    const reviewNote = window.getByRole('textbox', { name: 'Default note' })
    await reviewNote.fill('Regional review working notes')
    await expect(window.getByRole('article', {
      name: 'Thread review: Sprint execution'
    })).toBeVisible()
    await expect.poll(() => {
      const stored = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
        readOnly: true
      })
      const noteRow = stored.prepare(
        'SELECT content FROM notes WHERE id = ?'
      ).get(currentThreadNote.id) as { content: string } | undefined
      const threadReview = stored.prepare(
        `SELECT reviewed_on AS reviewedOn FROM thread_review_cell_pokes
         WHERE thread_id = ? AND scope_id = ? AND subject_id = ?`
      ).get(
        currentThread.id,
        threadScope.scopeId,
        reviewSubject.id
      ) as { reviewedOn: string } | undefined
      stored.close()
      return { noteContent: noteRow?.content, threadReview }
    }).toMatchObject({
      noteContent: expect.stringContaining('Regional review working notes'),
      threadReview: { reviewedOn: reviewDate }
    })

    await window.getByRole('textbox', { name: 'New Todo name' }).fill('Confirm regional owner')
    await window.getByRole('button', { name: 'Add Todo' }).click()
    const reviewTodoName = window.getByRole('textbox', { name: 'Todo name', exact: true })
    await expect(reviewTodoName).toHaveValue('Confirm regional owner')
    await reviewTodoName.fill('Confirm regional DRI')
    await reviewTodoName.press('Tab')
    await expect.poll(() => {
      const stored = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
        readOnly: true
      })
      const threadReview = stored.prepare(
        `SELECT reviewed_on AS reviewedOn FROM thread_review_cell_pokes
         WHERE thread_id = ? AND scope_id = ? AND subject_id = ?`
      ).get(
        currentThread.id,
        threadScope.scopeId,
        reviewSubject.id
      ) as { reviewedOn: string } | undefined
      const todoRow = stored.prepare(
        `SELECT name, scope_id AS scopeId, subject_id AS subjectId FROM todos
         WHERE thread_id = ?`
      ).get(currentThread.id) as {
        name: string
        scopeId: number
        subjectId: number
      } | undefined
      stored.close()
      return { threadReview, todoRow }
    }).toMatchObject({
      threadReview: { reviewedOn: reviewDate },
      todoRow: {
        name: 'Confirm regional DRI',
        scopeId: threadScope.scopeId,
        subjectId: reviewSubject.id
      }
    })

    await window.getByRole('button', { name: 'Pass along' }).click()
    await expect(window.getByRole('article', {
      name: 'Commitment review: Improve ticket quality'
    })).toBeVisible()
    const commitmentReview = window.getByRole('article', {
      name: 'Commitment review: Improve ticket quality'
    })
    const actionBar = commitmentReview.getByRole('toolbar', { name: 'Review actions' })
    const todoSection = commitmentReview.locator('[aria-label="commitment Todos"]')
    const updatesSection = commitmentReview.getByRole('heading', { name: 'Recent updates' })
      .locator('xpath=..')
    await expect(actionBar).toBeVisible()
    expect(await actionBar.evaluate((bar, todo) => Boolean(
      bar.compareDocumentPosition(todo as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    ), await todoSection.elementHandle())).toBe(true)

    await window.keyboard.press('Meta+p')
    const chooser = window.getByRole('dialog', { name: 'Choose update target' })
    await chooser.getByRole('option', { name: /^Improve ticket quality/ }).click()
    let composer = window.getByRole('dialog', { name: 'Add update' })
    await expect(composer).toContainText('North region')
    await expect(composer.getByRole('button', { name: /Delete/ })).toHaveCount(0)
    await expect(composer.getByRole('button', {
      name: 'Open Update observation in new window'
    })).toHaveCount(0)
    await composer.getByRole('button', { name: 'Cancel' }).click()
    await expect(composer).toBeHidden()
    await expect(window.getByRole('button', { name: 'Update' })).toBeEnabled()
    expect(updatesSection).toBeTruthy()

    await window.getByRole('button', { name: 'Update' }).click()
    await expect(window.getByRole('dialog', { name: 'Choose update target' })).toBeHidden()
    composer = window.getByRole('dialog', { name: 'Add update' })
    await expect(composer).toContainText('Improve ticket quality')
    await expect(composer).toContainText('North region')
    const observation = composer.getByRole('textbox', { name: 'Update observation' })
    await observation.fill('Ticket examples are now included')
    await composer.getByRole('button', { name: 'Add update' }).click()
    await expect(window.getByRole('heading', { name: 'You’re caught up' })).toBeVisible()

    await expect.poll(() => {
      const stored = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
        readOnly: true
      })
      const threadReview = stored.prepare(
        `SELECT reviewed_on AS reviewedOn FROM thread_review_cell_pokes
         WHERE thread_id = ? AND scope_id = ? AND subject_id = ?`
      ).get(
        currentThread.id,
        threadScope.scopeId,
        reviewSubject.id
      ) as { reviewedOn: string } | undefined
      const updateRow = stored.prepare(
        `SELECT observation, commitment_id AS commitmentId FROM updates
         WHERE commitment_id = ? ORDER BY id DESC LIMIT 1`
      ).get(currentCommitment.id) as { observation: string; commitmentId: number } | undefined
      stored.close()
      return { threadReview, updateRow }
    }).toMatchObject({
      threadReview: { reviewedOn: reviewDate },
      updateRow: {
        commitmentId: currentCommitment.id,
        observation: expect.stringContaining('Ticket examples are now included')
      }
    })

    await window.getByRole('button', { name: 'Project Atlas', exact: true }).click()
    await window.getByRole('button', { name: 'Sprint execution', exact: true }).click()
    await expect(window.getByLabel('Thread last reviewed')).toContainText(
      `Last reviewed · ${reviewDate}`
    )

    await application.close()
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    window = await application.firstWindow()
    await window.getByRole('button', { name: 'Review' }).click()
    await expect(window.getByRole('heading', { name: 'You’re caught up' })).toBeVisible()
    await expect(window.getByText('No new items need attention.')).toBeVisible()
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('persists and visually restores text tags in compact and rich-text fields', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-text-tags-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  let application: ElectronApplication | undefined

  const seed = new AppDatabase(databasePath)
  const focus = seed.domain.focuses.create({ title: 'Project @Atlas2' })
  const todo = seed.domain.todos.create({
    parent: { type: 'focus', id: focus.id },
    name: 'Coordinate @Launch2 readiness'
  })
  seed.close()

  async function launch(): Promise<ElectronApplication> {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    return electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
  }

  function storedText(): { title: string; todo: string; goal: string } {
    const stored = new DatabaseSync(databasePath, { readOnly: true })
    const focusRow = stored.prepare('SELECT title, goal FROM focuses WHERE id = ?')
      .get(focus.id) as { title: string; goal: string }
    const todoRow = stored.prepare('SELECT name FROM todos WHERE id = ?')
      .get(todo.id) as { name: string }
    stored.close()
    return { title: focusRow.title, todo: todoRow.name, goal: focusRow.goal }
  }

  try {
    application = await launch()
    let window = await application.firstWindow()
    await expect(window.getByText('@Launch2', { exact: true }).first()).toHaveAttribute(
      'data-text-tag',
      'true'
    )
    await window.getByRole('button', { name: 'Project @Atlas2', exact: true }).click()
    await expect(window.getByText('@Atlas2', { exact: true }).first()).toHaveAttribute(
      'data-text-tag',
      'true'
    )

    const goal = window.getByLabel('Goal')
    await goal.fill('Review @Launch2 and revisit @LAUNCH2')
    await expect(goal.getByText('@Launch2', { exact: true }))
      .toHaveAttribute('data-text-tag', 'true')
    await expect.poll(() => storedText().goal).toContain('"type":"tag"')

    await application.close()
    application = await launch()
    window = await application.firstWindow()
    await window.getByRole('button', { name: 'Project @Atlas2', exact: true }).click()
    await expect(window.getByLabel('Goal').getByText('@Launch2', { exact: true }))
      .toHaveAttribute('data-text-tag', 'true')
    expect(storedText()).toMatchObject({
      title: 'Project @Atlas2',
      todo: 'Coordinate @Launch2 readiness',
      goal: expect.stringContaining('"type":"tag"')
    })

    await window.getByRole('button', { name: 'Tags', exact: true }).click()
    await expect(window.getByRole('complementary', { name: 'Contextual sidebar' })).toBeVisible()
    await expect(window.getByRole('button', { name: '@atlas2', exact: true })).toBeVisible()
    await window.getByRole('button', { name: '@launch2', exact: true }).click()
    const uses = window.getByRole('table', { name: 'Uses of @launch2' })
    await expect(uses.locator('tbody tr')).toHaveCount(2)
    await expect(uses).toContainText('Coordinate @Launch2 readiness')
    await expect(uses).toContainText('Review @Launch2 and revisit @LAUNCH2')
    await expect(uses).not.toContainText('onmove-rich-text:1:')

    const goalUse = uses.locator('tbody tr').filter({ hasText: 'Review @Launch2' })
    await goalUse.getByRole('link').click()
    await expect(window.getByRole('heading', { name: 'Project @Atlas2' })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Overall', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('creates, edits, reloads, and deletes a persisted focus across Electron launches', async () => {
  test.setTimeout(60_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-e2e-'))
  let application: ElectronApplication | undefined

  async function launch(): Promise<ElectronApplication> {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    return electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
  }

  function launchCount(): number {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare("SELECT count(*) AS count FROM app_events WHERE kind = 'launch'")
      .get() as { count: number }
    database.close()
    return Number(row.count)
  }

  function storedFocus(): {
    title: string
    description: string | null
    goal: string
    status: string
    dueDate: string | null
    needsReview: number
    sensitive: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT title, description, goal, status, due_on AS dueDate, needs_review AS needsReview, sensitive FROM focuses ORDER BY id LIMIT 1'
      )
      .get() as {
        title: string
        description: string | null
        goal: string
        status: string
        dueDate: string | null
        needsReview: number
        sensitive: number
      } | undefined
    database.close()
    return row
  }

  function storedFocusDefaultNote(): { content: string; revision: number } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database.prepare(
      `SELECT note.content, note.content_revision AS revision
       FROM notes note
       JOIN focuses focus ON focus.id = note.focus_id
       WHERE note.title = 'Default'
       ORDER BY note.id LIMIT 1`
    ).get() as { content: string; revision: number } | undefined
    database.close()
    return row ? { content: row.content, revision: Number(row.revision) } : undefined
  }

  function storedThread(): {
    title: string
    reviewFrequencyDays: number
    needsReview: number
    status: string
    dueDate: string | null
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT title, review_frequency_days AS reviewFrequencyDays, needs_review AS needsReview, status, due_on AS dueDate FROM threads ORDER BY id LIMIT 1'
      )
      .get() as {
        title: string
        reviewFrequencyDays: number
        needsReview: number
        status: string
        dueDate: string | null
      } | undefined
    database.close()
    return row
  }

  function storedThreadCommitment(): {
    title: string
    threadId: number
    type: string
    legacyDueType: string
    status: string
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        `SELECT title, thread_id AS threadId, commitment_type AS type,
                legacy_due_type AS legacyDueType, status
         FROM commitments WHERE thread_id IS NOT NULL ORDER BY id LIMIT 1`
      )
      .get() as {
        title: string
        threadId: number
        type: string
        legacyDueType: string
        status: string
      } | undefined
    database.close()
    return row
  }

  function storedThreadUpdate(): {
    date: string
    observation: string
    state: string
    threadId: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT recorded_on AS date, observation, state, thread_id AS threadId FROM updates WHERE thread_id IS NOT NULL ORDER BY id LIMIT 1'
      )
      .get() as {
        date: string
        observation: string
        state: string
        threadId: number
      } | undefined
    database.close()
    return row
  }

  function storedScopedThreadUpdate(): {
    observation: string
    state: string
    scopeId: number
    subjectId: number
    subjectName: string
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        `SELECT u.observation, u.state, u.scope_id AS scopeId,
                u.subject_id AS subjectId, s.name AS subjectName
         FROM updates u
         JOIN subjects s ON s.id = u.subject_id
         WHERE u.thread_id IS NOT NULL AND u.scope_id IS NOT NULL
         ORDER BY u.id DESC LIMIT 1`
      )
      .get() as {
        observation: string
        state: string
        scopeId: number
        subjectId: number
        subjectName: string
      } | undefined
    database.close()
    return row
  }

  function storedScopedCommitmentUpdate(): {
    observation: string
    state: string
    scopeId: number
    subjectId: number
    subjectName: string
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        `SELECT u.observation, u.state, u.scope_id AS scopeId,
                u.subject_id AS subjectId, s.name AS subjectName
         FROM updates u
         JOIN subjects s ON s.id = u.subject_id
         WHERE u.commitment_id IS NOT NULL AND u.scope_id IS NOT NULL
         ORDER BY u.id DESC LIMIT 1`
      )
      .get() as {
        observation: string
        state: string
        scopeId: number
        subjectId: number
        subjectName: string
      } | undefined
    database.close()
    return row
  }

  function storedCommitment(): {
    title: string
    focusId: number
    type: string
    legacyDueType: string
    status: string
    dueDate: string | null
    reviewFrequencyDays: number
    needsReview: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        `SELECT title, focus_id AS focusId, commitment_type AS type,
                legacy_due_type AS legacyDueType, status,
                due_on AS dueDate, review_frequency_days AS reviewFrequencyDays,
                needs_review AS needsReview
         FROM commitments WHERE focus_id IS NOT NULL ORDER BY id LIMIT 1`
      )
      .get() as {
        title: string
        focusId: number
        type: string
        legacyDueType: string
        status: string
        dueDate: string | null
        reviewFrequencyDays: number
        needsReview: number
      } | undefined
    database.close()
    return row
  }

  function storedCommitmentUpdate(): {
    date: string
    observation: string
    state: string
    commitmentId: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT recorded_on AS date, observation, state, commitment_id AS commitmentId FROM updates WHERE commitment_id IS NOT NULL ORDER BY id LIMIT 1'
      )
      .get() as {
        date: string
        observation: string
        state: string
        commitmentId: number
      } | undefined
    database.close()
    return row
  }

  function latestCommitmentTransition(): string | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT to_status AS status FROM commitment_status_transitions ORDER BY id DESC LIMIT 1'
      )
      .get() as { status: string } | undefined
    database.close()
    return row?.status
  }

  function storedFocusUpdate(): {
    date: string
    observation: string
    state: string
    focusId: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT recorded_on AS date, observation, state, focus_id AS focusId FROM updates WHERE focus_id IS NOT NULL ORDER BY id LIMIT 1'
      )
      .get() as {
        date: string
        observation: string
        state: string
        focusId: number
      } | undefined
    database.close()
    return row
  }

  function storedFocusSubjectNames(): string[] {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const now = new Date()
    const on = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-')
    const rows = database.prepare(
      `SELECT subject.name, membership.effect
       FROM focus_scope_applications application
       JOIN scope_memberships membership ON membership.scope_id = application.scope_id
       JOIN subjects subject ON subject.id = membership.subject_id
       WHERE membership.effective_from <= ?
         AND (membership.effective_until IS NULL OR membership.effective_until > ?)
       ORDER BY membership.id`
    ).all(on, on) as { name: string; effect: 'include' | 'exclude' }[]
    database.close()
    const names = new Set<string>()
    for (const row of rows) {
      if (row.effect === 'include') names.add(row.name)
      else names.delete(row.name)
    }
    return [...names].sort()
  }

  function storedThreadScopeState(): {
    mode: string
    transitionCount: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database.prepare(
      `SELECT application.mode,
              (SELECT count(*) FROM scope_application_transitions transition
               WHERE transition.thread_id = application.thread_id) AS transitionCount
       FROM thread_scope_applications application
       ORDER BY application.thread_id LIMIT 1`
    ).get() as { mode: string; transitionCount: number } | undefined
    database.close()
    return row ? { mode: row.mode, transitionCount: Number(row.transitionCount) } : undefined
  }

  try {
    application = await launch()
    let window = await application.firstWindow()
    await expect.poll(() => application?.evaluate(({ Menu }) => ({
      importLabel: Menu.getApplicationMenu()?.getMenuItemById('import-data')?.label,
      exportLabel: Menu.getApplicationMenu()?.getMenuItemById('export-data')?.label
    }))).toEqual({ importLabel: 'Import Data…', exportLabel: 'Export Data…' })
    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    await expect(window.getByRole('toolbar', { name: 'Application toolbar' })).toBeVisible()
    await expect(window.getByText('Placeholder')).toHaveCount(0)
    await expect(window.getByText('Overview')).toHaveCount(0)
    await expect(window.getByText('Focuses', { exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'New focus' }).click()
    await window.getByLabel(/^Title/).fill('Persistent focus')
    const newFocusDescription = window.getByLabel(/Description \/ notes/)
    await newFocusDescription.fill('Stored notes')
    await newFocusDescription.press('Meta+A')
    await window
      .getByRole('dialog', { name: 'New focus' })
      .getByRole('button', { name: 'Italic' })
      .click()
    await window
      .getByRole('dialog', { name: 'New focus' })
      .getByRole('button', { name: 'Insert link' })
      .click()
    const descriptionLinkEditor = window
      .getByRole('dialog', { name: 'New focus' })
      .getByRole('group', { name: 'Link editor' })
    await descriptionLinkEditor.getByLabel('Link URL').fill('notes.example.com')
    await descriptionLinkEditor.getByRole('button', { name: 'Insert' }).click()
    await window.getByRole('button', { name: 'Create focus' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    const focusDueDate = '2026-09-10'
    await window.getByLabel('Focus due date', { exact: true }).fill(focusDueDate)
    await expect.poll(() => storedFocus()?.dueDate).toBe(focusDueDate)
    await expect(window.getByLabel('Focus last reviewed')).toContainText('Last reviewed · Never')
    await expect(window.getByRole('combobox', { name: 'Focus status' })).toHaveValue('active')
    await expect(window.getByLabel('Focus description').locator('em')).toContainText('Stored notes')
    const descriptionLink = window
      .getByLabel('Focus description')
      .getByRole('link', { name: 'Stored notes' })
    await expect(descriptionLink).toHaveAttribute('href', 'https://notes.example.com/')
    await window.evaluate(() => {
      const capturedWindow = window as typeof window & { __onmoveOpenedLink?: string }
      capturedWindow.__onmoveOpenedLink = ''
      window.open = ((url) => {
        capturedWindow.__onmoveOpenedLink = String(url)
        return null
      }) as typeof window.open
    })
    await descriptionLink.click()
    await expect
      .poll(() =>
        window.evaluate(
          () =>
            (window as typeof window & { __onmoveOpenedLink?: string }).__onmoveOpenedLink
        )
      )
      .toBe('https://notes.example.com/')
    const defaultNote = window.getByRole('textbox', { name: 'Default note' })
    await defaultNote.fill('A durable working note')
    await expect.poll(() => storedFocusDefaultNote()?.content).toContain('A durable working note')
    await expect.poll(() => storedFocusDefaultNote()?.revision).toBeGreaterThan(0)

    const documentWindowPromise = application.waitForEvent('window')
    await defaultNote
      .locator('xpath=../..')
      .getByRole('button', { name: 'Open in new window' })
      .click()
    const documentWindow = await documentWindowPromise
    await expect(documentWindow.locator('[data-slot="rich-text-window-titlebar"]'))
      .toHaveCSS('-webkit-app-region', 'drag')
    await expect(
      documentWindow.getByRole('heading', { name: 'Persistent focus — Default' })
    ).toBeVisible()
    const documentContext = documentWindow.getByRole('navigation', {
      name: 'Document context'
    })
    await expect(documentContext.getByText('Portfolio', { exact: true })).toBeVisible()
    await expect(documentContext.getByText('Persistent focus', { exact: true })).toBeVisible()
    await expect(documentContext.getByText('Default', { exact: true })).toBeVisible()
    await expect(documentWindow.getByText('OnMove document', { exact: true })).toHaveCount(0)
    await expect(documentWindow.getByText('Saved locally as you type', { exact: true }))
      .toHaveCount(0)
    await documentWindow.keyboard.press('Meta+p')
    await expect(documentWindow.getByRole('dialog', { name: 'Choose update target' }))
      .toHaveCount(0)
    const detachedEditor = documentWindow.getByRole('textbox', { name: 'Document content' })
    await expect(detachedEditor).toContainText('A durable working note')
    const detachedEditorBounds = async (): Promise<{
      editorHeight: number
      bottomGap: number
    }> => documentWindow.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('[aria-label="Document content"]')!
      const bounds = editor.getBoundingClientRect()
      return {
        editorHeight: bounds.height,
        bottomGap: window.innerHeight - bounds.bottom
      }
    })
    const initialDetachedEditorBounds = await detachedEditorBounds()
    await documentWindow.setViewportSize({ width: 820, height: 900 })
    const resizedDetachedEditorBounds = await detachedEditorBounds()
    expect(resizedDetachedEditorBounds.editorHeight)
      .toBeGreaterThan(initialDetachedEditorBounds.editorHeight + 150)
    expect(resizedDetachedEditorBounds.bottomGap).toBeLessThanOrEqual(26)
    await detachedEditor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await detachedEditor.press('Backspace')
    await expect(defaultNote).toHaveText('')
    for (const expected of ['a', 'as', 'asd', 'asdf']) {
      await detachedEditor.type(expected.at(-1)!)
      await expect(defaultNote).toHaveText(expected)
    }
    await detachedEditor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await detachedEditor.press('Backspace')
    await expect(defaultNote).toHaveText('')
    await detachedEditor.type('asdf')
    expect(await defaultNote.textContent()).toBe('asdf')
    await detachedEditor.fill('Changed safely in the document window')
    await expect(defaultNote).toContainText('Changed safely in the document window')
    await detachedEditor.press('End')
    await detachedEditor.type('!')
    await documentWindow.close()
    await expect.poll(() => storedFocusDefaultNote()?.content)
      .toContain('Changed safely in the document window!')

    const drawerToggle = window.getByRole('button', { name: 'Toggle context drawer' })
    await expect(drawerToggle).toHaveAttribute('aria-pressed', 'false')
    await drawerToggle.click()
    await expect(drawerToggle).toHaveAttribute('aria-pressed', 'true')
    const focusDrawer = window.getByRole('complementary', { name: 'Focus context drawer' })
    await expect(focusDrawer).toBeVisible()
    await expect(focusDrawer.getByText('Never')).toBeVisible()
    await expect(focusDrawer.getByLabel('Needs review')).toBeChecked()
    await focusDrawer.getByLabel('Needs review').uncheck()
    await focusDrawer.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => storedFocus()?.needsReview).toBe(0)
    const goal = window.getByLabel('Goal')
    await goal.fill('Deliver predictable customer value')
    await goal.press('Meta+A')
    await goal.locator('xpath=../..').getByRole('button', { name: 'Bold' }).click()
    await expect(goal.locator('strong')).toContainText('Deliver predictable customer value')
    await goal.press('Meta+A')
    await goal.locator('xpath=../..').getByRole('button', { name: 'Insert link' }).click()
    const goalLinkEditor = goal.locator('xpath=../..').getByRole('group', {
      name: 'Link editor'
    })
    await goalLinkEditor.getByLabel('Link URL').fill('handbook.example.com')
    await goalLinkEditor.getByRole('button', { name: 'Insert' }).click()
    const goalLink = goal.getByRole('link', { name: 'Deliver predictable customer value' })
    await expect(goalLink).toHaveAttribute('href', 'https://handbook.example.com/')
    const goalToolbar = goal.locator('xpath=../..')
    await goal.press('Meta+A')
    await goal.press('Meta+Shift+X')
    await expect(goalToolbar.getByRole('button', { name: 'Strikethrough' }))
      .toHaveAttribute('aria-pressed', 'true')
    await goal.press('Meta+Y')
    await expect(goalToolbar.getByRole('button', { name: 'Highlight' }))
      .toHaveAttribute('aria-pressed', 'true')
    await goalToolbar.getByLabel('Text color').selectOption({ label: 'Blue' })
    await expect(goal.locator('[style*="--rich-text-blue"]')).toContainText(
      'Deliver predictable customer value'
    )
    await goal.press('Meta+A')
    await goal.locator('xpath=../..').getByRole('button', { name: 'Numbered list' }).click()
    await goal.evaluate((editor) => {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let lastText: Text | null = null
      for (let node = walker.nextNode(); node; node = walker.nextNode()) lastText = node as Text
      if (!lastText) throw new Error('Expected the list item to contain text')
      const range = document.createRange()
      range.setStart(lastText, lastText.data.length)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await goal.press('Enter')
    await goal.pressSequentially('With aligned teams')
    await goal.press('Tab')
    await expect(goal.locator('ol ol')).toContainText('With aligned teams')
    await expect(goal.locator('ol ol').locator('..')).toHaveCSS('list-style-type', 'none')
    await goal.press('Shift+Tab')
    await expect(goal.locator('ol ol')).toHaveCount(0)
    await goal.press('Tab')
    await expect(goal.locator('ol ol')).toContainText('With aligned teams')
    await expect(goal.locator('ol ol').locator('..')).toHaveCSS('list-style-type', 'none')
    await expect
      .poll(() => storedFocus()?.goal, { timeout: 3_000 })
      .toContain('With aligned teams')
    const focusUpdates = window.getByRole('list', { name: 'Focus updates' })
    await expect(focusUpdates).toBeVisible()
    await window.keyboard.press('Meta+p')
    let updateChooser = window.getByRole('dialog', { name: 'Choose update target' })
    await updateChooser.getByRole('option', { name: /^Persistent focus/ }).click()
    let updateComposer = window.getByRole('dialog', { name: 'Add update' })
    const focusUpdateObservation = updateComposer.getByLabel('Update observation')
    await focusUpdateObservation.fill('Overall review completed')
    await focusUpdateObservation.press('Meta+A')
    await focusUpdateObservation
      .locator('xpath=../..')
      .getByRole('button', { name: 'Checklist' })
      .click()
    const focusUpdateChecklistItem = focusUpdateObservation.getByRole('checkbox')
    await focusUpdateChecklistItem.click({ position: { x: 7, y: 10 } })
    await expect(focusUpdateChecklistItem).toHaveAttribute('aria-checked', 'true')
    await updateComposer.getByLabel('Update state').selectOption('green')
    await updateComposer.getByRole('button', { name: 'Add update' }).click()
    await expect.poll(() => storedFocusUpdate()?.state, { timeout: 3_000 }).toBe('green')
    await expect
      .poll(() => storedFocusUpdate()?.observation, { timeout: 3_000 })
      .toContain('Overall review completed')
    const focusUpdateDate = storedFocusUpdate()!.date
    await expect.poll(() => isFullyVisibleInMain(
      focusUpdates.getByRole('listitem', { name: `Update from ${focusUpdateDate}` })
    )).toBe(true)
    await expect(window.getByRole('button', { name: 'Create update' })).toHaveCount(0)
    await expect(window.getByLabel('Focus last reviewed')).toContainText(
      `Last reviewed · ${focusUpdateDate}`
    )
    const focusSidebarButton = window.getByRole('button', { name: 'Persistent focus' })
    const overallSunflower = focusSidebarButton.getByRole('img', {
      name: 'Overall Green; no active commitments'
    })
    await expect(overallSunflower).toBeVisible()
    await expect(overallSunflower).toHaveAttribute('width', '24')
    await expect(overallSunflower.locator('[data-seed-index="0"]')).toHaveAttribute(
      'fill',
      'var(--success)'
    )
    await expect(overallSunflower.locator('[data-seed-index="0"]')).toHaveCSS(
      'fill',
      'rgb(136, 176, 75)'
    )
    await expect(overallSunflower.locator('circle').first()).toHaveCSS(
      'stroke',
      'rgb(155, 183, 212)'
    )
    await expect(focusSidebarButton.locator('.lucide-circle')).toHaveCount(0)
    await window.getByRole('button', { name: 'New thread' }).click()
    await window
      .getByRole('dialog', { name: 'New thread' })
      .getByLabel(/^Title/)
      .fill('Sprint execution')
    await window.getByRole('button', { name: 'Create thread' }).click()
    await expect(
      window.getByRole('button', { name: 'Sprint execution', exact: true })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Sprint execution', exact: true }).click()
    const threadDueDate = '2026-09-12'
    await window.getByLabel('Thread due date', { exact: true }).fill(threadDueDate)
    await expect.poll(() => storedThread()?.dueDate).toBe(threadDueDate)
    await expect(window.getByLabel(
      `Due date ${threadDueDate} is after the parent Focus due date ${focusDueDate}.`
    )).toHaveAttribute('title')
    await expect(window.getByLabel('Thread last reviewed')).toContainText('Last reviewed · Never')
    const threadStatus = window.getByRole('combobox', { name: 'Thread status' })
    await expect(threadStatus).toHaveValue('active')
    await threadStatus.selectOption('paused')
    await expect.poll(() => storedThread()?.status).toBe('paused')
    await expect(threadStatus).toHaveValue('paused')
    const threadDrawer = window.getByRole('complementary', { name: 'Thread context drawer' })
    await expect(threadDrawer).toBeVisible()
    await expect(threadDrawer.getByText('Never')).toBeVisible()
    await threadDrawer.getByLabel('Needs review').uncheck()
    await threadDrawer.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => storedThread()?.needsReview).toBe(0)
    const threadUpdates = window.getByRole('list', { name: 'Thread updates' })
    await expect(threadUpdates).toBeVisible()
    await window.keyboard.press('Meta+p')
    updateChooser = window.getByRole('dialog', { name: 'Choose update target' })
    await updateChooser.getByRole('option', { name: /^Sprint execution/ }).click()
    updateComposer = window.getByRole('dialog', { name: 'Add update' })
    await updateComposer.getByLabel('Update observation').fill('Sprint review completed')
    await updateComposer.getByLabel('Update state').selectOption('green')
    await updateComposer.getByRole('button', { name: 'Add update' }).click()
    await expect.poll(() => storedThreadUpdate()?.state, { timeout: 3_000 }).toBe('green')
    await expect
      .poll(() => storedThreadUpdate()?.observation, { timeout: 3_000 })
      .toContain('Sprint review completed')
    const threadUpdateDate = storedThreadUpdate()!.date
    await expect(window.getByLabel('Thread last reviewed')).toContainText(
      `Last reviewed · ${threadUpdateDate}`
    )
    await window
      .getByRole('button', { name: 'Add commitment to Sprint execution' })
      .click()
    const newThreadCommitmentDialog = window.getByRole('dialog', {
      name: 'New commitment'
    })
    await expect(newThreadCommitmentDialog).toContainText('Add a Thread-level commitment.')
    await newThreadCommitmentDialog
      .getByLabel(/^Title/)
      .fill('Improve ticket quality')
    await newThreadCommitmentDialog
      .getByRole('button', { name: 'Create commitment' })
      .click()
    await expect.poll(() => storedThreadCommitment()?.title).toBe('Improve ticket quality')
    await expect(storedThreadCommitment()).toMatchObject({
      type: 'tracking',
      legacyDueType: 'ongoing',
      status: 'active'
    })
    const threadCommitmentNavigation = window.getByRole('navigation', {
      name: 'Focus sections'
    })
    await expect(threadCommitmentNavigation).toBeVisible()
    await expect(
      threadCommitmentNavigation.getByRole('button', {
        name: 'Open Sprint execution commitment Improve ticket quality'
      })
    ).toHaveAttribute('aria-current', 'page')
    await expect(window.getByRole('heading', { name: 'Improve ticket quality' })).toBeVisible()
    await expect(
      window
        .getByRole('complementary', { name: 'Commitment context drawer' })
        .getByText('Thread — Sprint execution')
    ).toBeVisible()
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()
    await expect(
      window.getByRole('button', { name: 'Open commitment Improve ticket quality' })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Overall', exact: true }).click()
    await expect(window.getByRole('complementary', { name: 'Focus context drawer' })).toBeVisible()
    await window.getByRole('button', { name: 'Commitments', exact: true }).click()
    await expect(window.getByRole('navigation', { name: 'Focus commitments' })).toBeVisible()
    await expect(window.getByRole('complementary', { name: 'Context drawer' })).toContainText(
      'No settings here.'
    )
    await window.getByRole('button', { name: 'New commitment' }).click()
    const newCommitmentDialog = window.getByRole('dialog', { name: 'New commitment' })
    await newCommitmentDialog.getByLabel(/^Title/).fill('Keep sponsors aligned')
    await expect(newCommitmentDialog.getByLabel('Type')).toHaveCount(0)
    const commitmentDueDate = '2026-09-15'
    await newCommitmentDialog.getByLabel(/Due date/).fill(commitmentDueDate)
    await newCommitmentDialog.getByLabel('Review every (days)').fill('14')
    await window.getByRole('button', { name: 'Create commitment' }).click()
    await expect.poll(() => storedCommitment()?.type).toBe('tracking')
    await expect.poll(() => storedCommitment()?.legacyDueType).toBe('action')
    await expect.poll(() => storedCommitment()?.dueDate).toBe(commitmentDueDate)
    await expect.poll(() => storedCommitment()?.reviewFrequencyDays).toBe(14)
    const activeCommitmentSunflower = focusSidebarButton.getByRole('img', {
      name: 'Overall Green; active commitments: Keep sponsors aligned None'
    })
    await expect(activeCommitmentSunflower).toBeVisible()
    await expect(activeCommitmentSunflower.locator('[data-seed-index="0"]')).toHaveAttribute(
      'fill',
      'var(--success)'
    )
    await expect(activeCommitmentSunflower.locator('[data-seed-index="1"]')).toHaveAttribute(
      'fill',
      'var(--muted-foreground)'
    )
    await expect(window.getByRole('button', { name: 'Keep sponsors aligned' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(window.getByRole('heading', { name: 'Keep sponsors aligned' })).toBeVisible()
    await expect(window.getByLabel('Commitment type')).toHaveCount(0)
    await expect(window.getByLabel('Commitment due date', { exact: true }))
      .toHaveValue(commitmentDueDate)
    await expect(window.getByLabel(
      `Due date ${commitmentDueDate} is after the parent Focus due date ${focusDueDate}.`
    )).toHaveAttribute('title')
    const commitmentNavigation = window.getByRole('navigation', { name: 'Focus commitments' })
    await expect(commitmentNavigation.getByText('Active · Last updated · Never')).toBeVisible()
    await expect(window.getByLabel('Commitment last updated')).toContainText(
      'Last updated · Never'
    )
    const commitmentDrawer = window.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    await expect(commitmentDrawer).toBeVisible()
    await expect(commitmentDrawer.getByText('Last updated')).toBeVisible()
    await expect(commitmentDrawer.getByText('Never')).toHaveCount(2)
    await expect(commitmentDrawer.getByLabel('Needs review')).toBeChecked()
    await commitmentDrawer.getByLabel('Needs review').click()
    await commitmentDrawer.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(() => storedCommitment()?.needsReview).toBe(0)
    await expect(commitmentDrawer.getByLabel('Due date')).toHaveValue(commitmentDueDate)
    const commitmentStatus = window.getByRole('combobox', { name: 'Commitment status' })
    await expect(commitmentStatus).toHaveValue('active')
    await commitmentStatus.selectOption('paused')
    await expect.poll(() => storedCommitment()?.status).toBe('paused')
    await expect(commitmentStatus).toHaveValue('paused')
    await expect(commitmentNavigation.getByText('Paused · Last updated · Never')).toBeVisible()
    await expect(commitmentDrawer.getByText('paused', { exact: true })).toBeVisible()
    await expect(
      focusSidebarButton.getByRole('img', {
        name: 'Overall Green; active commitments: Improve ticket quality None'
      })
    ).toBeVisible()
    const updateList = window.getByRole('list', { name: 'Commitment updates' })
    await expect(updateList).toBeVisible()
    await expect(window.getByRole('table')).toHaveCount(0)
    await window.keyboard.press('Meta+p')
    updateChooser = window.getByRole('dialog', { name: 'Choose update target' })
    await updateChooser.getByRole('option', { name: /^Keep sponsors aligned/ }).click()
    updateComposer = window.getByRole('dialog', { name: 'Add update' })
    const newUpdateDate = '2099-12-31'
    await updateComposer.getByLabel('Date', { exact: true }).fill(newUpdateDate)
    await updateComposer.getByLabel('Update state').selectOption('red')
    await updateComposer.getByRole('button', { name: 'Add update' }).click()
    await expect.poll(() => storedCommitmentUpdate()?.date, { timeout: 3_000 }).toBe(newUpdateDate)
    await expect.poll(() => storedCommitmentUpdate()?.state, { timeout: 3_000 }).toBe('red')
    expect(storedCommitmentUpdate()?.observation).toBe('')
    await expect(window.getByRole('button', { name: 'Create update' })).toHaveCount(0)
    await expect(window.getByLabel('Commitment last updated')).toContainText(
      `Last updated · ${newUpdateDate}`
    )
    await expect(
      commitmentNavigation.getByText(`Paused · Last updated · ${newUpdateDate}`)
    ).toBeVisible()
    await expect(commitmentDrawer.getByText(newUpdateDate)).toHaveCount(2)
    const updateObservation = window.getByLabel('Update observation')
    await expect(updateObservation).toBeVisible()
    await expect(updateObservation).toHaveText('')
    await expect(window.getByRole('button', { name: 'Save update' })).toHaveCount(0)
    const updateCard = updateObservation.locator('xpath=ancestor::*[@role="listitem"]')
    await expect(updateCard).toBeVisible()
    const updateCardLayout = await updateCard.evaluate((card) => {
      const editor = card.querySelector<HTMLElement>('[data-slot="rich-text-editor"]')
      const cardBounds = card.getBoundingClientRect()
      const editorBounds = editor?.getBoundingClientRect()
      return {
        cardClientWidth: card.clientWidth,
        cardScrollWidth: card.scrollWidth,
        observationWidth: editorBounds?.width ?? 0,
        observationWidthRatio: editorBounds ? editorBounds.width / cardBounds.width : 0
      }
    })
    expect(updateCardLayout.cardScrollWidth).toBeLessThanOrEqual(updateCardLayout.cardClientWidth)
    expect(updateCardLayout.observationWidthRatio).toBeGreaterThan(0.85)
    await expect(
      updateList.locator('span').filter({ hasText: /^Red$/ })
    ).toBeVisible()
    await expect(
      window
        .getByRole('navigation', { name: 'Focus commitments' })
        .locator('[data-tone="danger"]')
        .filter({ hasText: /^Red$/ })
    ).toBeVisible()
    await updateObservation.fill('Sponsors confirmed the launch plan')
    await expect
      .poll(() => storedCommitmentUpdate()?.observation, { timeout: 3_000 })
      .toContain('Sponsors confirmed the launch plan')
    await expect(updateObservation).toContainText('Sponsors confirmed the launch plan')
    await window.getByRole('button', { name: 'Back to Focus sections' }).click()
    const currentCommitments = window.getByRole('list', { name: 'Current commitments' })
    const actionRow = currentCommitments
      .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
      .locator('..')
    await expect(actionRow.getByText('Action', { exact: true })).toHaveCount(0)
    await expect(actionRow.getByText(`Due · ${commitmentDueDate}`)).toBeVisible()
    await actionRow
      .getByRole('checkbox', { name: 'Mark commitment Keep sponsors aligned done' })
      .click()
    await expect.poll(() => storedCommitment()?.status).toBe('done')
    await expect.poll(() => latestCommitmentTransition()).toBe('done')
    await expect(currentCommitments).toContainText('No active or paused commitments')
    const closedCommitmentsToggle = window.getByRole('button', {
      name: /Done \/ Cancelled/
    })
    await expect(closedCommitmentsToggle).toHaveAttribute('aria-expanded', 'false')
    await closedCommitmentsToggle.click()
    const closedCommitments = window.getByRole('list', {
      name: 'Done and cancelled commitments'
    })
    const commitmentRow = closedCommitments
      .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
      .locator('..')
    await expect(commitmentRow).toContainText(`Last updated · ${newUpdateDate}`)
    await expect(
      commitmentRow.locator('[data-slot="lifecycle-status-label"]').filter({ hasText: /^Done$/ })
    ).toBeVisible()
    await expect(
      commitmentRow.getByRole('checkbox', { name: 'Mark commitment Keep sponsors aligned done' })
    ).toBeChecked()
    await expect(
      commitmentRow.locator('[data-tone="danger"]').filter({ hasText: /^Red$/ })
    ).toBeVisible()
    await expect(window.getByRole('complementary', { name: 'Focus context drawer' })).toBeVisible()
    await window
      .getByRole('button', {
        name: 'Pin commitment Keep sponsors aligned in context drawer'
      })
      .click()
    await expect(
      window.getByRole('complementary', { name: 'Commitment context drawer' })
    ).toBeVisible()
    await expect(window.getByRole('button', { name: 'Overall', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await window.getByRole('button', { name: 'Todos' }).click()
    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    await expect(
      window.getByRole('complementary', { name: 'Commitment context drawer' })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Persistent focus' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await expect(
      window.getByRole('complementary', { name: 'Commitment context drawer' })
    ).toBeVisible()
    await drawerToggle.click()
    await expect(drawerToggle).toHaveAttribute('aria-pressed', 'false')
    await expect(
      window.getByRole('complementary', { name: 'Commitment context drawer' })
    ).toBeHidden()
    await drawerToggle.click()
    await expect(
      window.getByRole('complementary', { name: 'Commitment context drawer' })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Unpin drawer and follow current selection' }).click()
    await expect(window.getByRole('complementary', { name: 'Focus context drawer' })).toBeVisible()
    await window
      .getByRole('complementary', { name: 'Focus context drawer' })
      .getByLabel('Status', { exact: true })
      .selectOption('paused')
    await window.getByRole('button', { name: 'Save changes' }).click()
    await expect(window.getByRole('button', { name: 'Persistent focus, paused' })).toBeVisible()
    await window.getByRole('main').getByLabel('Sensitive').first().click()
    await expect.poll(() => storedFocus()?.sensitive).toBe(1)
    await expect(window.getByRole('main').getByLabel('Sensitive').first()).toBeChecked()
    await application.evaluate(({ BrowserWindow, Menu }) => {
      const menuItem = Menu.getApplicationMenu()?.getMenuItemById('hide-sensitive-content')
      if (!menuItem) throw new Error('Missing sensitive-content View menu item')
      menuItem.click?.(menuItem, BrowserWindow.getFocusedWindow() ?? undefined, {} as never)
    })
    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Persistent focus, paused' })).toHaveCount(0)
    await application.evaluate(({ BrowserWindow, Menu }) => {
      const menuItem = Menu.getApplicationMenu()?.getMenuItemById('hide-sensitive-content')
      if (!menuItem) throw new Error('Missing sensitive-content View menu item')
      menuItem.click?.(menuItem, BrowserWindow.getFocusedWindow() ?? undefined, {} as never)
    })
    await expect(window.getByRole('button', { name: 'Persistent focus, paused' })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'Persistent focus, paused' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await expect(window.getByLabel('Focus due date', { exact: true })).toHaveValue(focusDueDate)
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()
    const preSubjectScopeDrawer = window.getByRole('complementary', {
      name: 'Thread context drawer'
    })
    await expect(preSubjectScopeDrawer.getByRole('radio', { name: /Custom scope/ })).toBeChecked()
    await window.getByRole('button', { name: 'Overall', exact: true }).click()
    const focusSubjectInput = window.getByRole('textbox', { name: 'Add a Subject' })
    for (const subject of ['Customer Operations', 'Enterprise Accounts', 'Platform Team']) {
      await focusSubjectInput.fill(subject)
      await focusSubjectInput.press('Enter')
      await expect(
        window.getByRole('button', { name: `Remove ${subject} from scope` })
      ).toBeVisible()
    }
    await focusSubjectInput.fill('Temporary audience')
    await focusSubjectInput.press('Enter')
    await window
      .getByRole('button', { name: 'Remove Temporary audience from scope' })
      .click()
    await expect(
      window.getByRole('button', { name: 'Remove Temporary audience from scope' })
    ).toHaveCount(0)
    await expect.poll(storedFocusSubjectNames).toEqual([
      'Customer Operations',
      'Enterprise Accounts',
      'Platform Team'
    ])
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()
    await expect(window.getByRole('main').getByText('Scope definition')).toHaveCount(0)
    await expect(window.getByRole('tablist', { name: 'Thread working context' })).toHaveCount(0)
    await window
      .getByRole('button', { name: 'Open commitment Improve ticket quality' })
      .click()
    const openCommitmentDrawer = window.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    await expect(openCommitmentDrawer.getByText('Scope definition')).toHaveCount(0)
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()
    const inheritedThreadDrawer = window.getByRole('complementary', {
      name: 'Thread context drawer'
    })
    await inheritedThreadDrawer.getByRole('radio', { name: /Inherit Focus scope/ }).click()
    await expect(window.getByRole('tab', { name: 'Work in Customer Operations' })).toBeVisible()
    await expect(window.getByRole('tab', { name: 'Work in Enterprise Accounts' })).toBeVisible()
    await expect(window.getByRole('tab', { name: 'Work in Platform Team' })).toBeVisible()
    const scopeDrawer = window.getByRole('complementary', { name: 'Thread context drawer' })
    await expect(scopeDrawer.getByRole('radio', { name: /Inherit Focus scope/ })).toBeChecked()
    const customScopeChoice = scopeDrawer.getByRole('radio', { name: /Custom scope/ })
    await customScopeChoice.click()
    await expect(customScopeChoice).toBeChecked()
    await expect(customScopeChoice).toBeEnabled()
    await expect.poll(() => storedThreadScopeState()?.mode).toBe('explicit')
    await expect(window.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    await window
      .getByRole('combobox', { name: 'Add update for Subject…' })
      .selectOption({ label: 'Customer Operations' })
    let scopedThreadUpdates = window.getByRole('list', { name: 'Thread updates' })
    let customerUpdateCard = scopedThreadUpdates
      .getByRole('listitem')
      .filter({ hasText: 'Customer Operations' })
    await expect(customerUpdateCard).toBeVisible()
    await customerUpdateCard.getByLabel('Update observation').fill('Customer scope review')
    await customerUpdateCard.getByLabel('Update state').selectOption('yellow')
    await expect.poll(() => storedScopedThreadUpdate()?.state, { timeout: 3_000 }).toBe('yellow')
    await scopeDrawer.getByRole('button', { name: 'Remove Enterprise Accounts' }).click()
    const threadSubjectInput = scopeDrawer.getByRole('textbox', {
      name: 'Add a Subject to custom scope'
    })
    await threadSubjectInput.fill('Delivery Partners')
    await threadSubjectInput.press('Enter')
    await expect(
      scopeDrawer.getByRole('button', { name: 'Remove Delivery Partners' })
    ).toBeVisible()
    await scopeDrawer
      .getByRole('button', { name: 'Remove Delivery Partners' })
      .click()
    await scopeDrawer
      .getByRole('button', { name: 'Remove Customer Operations' })
      .click()
    scopedThreadUpdates = window.getByRole('list', { name: 'Thread updates' })
    await expect(scopedThreadUpdates.getByText('Customer scope review')).toHaveCount(0)
    const formerUpdatesToggle = window.getByRole('button', { name: /Former scope updates/ })
    await expect(formerUpdatesToggle).toHaveAttribute('aria-expanded', 'false')
    await formerUpdatesToggle.click()
    customerUpdateCard = window
      .getByRole('list', { name: 'Former scope updates' })
      .getByRole('listitem')
      .filter({ hasText: 'Customer scope review' })
    await expect(customerUpdateCard).toContainText('Former scope')
    await expect(scopeDrawer.getByRole('button', { name: 'Add Customer Operations' }))
      .toBeVisible()
    await scopeDrawer
      .getByRole('button', { name: 'Add Customer Operations' })
      .click()
    await expect(scopeDrawer.getByRole('button', { name: 'Remove Customer Operations' }))
      .toBeVisible()
    await expect.poll(storedThreadScopeState).toEqual({
      mode: 'explicit',
      transitionCount: 8
    })
    await expect(window.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    scopedThreadUpdates = window.getByRole('list', { name: 'Thread updates' })
    customerUpdateCard = scopedThreadUpdates
      .getByRole('listitem')
      .filter({ hasText: 'Customer scope review' })
    await expect(customerUpdateCard).toBeVisible()
    await expect(customerUpdateCard).not.toContainText('Former scope')
    await expect(customerUpdateCard).toContainText('Customer Operations')
    const remainingFormerUpdatesToggle = window.getByRole('button', {
      name: /Former scope updates/
    })
    await expect(remainingFormerUpdatesToggle).toHaveAttribute('aria-expanded', 'false')
    await remainingFormerUpdatesToggle.click()
    const remainingFormerUpdates = window.getByRole('list', {
      name: 'Former scope updates'
    })
    await expect(remainingFormerUpdates).toContainText('Sprint review completed')
    await expect(remainingFormerUpdates).not.toContainText('Customer scope review')
    await expect(window.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => storedScopedThreadUpdate()?.state, { timeout: 3_000 }).toBe('yellow')
    await expect.poll(() => storedScopedThreadUpdate()?.subjectName).toBe('Customer Operations')
    await expect.poll(storedFocusSubjectNames).toEqual([
      'Customer Operations',
      'Enterprise Accounts',
      'Platform Team'
    ])

    await window
      .getByRole('button', { name: 'Open commitment Improve ticket quality' })
      .click()
    const inheritedCommitmentDrawer = window.getByRole('complementary', {
      name: 'Commitment context drawer'
    })
    await expect(window.getByRole('main').getByRole('button', { name: 'Add update' }))
      .toHaveCount(0)
    await expect(inheritedCommitmentDrawer.getByText('Scope definition')).toHaveCount(0)
    await expect(window.getByRole('tablist', { name: 'Commitment working context' }))
      .toBeVisible()
    await expect(window.getByRole('main').getByRole('button', { name: 'Add update' }))
      .toHaveCount(0)
    await expect(window.getByRole('combobox', { name: 'Add update for Subject…' }))
      .toBeVisible()
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()

    await window
      .getByRole('button', { name: 'Add commitment to Sprint execution' })
      .click()
    const scopedCommitmentDialog = window.getByRole('dialog', { name: 'New commitment' })
    await scopedCommitmentDialog.getByLabel(/^Title/).fill('Scoped ticket quality')
    await scopedCommitmentDialog.getByRole('button', { name: 'Create commitment' }).click()
    await expect(window.getByRole('heading', { name: 'Scoped ticket quality' })).toBeVisible()
    await expect(window.getByRole('tablist', {
      name: 'Commitment working context'
    })).toBeVisible()
    await expect(window.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    await window
      .getByRole('combobox', { name: 'Add update for Subject…' })
      .selectOption({ label: 'Customer Operations' })
    const scopedCommitmentUpdates = window.getByRole('list', { name: 'Commitment updates' })
    const scopedCommitmentUpdateCard = scopedCommitmentUpdates
      .getByRole('listitem')
      .filter({ hasText: 'Customer Operations' })
    await expect(scopedCommitmentUpdateCard).toBeVisible()
    await scopedCommitmentUpdateCard
      .getByLabel('Update observation')
      .fill('Customer ticket quality is improving')
    await scopedCommitmentUpdateCard.getByLabel('Update state').selectOption('green')
    await expect
      .poll(() => storedScopedCommitmentUpdate()?.state, { timeout: 3_000 })
      .toBe('green')
    await expect.poll(() => storedScopedCommitmentUpdate()?.subjectName)
      .toBe('Customer Operations')
    await application.close()
    application = undefined

    expect(existsSync(join(userDataDirectory, 'onmove.sqlite3'))).toBe(true)
    expect(launchCount()).toBe(1)
    expect(storedFocus()).toMatchObject({
      title: 'Persistent focus',
      status: 'paused',
      dueDate: focusDueDate,
      needsReview: 0,
      sensitive: 1
    })
    expect(storedFocus()?.description).toContain('onmove-rich-text:1:')
    expect(storedFocus()?.description).toContain('Stored notes')
    expect(storedFocus()?.goal).toContain('onmove-rich-text:1:')
    expect(storedFocus()?.goal).toContain('Deliver predictable customer value')
    expect(storedFocus()?.goal).toContain('With aligned teams')
    expect(storedThread()).toEqual({
      title: 'Sprint execution',
      reviewFrequencyDays: 7,
      needsReview: 0,
      status: 'paused',
      dueDate: threadDueDate
    })
    expect(storedThreadCommitment()).toMatchObject({
      title: 'Improve ticket quality',
      type: 'tracking',
      legacyDueType: 'ongoing',
      status: 'active'
    })
    expect(storedThreadUpdate()).toMatchObject({ state: 'green' })
    expect(storedThreadUpdate()?.observation).toContain('Sprint review completed')
    expect(storedScopedThreadUpdate()).toMatchObject({
      state: 'yellow',
      subjectName: 'Customer Operations'
    })
    expect(storedScopedThreadUpdate()?.observation).toContain('Customer scope review')
    expect(storedCommitment()).toMatchObject({
      title: 'Keep sponsors aligned',
      status: 'done',
      type: 'tracking',
      legacyDueType: 'action',
      reviewFrequencyDays: 14,
      needsReview: 0
    })
    expect(storedFocusUpdate()).toMatchObject({
      date: focusUpdateDate,
      state: 'green'
    })
    expect(storedFocusUpdate()?.observation).toContain('Overall review completed')
    expect(storedCommitmentUpdate()).toMatchObject({
      state: 'red'
    })
    expect(storedCommitmentUpdate()?.observation).toContain('onmove-rich-text:1:')
    expect(storedCommitmentUpdate()?.observation).toContain('Sponsors confirmed the launch plan')

    application = await launch()
    window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'Persistent focus, paused' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await expect(window.getByLabel('Focus due date', { exact: true })).toHaveValue(focusDueDate)
    await expect(
      window.getByLabel('Focus description').getByRole('link', { name: 'Stored notes' })
    ).toHaveAttribute('href', 'https://notes.example.com/')
    await expect(window.getByLabel('Goal')).toContainText('Deliver predictable customer value')
    await expect(
      window
        .getByLabel('Goal')
        .locator('strong')
        .filter({ hasText: 'Deliver predictable customer value' })
    ).toBeVisible()
    await expect(window.getByLabel('Goal').locator('ol ol')).toContainText('With aligned teams')
    await expect(
      window.getByLabel('Goal').getByRole('link', { name: 'Deliver predictable customer value' })
    ).toHaveAttribute('href', 'https://handbook.example.com/')
    const reloadedPrimaryGoal = window
      .getByLabel('Goal')
      .getByText('Deliver predictable customer value', { exact: true })
    await expect(reloadedPrimaryGoal).toHaveClass(/line-through/)
    await expect(reloadedPrimaryGoal).toHaveClass(/onmove-rich-text-highlight/)
    await expect(
      reloadedPrimaryGoal.locator(
        'xpath=ancestor-or-self::*[contains(@style, "--rich-text-blue")][1]'
      )
    ).toHaveAttribute('style', /--rich-text-blue/)
    await expect(window.getByRole('list', { name: 'Subjects in scope' })).toContainText(
      'Customer Operations'
    )
    await expect(window.getByRole('list', { name: 'Subjects in scope' })).toContainText(
      'Enterprise Accounts'
    )
    await expect(window.getByRole('list', { name: 'Subjects in scope' })).toContainText(
      'Platform Team'
    )
    const screenshotPath = process.env.ONMOVE_SCREENSHOT_PATH
    if (screenshotPath) await window.screenshot({ path: screenshotPath })
    await expect(window.getByRole('list', { name: 'Focus updates' })).toContainText(
      'Overall review completed'
    )
    await expect(
      window
        .getByRole('list', { name: 'Focus updates' })
        .getByRole('checkbox', { name: 'Overall review completed' })
    ).toHaveAttribute('aria-checked', 'true')
    await expect(
      window.getByRole('button', { name: 'Sprint execution, paused', exact: true })
    ).toBeVisible()
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()
    await expect(window.getByRole('heading', { name: 'Sprint execution' })).toBeVisible()
    await expect(window.getByLabel('Thread due date', { exact: true })).toHaveValue(threadDueDate)
    await expect(window.getByLabel(
      `Due date ${threadDueDate} is after the parent Focus due date ${focusDueDate}.`
    )).toHaveAttribute('title')
    await expect(window.getByRole('tab', { name: 'Work in Customer Operations' })).toBeVisible()
    await expect(
      window.getByRole('tab', { name: 'Work in Platform Team' })
    ).toBeVisible()
    const reloadedCustomerUpdateCard = window
      .getByRole('list', { name: 'Thread updates' })
      .getByRole('listitem')
      .filter({ hasText: 'Customer scope review' })
    await expect(reloadedCustomerUpdateCard).toBeVisible()
    await expect(reloadedCustomerUpdateCard).toContainText('Customer Operations')
    await expect(reloadedCustomerUpdateCard).not.toContainText('Former scope')
    await window.getByRole('button', { name: 'Toggle context drawer' }).click()
    const reloadedScopeDrawer = window.getByRole('complementary', {
      name: 'Thread context drawer'
    })
    await expect(reloadedScopeDrawer.getByRole('radio', { name: /Custom scope/ })).toBeChecked()
    await expect(reloadedScopeDrawer.getByRole('button', { name: 'Remove Customer Operations' }))
      .toBeVisible()
    await expect(reloadedScopeDrawer.getByRole('button', { name: 'Remove Platform Team' }))
      .toBeVisible()
    await expect(reloadedScopeDrawer.getByRole('button', { name: 'Add Enterprise Accounts' }))
      .toBeVisible()
    const threadScopeScreenshotPath = process.env.ONMOVE_THREAD_SCOPE_SCREENSHOT_PATH
    if (threadScopeScreenshotPath) {
      await window.screenshot({ path: threadScopeScreenshotPath })
    }
    await window.getByRole('button', { name: 'Toggle context drawer' }).click()
    await expect(reloadedScopeDrawer).toHaveCount(0)
    await expect(window.getByRole('combobox', { name: 'Thread status' })).toHaveValue('paused')
    await expect(window.getByRole('list', { name: 'Thread updates' })).toContainText(
      'Customer scope review'
    )
    await expect(window.getByRole('list', { name: 'Thread updates' }))
      .not.toContainText('Sprint review completed')
    const reloadedFormerUpdatesToggle = window.getByRole('button', {
      name: /Former scope updates/
    })
    await expect(reloadedFormerUpdatesToggle).toHaveAttribute('aria-expanded', 'false')
    await reloadedFormerUpdatesToggle.click()
    await expect(window.getByRole('list', { name: 'Former scope updates' }))
      .toContainText('Sprint review completed')
    await expect(
      window.getByRole('button', { name: 'Open commitment Improve ticket quality' })
    ).toBeVisible()
    await window
      .getByRole('button', { name: 'Open commitment Improve ticket quality' })
      .click()
    await expect(
      window
        .getByRole('navigation', { name: 'Focus sections' })
        .getByRole('button', {
          name: 'Open Sprint execution commitment Improve ticket quality'
        })
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      window.getByRole('navigation', { name: 'Focus sections' })
    ).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Improve ticket quality' })).toBeVisible()
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()
    await window.getByRole('button', { name: 'Overall', exact: true }).click()
    const reloadedClosedCommitmentsToggle = window.getByRole('button', {
      name: /Done \/ Cancelled/
    })
    await expect(reloadedClosedCommitmentsToggle).toHaveAttribute('aria-expanded', 'false')
    await reloadedClosedCommitmentsToggle.click()
    await expect(
      window.getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
    ).toBeVisible()
    await expect(
      window
        .getByRole('list', { name: 'Done and cancelled commitments' })
        .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
        .getByText(/Last updated · /)
    ).toBeVisible()
    await expect(
      window
        .getByRole('list', { name: 'Done and cancelled commitments' })
        .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
        .locator('[data-slot="lifecycle-status-label"]')
        .filter({ hasText: /^Done$/ })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Open commitment Keep sponsors aligned' }).click()
    await expect(window.getByRole('combobox', { name: 'Commitment status' })).toHaveValue('done')
    await expect(window.getByLabel('Commitment type')).toHaveCount(0)
    await expect(window.getByLabel('Commitment due date', { exact: true }))
      .toHaveValue(commitmentDueDate)
    await expect(
      window.getByRole('checkbox', { name: /Mark commitment/ })
    ).toHaveCount(0)
    await expect(window.getByLabel('Update observation')).toContainText(
      'Sponsors confirmed the launch plan'
    )
    await expect(
      window.getByRole('list', { name: 'Commitment updates' }).locator('span').filter({ hasText: /^Red$/ })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Overall', exact: true }).click()
    await window.getByRole('button', { name: 'Toggle context drawer' }).click()
    await expect(window.getByLabel('Description / notes')).toContainText('Stored notes')
    await window
      .getByRole('complementary', { name: 'Focus context drawer' })
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    await expect(window.getByRole('dialog', { name: 'Delete focus?' })).toBeVisible()
    await window.getByRole('button', { name: 'Delete focus' }).click()
    await expect(window.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible()
    await expect(window.getByText('No focuses yet')).toBeVisible()
    await application.close()
    application = undefined
    expect(launchCount()).toBe(2)
    expect(storedFocus()).toBeUndefined()
    expect(storedThread()).toBeUndefined()
    expect(storedThreadCommitment()).toBeUndefined()
    expect(storedThreadUpdate()).toBeUndefined()
    expect(storedCommitment()).toBeUndefined()
    expect(storedFocusUpdate()).toBeUndefined()
    expect(storedCommitmentUpdate()).toBeUndefined()
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('creates and exposes verified rolling backups in Settings', async () => {
  test.setTimeout(45_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-backups-e2e-'))
  let application: ElectronApplication | undefined

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Todos' })).toBeVisible()

    await window.getByRole('button', { name: 'Settings' }).click()
    await expect(window.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(window.getByText('Automatic database backups')).toBeVisible()
    await expect(window.getByText('1 of 10 snapshots')).toBeVisible()

    const backupDirectory = join(userDataDirectory, 'Backups')
    await expect.poll(() =>
      readdirSync(backupDirectory).filter((name) => name.endsWith('.sqlite3')).length
    ).toBe(1)

    await window.getByRole('button', { name: 'Back up now' }).click()
    await expect(window.getByText('2 of 10 snapshots')).toBeVisible()
    await expect.poll(() =>
      readdirSync(backupDirectory).filter((name) => name.endsWith('.sqlite3')).length
    ).toBe(2)

    for (const fileName of readdirSync(backupDirectory).filter((name) => name.endsWith('.sqlite3'))) {
      const backup = new DatabaseSync(join(backupDirectory, fileName), { readOnly: true })
      expect(backup.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' })
      backup.close()
    }
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('drags a Commitment between Threads and confirms required Scope widening', async () => {
  test.setTimeout(60_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-commitment-move-e2e-'))
  let application: ElectronApplication | undefined

  function storedMove(): {
    parentTitle: string
    updateCount: number
    todoCount: number
    noteContent: string
    targetMode: string
    targetSubjects: string[]
    parentTransitionCount: number
  } | null {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database.prepare(
      `SELECT commitment.id, thread.title AS parent_title,
              (SELECT count(*) FROM updates WHERE commitment_id = commitment.id) AS update_count,
              (SELECT count(*) FROM todos WHERE commitment_id = commitment.id) AS todo_count,
              (SELECT content FROM notes WHERE commitment_id = commitment.id ORDER BY id LIMIT 1)
                AS note_content,
              application.mode AS target_mode,
              (SELECT count(*) FROM commitment_parent_transitions transition
               WHERE transition.commitment_id = commitment.id) AS parent_transition_count,
              application.scope_id AS target_scope_id
       FROM commitments commitment
       JOIN threads thread ON thread.id = commitment.thread_id
       JOIN thread_scope_applications application ON application.thread_id = thread.id
       WHERE commitment.title = 'Portable commitment'`
    ).get() as {
      id: number
      parent_title: string
      update_count: number
      todo_count: number
      note_content: string
      target_mode: string
      parent_transition_count: number
      target_scope_id: number | null
    } | undefined
    const subjects = row?.target_scope_id === null || row === undefined
      ? []
      : database.prepare(
          `SELECT DISTINCT subject.name
           FROM scope_memberships membership
           JOIN subjects subject ON subject.id = membership.subject_id
           WHERE membership.scope_id = ? AND membership.effect = 'include'
           ORDER BY subject.name`
        ).all(row.target_scope_id).map((subject) => (subject as { name: string }).name)
    database.close()
    return row ? {
      parentTitle: row.parent_title,
      updateCount: Number(row.update_count),
      todoCount: Number(row.todo_count),
      noteContent: row.note_content,
      targetMode: row.target_mode,
      targetSubjects: subjects,
      parentTransitionCount: Number(row.parent_transition_count)
    } : null
  }

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()

    await window.getByRole('button', { name: 'New focus' }).click()
    await window.getByLabel(/^Title/).fill('Move Focus')
    await window.getByRole('button', { name: 'Create focus' }).click()
    for (const title of ['Source Thread', 'Target Thread']) {
      await window.getByRole('button', { name: 'New thread' }).click()
      const dialog = window.getByRole('dialog', { name: 'New thread' })
      await dialog.getByLabel(/^Title/).fill(title)
      await dialog.getByRole('button', { name: 'Create thread' }).click()
    }

    await window.getByRole('button', { name: 'Source Thread', exact: true }).click()
    const drawerToggle = window.getByRole('button', { name: 'Toggle context drawer' })
    if (await drawerToggle.getAttribute('aria-pressed') === 'false') await drawerToggle.click()
    const sourceDrawer = window.getByRole('complementary', { name: 'Thread context drawer' })
    await sourceDrawer.getByRole('radio', { name: /Custom scope/ }).click()
    const subjectInput = sourceDrawer.getByLabel('Add a Subject to custom scope')
    await subjectInput.fill('Partner Team')
    await subjectInput.press('Enter')
    await expect(sourceDrawer.getByRole('button', { name: 'Remove Partner Team' })).toBeVisible()

    await window.getByRole('button', { name: 'Add commitment to Source Thread' }).click()
    const commitmentDialog = window.getByRole('dialog', { name: 'New commitment' })
    await commitmentDialog.getByLabel(/^Title/).fill('Portable commitment')
    await commitmentDialog.getByRole('button', { name: 'Create commitment' }).click()
    await expect(window.getByRole('heading', { name: 'Portable commitment' })).toBeVisible()

    await window
      .getByRole('combobox', { name: 'Add update for Subject…' })
      .selectOption({ label: 'Partner Team' })
    const updateCard = window
      .getByRole('list', { name: 'Commitment updates' })
      .getByRole('listitem')
      .filter({ hasText: 'Partner Team' })
    await updateCard.getByLabel('Update observation').fill('Partner evidence moves intact')
    await updateCard.getByLabel('Update state').selectOption('green')

    await window.getByLabel('New Todo name').fill('Carry the scoped action')
    await window.getByLabel('New Todo context').selectOption({ label: 'Partner Team' })
    await window.getByRole('button', { name: 'Add Todo' }).click()
    await window.getByRole('textbox', { name: 'Default note' }).fill('Durable move note')

    const commitmentRow = window.getByRole('button', {
      name: 'Open Source Thread commitment Portable commitment'
    })
    const targetRow = window.getByRole('button', { name: 'Target Thread', exact: true })
    const commitmentBounds = await commitmentRow.boundingBox()
    const targetBounds = await targetRow.boundingBox()
    if (!commitmentBounds || !targetBounds) throw new Error('Commitment move targets need layout')
    await window.mouse.move(
      commitmentBounds.x + commitmentBounds.width / 2,
      commitmentBounds.y + commitmentBounds.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(
      targetBounds.x + targetBounds.width / 2,
      targetBounds.y + targetBounds.height / 2,
      { steps: 12 }
    )
    await expect(targetRow.locator('..')).toHaveAttribute('data-drop-target', 'active')
    await window.mouse.up()

    const moveDialog = window.getByRole('dialog', { name: 'Move Portable commitment?' })
    await expect(moveDialog).toBeVisible()
    await expect(moveDialog.getByText('Partner Team')).toBeVisible()
    await expect(moveDialog).toContainText('1 Updates, 1 Todos, and 1 Notes')
    await expect(window.getByRole('list', { name: 'Source Thread Commitments' }))
      .toContainText('Portable commitment')
    await moveDialog.getByRole('button', { name: 'Move Commitment' }).click()

    await expect(window.getByRole('list', { name: 'Target Thread Commitments' }))
      .toContainText('Portable commitment')
    await expect(window.getByRole('list', { name: 'Source Thread Commitments' }))
      .not.toContainText('Portable commitment')
    await expect(window.getByRole('heading', { name: 'Portable commitment' })).toBeVisible()
    await expect.poll(storedMove).toEqual({
      parentTitle: 'Target Thread',
      updateCount: 1,
      todoCount: 1,
      noteContent: expect.stringContaining('Durable move note'),
      targetMode: 'explicit',
      targetSubjects: ['Partner Team'],
      parentTransitionCount: 2
    })

    await window.waitForTimeout(75)
    const movedCommitmentRow = window.getByRole('button', {
      name: 'Open Target Thread commitment Portable commitment'
    })
    const sourceRow = window.getByRole('button', { name: 'Source Thread', exact: true })
    const movedBounds = await movedCommitmentRow.boundingBox()
    const sourceBounds = await sourceRow.boundingBox()
    if (!movedBounds || !sourceBounds) throw new Error('Return move targets need layout')
    await window.mouse.move(
      movedBounds.x + movedBounds.width / 2,
      movedBounds.y + movedBounds.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(
      sourceBounds.x + sourceBounds.width / 2,
      sourceBounds.y + sourceBounds.height / 2,
      { steps: 12 }
    )
    await window.mouse.up()
    await expect(window.getByRole('dialog', { name: 'Move Portable commitment?' })).toHaveCount(0)
    await expect(window.getByRole('list', { name: 'Source Thread Commitments' }))
      .toContainText('Portable commitment')
    await expect.poll(() => {
      const move = storedMove()
      return move && {
        parentTitle: move.parentTitle,
        parentTransitionCount: move.parentTransitionCount
      }
    }).toEqual({ parentTitle: 'Source Thread', parentTransitionCount: 3 })
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('drags a Thread between Focuses and preserves its scoped subtree', async () => {
  test.setTimeout(60_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-thread-move-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  let application: ElectronApplication | undefined

  const seed = new AppDatabase(databasePath)
  const sourceFocus = seed.domain.focuses.create({ title: 'Source Portfolio' })
  const targetFocus = seed.domain.focuses.create({ title: 'Target Portfolio' })
  seed.domain.focusScopes.addSubject(sourceFocus.id, { name: 'Core Team' })
  const sourceScope = seed.domain.focusScopes.addSubject(
    sourceFocus.id,
    { name: 'Partner Team' }
  )
  seed.domain.focusScopes.addSubject(targetFocus.id, { name: 'Core Team' })
  const partner = sourceScope.subjects.find(({ name }) => name === 'Partner Team')!
  const thread = seed.domain.threads.create({
    focusId: sourceFocus.id,
    title: 'Portable Thread',
    reviewFrequencyDays: 7
  })
  const commitment = seed.domain.commitments.create({
    parent: { type: 'thread', id: thread.id },
    type: 'tracking',
    title: 'Portable child'
  })
  seed.domain.updates.create({
    parent: { type: 'thread', id: thread.id },
    observation: 'Thread evidence',
    state: 'green',
    scope: { scopeId: sourceScope.scopeId!, subjectId: partner.id }
  })
  seed.domain.updates.create({
    parent: { type: 'commitment', id: commitment.id },
    observation: 'Commitment evidence',
    state: 'yellow',
    scope: { scopeId: sourceScope.scopeId!, subjectId: partner.id }
  })
  seed.domain.todos.create({
    parent: {
      type: 'thread-scope',
      id: thread.id,
      scope: { scopeId: sourceScope.scopeId!, subjectId: partner.id }
    },
    name: 'Thread action'
  })
  seed.domain.todos.create({
    parent: {
      type: 'commitment-scope',
      id: commitment.id,
      scope: { scopeId: sourceScope.scopeId!, subjectId: partner.id }
    },
    name: 'Commitment action'
  })
  const threadNote = thread.snapshot().notes[0]
  seed.domain.richTextDocuments.save(
    { type: 'note', id: threadNote.id, field: 'content' },
    'Thread note survives its move'
  )
  seed.close()

  function storedMove(): {
    focusTitle: string
    commitments: number
    updates: number
    todos: number
    foreignScopedRecords: number
    transitions: number
    targetHasPartner: boolean
  } {
    const stored = new DatabaseSync(databasePath, { readOnly: true })
    const row = stored.prepare(
      `SELECT focus.title AS focus_title,
              (SELECT count(*) FROM commitments WHERE thread_id = thread.id) AS commitments,
              (SELECT count(*) FROM updates update_record
               LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
               WHERE update_record.thread_id = thread.id OR commitment.thread_id = thread.id)
                AS updates,
              (SELECT count(*) FROM todos todo
               LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
               WHERE todo.thread_id = thread.id OR commitment.thread_id = thread.id) AS todos,
              (SELECT count(*) FROM thread_parent_transitions transition
               WHERE transition.thread_id = thread.id) AS transitions,
              (SELECT count(*) FROM (
                SELECT update_record.scope_id AS scope_id FROM updates update_record
                LEFT JOIN commitments commitment ON commitment.id = update_record.commitment_id
                WHERE update_record.scope_id IS NOT NULL
                  AND (update_record.thread_id = thread.id OR commitment.thread_id = thread.id)
                UNION ALL
                SELECT todo.scope_id FROM todos todo
                LEFT JOIN commitments commitment ON commitment.id = todo.commitment_id
                WHERE todo.scope_id IS NOT NULL
                  AND (todo.thread_id = thread.id OR commitment.thread_id = thread.id)
              ) record JOIN scopes scope ON scope.id = record.scope_id
               WHERE scope.focus_id <> thread.focus_id) AS foreign_scoped_records
       FROM threads thread
       JOIN focuses focus ON focus.id = thread.focus_id
       WHERE thread.id = ?`
    ).get(thread.id) as {
      focus_title: string
      commitments: number
      updates: number
      todos: number
      foreign_scoped_records: number
      transitions: number
    }
    const partnerCount = stored.prepare(
      `SELECT count(*) AS count FROM scopes scope
       JOIN scope_memberships membership ON membership.scope_id = scope.id
       JOIN subjects subject ON subject.id = membership.subject_id
       WHERE scope.focus_id = ? AND subject.name = 'Partner Team'`
    ).get(targetFocus.id) as { count: number }
    stored.close()
    return {
      focusTitle: row.focus_title,
      commitments: Number(row.commitments),
      updates: Number(row.updates),
      todos: Number(row.todos),
      foreignScopedRecords: Number(row.foreign_scoped_records),
      transitions: Number(row.transitions),
      targetHasPartner: Number(partnerCount.count) > 0
    }
  }

  async function launch(): Promise<ElectronApplication> {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    return electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
  }

  try {
    application = await launch()
    let window = await application.firstWindow()
    await window.getByRole('button', { name: 'Source Portfolio', exact: true }).click()

    const threadRow = window.getByRole('button', { name: 'Portable Thread', exact: true })
    const targetRow = window.getByRole('button', { name: 'Target Portfolio', exact: true })
    const threadBounds = await threadRow.boundingBox()
    const targetBounds = await targetRow.boundingBox()
    if (!threadBounds || !targetBounds) throw new Error('Thread move targets need layout')
    await window.mouse.move(
      threadBounds.x + threadBounds.width / 2,
      threadBounds.y + threadBounds.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(
      targetBounds.x + targetBounds.width / 2,
      targetBounds.y + targetBounds.height / 2,
      { steps: 12 }
    )
    await expect(targetRow.locator('..')).toHaveAttribute('data-drop-target', 'active')
    await window.mouse.up()

    const moveDialog = window.getByRole('dialog', { name: 'Move Portable Thread?' })
    await expect(moveDialog).toBeVisible()
    await expect(moveDialog.getByText('Partner Team')).toBeVisible()
    await expect(moveDialog).toContainText('1 Commitments, 2 Updates, 2 Todos, and 2 Notes')
    await expect(threadRow).toBeVisible()
    await moveDialog.getByRole('button', { name: 'Move Thread' }).click()

    await expect(targetRow).toHaveAttribute('aria-current', 'page')
    await expect(window.getByRole('button', { name: 'Portable Thread', exact: true }))
      .toHaveAttribute('aria-current', 'page')
    await expect(window.getByRole('heading', { name: 'Portable Thread', exact: true })).toBeVisible()
    await expect.poll(storedMove).toEqual({
      focusTitle: 'Target Portfolio',
      commitments: 1,
      updates: 2,
      todos: 2,
      foreignScopedRecords: 0,
      transitions: 2,
      targetHasPartner: true
    })

    await application.close()
    application = await launch()
    window = await application.firstWindow()
    await window.getByRole('button', { name: 'Target Portfolio', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Portable Thread', exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Source Portfolio', exact: true })).toBeVisible()
    await expect(storedMove()).toMatchObject({ focusTitle: 'Target Portfolio', transitions: 2 })
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('applies a custom Thread Scope to Commitments created before that Scope', async () => {
  test.setTimeout(30_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-custom-thread-e2e-'))
  let application: ElectronApplication | undefined

  function storedApplicationModes(): {
    focusMode: string
    threadMode: string
    commitmentModes: string[]
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const rows = database.prepare(
      `SELECT focus_application.mode AS focusMode,
              thread_application.mode AS threadMode,
              commitment_application.mode AS commitmentMode
       FROM focuses focus
       JOIN focus_scope_applications focus_application
         ON focus_application.focus_id = focus.id
       JOIN threads thread ON thread.focus_id = focus.id
       JOIN thread_scope_applications thread_application
         ON thread_application.thread_id = thread.id
       JOIN commitments commitment ON commitment.thread_id = thread.id
       JOIN commitment_scope_applications commitment_application
         ON commitment_application.commitment_id = commitment.id
       ORDER BY commitment.id`
    ).all() as Array<{
      focusMode: string
      threadMode: string
      commitmentMode: string
    }>
    database.close()
    return rows.length === 0 ? undefined : {
      focusMode: rows[0].focusMode,
      threadMode: rows[0].threadMode,
      commitmentModes: rows.map(({ commitmentMode }) => commitmentMode)
    }
  }

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()

    await window.getByRole('button', { name: 'New focus' }).click()
    await window.getByLabel(/^Title/).fill('Open focus')
    await window.getByRole('button', { name: 'Create focus' }).click()
    await window.getByRole('button', { name: 'New thread' }).click()
    const threadDialog = window.getByRole('dialog', { name: 'New thread' })
    await threadDialog.getByLabel(/^Title/).fill('Sprint execution')
    await threadDialog.getByRole('button', { name: 'Create thread' }).click()
    await window.getByRole('button', { name: 'Sprint execution', exact: true }).click()

    for (const title of ['Improve ticket quality', 'Keep refinement healthy']) {
      await window.getByRole('button', { name: 'Add commitment to Sprint execution' }).click()
      const commitmentDialog = window.getByRole('dialog', { name: 'New commitment' })
      await commitmentDialog.getByLabel(/^Title/).fill(title)
      await commitmentDialog.getByRole('button', { name: 'Create commitment' }).click()
      await window.getByRole('button', { name: 'Sprint execution', exact: true }).click()
    }

    const drawerToggle = window.getByRole('button', { name: 'Toggle context drawer' })
    if (await drawerToggle.getAttribute('aria-pressed') === 'false') await drawerToggle.click()
    const threadDrawer = window.getByRole('complementary', { name: 'Thread context drawer' })
    await expect(threadDrawer.getByRole('radio', { name: 'Custom scope' })).toBeChecked()
    const subjectInput = threadDrawer.getByLabel('Add a Subject to custom scope')
    for (const subject of ['Customer Operations', 'Platform Team']) {
      await subjectInput.fill(subject)
      await subjectInput.press('Enter')
      await expect(threadDrawer.getByRole('button', { name: `Remove ${subject}` })).toBeVisible()
    }

    await expect.poll(storedApplicationModes).toEqual({
      focusMode: 'open',
      threadMode: 'explicit',
      commitmentModes: ['inherited', 'inherited']
    })

    for (const title of ['Improve ticket quality', 'Keep refinement healthy']) {
      await window.getByRole('button', { name: `Open commitment ${title}` }).click()
      await expect(window.getByRole('heading', { name: title })).toBeVisible()
      const commitmentDrawer = window.getByRole('complementary', {
        name: 'Commitment context drawer'
      })
      await expect(commitmentDrawer.getByText('Scope definition')).toHaveCount(0)
      const tablist = window.getByRole('tablist', { name: 'Commitment working context' })
      await expect(tablist).toBeVisible()
      const allSubjectsTab = tablist.getByRole('tab', { name: 'All subjects' })
      await allSubjectsTab.click()
      await expect(allSubjectsTab).toHaveAttribute('aria-selected', 'true')
      const addUpdate = window.getByRole('combobox', { name: 'Add update for Subject…' })
      await expect(addUpdate.getByRole('option', { name: 'Customer Operations' })).toBeAttached()
      await expect(addUpdate.getByRole('option', { name: 'Platform Team' })).toBeAttached()
      for (const subject of ['Customer Operations', 'Platform Team']) {
        const tab = tablist.getByRole('tab', { name: `Work in ${subject}` })
        await tab.click()
        await expect(tab).toHaveAttribute('aria-selected', 'true')
      }
      await window.getByRole('button', { name: 'Sprint execution', exact: true }).click()
    }
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('sorts and preserves contextual Todos through Scope changes', async () => {
  test.setTimeout(45_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-todos-e2e-'))
  let application: ElectronApplication | undefined

  function storedTodos(): Array<{
    name: string
    focusId: number | null
    threadId: number | null
    commitmentId: number | null
    subjectName: string | null
  }> {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const rows = database.prepare(
      `SELECT todo.name, todo.focus_id AS focusId, todo.thread_id AS threadId,
              todo.commitment_id AS commitmentId, subject.name AS subjectName
       FROM todos todo
       LEFT JOIN subjects subject ON subject.id = todo.subject_id
       ORDER BY todo.id`
    ).all() as Array<{
      name: string
      focusId: number | null
      threadId: number | null
      commitmentId: number | null
      subjectName: string | null
    }>
    database.close()
    return rows
  }

  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()

    await window.getByRole('button', { name: 'New focus' }).click()
    await window.getByLabel(/^Title/).fill('Todo Focus')
    await window.getByRole('button', { name: 'Create focus' }).click()

    const newTodoName = window.getByLabel('New Todo name')
    await newTodoName.fill('Overdue sponsor review')
    await window.getByLabel('New Todo due date').fill('2000-01-01')
    await window.getByRole('button', { name: 'Add Todo' }).click()
    await newTodoName.fill('Prepare next brief')
    await window.getByRole('button', { name: 'Add Todo' }).click()
    const focusTodoList = window.getByRole('list', { name: 'focus Todos sortable list' })
    const overdueHandle = window.getByLabel('Drag Overdue sponsor review')
    const overdueTodo = overdueHandle.locator('..').locator('..')
    await expect(overdueTodo).toHaveAttribute('data-overdue', 'true')
    await expect(overdueTodo.getByText('Overdue', { exact: true })).toBeVisible()
    const nextBriefTodo = window.getByLabel('Drag Prepare next brief').locator('..').locator('..')
    const overdueHandleBounds = await overdueHandle.boundingBox()
    const nextBriefBounds = await nextBriefTodo.boundingBox()
    if (!overdueHandleBounds) throw new Error('Todo drag handle has no layout bounds')
    if (!nextBriefBounds) throw new Error('Todo drag target has no layout bounds')
    await window.mouse.move(
      overdueHandleBounds.x + overdueHandleBounds.width / 2,
      overdueHandleBounds.y + overdueHandleBounds.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(
      nextBriefBounds.x + nextBriefBounds.width / 2,
      nextBriefBounds.y + nextBriefBounds.height / 2,
      { steps: 12 }
    )
    await expect(window.getByText('Drop Todo here')).toBeVisible()
    await expect(nextBriefTodo).not.toHaveCSS('transform', 'none')
    await window.mouse.up()
    await expect(window.getByText('Drop Todo here')).toBeHidden()
    await expect(overdueTodo).toHaveAttribute('data-dragging', 'false')
    await expect(focusTodoList.locator('[data-todo-id]').first().getByLabel('Todo name'))
      .toHaveValue('Prepare next brief')
    // dnd-kit briefly captures the click synthesized by the pointer-up so it cannot
    // activate a control underneath the dropped row.
    await window.waitForTimeout(75)

    await window.getByRole('button', { name: 'New thread' }).click()
    const threadDialog = window.getByRole('dialog', { name: 'New thread' })
    await threadDialog.getByLabel(/^Title/).fill('Scoped delivery')
    await threadDialog.getByRole('button', { name: 'Create thread' }).click()
    await window.getByRole('button', { name: 'Scoped delivery', exact: true }).click()
    const todoDrawerToggle = window.getByRole('button', { name: 'Toggle context drawer' })
    if (await todoDrawerToggle.getAttribute('aria-pressed') === 'false') {
      await todoDrawerToggle.click()
    }
    const threadDrawer = window.getByRole('complementary', { name: 'Thread context drawer' })
    const subjectInput = threadDrawer.getByLabel('Add a Subject to custom scope')
    for (const subject of ['Customer Operations', 'Platform Team']) {
      await subjectInput.fill(subject)
      await subjectInput.press('Enter')
      await expect(threadDrawer.getByRole('button', { name: `Remove ${subject}` })).toBeVisible()
    }

    await window.getByLabel('New Todo name').fill('Call customer owner')
    const threadTodoContext = window.getByLabel('New Todo context')
    await expect(threadTodoContext.locator('option')).toHaveText([
      'All subjects',
      'Customer Operations',
      'Platform Team'
    ])
    await expect(threadTodoContext).toHaveValue('all-subjects')
    await window.getByLabel('New Todo name').fill('Confirm shared rollout')
    await window.getByRole('button', { name: 'Add Todo' }).click()
    const sharedParentCompletion = window.getByLabel(
      'Confirm shared rollout completes when every Subject is done'
    )
    await expect(sharedParentCompletion).toBeDisabled()
    await window.getByRole('button', { name: /Subject progress 0\/2/ }).click()
    await expect(window.getByLabel(
      'Mark Confirm shared rollout done for Customer Operations'
    )).not.toBeChecked()

    await window.getByRole('tab', { name: 'Work in Customer Operations' }).click()
    await expect(window.getByLabel('Delete Confirm shared rollout')).toHaveCount(0)
    const sharedSubjectCompletion = window.getByLabel('Mark Confirm shared rollout done')
    await sharedSubjectCompletion.click()
    await expect(sharedSubjectCompletion).toBeChecked()

    await window.getByRole('tab', { name: 'All subjects' }).click()
    await expect(window.getByRole('button', { name: /Subject progress 1\/2/ })).toBeVisible()
    await window.getByLabel('New Todo name').fill('Call customer owner')
    await threadTodoContext.selectOption({ label: 'Customer Operations' })
    await window.getByRole('button', { name: 'Add Todo' }).click()
    await window.getByRole('tab', { name: 'Work in Customer Operations' }).click()
    const scopedThreadTodos = window.getByRole('list', { name: 'thread Todos sortable list' })
    await expect(scopedThreadTodos.locator(
      'input[aria-label="Todo name"][value="Call customer owner"]'
    ))
      .toHaveValue('Call customer owner')
    await expect(scopedThreadTodos).toContainText('Customer Operations')
    await expect(window.getByRole('button', { name: /Orphaned Todos/ })).toHaveCount(0)

    await window.getByRole('tab', { name: 'All subjects' }).click()
    await window.getByLabel('New Todo name').fill('Coordinate platform owner')
    await window.getByLabel('New Todo context').selectOption({ label: 'Platform Team' })
    await window.getByRole('button', { name: 'Add Todo' }).click()
    await window.getByRole('button', { name: 'Add commitment to Scoped delivery' }).click()
    const commitmentDialog = window.getByRole('dialog', { name: 'New commitment' })
    await commitmentDialog.getByLabel(/^Title/).fill('Improve ticket quality')
    await commitmentDialog.getByRole('button', { name: 'Create commitment' }).click()
    await window.getByRole('tab', { name: 'Work in Platform Team' }).click()
    await window.getByLabel('New Todo name').fill('Rewrite platform examples')
    await window.getByRole('button', { name: 'Add Todo' }).click()
    await expect.poll(() => storedTodos().map(({ name, subjectName }) => ({ name, subjectName })))
      .toContainEqual({ name: 'Rewrite platform examples', subjectName: 'Platform Team' })

    await window.getByRole('button', { name: 'Scoped delivery', exact: true }).click()
    await threadDrawer.getByRole('button', { name: 'Remove Platform Team' }).click()
    await expect(window.getByRole('tab', { name: 'All subjects' }))
      .toHaveAttribute('aria-selected', 'true')
    const threadOrphanedToggle = window.getByRole('button', { name: /Orphaned Todos/ })
    await expect(sharedParentCompletion).toBeChecked()
    await expect(window.getByRole('button', { name: /Subject progress 1\/1/ })).toBeVisible()
    await expect(threadOrphanedToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByRole('list', { name: 'Orphaned Todos' })).toHaveCount(0)
    await threadOrphanedToggle.click()
    const threadOrphanedTodos = window.getByRole('list', { name: 'Orphaned Todos' })
    await expect(threadOrphanedTodos.getByLabel('Todo name', { exact: true }))
      .toHaveValue('Coordinate platform owner')
    await expect(threadOrphanedTodos).toContainText('Platform Team · Orphaned')

    await window.getByRole('button', {
      name: 'Open commitment Improve ticket quality'
    }).click()
    const commitmentOrphanedToggle = window.getByRole('button', { name: /Orphaned Todos/ })
    await expect(commitmentOrphanedToggle).toHaveAttribute('aria-expanded', 'false')
    await commitmentOrphanedToggle.click()
    const commitmentOrphanedTodos = window.getByRole('list', { name: 'Orphaned Todos' })
    await expect(commitmentOrphanedTodos).toContainText('Platform Team · Orphaned')
    await expect(commitmentOrphanedTodos.getByLabel('Todo name', { exact: true }))
      .toHaveValue('Rewrite platform examples')

    await expect.poll(() => storedTodos()).toContainEqual(expect.objectContaining({
      name: 'Rewrite platform examples',
      subjectName: 'Platform Team'
    }))

    await application.close()
    application = undefined
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const reloadedWindow = await application.firstWindow()
    await reloadedWindow.getByRole('button', { name: 'Todo Focus' }).click()
    const reloadedFocusTodos = reloadedWindow.getByRole('list', {
      name: 'focus Todos sortable list'
    })
    await expect(reloadedFocusTodos.locator('[data-todo-id]').first().getByLabel('Todo name'))
      .toHaveValue('Prepare next brief')
    await expect(reloadedWindow.getByLabel('Drag Overdue sponsor review')
      .locator('..').locator('..')).toHaveAttribute('data-overdue', 'true')
    await reloadedWindow.getByRole('button', { name: 'Scoped delivery', exact: true }).click()
    await reloadedWindow.getByRole('button', {
      name: 'Open commitment Improve ticket quality'
    }).click()
    const reloadedOrphanedToggle = reloadedWindow.getByRole('button', {
      name: /Orphaned Todos/
    })
    await expect(reloadedOrphanedToggle).toHaveAttribute('aria-expanded', 'false')
    await reloadedOrphanedToggle.click()
    const reloadedOrphanedTodos = reloadedWindow.getByRole('list', {
      name: 'Orphaned Todos'
    })
    await expect(reloadedOrphanedTodos).toContainText('Platform Team · Orphaned')
    await expect(reloadedOrphanedTodos.getByLabel('Todo name', { exact: true }))
      .toHaveValue('Rewrite platform examples')
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
