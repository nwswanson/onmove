// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { findTextTags } from '../../src/shared/text-tags'
import {
  TaggedInput,
  TaggedText
} from '../../src/renderer/src/components/ui/tagged-text'

describe('durable text tags', () => {
  it('recognizes only standalone Unicode alphanumeric tokens', () => {
    expect(findTextTags(
      '@Alpha2, @123 @team-health @team_name person@example.com @@double and (@Final).'
    )).toEqual([
      { value: '@Alpha2', name: 'alpha2', start: 0, end: 7 },
      { value: '@123', name: '123', start: 9, end: 13 },
      { value: '@Final', name: 'final', start: 71, end: 77 }
    ])
    expect(findTextTags('@Équipe2 and @東京3').map(({ value }) => value))
      .toEqual(['@Équipe2', '@東京3'])
    expect(findTextTags('@Équipe2 @İ').map(({ name }) => name))
      .toEqual(['équipe2', 'i'])
  })

  it('renders valid tokens visually without changing their text', () => {
    render(<TaggedText value="Review @Launch2, not @launch-plan or owner@example.com" />)

    expect(screen.getByText('@Launch2')).toHaveAttribute('data-text-tag')
    expect(document.querySelectorAll('[data-text-tag]')).toHaveLength(1)
    expect(document.body).toHaveTextContent(
      'Review @Launch2, not @launch-plan or owner@example.com'
    )
  })

  it('keeps a native input value and emits literal tag syntax while highlighting it', async () => {
    const onValue = vi.fn()
    const user = userEvent.setup()

    function Fixture(): React.JSX.Element {
      const [value, setValue] = useState('Ship')
      return (
        <TaggedInput
          aria-label="Tagged title"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            onValue(event.target.value)
          }}
        />
      )
    }

    render(<Fixture />)
    const input = screen.getByRole('textbox', { name: 'Tagged title' })
    await user.type(input, ' with @Release2')

    expect(input).toHaveValue('Ship with @Release2')
    expect(screen.getByText('@Release2')).toHaveAttribute('data-text-tag')
    expect(onValue).toHaveBeenLastCalledWith('Ship with @Release2')
  })
})
