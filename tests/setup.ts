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

if (typeof CSS !== 'undefined' && typeof CSS.supports !== 'function') {
  Object.defineProperty(CSS, 'supports', {
    value: () => false,
    configurable: true
  })
}

if (typeof Image !== 'undefined' && typeof Image.prototype.decode !== 'function') {
  Object.defineProperty(Image.prototype, 'decode', {
    value: () => Promise.resolve(),
    configurable: true
  })
}

// jsdom does not currently expose these event constructors. Lexical uses
// instanceof checks while handling the default (non-intercepted) paste path.
if (typeof window !== 'undefined' && typeof DragEvent === 'undefined') {
  class TestDragEvent extends MouseEvent {}
  Object.defineProperty(globalThis, 'DragEvent', {
    value: TestDragEvent,
    configurable: true
  })
  Object.defineProperty(window, 'DragEvent', {
    value: TestDragEvent,
    configurable: true
  })
}

if (typeof window !== 'undefined' && typeof ClipboardEvent === 'undefined') {
  class TestClipboardEvent extends Event {}
  Object.defineProperty(globalThis, 'ClipboardEvent', {
    value: TestClipboardEvent,
    configurable: true
  })
  Object.defineProperty(window, 'ClipboardEvent', {
    value: TestClipboardEvent,
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
