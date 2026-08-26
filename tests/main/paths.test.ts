import { describe, expect, it } from 'vitest'
import {
  resolveBundledSemanticModelPath,
  resolveDatabasePath
} from '../../src/main/paths'

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

describe('resolveBundledSemanticModelPath', () => {
  it('uses the source-tree resource while developing', () => {
    expect(resolveBundledSemanticModelPath('/code/onmove', '/electron/resources', false)).toBe(
      '/code/onmove/resources/models/universal-sentence-encoder-lite-v1'
    )
  })

  it('uses the immutable Resources directory in a packaged application', () => {
    expect(resolveBundledSemanticModelPath('/Applications/OnMove.app', '/app/Contents/Resources', true)).toBe(
      '/app/Contents/Resources/models/universal-sentence-encoder-lite-v1'
    )
  })
})
