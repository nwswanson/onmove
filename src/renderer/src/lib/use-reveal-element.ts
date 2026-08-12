import { useEffect, useRef, type RefObject } from 'react'

const REVEAL_OPTIONS: ScrollIntoViewOptions = {
  behavior: 'smooth',
  block: 'nearest',
  inline: 'nearest'
}

/**
 * Reveals a newly mounted or newly activated region with the least scrolling
 * needed to fit it inside its scrollable workspace.
 */
export function useRevealElement<T extends HTMLElement>(enabled = true): RefObject<T | null> {
  const elementRef = useRef<T>(null)

  useEffect(() => {
    if (!enabled) return

    // Rich editors finish focus initialization and toolbar wrapping after the
    // card mounts. Waiting through two frames measures the settled card instead
    // of revealing its shorter pre-layout shape.
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        elementRef.current?.scrollIntoView(REVEAL_OPTIONS)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [enabled])

  return elementRef
}
