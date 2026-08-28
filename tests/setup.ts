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

// Excalidraw probes a 2D context while its module loads. Scene-model tests do
// not paint, but jsdom's default getContext implementation throws before the
// pure conversion helpers can be exercised.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value() {
      return {
        canvas: this,
        filter: 'none',
        measureText: (text: string) => ({ width: text.length * 8 })
      }
    }
  })
}

if (typeof FontFace === 'undefined') {
  class TestFontFace {
    family: string
    status: FontFaceLoadStatus = 'loaded'

    constructor(family: string) {
      this.family = family
    }

    load(): Promise<TestFontFace> {
      return Promise.resolve(this)
    }
  }
  Object.defineProperty(globalThis, 'FontFace', {
    value: TestFontFace,
    configurable: true
  })
}

if (typeof document !== 'undefined' && !document.fonts) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: () => undefined,
      check: () => true,
      load: () => Promise.resolve([]),
      ready: Promise.resolve()
    }
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
