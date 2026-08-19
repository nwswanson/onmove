import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { AppDatabase } from '../../src/main/database'

function localDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No loopback port was allocated')
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
  return address.port
}

test('serves MCP from the running app and immediately refreshes its open windows', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'onmove-mcp-live-e2e-'))
  const databasePath = join(userDataDirectory, 'onmove.sqlite3')
  const serverPort = await availableLoopbackPort()
  const seeded = new AppDatabase(databasePath)
  const focus = seeded.domain.focuses.create({ title: 'MCP launch' }).toSnapshot()
  const thread = seeded.domain.threads.create({
    focusId: focus.id,
    title: 'MCP delivery',
    reviewFrequencyDays: 7
  }).snapshot()
  seeded.mcpSettings.update({ serverEnabled: true, serverPort, allowMutations: true })
  seeded.close()

  let application: ElectronApplication | undefined
  let client: Client | undefined
  try {
    const executablePath = process.env.ONMOVE_E2E_EXECUTABLE_PATH
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: executablePath ? [] : [resolve('.')],
      env: { ...process.env, ONMOVE_USER_DATA_DIR: userDataDirectory } as Record<string, string>
    })
    const window = await application.firstWindow()
    await expect(window.getByRole('button', { name: 'Todos', exact: true })).toBeVisible()

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${serverPort}/mcp`)
    )
    client = new Client({ name: 'onmove-e2e', version: '1.0.0' })
    await client.connect(transport)

    const tools = await client.listTools()
    expect(tools.tools.map(({ name }) => name)).toContain('onmove.search')

    await window.evaluate(async ({ threadId }) => {
      await window.onmove.domain.updateThread(threadId, { title: 'Edited in the live app' })
    }, { threadId: thread.id })
    const liveThread = await client.callTool({
      name: 'onmove.get_thread',
      arguments: { id: thread.id }
    })
    expect(liveThread.structuredContent).toMatchObject({
      entity: { title: 'Edited in the live app' }
    })

    const created = await client.callTool({
      name: 'onmove.create_todo',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        name: 'MCP-created review packet',
        dueDate: localDate()
      }
    })
    expect(created.isError).not.toBe(true)

    await expect(window.getByRole('button', {
      name: 'Todos, 1 overdue or due today',
      exact: true
    })).toBeVisible({ timeout: 5_000 })
  } finally {
    await client?.close().catch(() => undefined)
    await application?.close().catch(() => undefined)
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
