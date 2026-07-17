import { defineConfig } from 'vitest/config'
import path from 'path'

const openAISdkOverride = process.env.OPENAI_SDK_TEST_OVERRIDE?.trim()

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      ...(openAISdkOverride
        ? { '@ai-sdk/openai': path.resolve(openAISdkOverride) }
        : {}),
      '@': path.resolve(__dirname, './src'),
    },
  },
})
