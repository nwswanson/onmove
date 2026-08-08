import { describe, expect, it } from 'vitest'
import {
  sensitiveRecordIsVisible,
  visibleSensitiveRecords
} from '../../src/renderer/src/features/shared/sensitivity'

describe('sensitive hierarchy visibility', () => {
  const publicRecord = { id: 1, sensitive: false }
  const sensitiveRecord = { id: 2, sensitive: true }

  it('leaves complete collections intact while hiding is disabled', () => {
    expect(
      visibleSensitiveRecords([publicRecord, sensitiveRecord], false, true)
    ).toEqual([publicRecord, sensitiveRecord])
  })

  it('filters records with their own sensitive flag', () => {
    expect(visibleSensitiveRecords([publicRecord, sensitiveRecord], true)).toEqual([
      publicRecord
    ])
  })

  it('filters an entire descendant collection when an ancestor is sensitive', () => {
    expect(visibleSensitiveRecords([publicRecord, sensitiveRecord], true, true)).toEqual([])
    expect(sensitiveRecordIsVisible(publicRecord, true, true)).toBe(false)
  })
})
