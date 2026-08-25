import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('visual sidebar folders', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-sidebar-folders-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('persists separately ordered Focus and per-Focus Thread folders', () => {
    const focus = database.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    database.sidebarFolders.create({ area: { type: 'focus' }, name: 'Z Later' })
    const focusFolders = database.sidebarFolders.create({
      area: { type: 'focus' },
      name: 'A First'
    })
    const focusFolder = focusFolders.find(({ name }) => name === 'A First')
    if (!focusFolder) throw new Error('Expected Focus folder')
    const threadFolders = database.sidebarFolders.create({
      area: { type: 'thread', focusId: focus.id },
      name: 'Delivery 2026'
    })
    const threadFolder = threadFolders.find(({ area }) => area.type === 'thread')
    if (!threadFolder) throw new Error('Expected Thread folder')

    database.sidebarFolders.setMembership({ type: 'focus', id: focus.id }, focusFolder.id)
    database.sidebarFolders.setMembership({ type: 'thread', id: thread.id }, threadFolder.id)

    expect(database.sidebarFolders.list()).toEqual([
      expect.objectContaining({
        id: focusFolder.id,
        name: 'A First',
        area: { type: 'focus' },
        targetIds: [focus.id]
      }),
      expect.objectContaining({ name: 'Z Later', targetIds: [] }),
      expect.objectContaining({
        id: threadFolder.id,
        name: 'Delivery 2026',
        area: { type: 'thread', focusId: focus.id },
        targetIds: [thread.id]
      })
    ])

    database.close()
    database = new AppDatabase(databasePath)
    expect(database.sidebarFolders.list()).toHaveLength(3)
  })

  it('deletes only visual organization and leaves every contained record intact', () => {
    const focus = database.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    let folders = database.sidebarFolders.create({
      area: { type: 'thread', focusId: focus.id },
      name: 'Operations'
    })
    database.sidebarFolders.setMembership({ type: 'thread', id: thread.id }, folders[0].id)

    folders = database.sidebarFolders.delete(folders[0].id)

    expect(folders).toEqual([])
    expect(database.domain.threads.requireModel(thread.id).snapshot()).toMatchObject({
      id: thread.id,
      focusId: focus.id,
      title: 'Sprint execution'
    })
  })

  it('clears Thread folder membership when the Thread moves to another Focus', () => {
    const source = database.domain.focuses.create({ title: 'Source' })
    const target = database.domain.focuses.create({ title: 'Target' })
    const thread = database.domain.threads.create({
      focusId: source.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const folder = database.sidebarFolders.create({
      area: { type: 'thread', focusId: source.id },
      name: 'Delivery'
    })[0]
    database.sidebarFolders.setMembership({ type: 'thread', id: thread.id }, folder.id)

    thread.moveTo({
      focusId: target.id,
      plannedFromFocusId: source.id,
      confirmedScopeSubjectIds: []
    })

    expect(database.sidebarFolders.list()[0].targetIds).toEqual([])
  })

  it('rejects punctuation, duplicates, nonexistent records, and cross-Focus placement', () => {
    const first = database.domain.focuses.create({ title: 'First' })
    const second = database.domain.focuses.create({ title: 'Second' })
    const thread = database.domain.threads.create({
      focusId: first.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    expect(() => database.sidebarFolders.create({
      area: { type: 'focus' },
      name: 'Not-Allowed'
    })).toThrow('only letters, numbers')
    database.sidebarFolders.create({ area: { type: 'focus' }, name: 'Planning' })
    expect(() => database.sidebarFolders.create({
      area: { type: 'focus' },
      name: 'planning'
    })).toThrow('already exists')
    const foreignFolder = database.sidebarFolders.create({
      area: { type: 'thread', focusId: second.id },
      name: 'Other'
    }).find(({ area }) => area.type === 'thread')
    if (!foreignFolder) throw new Error('Expected Thread folder')
    expect(() => database.sidebarFolders.setMembership(
      { type: 'thread', id: thread.id },
      foreignFolder.id
    )).toThrow('current Focus')
    expect(() => database.sidebarFolders.setMembership(
      { type: 'focus', id: 999_999 },
      null
    )).toThrow('does not exist')
  })
})
