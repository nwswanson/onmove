const EXTERNAL_LINK_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

/** Keep renderer-authored links outside Electron and reject executable/local schemes. */
export function isAllowedExternalLink(value: string): boolean {
  try {
    return EXTERNAL_LINK_PROTOCOLS.has(new URL(value).protocol)
  } catch {
    return false
  }
}
