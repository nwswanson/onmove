export interface SensitiveRecord {
  sensitive: boolean
}

/**
 * The renderer's single hierarchy-aware visibility rule. Domain snapshots remain
 * complete; collection owners call this before handing records to UI receivers.
 */
export function sensitiveRecordIsVisible(
  record: SensitiveRecord,
  hideSensitiveContent: boolean,
  ancestorSensitive = false
): boolean {
  return !hideSensitiveContent || (!ancestorSensitive && !record.sensitive)
}

export function visibleSensitiveRecords<T extends SensitiveRecord>(
  records: readonly T[],
  hideSensitiveContent: boolean,
  ancestorSensitive = false
): T[] {
  return records.filter((record) =>
    sensitiveRecordIsVisible(record, hideSensitiveContent, ancestorSensitive)
  )
}
