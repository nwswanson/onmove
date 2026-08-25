import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import type { OnMoveRichTextDocument } from '../../src/shared/rich-text-document'

function richText(text: string): OnMoveRichTextDocument {
  return {
    version: 1,
    blocks: [{ type: 'paragraph', children: [{ type: 'text', text }] }]
  }
}

describe('hierarchical MCP permissions', () => {
  let directory: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-mcp-access-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function hierarchy(title: string): { focusId: number; threadId: number; noteId: number } {
    const focus = database.domain.focuses.create({ title }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: `${title} Thread`,
      reviewFrequencyDays: 7
    }).snapshot()
    return { focusId: focus.id, threadId: thread.id, noteId: thread.notes[0].id }
  }

  it('stores bounded defaults and only explicit hierarchy exceptions', () => {
    const first = hierarchy('First')
    const initial = database.mcpSettings.get()
    expect(Object.keys(initial.permissionPolicy.defaults)).toHaveLength(8)
    expect(initial.permissionPolicy.defaults.note).toEqual({
      view: true, edit: false, delete: false
    })
    expect(initial.permissionPolicy.overrides).toEqual([])

    const changed = database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: first.focusId },
        resource: 'all',
        view: false,
        edit: false
      }
    })
    expect(changed.permissionPolicy.overrides).toEqual([{
      target: { type: 'focus', id: first.focusId },
      resource: 'all',
      view: false,
      edit: false,
      delete: null
    }])

    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: first.focusId },
        resource: 'all',
        view: null,
        edit: null
      }
    })
    expect(database.mcpSettings.get().permissionPolicy.overrides).toEqual([])
  })

  it('supports a Focus whitelist, a Thread exception, and resource-specific precedence', () => {
    const allowed = hierarchy('Allowed')
    const blocked = hierarchy('Blocked')
    database.mcpSettings.update({
      permission: {
        target: { type: 'default' }, resource: 'all', view: false, edit: false
      }
    })
    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: allowed.focusId },
        resource: 'all', view: true, edit: true
      }
    })

    let access = database.mcpSettings.accessPolicy()
    expect(database.queries.getThread(allowed.threadId, access)).not.toBeNull()
    expect(database.queries.getThread(blocked.threadId, access)).toBeNull()

    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: allowed.threadId },
        resource: 'all', view: false, edit: false
      }
    })
    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: allowed.threadId },
        resource: 'note', view: true, edit: true
      }
    })
    access = database.mcpSettings.accessPolicy()
    expect(database.queries.getThread(allowed.threadId, access)).toBeNull()
    expect(database.queries.getNote(allowed.noteId, access)).not.toBeNull()
    expect(database.commands.updateNote({
      id: allowed.noteId,
      expectedRevision: 0,
      document: richText('Allowed through the Note-specific Thread rule')
    }, access)).toMatchObject({ revision: 1 })
  })

  it('re-reads view and edit independently and removes nested rules with a Focus policy', () => {
    const target = hierarchy('Policy target')
    database.mcpSettings.update({
      permission: {
        target: { type: 'default' }, resource: 'note', view: true, edit: false
      }
    })
    expect(() => database.commands.updateNote({
      id: target.noteId,
      expectedRevision: 0,
      document: richText('Denied edit')
    }, database.mcpSettings.accessPolicy())).toThrow('note editing is disabled')

    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: target.threadId },
        resource: 'note', edit: true
      }
    })
    expect(database.commands.updateNote({
      id: target.noteId,
      expectedRevision: 0,
      document: richText('Allowed edit')
    }, database.mcpSettings.accessPolicy())).toMatchObject({ revision: 1 })

    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: target.focusId },
        resource: 'all', view: false, edit: false
      }
    })
    database.mcpSettings.update({ removePermissionTarget: {
      type: 'focus', id: target.focusId
    } })
    expect(database.mcpSettings.get().permissionPolicy.overrides).toEqual([])
  })

  it('keeps delete independent from edit and resolves it through hierarchy overrides', () => {
    const target = hierarchy('Deletion target')
    database.mcpSettings.update({
      permission: {
        target: { type: 'default' }, resource: 'note', view: true, edit: true,
        delete: false
      }
    })
    expect(() => database.commands.deleteEntity(
      { type: 'note', id: target.noteId },
      database.mcpSettings.accessPolicy()
    )).toThrow('note deletion is disabled')
    expect(database.domain.notes.find(target.noteId)).not.toBeNull()

    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: target.threadId },
        resource: 'note', edit: false, delete: true
      }
    })
    expect(database.commands.deleteEntity(
      { type: 'note', id: target.noteId },
      database.mcpSettings.accessPolicy()
    )).toMatchObject({
      deleted: true,
      reference: { type: 'note', id: target.noteId },
      updatesUseArchive: false
    })
    expect(database.domain.notes.find(target.noteId)).toBeNull()
  })

  it('authorizes parent cascades by the parent grant and preserves referentially used Subjects', () => {
    const target = hierarchy('Cascade deletion target')
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: target.threadId },
      observation: 'Evidence rescued from a parent cascade'
    }).toSnapshot()
    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: target.focusId },
        resource: 'focus', delete: true
      }
    })
    expect(database.commands.deleteEntity(
      { type: 'focus', id: target.focusId },
      database.mcpSettings.accessPolicy()
    )).toMatchObject({ deleted: true, updatesUseArchive: true })
    expect(database.domain.archivedUpdates.listForOriginalUpdate(update.id)).toHaveLength(1)

    const retained = hierarchy('Subject history owner')
    const scoped = database.domain.focusScopes.addSubject(retained.focusId, {
      name: 'Historically attributed person'
    })
    const subject = scoped.subjects[0]
    database.mcpSettings.update({
      permission: {
        target: { type: 'default' }, resource: 'subject', delete: true
      }
    })
    expect(() => database.commands.deleteEntity(
      { type: 'subject', id: subject.id },
      database.mcpSettings.accessPolicy()
    )).toThrow('cannot be deleted while Scope or Update history references it')
    expect(database.domain.subjects.find(subject.id)).not.toBeNull()
  })

  it('filters global search before pagination and changes immediately without reconnecting', () => {
    const visible = hierarchy('Visible literal needle')
    const hidden = hierarchy('Hidden literal needle')
    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: hidden.focusId },
        resource: 'all', view: false, edit: false
      }
    })
    expect(database.queries.search(
      { text: 'literal needle', limit: 1 }, database.mcpSettings.accessPolicy()
    )).toEqual([expect.objectContaining({
      reference: { type: 'focus', id: visible.focusId }
    })])

    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: hidden.focusId },
        resource: 'focus', view: true
      }
    })
    expect(database.queries.search(
      { text: 'hidden literal' }, database.mcpSettings.accessPolicy()
    )[0]).toMatchObject({ reference: { type: 'focus', id: hidden.focusId } })
  })
})
