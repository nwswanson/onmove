import { describe, expect, it } from 'vitest'
import { resolveDatabasePath } from '../../src/main/paths'

describe('resolveDatabasePath', () => {
  it('places SQLite inside Electron userData', () => {
    expect(resolveDatabasePath('/Users/test/Library/Application Support/OnMove')).toBe(
      '/Users/test/Library/Application Support/OnMove/onmove.sqlite3'
    )
  })

  it('does not escape the provided userData directory', () => {
    const userData = '/private/tmp/onmove-test-profile'
    expect(resolveDatabasePath(userData).startsWith(`${userData}/`)).toBe(true)
  })
})
