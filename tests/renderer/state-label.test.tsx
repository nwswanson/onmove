// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StateLabel } from '../../src/renderer/src/components/ui/state-label'

describe('StateLabel', () => {
  it.each([
    ['Red', 'danger', 'bg-destructive'],
    ['Yellow', 'warning', 'text-warning-foreground'],
    ['Green', 'success', 'text-success-foreground'],
    ['None', 'neutral', 'text-muted-foreground']
  ] as const)('renders %s as text and the %s semantic tone', (label, tone, className) => {
    render(<StateLabel model={{ label, tone }} />)

    const state = screen.getByText(label, { selector: `span[data-tone="${tone}"]` })
    expect(state).toHaveClass(className)
  })
})
