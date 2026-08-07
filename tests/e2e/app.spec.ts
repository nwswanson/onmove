import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

test('persists a hello across real Electron launches', async () => {
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

  try {
    application = await launch()
    let window = await application.firstWindow()
    await expect(window.getByRole('heading', { name: 'Hello, world.' })).toBeVisible()
    await expect(window.getByTestId('greeting-count')).toHaveText('0')
    await window.getByRole('button', { name: 'Save a hello' }).click()
    await expect(window.getByTestId('greeting-count')).toHaveText('1')
    await application.close()
    application = undefined

    expect(existsSync(join(userDataDirectory, 'onmove.sqlite3'))).toBe(true)

    application = await launch()
    window = await application.firstWindow()
    await expect(window.getByTestId('greeting-count')).toHaveText('1')
    await expect(window.getByText('Opened 2 times')).toBeVisible()
  } finally {
    await application?.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
