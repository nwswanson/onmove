import { useCallback, useEffect, useMemo, useState } from 'react'
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
  revision: number
  saving: boolean
  error: string | null
  metadataSaving: boolean
  metadataError: string | null
  save: (value: string) => void
  saveUpdateMetadata: (input: EditUpdateInput) => Promise<void>
  openInWindow: () => void
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
  const [document, setDocument] = useState<RichTextDocumentSnapshot>({
    reference,
    title: '',
    kind: reference.type === 'focus' ? 'description' : reference.type,
    context: [],
    subject: null,
    updateMetadata: null,
    value: initialValue,
    revision: 0,
    updatedAt: ''
  })
  const [error, setError] = useState<string | null>(null)
  const [metadataSaving, setMetadataSaving] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const stableReference = useMemo<RichTextDocumentReference>(() => {
    if (reference.type === 'focus') {
      return { type: 'focus', id: reference.id, field: reference.field }
    }
    if (reference.type === 'update') {
      return { type: 'update', id: reference.id, field: 'observation' }
    }
    return { type: 'note', id: reference.id, field: 'content' }
  }, [reference.field, reference.id, reference.type])

  useEffect(() => {
    let active = true
    window.onmove.richText.getDocument(stableReference).then(
      (nextDocument) => active && setDocument((current) =>
        richTextReferencesEqual(current.reference, stableReference) &&
        current.revision > nextDocument.revision
          ? current
          : nextDocument
      ),
      () => active && setError('This text could not be loaded.')
    )
    const unsubscribe = window.onmove.richText.onDocumentChanged(({ document: changed }) => {
      if (!richTextReferencesEqual(changed.reference, stableReference)) return
      setDocument((current) => changed.revision >= current.revision ? changed : current)
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
      setDocument(saved)
      setError(null)
    } catch {
      setError('This text could not be saved. Keep this window open and try typing again.')
    }
  }, [stableReference])

  const openInWindow = useCallback((): void => {
    void window.onmove.richText.openWindow(stableReference)
  }, [stableReference])

  const saveUpdateMetadata = useCallback(async (input: EditUpdateInput): Promise<void> => {
    if (stableReference.type !== 'update') return
    setDocument((current) =>
      richTextReferencesEqual(current.reference, stableReference) && current.updateMetadata
        ? { ...current, updateMetadata: { ...current.updateMetadata, ...input } }
        : current)
    setMetadataSaving(true)
    setMetadataError(null)
    try {
      const updated = await window.onmove.domain.updateUpdate(stableReference.id, input)
      setDocument((current) => richTextReferencesEqual(current.reference, stableReference)
        ? {
            ...current,
            updateMetadata: {
              date: updated.date,
              state: updated.state,
              sensitive: updated.sensitive
            },
            updatedAt: updated.updatedAt
          }
        : current)
    } catch {
      setMetadataError('The Update details could not be saved.')
      void window.onmove.richText.getDocument(stableReference).then(setDocument, () => undefined)
    } finally {
      setMetadataSaving(false)
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
    saving: false,
    error,
    metadataSaving,
    metadataError,
    save,
    saveUpdateMetadata,
    openInWindow
  }
}
