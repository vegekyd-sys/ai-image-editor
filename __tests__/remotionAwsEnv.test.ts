import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeRemotionAwsEnvironment } from '@/lib/remotion-lambda-renderer'

const keys = [
  'REMOTION_AWS_ACCESS_KEY_ID',
  'REMOTION_AWS_SECRET_ACCESS_KEY',
  'REMOTION_AWS_SESSION_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const

const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('sanitizeRemotionAwsEnvironment', () => {
  it('removes real and escaped control characters before AWS signs headers', () => {
    process.env.REMOTION_AWS_ACCESS_KEY_ID = '  access-key\n'
    process.env.REMOTION_AWS_SECRET_ACCESS_KEY = 'secret-key\\n'
    process.env.AWS_ACCESS_KEY_ID = 'fallback-key\r\n'

    sanitizeRemotionAwsEnvironment()

    expect(process.env.REMOTION_AWS_ACCESS_KEY_ID).toBe('access-key')
    expect(process.env.REMOTION_AWS_SECRET_ACCESS_KEY).toBe('secret-key')
    expect(process.env.AWS_ACCESS_KEY_ID).toBe('fallback-key')
  })

  it('deletes empty credentials instead of leaving an invalid header value', () => {
    process.env.REMOTION_AWS_SESSION_TOKEN = '\n'

    sanitizeRemotionAwsEnvironment()

    expect(process.env.REMOTION_AWS_SESSION_TOKEN).toBeUndefined()
  })
})
