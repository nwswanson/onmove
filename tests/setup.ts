import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})
