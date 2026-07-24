import { describe, expect, it } from 'vitest'
import { mergePatchProps } from '../src/lib/patch-props'

describe('mergePatchProps', () => {
  it('replaces arrays instead of retaining stale tail entries', () => {
    expect(mergePatchProps(
      {
        captions: [
          { word: 'one', startMs: 0, endMs: 100 },
          { word: 'two', startMs: 100, endMs: 200 },
        ],
      },
      {
        captions: [{ word: 'done', startMs: 0, endMs: 200 }],
      },
    )).toEqual({
      captions: [{ word: 'done', startMs: 0, endMs: 200 }],
    })
  })

  it('still merges nested object fields', () => {
    expect(mergePatchProps(
      { theme: { color: 'violet', density: 'compact' } },
      { theme: { density: 'open' } },
    )).toEqual({
      theme: { color: 'violet', density: 'open' },
    })
  })
})
