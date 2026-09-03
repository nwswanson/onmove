import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  EditUpdateInput,
  RichTextDocumentContextSegment,
  RichTextDocumentReference,
  RichTextDocumentSnapshot,
  RichTextDocumentSubjectContext,
  RichTextDocumentUpdateMetadata
} from '../../../../shared/contracts'

export function richTextReferencesEqual(
  left: RichTextDocumentReference,
  right: RichTextDocumentReference
): boolean {
  return left.type === right.type && left.id === right.id && left.field === right.field
}

export interface DurableRichTextModel {
  title: string
  kind: RichTextDocumentSnapshot['kind']
  context: readonly RichTextDocumentContextSegment[]
  subject: RichTextDocumentSubjectContext | null
  updateMetadata: RichTextDocumentUpdateMetadata | null
  value: string
  /** Durable database revision, including revisions committed by this editor. */
  revision: number
  /** Changes only when Lexical must apply a value originating outside this editor. */
  externalRevision: number
  saving: boolean
  error: string | null
  metadataSaving: boolean
  metadataError: string | null
  save: (value: string) => void
  saveUpdateMetadata: (input: EditUpdateInput) => Promise<void>
  openInWindow: () => void
}

function documentSnapshotsEqual(
  left: RichTextDocumentSnapshot,
  right: RichTextDocumentSnapshot
): boolean {
  return (
    richTextReferencesEqual(left.reference, right.reference) &&
    left.title === right.title &&
    left.kind === right.kind &&
    left.value === right.value &&
    left.revision === right.revision &&
    left.updatedAt === right.updatedAt &&
    left.subject?.id === right.subject?.id &&
    left.subject?.name === right.subject?.name &&
    left.updateMetadata?.date === right.updateMetadata?.date &&
    left.updateMetadata?.state === right.updateMetadata?.state &&
    left.updateMetadata?.sensitive === right.updateMetadata?.sensitive &&
    left.context.length === right.context.length &&
    left.context.every((segment, index) =>
      segment.kind === right.context[index]?.kind &&
      segment.title === right.context[index]?.title)
  )
}

function documentSnapshotIsOlder(
  candidate: RichTextDocumentSnapshot,
  current: RichTextDocumentSnapshot
): boolean {
  if (candidate.revision !== current.revision) return candidate.revision < current.revision
  return Boolean(
    candidate.updatedAt && current.updatedAt && candidate.updatedAt < current.updatedAt
  )
}

function documentSnapshotIsStrictlyNewer(
  candidate: RichTextDocumentSnapshot,
  current: RichTextDocumentSnapshot
): boolean {
  if (candidate.revision !== current.revision) return candidate.revision > current.revision
  if (!candidate.updatedAt) return false
  return !current.updatedAt || candidate.updatedAt > current.updatedAt
}

/**
 * Feature-owned bridge between a generic editor and the durable rich-text IPC.
 * A save is synchronous by contract: when `save` returns, SQLite contains the
 * new value. Revision broadcasts keep other mounted editors current.
 */
export function useDurableRichText(
  reference: RichTextDocumentReference,
  initialValue = ''
): DurableRichTextModel {
  const initialDocument: RichTextDocumentSnapshot = {
    reference,
    title: '',
    kind: reference.type === 'focus' ? 'description' : reference.type,
    context: [],
    subject: null,
    updateMetadata: null,
    value: initialValue,
    revision: 0,
    updatedAt: ''
  }
  const [document, setDocument] = useState<RichTextDocumentSnapshot>(initialDocument)
  const documentRef = useRef(initialDocument)
  const initialValueRef = useRef(initialValue)
  const syncEpochRef = useRef(0)
  const metadataRequestRef = useRef(0)
  const [externalRevision, setExternalRevision] = useState(0)
  const [error, setError] = useState<{
    reference: RichTextDocumentReference
    message: string
  } | null>(null)
  const [metadataSaving, setMetadataSaving] = useState<{
    reference: RichTextDocumentReference
    requestId: number
  } | null>(null)
  const [metadataError, setMetadataError] = useState<{
    reference: RichTextDocumentReference
    message: string
  } | null>(null)
  const stableReference = useMemo<RichTextDocumentReference>(() => {
    if (reference.type === 'focus') {
      return { type: 'focus', id: reference.id, field: reference.field }
    }
    if (reference.type === 'update') {
      return { type: 'update', id: reference.id, field: 'observation' }
    }
    return { type: 'note', id: reference.id, field: 'content' }
  }, [reference.field, reference.id, reference.type])

  useLayoutEffect(() => {
    initialValueRef.current = initialValue
  }, [initialValue])

  useEffect(() => {
    let active = true
    metadataRequestRef.current += 1
    if (!richTextReferencesEqual(documentRef.current.reference, stableReference)) {
      const placeholder: RichTextDocumentSnapshot = {
        reference: stableReference,
        title: '',
        kind: stableReference.type === 'focus' ? 'description' : stableReference.type,
        context: [],
        subject: null,
        updateMetadata: null,
        value: initialValueRef.current,
        revision: 0,
        updatedAt: ''
      }
      documentRef.current = placeholder
      syncEpochRef.current += 1
      setDocument(placeholder)
      setExternalRevision((current) => current + 1)
    }
    const loadEpoch = syncEpochRef.current
    window.onmove.richText.getDocument(stableReference).then(
      (nextDocument) => {
        if (!active) return
        const current = documentRef.current
        const changedWhileLoading = syncEpochRef.current !== loadEpoch
        if (
          !richTextReferencesEqual(current.reference, stableReference) ||
          documentSnapshotIsOlder(nextDocument, current) ||
          (changedWhileLoading && !documentSnapshotIsStrictlyNewer(nextDocument, current))
        ) return
        if (documentSnapshotsEqual(nextDocument, current)) {
          setError(null)
          return
        }
        const textChanged = nextDocument.value !== current.value
        documentRef.current = nextDocument
        syncEpochRef.current += 1
        setDocument(nextDocument)
        // Initial hydration is an external synchronization even when a newly
        // created document legitimately contains text at durable revision 0.
        if (textChanged) setExternalRevision((revision) => revision + 1)
        setError(null)
      },
      () => {
        if (
          active &&
          syncEpochRef.current === loadEpoch &&
          richTextReferencesEqual(documentRef.current.reference, stableReference)
        ) {
          setError({
            reference: stableReference,
            message: 'This text could not be loaded.'
          })
        }
      }
    )
    const unsubscribe = window.onmove.richText.onDocumentChanged(({ document: changed }) => {
      if (!richTextReferencesEqual(changed.reference, stableReference)) return
      const current = documentRef.current
      if (
        documentSnapshotIsOlder(changed, current) ||
        documentSnapshotsEqual(changed, current)
      ) return
      const textChanged = changed.value !== current.value
      documentRef.current = changed
      syncEpochRef.current += 1
      setDocument(changed)
      // Metadata broadcasts can share an observation revision. Reconcile that
      // metadata without making Lexical process it as a text replacement.
      if (textChanged) setExternalRevision((revision) => revision + 1)
      setError(null)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [stableReference])

  const save = useCallback((value: string): void => {
    try {
      const saved = window.onmove.richText.saveDocument(stableReference, value)
      documentRef.current = saved
      syncEpochRef.current += 1
      setDocument(saved)
      setError(null)
    } catch {
      setError({
        reference: stableReference,
        message: 'This text could not be saved. Keep this window open and try typing again.'
      })
    }
  }, [stableReference])

  const openInWindow = useCallback((): void => {
    void window.onmove.richText.openWindow(stableReference)
  }, [stableReference])

  const saveUpdateMetadata = useCallback(async (input: EditUpdateInput): Promise<void> => {
    if (stableReference.type !== 'update') return
    const requestId = ++metadataRequestRef.current
    const current = documentRef.current
    if (richTextReferencesEqual(current.reference, stableReference) && current.updateMetadata) {
      const optimistic = {
        ...current,
        updateMetadata: { ...current.updateMetadata, ...input }
      }
      documentRef.current = optimistic
      syncEpochRef.current += 1
      setDocument(optimistic)
    }
    const requestEpoch = syncEpochRef.current
    setMetadataSaving({ reference: stableReference, requestId })
    setMetadataError(null)
    try {
      const updated = await window.onmove.domain.updateUpdate(stableReference.id, input)
      if (metadataRequestRef.current !== requestId) return
      const latest = documentRef.current
      if (richTextReferencesEqual(latest.reference, stableReference)) {
        const candidate = {
          ...latest,
          updateMetadata: {
            date: updated.date,
            state: updated.state,
            sensitive: updated.sensitive
          },
          updatedAt: updated.updatedAt
        }
        const changedWhileSaving = syncEpochRef.current !== requestEpoch
        if (
          !documentSnapshotIsOlder(candidate, latest) &&
          (!changedWhileSaving || documentSnapshotIsStrictlyNewer(candidate, latest)) &&
          !documentSnapshotsEqual(candidate, latest)
        ) {
          documentRef.current = candidate
          syncEpochRef.current += 1
          setDocument(candidate)
        }
      }
    } catch {
      if (
        metadataRequestRef.current !== requestId ||
        !richTextReferencesEqual(documentRef.current.reference, stableReference)
      ) return
      setMetadataError({
        reference: stableReference,
        message: 'The Update details could not be saved.'
      })
      const recoveryEpoch = syncEpochRef.current
      void window.onmove.richText.getDocument(stableReference).then((nextDocument) => {
        if (metadataRequestRef.current !== requestId) return
        const latest = documentRef.current
        const changedWhileRecovering = syncEpochRef.current !== recoveryEpoch
        if (
          !richTextReferencesEqual(latest.reference, stableReference) ||
          documentSnapshotIsOlder(nextDocument, latest) ||
          (changedWhileRecovering && !documentSnapshotIsStrictlyNewer(nextDocument, latest)) ||
          documentSnapshotsEqual(nextDocument, latest)
        ) return
        const textChanged = nextDocument.value !== latest.value
        documentRef.current = nextDocument
        syncEpochRef.current += 1
        setDocument(nextDocument)
        if (textChanged) setExternalRevision((revision) => revision + 1)
      }, () => undefined)
    } finally {
      setMetadataSaving((currentSaving) =>
        currentSaving?.requestId === requestId &&
        richTextReferencesEqual(currentSaving.reference, stableReference)
          ? null
          : currentSaving)
    }
  }, [stableReference])

  const activeDocument: RichTextDocumentSnapshot = richTextReferencesEqual(
    document.reference,
    stableReference
  )
    ? document
    : {
        reference: stableReference,
        title: '',
        kind: stableReference.type === 'focus' ? 'description' : stableReference.type,
        context: [],
        subject: null,
        updateMetadata: null,
        value: initialValue,
        revision: 0,
        updatedAt: ''
      }

  return {
    title: activeDocument.title,
    kind: activeDocument.kind,
    context: activeDocument.context,
    subject: activeDocument.subject,
    updateMetadata: activeDocument.updateMetadata,
    value: activeDocument.value,
    revision: activeDocument.revision,
    externalRevision,
    saving: false,
    error: error && richTextReferencesEqual(error.reference, stableReference)
      ? error.message
      : null,
    metadataSaving: Boolean(
      metadataSaving && richTextReferencesEqual(metadataSaving.reference, stableReference)
    ),
    metadataError: metadataError &&
      richTextReferencesEqual(metadataError.reference, stableReference)
      ? metadataError.message
      : null,
    save,
    saveUpdateMetadata,
    openInWindow
  }
}
