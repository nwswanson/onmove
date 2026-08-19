import { useEffect, useReducer, useState } from 'react'
import type { TagSummarySnapshot, TagUseSnapshot } from '../../../../shared/contracts'

interface UsesState {
  name: string | null
  uses: TagUseSnapshot[]
  error: string | null
}

const EMPTY_TAGS: readonly TagSummarySnapshot[] = []

export interface TagsModel {
  tags: readonly TagSummarySnapshot[]
  tagsLoading: boolean
  tagsError: string | null
  uses: readonly TagUseSnapshot[]
  usesLoading: boolean
  usesError: string | null
}

/** Owns the two bounded preload queries and live rich-text invalidation. */
export function useTagsModel(selectedTag: string | null): TagsModel {
  const [refreshKey, refresh] = useReducer((value: number) => value + 1, 0)
  const [tags, setTags] = useState<TagSummarySnapshot[] | null>(null)
  const [tagsError, setTagsError] = useState<string | null>(null)
  const [usesState, setUsesState] = useState<UsesState>({
    name: null,
    uses: [],
    error: null
  })

  useEffect(() => window.onmove.richText.onDocumentChanged(() => refresh()), [])
  useEffect(() => window.onmove.onDomainChanged(() => refresh()), [])

  useEffect(() => {
    let active = true
    window.onmove.domain.listTags().then(
      (next) => {
        if (!active) return
        setTags(next)
        setTagsError(null)
      },
      () => {
        if (!active) return
        setTagsError('Tags could not be loaded.')
      }
    )
    return () => {
      active = false
    }
  }, [refreshKey])

  useEffect(() => {
    if (selectedTag === null) return
    let active = true
    window.onmove.domain.listTagUses(selectedTag).then(
      (uses) => {
        if (!active) return
        setUsesState({ name: selectedTag, uses, error: null })
      },
      () => {
        if (!active) return
        setUsesState({ name: selectedTag, uses: [], error: 'Tag uses could not be loaded.' })
      }
    )
    return () => {
      active = false
    }
  }, [refreshKey, selectedTag])

  return {
    tags: tags ?? EMPTY_TAGS,
    tagsLoading: tags === null && tagsError === null,
    tagsError,
    uses: usesState.name === selectedTag ? usesState.uses : [],
    usesLoading: selectedTag !== null && usesState.name !== selectedTag,
    usesError: usesState.name === selectedTag ? usesState.error : null
  }
}
