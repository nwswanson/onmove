import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { OnMoveMcpHttpServer, OnMoveMcpRuntime } from '../../src/mcp/live-server'

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port was allocated')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

describe('running-application MCP server', () => {
  let directory: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-live-mcp-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('serves Streamable HTTP from the same AppDatabase and notifies after mutations', async () => {
    const focus = database.domain.focuses.create({ title: 'Live workspace' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Live MCP',
      reviewFrequencyDays: 7
    }).snapshot()
    database.mcpSettings.update({ allowMutations: true })
    const changed = vi.fn()
    const server = new OnMoveMcpHttpServer(database, changed)
    const endpoint = await server.start(0)
    const client = new Client({ name: 'live-test', version: '1.0.0' })

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
      expect((await client.listTools()).tools).toHaveLength(16)
      const created = await client.callTool({
        name: 'onmove.create_todo',
        arguments: { parent: { type: 'thread', id: thread.id }, name: 'Same process Todo' }
      })
      expect(created.isError).not.toBe(true)
      expect(database.domain.todos.list({ type: 'thread', id: thread.id })).toEqual([
        expect.objectContaining({ name: 'Same process Todo' })
      ])
      expect(changed).toHaveBeenCalledOnce()

      const rejected = await fetch(endpoint, {
        method: 'POST',
        headers: { origin: 'https://example.com' }
      })
      expect(rejected.status).toBe(403)
    } finally {
      await client.close()
      await server.stop()
    }
  })

  it('starts and stops from persisted settings and reports port conflicts without crashing', async () => {
    const port = await availablePort()
    const runtime = new OnMoveMcpRuntime(database, vi.fn())
    expect(await runtime.initialize()).toMatchObject({ status: 'stopped', endpoint: null })

    const running = await runtime.update({ serverEnabled: true, serverPort: port })
    expect(running).toMatchObject({
      serverEnabled: true,
      serverPort: port,
      status: 'running',
      endpoint: `http://127.0.0.1:${port}/mcp`,
      error: null
    })
    expect(database.mcpSettings.get()).toMatchObject({ serverEnabled: true, serverPort: port })

    const stopped = await runtime.update({ serverEnabled: false })
    expect(stopped).toMatchObject({ status: 'stopped', endpoint: null, error: null })

    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(port, '127.0.0.1', resolve)
    })
    try {
      const conflicted = await runtime.update({ serverEnabled: true })
      expect(conflicted.status).toBe('error')
      expect(conflicted.endpoint).toBeNull()
      expect(conflicted.error).toMatch(/address already in use|EADDRINUSE/ui)
    } finally {
      await runtime.update({ serverEnabled: false })
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
      await runtime.close()
    }
  })
})
