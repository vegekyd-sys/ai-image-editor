import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveRemotionLambdaVideoFlags } from '@/lib/remotion-lambda-renderer'

describe('Remotion Lambda video decoder parity', () => {
  it('uses @remotion/media semantics by default, matching web export', () => {
    expect(resolveRemotionLambdaVideoFlags({})).toEqual({
      useOffthreadVideo: false,
      useNativeVideo: false,
      mode: 'media',
    })
  })

  it('keeps explicit decoder overrides available as rollback controls', () => {
    expect(resolveRemotionLambdaVideoFlags({
      REMOTION_LAMBDA_USE_OFFTHREAD_VIDEO: 'true',
    })).toEqual({
      useOffthreadVideo: true,
      useNativeVideo: false,
      mode: 'offthread',
    })

    expect(resolveRemotionLambdaVideoFlags({
      REMOTION_LAMBDA_USE_NATIVE_VIDEO: 'true',
    })).toEqual({
      useOffthreadVideo: false,
      useNativeVideo: true,
      mode: 'native',
    })
  })

  it('does not hard-code the native Html5Video path in Lambda input props', () => {
    const source = readFileSync('src/lib/remotion-lambda-renderer.ts', 'utf8')
    const inputPropsStart = source.indexOf('inputProps: {')
    const inputPropsEnd = source.indexOf("\n      codec: 'h264'", inputPropsStart)
    const inputPropsSource = source.slice(inputPropsStart, inputPropsEnd)

    expect(inputPropsSource).not.toContain('useNativeVideo: true')
    expect(source).toContain('const videoFlags = resolveRemotionLambdaVideoFlags(process.env)')
    expect(inputPropsSource).toContain('useOffthreadVideo: videoFlags.useOffthreadVideo')
    expect(inputPropsSource).toContain('useNativeVideo: videoFlags.useNativeVideo')
  })
})
