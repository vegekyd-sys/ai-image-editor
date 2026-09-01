import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REMOTION_EXPORT_CAPACITY,
  estimateRemotionExportLambdaSlots,
  resolveRemotionExportCapacityLimit,
} from '@/lib/remotion-export-capacity'

describe('Remotion export capacity estimation', () => {
  it('keeps the current 20 frames per Lambda speed for a 30 second video', () => {
    const estimate = estimateRemotionExportLambdaSlots({
      animation: { fps: 30, durationInSeconds: 30 },
    }, 'video', {})

    expect(estimate).toEqual({
      estimatedLambdaSlots: 46,
      durationInFrames: 900,
      framesPerLambda: 20,
      rendererLambdaSlots: 45,
      controlLambdaSlots: 1,
    })
    expect(Math.floor(DEFAULT_REMOTION_EXPORT_CAPACITY / estimate.estimatedLambdaSlots)).toBe(5)
  })

  it('weights longer videos by their actual frame count', () => {
    expect(estimateRemotionExportLambdaSlots({
      animation: { fps: 30, durationInSeconds: 60 },
    }, 'video', {}).estimatedLambdaSlots).toBe(91)
  })

  it('uses one queue slot for still exports', () => {
    expect(estimateRemotionExportLambdaSlots({}, 'image', {}).estimatedLambdaSlots).toBe(1)
  })

  it('allows an explicit capacity override without changing render chunking', () => {
    expect(resolveRemotionExportCapacityLimit({ REMOTION_EXPORT_LAMBDA_CAPACITY: '320' })).toBe(320)
    expect(estimateRemotionExportLambdaSlots({
      animation: { fps: 30, durationInSeconds: 30 },
    }, 'video', { REMOTION_EXPORT_LAMBDA_CAPACITY: '320' }).framesPerLambda).toBe(20)
  })
})
