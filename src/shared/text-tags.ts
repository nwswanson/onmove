export interface TextTagMatch {
  /** The complete durable token, including its leading @. */
  value: string
  /** The alphanumeric identifier without its leading @. */
  name: string
  start: number
  end: number
}

// Tags are deliberately conservative for the first durable format. They are
// Unicode alphanumeric identifiers, are not recognized inside email-like words,
// and reject hyphenated or underscored continuations rather than silently
// styling only a misleading prefix.
const TEXT_TAG_PATTERN = /(^|[^\p{L}\p{N}@])(@[\p{L}\p{N}]+)(?![\p{L}\p{N}_-])/gu

/** Finds every durable @tag token without assigning domain identity or links. */
export function findTextTags(value: string): TextTagMatch[] {
  const matches: TextTagMatch[] = []
  for (const match of value.matchAll(TEXT_TAG_PATTERN)) {
    const token = match[2]
    if (match.index === undefined || token === undefined) continue
    const start = match.index + (match[1]?.length ?? 0)
    matches.push({
      value: token,
      name: token.slice(1),
      start,
      end: start + token.length
    })
  }
  return matches
}

export function firstTextTag(value: string): TextTagMatch | null {
  return findTextTags(value)[0] ?? null
}
