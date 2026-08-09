import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

test('creates, edits, reloads, and deletes a persisted focus across Electron launches', async () => {
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
    needsReview: number
    sensitive: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT title, description, goal, status, needs_review AS needsReview, sensitive FROM focuses ORDER BY id LIMIT 1'
      )
      .get() as {
        title: string
        description: string | null
        goal: string
        status: string
        needsReview: number
        sensitive: number
      } | undefined
    database.close()
    return row
  }

  function storedThread(): {
    title: string
    reviewFrequencyDays: number
    needsReview: number
    status: string
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT title, review_frequency_days AS reviewFrequencyDays, needs_review AS needsReview, status FROM threads ORDER BY id LIMIT 1'
      )
      .get() as {
        title: string
        reviewFrequencyDays: number
        needsReview: number
        status: string
      } | undefined
    database.close()
    return row
  }

  function storedThreadCommitment(): {
    title: string
    threadId: number
    type: string
    status: string
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT title, thread_id AS threadId, commitment_type AS type, status FROM commitments WHERE thread_id IS NOT NULL ORDER BY id LIMIT 1'
      )
      .get() as {
        title: string
        threadId: number
        type: string
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

  function storedCommitment(): {
    title: string
    focusId: number
    type: string
    status: string
    dueDate: string | null
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT title, focus_id AS focusId, commitment_type AS type, status, due_on AS dueDate FROM commitments WHERE focus_id IS NOT NULL ORDER BY id LIMIT 1'
      )
      .get() as {
        title: string
        focusId: number
        type: string
        status: string
        dueDate: string | null
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
    await expect(window.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(window.getByRole('toolbar', { name: 'Application toolbar' })).toBeVisible()
    await expect(window.getByText('Overview')).toBeVisible()
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
    await window.getByRole('button', { name: 'Create focus' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await expect(window.getByLabel('Focus last reviewed')).toContainText('Last reviewed · Never')
    await expect(window.getByRole('combobox', { name: 'Focus status' })).toHaveValue('active')
    await expect(window.getByLabel('Focus description').locator('em')).toContainText('Stored notes')
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
    await window.getByRole('button', { name: 'Add update' }).click()
    await expect.poll(() => storedFocusUpdate()?.state).toBe('none')
    const focusUpdateDate = storedFocusUpdate()!.date
    expect(storedFocusUpdate()?.observation).toBe('')
    await expect(window.getByRole('button', { name: 'Create update' })).toHaveCount(0)
    await focusUpdates.getByLabel('Update observation').fill('Overall review completed')
    await focusUpdates.getByLabel('Update state').selectOption('green')
    await expect.poll(() => storedFocusUpdate()?.state, { timeout: 3_000 }).toBe('green')
    await expect
      .poll(() => storedFocusUpdate()?.observation, { timeout: 3_000 })
      .toContain('Overall review completed')
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
    await window.getByRole('button', { name: 'Add update' }).click()
    await expect.poll(() => storedThreadUpdate()?.state).toBe('none')
    await threadUpdates.getByLabel('Update observation').fill('Sprint review completed')
    await threadUpdates.getByLabel('Update state').selectOption('green')
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
      type: 'ongoing',
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
    const newCommitmentType = newCommitmentDialog.getByRole('combobox', { name: 'Type' })
    await expect(newCommitmentType).toHaveValue('ongoing')
    await newCommitmentType.selectOption('action')
    const commitmentDueDate = '2026-09-15'
    await newCommitmentDialog.getByLabel(/Due date/).fill(commitmentDueDate)
    await window.getByRole('button', { name: 'Create commitment' }).click()
    await expect.poll(() => storedCommitment()?.type).toBe('action')
    await expect.poll(() => storedCommitment()?.dueDate).toBe(commitmentDueDate)
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
    await expect(window.getByLabel('Commitment type')).toContainText('Type · Action')
    await expect(window.getByLabel('Commitment due date')).toContainText(
      `Due date · ${commitmentDueDate}`
    )
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
    await expect(commitmentDrawer.getByText('Never')).toBeVisible()
    await expect(commitmentDrawer.getByText('Action', { exact: true })).toBeVisible()
    await expect(commitmentDrawer.getByText(commitmentDueDate)).toBeVisible()
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
    await window.getByRole('button', { name: 'Add update' }).click()
    await expect.poll(() => storedCommitmentUpdate()?.state).toBe('none')
    expect(storedCommitmentUpdate()?.observation).toBe('')
    await expect(window.getByRole('button', { name: 'Create update' })).toHaveCount(0)
    const newUpdateDate = '2099-12-31'
    await updateList.getByLabel('Update date').fill(newUpdateDate)
    await updateList.getByLabel('Update state').selectOption('red')
    await expect.poll(() => storedCommitmentUpdate()?.date, { timeout: 3_000 }).toBe(newUpdateDate)
    await expect.poll(() => storedCommitmentUpdate()?.state, { timeout: 3_000 }).toBe('red')
    await expect(window.getByLabel('Commitment last updated')).toContainText(
      `Last updated · ${newUpdateDate}`
    )
    await expect(
      commitmentNavigation.getByText(`Paused · Last updated · ${newUpdateDate}`)
    ).toBeVisible()
    await expect(commitmentDrawer.getByText(newUpdateDate)).toBeVisible()
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
    await expect(actionRow.getByText('Action', { exact: true })).toBeVisible()
    await expect(actionRow.getByText(`Due · ${commitmentDueDate}`)).toBeVisible()
    await actionRow
      .getByRole('checkbox', { name: 'Mark commitment Keep sponsors aligned done' })
      .click()
    await expect.poll(() => storedCommitment()?.status).toBe('done')
    await expect.poll(() => latestCommitmentTransition()).toBe('done')
    await expect(currentCommitments).toContainText('No active or paused commitments')
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
    await window.getByRole('button', { name: 'Home' }).click()
    await expect(window.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
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
    await expect(window.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Persistent focus, paused' })).toHaveCount(0)
    await application.evaluate(({ BrowserWindow, Menu }) => {
      const menuItem = Menu.getApplicationMenu()?.getMenuItemById('hide-sensitive-content')
      if (!menuItem) throw new Error('Missing sensitive-content View menu item')
      menuItem.click?.(menuItem, BrowserWindow.getFocusedWindow() ?? undefined, {} as never)
    })
    await expect(window.getByRole('button', { name: 'Persistent focus, paused' })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'Persistent focus, paused' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
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
    await expect(window.getByText('Open scope — add a Subject to define its boundary.'))
      .toBeVisible()
    for (const subject of ['Customer Operations', 'Platform Team']) {
      await window
        .getByRole('button', { name: `Add ${subject} to Thread scope` })
        .click()
      await expect(
        window.getByRole('button', { name: `Remove ${subject} from Thread scope` })
      ).toBeVisible()
    }
    const threadSubjectInput = window.getByRole('textbox', {
      name: 'Add a Subject to Thread'
    })
    await threadSubjectInput.fill('Delivery Partners')
    await threadSubjectInput.press('Enter')
    await expect(
      window.getByRole('button', { name: 'Remove Delivery Partners from Thread scope' })
    ).toBeVisible()
    await window
      .getByRole('button', { name: 'Remove Customer Operations from Thread scope' })
      .click()
    await expect(
      window.getByRole('button', { name: 'Add Customer Operations to Thread scope' })
    ).toBeVisible()
    await window
      .getByRole('button', { name: 'Add Customer Operations to Thread scope' })
      .click()
    await window.getByRole('button', { name: 'Follow Focus' }).click()
    await expect(window.getByText('Following Focus · 3 Subjects in scope')).toBeVisible()
    await window
      .getByRole('button', { name: 'Remove Enterprise Accounts from Thread scope' })
      .click()
    await expect(window.getByText('Custom · 2 Subjects in scope')).toBeVisible()
    await expect.poll(storedThreadScopeState).toEqual({
      mode: 'explicit',
      transitionCount: 8
    })
    await expect.poll(storedFocusSubjectNames).toEqual([
      'Customer Operations',
      'Enterprise Accounts',
      'Platform Team'
    ])
    await application.close()
    application = undefined

    expect(existsSync(join(userDataDirectory, 'onmove.sqlite3'))).toBe(true)
    expect(launchCount()).toBe(1)
    expect(storedFocus()).toMatchObject({
      title: 'Persistent focus',
      status: 'paused',
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
      status: 'paused'
    })
    expect(storedThreadCommitment()).toMatchObject({
      title: 'Improve ticket quality',
      type: 'ongoing',
      status: 'active'
    })
    expect(storedThreadUpdate()).toMatchObject({ state: 'green' })
    expect(storedThreadUpdate()?.observation).toContain('Sprint review completed')
    expect(storedCommitment()).toMatchObject({
      title: 'Keep sponsors aligned',
      status: 'done'
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
    await expect(window.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'Persistent focus, paused' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await expect(window.getByLabel('Goal')).toContainText('Deliver predictable customer value')
    await expect(
      window
        .getByLabel('Goal')
        .locator('strong')
        .filter({ hasText: 'Deliver predictable customer value' })
    ).toBeVisible()
    await expect(window.getByLabel('Goal').locator('ol ol')).toContainText('With aligned teams')
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
      window.getByRole('button', { name: 'Sprint execution, paused', exact: true })
    ).toBeVisible()
    await window
      .getByRole('button', { name: 'Sprint execution, paused', exact: true })
      .click()
    await expect(window.getByRole('heading', { name: 'Sprint execution' })).toBeVisible()
    await expect(window.getByText('Custom · 2 Subjects in scope')).toBeVisible()
    await expect(
      window.getByRole('button', { name: 'Remove Customer Operations from Thread scope' })
    ).toBeVisible()
    await expect(
      window.getByRole('button', { name: 'Remove Platform Team from Thread scope' })
    ).toBeVisible()
    await expect(
      window.getByRole('button', { name: 'Add Enterprise Accounts to Thread scope' })
    ).toBeVisible()
    const threadScopeScreenshotPath = process.env.ONMOVE_THREAD_SCOPE_SCREENSHOT_PATH
    if (threadScopeScreenshotPath) {
      await window.screenshot({ path: threadScopeScreenshotPath })
    }
    await expect(window.getByRole('combobox', { name: 'Thread status' })).toHaveValue('paused')
    await expect(window.getByRole('list', { name: 'Thread updates' })).toContainText(
      'Sprint review completed'
    )
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
    await expect(window.getByLabel('Commitment type')).toContainText('Type · Action')
    await expect(window.getByLabel('Commitment due date')).toContainText(
      `Due date · ${commitmentDueDate}`
    )
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
    await expect(window.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
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
