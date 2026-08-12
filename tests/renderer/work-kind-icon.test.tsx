// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkKindIcon } from '../../src/renderer/src/features/shared/work-kind-icon'

describe('WorkKindIcon', () => {
  it('owns distinct accessible glyphs for Focus, Thread, and Commitment', () => {
    render(
      <>
        <WorkKindIcon kind="focus" />
        <WorkKindIcon kind="thread" />
        <WorkKindIcon kind="commitment" />
      </>
    )

    const focus = screen.getByRole('img', { name: 'Focus type' })
    const thread = screen.getByRole('img', { name: 'Thread type' })
    const commitment = screen.getByRole('img', { name: 'Commitment type' })

    expect(focus).toHaveAttribute('title', 'Focus')
    expect(focus.querySelector('svg')).toHaveClass('lucide-target')
    expect(thread).toHaveAttribute('title', 'Thread')
    expect(thread.querySelector('svg')).toHaveClass('lucide-git-branch')
    expect(commitment).toHaveAttribute('title', 'Commitment')
    expect(commitment.querySelector('svg')).toHaveClass('lucide-handshake')
  })
})
