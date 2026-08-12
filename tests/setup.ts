import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

if (typeof ResizeObserver === 'undefined') {
  class TestResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: TestResizeObserver,
    configurable: true
  })
}

if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => undefined
}

if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0)
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
}

afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})
