// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TEXT_AUTOSAVE_INTERVAL_MS,
  useThrottledAutosave
} from '../../src/renderer/src/lib/use-throttled-autosave'

describe('useThrottledAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves the latest draft at most once per throttle interval', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useThrottledAutosave({ initialValue: 'original', onSave })
    )

    act(() => result.current.schedule('first draft'))
    act(() => vi.advanceTimersByTime(TEXT_AUTOSAVE_INTERVAL_MS - 1))
    expect(onSave).not.toHaveBeenCalled()

    act(() => result.current.schedule('latest draft'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenLastCalledWith('latest draft')

    act(() => result.current.schedule('next interval'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEXT_AUTOSAVE_INTERVAL_MS)
    })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('next interval')
  })

  it('flushes on demand and serializes edits made during an in-flight save', async () => {
    let finishFirstSave: (() => void) | undefined
    const onSave = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          finishFirstSave = resolve
        })
      )
      .mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useThrottledAutosave({ initialValue: 'original', onSave })
    )

    act(() => result.current.schedule('first draft'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEXT_AUTOSAVE_INTERVAL_MS)
    })
    expect(onSave).toHaveBeenCalledWith('first draft')

    act(() => result.current.schedule('latest draft'))
    let flushed: Promise<void> | undefined
    act(() => {
      flushed = result.current.flush('latest draft')
    })
    expect(onSave).toHaveBeenCalledOnce()

    await act(async () => {
      finishFirstSave?.()
      await flushed
    })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('latest draft')
  })

  it('accepts an external persisted baseline without suppressing later reversions', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useThrottledAutosave({ initialValue: 'original', onSave })
    )

    act(() => result.current.acceptExternal('external revision'))
    act(() => result.current.schedule('original'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TEXT_AUTOSAVE_INTERVAL_MS)
    })

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith('original')
  })
})
