import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { createOnMoveMcpServer } from '../../src/mcp/server'

describe('OnMove MCP protocol adapter', () => {
  let directory: string
  let database: AppDatabase
  let client: Client
  let server: ReturnType<typeof createOnMoveMcpServer>

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-mcp-protocol-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
    database.domain.focuses.create({ title: 'Launch readiness' })
    server = createOnMoveMcpServer(database)
    client = new Client({ name: 'vitest-mcp-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await server.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('negotiates tools and resource templates and returns structured search output', async () => {
    const listed = await client.listTools()
    expect(listed.tools.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'onmove.list_focuses',
      'onmove.get_thread',
      'onmove.search',
      'onmove.create_update',
      'onmove.poke_review'
    ]))
    expect(listed.tools).toHaveLength(16)

    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate)).toEqual(
      expect.arrayContaining(['onmove://focus/{id}', 'onmove://thread/{id}', 'onmove://tags/{name}'])
    )

    const search = await client.callTool({
      name: 'onmove.search',
      arguments: { text: 'launch readiness' }
    })
    expect(search.isError).not.toBe(true)
    expect(search.structuredContent).toMatchObject({
      items: [expect.objectContaining({
        reference: { type: 'focus', id: 1 },
        contextPath: ['Launch readiness']
      })]
    })

    const focus = await client.readResource({ uri: 'onmove://focus/1' })
    expect(focus.contents[0]).toMatchObject({ uri: 'onmove://focus/1', mimeType: 'application/json' })
    expect(JSON.parse('text' in focus.contents[0] ? focus.contents[0].text : '{}')).toMatchObject({
      reference: { type: 'focus', id: 1 }
    })
  })

  it('returns the same not-found behavior for hidden and unknown records', async () => {
    database.domain.focuses.requireModel(1).update({ sensitive: true })
    const hidden = await client.callTool({ name: 'onmove.get_focus', arguments: { id: 1 } })
    const missing = await client.callTool({ name: 'onmove.get_focus', arguments: { id: 999 } })
    expect(hidden.isError).toBe(true)
    expect(missing.isError).toBe(true)
    expect(hidden.content).toEqual(missing.content)
  })

  it('re-reads permissions for every call and enables safe writes without reconnecting', async () => {
    const focus = database.domain.focuses.requireModel(1).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery health',
      reviewFrequencyDays: 7
    }).snapshot()

    const denied = await client.callTool({
      name: 'onmove.create_update',
      arguments: { parent: { type: 'thread', id: thread.id }, observation: 'First evidence' }
    })
    expect(denied.isError).toBe(true)

    database.mcpSettings.update({ allowMutations: true })
    const allowed = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        observation: 'First evidence',
        state: 'green'
      }
    })
    expect(allowed.isError).not.toBe(true)
    expect(database.domain.updates.listForThread(thread.id)).toEqual([
      expect.objectContaining({ observation: 'First evidence', state: 'green' })
    ])
  })
})

