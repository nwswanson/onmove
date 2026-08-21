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
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: 'Live Update observation'
    }).toSnapshot()
    database.mcpSettings.update({ allowMutations: true })
    const changed = vi.fn()
    const richTextChanged = vi.fn()
    const server = new OnMoveMcpHttpServer(database, changed, undefined, richTextChanged)
    const endpoint = await server.start(0)
    const client = new Client({ name: 'live-test', version: '1.0.0' })

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
      expect((await client.listTools()).tools).toHaveLength(49)
      const created = await client.callTool({
        name: 'onmove.create_todo',
        arguments: { parent: { type: 'thread', id: thread.id }, name: 'Same process Todo' }
      })
      expect(created.isError).not.toBe(true)
      expect(database.domain.todos.list({ type: 'thread', id: thread.id })).toEqual([
        expect.objectContaining({ name: 'Same process Todo' })
      ])
      expect(changed).toHaveBeenCalledOnce()

      const note = database.domain.notes.list({ type: 'thread', id: thread.id })[0]
      changed.mockClear()
      const updatedNote = await client.callTool({
        name: 'onmove.update_note',
        arguments: {
          id: note.id,
          expectedRevision: note.revision,
          richText: {
            version: 1,
            blocks: [{
              type: 'paragraph',
              children: [{ type: 'text', text: 'Live Note content', marks: ['bold'] }]
            }]
          }
        }
      })
      expect(updatedNote.isError).not.toBe(true)
      expect(changed).toHaveBeenCalledOnce()
      expect(richTextChanged).toHaveBeenCalledWith(expect.objectContaining({
        reference: { type: 'note', id: note.id, field: 'content' },
        value: expect.stringContaining('Live Note content'),
        revision: note.revision + 1
      }))

      changed.mockClear()
      richTextChanged.mockClear()
      const patchedNote = await client.callTool({
        name: 'onmove.patch_note_text',
        arguments: {
          id: note.id,
          expectedRevision: note.revision + 1,
          findText: 'Live Note content',
          replaceText: 'Live Note wording'
        }
      })
      expect(patchedNote.isError).not.toBe(true)
      expect(changed).toHaveBeenCalledOnce()
      expect(richTextChanged).toHaveBeenCalledWith(expect.objectContaining({
        reference: { type: 'note', id: note.id, field: 'content' },
        value: expect.stringContaining('Live Note wording'),
        revision: note.revision + 2
      }))

      changed.mockClear()
      richTextChanged.mockClear()
      const patchedUpdate = await client.callTool({
        name: 'onmove.patch_rich_text',
        arguments: {
          target: { type: 'update-observation', updateId: update.id },
          expectedRevision: 0,
          findText: 'Live Update',
          replaceText: 'Fresh evidence'
        }
      })
      expect(patchedUpdate.isError).not.toBe(true)
      expect(changed).toHaveBeenCalledOnce()
      expect(richTextChanged).toHaveBeenCalledWith(expect.objectContaining({
        reference: { type: 'update', id: update.id, field: 'observation' },
        value: expect.stringContaining('Fresh evidence observation'),
        revision: 1
      }))

      const invalidArguments = {
        id: note.id,
        expectedRevision: note.revision + 2,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{ type: 'text', text: 'hey there', tag: true }]
          }]
        }
      }
      let thirdRejected: Awaited<ReturnType<typeof client.callTool>> | null = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        thirdRejected = await client.callTool({
          name: 'onmove.update_note',
          arguments: invalidArguments
        })
      }
      expect(thirdRejected?.structuredContent).toMatchObject({
        error: { pointer: '/richText/blocks/0/children/0' },
        recovery: {
          duplicateInvalidCall: {
            count: 3,
            warning: expect.stringContaining('third identical rejected request')
          }
        }
      })

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
    const focus = database.domain.focuses.create({ title: 'Current UI owner' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'runtimecurrentasdfasdf Thread',
      reviewFrequencyDays: 7
    }).snapshot()
    const runtime = new OnMoveMcpRuntime(database, vi.fn())
    runtime.setUiContext({ focusId: focus.id, subjectId: null })
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

    const client = new Client({ name: 'runtime-context-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(running.endpoint as string)))
    const scoped = await client.callTool({
      name: 'onmove.search',
      arguments: {
        text: 'runtimecurrentasdfasdf',
        scope: { mode: 'current' },
        kinds: ['thread']
      }
    })
    expect(scoped.structuredContent).toMatchObject({
      items: [expect.objectContaining({ reference: { type: 'thread', id: thread.id } })],
      diagnostics: { appliedScope: { mode: 'current', focusId: focus.id } }
    })
    await client.close()

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
