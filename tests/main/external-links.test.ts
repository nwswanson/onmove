import { describe, expect, it } from 'vitest'
import { isAllowedExternalLink } from '../../src/main/external-links'

describe('external links', () => {
  it('allows ordinary web and email links while rejecting executable and local schemes', () => {
    expect(isAllowedExternalLink('https://example.com/path')).toBe(true)
    expect(isAllowedExternalLink('http://localhost:5173')).toBe(true)
    expect(isAllowedExternalLink('mailto:owner@example.com')).toBe(true)
    expect(isAllowedExternalLink('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalLink('file:///Users/test/secret.txt')).toBe(false)
    expect(isAllowedExternalLink('data:text/html,hello')).toBe(false)
    expect(isAllowedExternalLink('not a url')).toBe(false)
  })
})
