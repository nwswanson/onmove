// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  getSunflowerSeedLimit,
  limitSunflowerSeeds,
  SemanticSunflower,
  validateSemanticSunflowerModel
} from '../../src/renderer/src/components/ui/sunflower'

describe('Sunflower', () => {
  it('keeps its generic limiting helpers deterministic', () => {
    expect(getSunflowerSeedLimit(24, { minSeedDiameter: 1 })).toBeGreaterThan(10)
    expect(limitSunflowerSeeds(['red', 'red', 'green'], 2)).toEqual(['red', 'green'])
    expect(limitSunflowerSeeds(['red', 'red'], 2)).toEqual(['red', 'red'])
  })

  it('renders semantic product colors at the requested 24px size', () => {
    render(
      <SemanticSunflower
        model={{
          ariaLabel: 'Overall None; active commitments Green and Yellow',
          seeds: [
            { id: 'overall', label: 'Overall: None', tone: 'neutral' },
            { id: 'green', label: 'Healthy: Green', tone: 'success' },
            { id: 'yellow', label: 'Risk: Yellow', tone: 'warning' }
          ]
        }}
      />
    )

    const graphic = screen.getByRole('img', {
      name: 'Overall None; active commitments Green and Yellow'
    })
    expect(graphic).toHaveAttribute('width', '24')
    expect(graphic).toHaveAttribute('height', '24')
    expect(graphic.querySelector('circle')).toHaveAttribute('stroke', 'var(--primary)')
    expect(graphic.querySelector('[data-seed-index="0"]')).toHaveAttribute(
      'fill',
      'var(--muted-foreground)'
    )
    expect(graphic.querySelector('[data-seed-index="1"]')).toHaveAttribute(
      'fill',
      'var(--success)'
    )
    expect(graphic.querySelector('[data-seed-index="2"]')).toHaveAttribute(
      'fill',
      'var(--warning)'
    )
  })

  it('rejects empty labels, empty seed lists, and duplicate seed ids', () => {
    expect(() => validateSemanticSunflowerModel({ ariaLabel: '', seeds: [] })).toThrow(
      'requires an accessible label'
    )
    expect(() =>
      validateSemanticSunflowerModel({
        ariaLabel: 'Duplicate',
        seeds: [
          { id: 'same', label: 'One', tone: 'neutral' },
          { id: 'same', label: 'Two', tone: 'success' }
        ]
      })
    ).toThrow('invalid seed "same"')
  })
})
