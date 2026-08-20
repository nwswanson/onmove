import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { AppDatabase } from '../../src/main/database'
import type { OnMoveRichTextDocument } from '../../src/shared/rich-text-document'

function localDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function richText(text: string): OnMoveRichTextDocument {
  return {
    version: 1,
    blocks: [{ type: 'paragraph', children: [{ type: 'text', text, marks: ['bold'] }] }]
  }
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
  const threadNote = seeded.domain.notes.list({ type: 'thread', id: thread.id })[0]
  const team = seeded.domain.threads.create({
    focusId: focus.id,
    title: 'Leadership Team',
    reviewFrequencyDays: 7
  }).snapshot()
  const oneToOne = seeded.domain.commitments.create({
    type: 'tracking',
    parent: { type: 'thread', id: team.id },
    title: '1:1'
  }).snapshot()
  const teamScope = seeded.domain.threadScopes.addSubject(team.id, { name: 'Person Y' })
  const person = teamScope.subjects[0]
  const unrelatedSubject = seeded.domain.subjects.create({ name: 'Unrelated Subject' }).toSnapshot()
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
    expect(tools.tools.map(({ name }) => name)).toContain('onmove.resolve_note')
    expect(tools.tools.map(({ name }) => name)).toContain('onmove.resolve_target')
    expect(tools.tools.map(({ name }) => name)).toContain('onmove.patch_note_text')
    expect(tools.tools.map(({ name }) => name)).toContain('onmove.update_note')

    await window.evaluate((noteId) => {
      const testWindow = window as typeof window & {
        __mcpNoteChanges?: Array<{ id: number; value: string; revision: number }>
      }
      testWindow.__mcpNoteChanges = []
      window.onmove.richText.onDocumentChanged(({ document }) => {
        if (document.reference.type !== 'note' || document.reference.id !== noteId) return
        testWindow.__mcpNoteChanges?.push({
          id: document.reference.id,
          value: document.value,
          revision: document.revision
        })
      })
    }, threadNote.id)
    const updatedNote = await client.callTool({
      name: 'onmove.update_note',
      arguments: {
        id: threadNote.id,
        expectedRevision: threadNote.revision,
        richText: {
          version: 1,
          blocks: [{
            type: 'paragraph',
            children: [{
              type: 'text',
              text: 'MCP content visible in open windows',
              marks: ['bold']
            }]
          }]
        }
      }
    })
    expect(updatedNote.isError).not.toBe(true)
    await expect.poll(() => window.evaluate(({ noteId, revision }) => {
      const testWindow = window as typeof window & {
        __mcpNoteChanges?: Array<{ id: number; value: string; revision: number }>
      }
      return (testWindow.__mcpNoteChanges ?? []).some((change) =>
        change.id === noteId &&
        change.value.includes('MCP content visible in open windows') &&
        change.value.includes('"format":1') &&
        change.revision === revision
      )
    }, { noteId: threadNote.id, revision: threadNote.revision + 1 })).toBe(true)

    const resolvedNote = await client.callTool({
      name: 'onmove.resolve_note',
      arguments: {
        focus: { title: 'MCP launch' },
        thread: { title: 'MCP delivery' },
        note: { title: 'Default' },
        includeRichText: true
      }
    })
    expect(resolvedNote.structuredContent).toMatchObject({
      status: 'resolved',
      target: {
        reference: { type: 'note', id: threadNote.id },
        note: {
          revision: threadNote.revision + 1,
          content: 'MCP content visible in open windows'
        }
      }
    })
    const patchedNote = await client.callTool({
      name: 'onmove.patch_note_text',
      arguments: {
        id: threadNote.id,
        expectedRevision: threadNote.revision + 1,
        findText: 'content',
        replaceText: 'wording'
      }
    })
    expect(patchedNote.isError).not.toBe(true)
    await expect.poll(() => window.evaluate(({ noteId, revision }) => {
      const testWindow = window as typeof window & {
        __mcpNoteChanges?: Array<{ id: number; value: string; revision: number }>
      }
      return (testWindow.__mcpNoteChanges ?? []).some((change) =>
        change.id === noteId &&
        change.value.includes('MCP wording visible in open windows') &&
        change.value.includes('"format":1') &&
        change.revision === revision
      )
    }, { noteId: threadNote.id, revision: threadNote.revision + 2 })).toBe(true)

    const resolved = await client.callTool({
      name: 'onmove.resolve_target',
      arguments: {
        thread: { title: 'Leadership Team' },
        commitment: { title: '1:1' },
        subject: { name: 'Person Y' }
      }
    })
    expect(resolved.structuredContent).toMatchObject({
      status: 'resolved',
      target: {
        parent: { type: 'commitment', id: oneToOne.id },
        subject: { id: person.id, name: 'Person Y' },
        recommendedTodoRequest: {
          tool: 'onmove.create_todo',
          arguments: {
            parent: { type: 'commitment', id: oneToOne.id },
            attribution: { mode: 'subject', subjectId: person.id }
          }
        }
      }
    })
    const recommendation = resolved.structuredContent as {
      target: {
        recommendedTodoRequest: {
          tool: string
          arguments: Record<string, unknown>
        }
      }
    }
    const scopedTodo = await client.callTool({
      name: recommendation.target.recommendedTodoRequest.tool,
      arguments: {
        ...recommendation.target.recommendedTodoRequest.arguments,
        name: 'Do X for Person Y'
      }
    })
    expect(scopedTodo.isError).not.toBe(true)
    expect(scopedTodo.structuredContent).toMatchObject({
      parent: {
        type: 'commitment-scope',
        id: oneToOne.id,
        scope: { scopeId: teamScope.scopeId, subjectId: person.id }
      }
    })

    await window.evaluate(async ({ threadId }) => {
      await window.onmove.domain.updateThread(threadId, { title: 'Edited in the live app' })
    }, { threadId: thread.id })
    const liveThread = await client.callTool({
      name: 'onmove.get_thread',
      arguments: { id: thread.id }
    })
    expect(liveThread.structuredContent).toMatchObject({
      entity: { title: 'Edited in the live app' },
      writeGuide: {
        createUpdate: {
          attributionMode: 'unscoped',
          subjectRequired: false,
          allowedSubjects: []
        }
      }
    })

    const invalidUpdate = await client.callTool({
      name: 'onmove.create_update',
      arguments: {
        parent: { type: 'thread', id: thread.id },
        subjectId: unrelatedSubject.id,
        richText: richText('Live recovery evidence')
      }
    })
    expect(invalidUpdate.isError).toBe(true)
    expect(invalidUpdate.structuredContent).toMatchObject({
      error: { code: 'open_parent_cannot_target_subject' },
      recovery: {
        retry: {
          tool: 'onmove.create_update',
          arguments: {
            parent: { type: 'thread', id: thread.id },
            attribution: { mode: 'unscoped' },
            richText: richText('Live recovery evidence')
          }
        }
      }
    })
    const recovered = invalidUpdate.structuredContent as {
      recovery: { retry: { tool: string; arguments: Record<string, unknown> } }
    }
    const recoveredUpdate = await client.callTool({
      name: recovered.recovery.retry.tool,
      arguments: recovered.recovery.retry.arguments
    })
    expect(recoveredUpdate.isError).not.toBe(true)
    const updatedThread = await client.callTool({
      name: 'onmove.get_thread',
      arguments: { id: thread.id }
    })
    expect(updatedThread.structuredContent).toMatchObject({
      updates: [expect.objectContaining({
        observation: 'Live recovery evidence',
        observationRichText: richText('Live recovery evidence'),
        scope: null
      })]
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
