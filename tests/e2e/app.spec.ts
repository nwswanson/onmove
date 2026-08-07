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
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare('SELECT title, description, goal, status FROM focuses ORDER BY id LIMIT 1')
      .get() as {
        title: string
        description: string | null
        goal: string
        status: string
      } | undefined
    database.close()
    return row
  }

  function storedThread(): { title: string; reviewFrequencyDays: number } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT title, review_frequency_days AS reviewFrequencyDays FROM threads ORDER BY id LIMIT 1'
      )
      .get() as { title: string; reviewFrequencyDays: number } | undefined
    database.close()
    return row
  }

  function storedCommitment(): { title: string; focusId: number } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare('SELECT title, focus_id AS focusId FROM commitments ORDER BY id LIMIT 1')
      .get() as { title: string; focusId: number } | undefined
    database.close()
    return row
  }

  function storedUpdate(): {
    observation: string
    state: string
    commitmentId: number
  } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare(
        'SELECT observation, state, commitment_id AS commitmentId FROM updates ORDER BY id LIMIT 1'
      )
      .get() as { observation: string; state: string; commitmentId: number } | undefined
    database.close()
    return row
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
    await expect(window.getByLabel('Focus description').locator('em')).toContainText('Stored notes')
    const drawerToggle = window.getByRole('button', { name: 'Toggle context drawer' })
    await expect(drawerToggle).toHaveAttribute('aria-pressed', 'false')
    await drawerToggle.click()
    await expect(drawerToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(window.getByRole('complementary', { name: 'Focus context drawer' })).toBeVisible()
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
    await window.getByRole('button', { name: 'New thread' }).click()
    await window
      .getByRole('dialog', { name: 'New thread' })
      .getByLabel(/^Title/)
      .fill('Sprint execution')
    await window.getByRole('button', { name: 'Create thread' }).click()
    await expect(window.getByRole('button', { name: 'Sprint execution' })).toBeVisible()
    await window.getByRole('button', { name: 'Sprint execution' }).click()
    await expect(window.getByRole('complementary', { name: 'Thread context drawer' })).toBeVisible()
    await window.getByRole('button', { name: 'Overall' }).click()
    await expect(window.getByRole('complementary', { name: 'Focus context drawer' })).toBeVisible()
    await window.getByRole('button', { name: 'Commitments' }).click()
    await expect(window.getByRole('navigation', { name: 'Focus commitments' })).toBeVisible()
    await expect(window.getByRole('complementary', { name: 'Context drawer' })).toContainText(
      'No settings here.'
    )
    await window.getByRole('button', { name: 'New commitment' }).click()
    await window
      .getByRole('dialog', { name: 'New commitment' })
      .getByLabel(/^Title/)
      .fill('Keep sponsors aligned')
    await window.getByRole('button', { name: 'Create commitment' }).click()
    await expect(window.getByRole('button', { name: 'Keep sponsors aligned' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(window.getByRole('heading', { name: 'Keep sponsors aligned' })).toBeVisible()
    await expect(
      window.getByRole('complementary', { name: 'Commitment context drawer' })
    ).toBeVisible()
    await expect(window.getByRole('table', { name: 'Commitment updates' })).toBeVisible()
    await window.getByRole('button', { name: 'Add update' }).click()
    await window.getByLabel('New update state').selectOption('red')
    await window.getByRole('button', { name: 'Create update' }).click()
    const updateObservation = window.getByLabel('Update observation')
    await expect(updateObservation).toHaveText('')
    await expect(
      window.getByRole('table', { name: 'Commitment updates' }).locator('span').filter({ hasText: /^Red$/ })
    ).toBeVisible()
    await expect(
      window
        .getByRole('navigation', { name: 'Focus commitments' })
        .locator('[data-tone="danger"]')
        .filter({ hasText: /^Red$/ })
    ).toBeVisible()
    await updateObservation.fill('Sponsors confirmed the launch plan')
    await expect
      .poll(() => storedUpdate()?.observation, { timeout: 3_000 })
      .toContain('Sponsors confirmed the launch plan')
    await expect(updateObservation).toContainText('Sponsors confirmed the launch plan')
    await window.getByRole('button', { name: 'Back to Focus sections' }).click()
    const commitmentRow = window
      .getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
      .locator('..')
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
    await expect(window.getByRole('button', { name: 'Overall' })).toHaveAttribute(
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
    await window.getByLabel('Status').selectOption('paused')
    await window.getByRole('button', { name: 'Save changes' }).click()
    await expect(window.getByRole('button', { name: 'Persistent focus, paused' })).toBeVisible()
    await application.close()
    application = undefined

    expect(existsSync(join(userDataDirectory, 'onmove.sqlite3'))).toBe(true)
    expect(launchCount()).toBe(1)
    expect(storedFocus()).toMatchObject({
      title: 'Persistent focus',
      status: 'paused'
    })
    expect(storedFocus()?.description).toContain('onmove-rich-text:1:')
    expect(storedFocus()?.description).toContain('Stored notes')
    expect(storedFocus()?.goal).toContain('onmove-rich-text:1:')
    expect(storedFocus()?.goal).toContain('Deliver predictable customer value')
    expect(storedFocus()?.goal).toContain('With aligned teams')
    expect(storedThread()).toEqual({ title: 'Sprint execution', reviewFrequencyDays: 7 })
    expect(storedCommitment()).toMatchObject({ title: 'Keep sponsors aligned' })
    expect(storedUpdate()).toMatchObject({
      state: 'red'
    })
    expect(storedUpdate()?.observation).toContain('onmove-rich-text:1:')
    expect(storedUpdate()?.observation).toContain('Sponsors confirmed the launch plan')

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
    await expect(window.getByRole('button', { name: 'Sprint execution' })).toBeVisible()
    await expect(
      window.getByRole('button', { name: 'Open commitment Keep sponsors aligned' })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Open commitment Keep sponsors aligned' }).click()
    await expect(window.getByLabel('Update observation')).toContainText(
      'Sponsors confirmed the launch plan'
    )
    await expect(
      window.getByRole('table', { name: 'Commitment updates' }).locator('span').filter({ hasText: /^Red$/ })
    ).toBeVisible()
    await window.getByRole('button', { name: 'Back to Focus sections' }).click()
    await window.getByRole('button', { name: 'Toggle context drawer' }).click()
    await expect(window.getByLabel('Description / notes')).toContainText('Stored notes')
    await window.getByRole('button', { name: 'Delete' }).click()
    await expect(window.getByRole('dialog', { name: 'Delete focus?' })).toBeVisible()
    await window.getByRole('button', { name: 'Delete focus' }).click()
    await expect(window.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(window.getByText('No focuses yet')).toBeVisible()
    await application.close()
    application = undefined
    expect(launchCount()).toBe(2)
    expect(storedFocus()).toBeUndefined()
    expect(storedThread()).toBeUndefined()
    expect(storedCommitment()).toBeUndefined()
    expect(storedUpdate()).toBeUndefined()
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
