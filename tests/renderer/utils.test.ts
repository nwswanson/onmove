import { describe, expect, it } from 'vitest'
import { cn } from '../../src/renderer/src/lib/utils'

describe('cn', () => {
  it('combines conditional class names', () => {
    expect(cn('base', { hidden: false, active: true })).toBe('base active')
  })

  it('lets later Tailwind utilities win', () => {
    expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4')
  })
})
