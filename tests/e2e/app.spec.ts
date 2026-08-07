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

  function storedFocus(): { title: string; description: string | null; status: string } | undefined {
    const database = new DatabaseSync(join(userDataDirectory, 'onmove.sqlite3'), {
      readOnly: true
    })
    const row = database
      .prepare('SELECT title, description, status FROM focuses ORDER BY id LIMIT 1')
      .get() as { title: string; description: string | null; status: string } | undefined
    database.close()
    return row
  }

  try {
    application = await launch()
    let window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Home' })).toBeVisible()
    await expect(window.getByRole('toolbar', { name: 'Application toolbar' })).toBeVisible()
    await expect(window.getByText('Overview')).toBeVisible()
    await expect(window.getByText('Focuses', { exact: true })).toBeVisible()
    await window.getByRole('button', { name: 'New focus' }).click()
    await window.getByLabel(/^Title/).fill('Persistent focus')
    await window.getByLabel(/Description \/ notes/).fill('Stored notes')
    await window.getByRole('button', { name: 'Create focus' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await window.getByRole('button', { name: 'Open Focus context' }).click()
    await window.getByLabel('Status', { exact: true }).selectOption('paused')
    await window.getByRole('button', { name: 'Save changes' }).click()
    await expect(window.getByRole('button', { name: 'Persistent focus, paused' })).toBeVisible()
    await application.close()
    application = undefined

    expect(existsSync(join(userDataDirectory, 'onmove.sqlite3'))).toBe(true)
    expect(launchCount()).toBe(1)
    expect(storedFocus()).toEqual({
      title: 'Persistent focus',
      description: 'Stored notes',
      status: 'paused'
    })

    application = await launch()
    window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Home' })).toBeVisible()
    await window.getByRole('button', { name: 'Persistent focus, paused' }).click()
    await expect(window.getByRole('heading', { name: 'Persistent focus' })).toBeVisible()
    await window.getByRole('button', { name: 'Open Focus context' }).click()
    await expect(window.getByLabel('Description / notes')).toHaveValue('Stored notes')
    await window.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(window.getByRole('dialog', { name: 'Delete focus?' })).toBeVisible()
    await window.getByRole('button', { name: 'Delete focus' }).click()
    await expect(window.getByRole('heading', { name: 'Home' })).toBeVisible()
    await expect(window.getByText('No focuses yet')).toBeVisible()
    await application.close()
    application = undefined
    expect(launchCount()).toBe(2)
    expect(storedFocus()).toBeUndefined()
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
