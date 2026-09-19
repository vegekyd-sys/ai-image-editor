import { describe, expect, it, vi } from 'vitest'
import {
  isRetryableRemotionLambdaSubmissionError,
  retryRemotionLambdaSubmission,
} from '@/lib/remotion-lambda-renderer'

describe('Remotion Lambda submission retry', () => {
  it.each([
    'AWS Concurrency limit reached (Original Error: Rate Exceeded.)',
    'ConcurrentInvocationLimitExceeded',
    'TooManyRequestsException: Rate Exceeded.',
    'Lambda function remotion-render failed with an unhandled error',
    'Lambda function remotion-render failed with error code Runtime.TruncatedResponse',
    'socket hang up',
  ])('classifies transient launch failure: %s', (message) => {
    expect(isRetryableRemotionLambdaSubmissionError(new Error(message))).toBe(true)
  })

  it.each([
    'Input has an unsupported or unrecognizable format.',
    'Remotion render site version mismatch',
    'AccessDeniedException',
  ])('does not retry deterministic failure: %s', (message) => {
    expect(isRetryableRemotionLambdaSubmissionError(new Error(message))).toBe(false)
  })

  it('retries a transient submission before any render id exists', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('Lambda function remotion-render failed with an unhandled error'))
      .mockResolvedValue({ renderId: 'render-ok' })
    const sleepFn = vi.fn(async () => {})
    const onRetry = vi.fn(async () => {})

    await expect(retryRemotionLambdaSubmission(submit, {
      attempts: 3,
      delayMs: 25,
      sleepFn,
      randomFn: () => 0.5,
      onRetry,
    })).resolves.toEqual({ renderId: 'render-ok' })

    expect(submit).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledWith(25)
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, nextAttempt: 2 }))
  })

  it('does not resubmit a deterministic media error', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('Input has an unsupported or unrecognizable format.'))

    await expect(retryRemotionLambdaSubmission(submit, {
      attempts: 3,
      sleepFn: async () => {},
    })).rejects.toThrow('unsupported or unrecognizable')

    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('stops after the configured attempt budget', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('AWS Concurrency limit reached'))

    await expect(retryRemotionLambdaSubmission(submit, {
      attempts: 3,
      sleepFn: async () => {},
    })).rejects.toThrow('AWS Concurrency limit reached')

    expect(submit).toHaveBeenCalledTimes(3)
  })
})
