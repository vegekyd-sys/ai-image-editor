import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8')
}

describe('AgentChatView code block rendering', () => {
  it('only collapses substantial code blocks by default', () => {
    const source = read('src/components/AgentChatView.tsx')

    expect(source).toContain('const CODE_COLLAPSE_LINE_THRESHOLD = 24')
    expect(source).toContain('const CODE_COLLAPSE_CHAR_THRESHOLD = 1800')
    expect(source).toContain('shouldCollapseCodeBlock(text)')
    expect(source).not.toContain('lines.length > 3')
  })
})

