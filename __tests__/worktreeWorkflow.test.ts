import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('lightweight worktree and fixed runner workflow', () => {
  it('does not fetch during ordinary worktree creation', () => {
    const source = read('scripts/makaron-worktree-fastpath.mjs')
    expect(source).toContain("if (has('--fetch'))")
    expect(source).toContain("has('--help')")
    expect(source).toContain('resolveCanonicalDevRepo(invocationRepo)')
    expect(source).toContain('created lightweight worktree')
    expect(source).toContain('runner:test')
  })

  it('switches the fixed runner only to committed detached refs', () => {
    const source = read('scripts/makaron-runner.mjs')
    expect(source).toContain("run('git', ['switch', '--detach', ref]")
    expect(source).toContain('assertClean(path)')
    expect(source).toContain("has('--help')")
    expect(source).toContain('const devPath = canonicalDevWorktree()')
    expect(source).toContain('`${basename(devPath)}-runner`')
    expect(source).not.toContain('reset --hard')
    expect(source).not.toContain('git clean')
  })

  it('centralizes ignored runtime configuration and Next cache', () => {
    const source = read('scripts/makaron-runner.mjs')
    expect(source).toContain("['.env.local', '.env.production']")
    expect(source).toContain("resolve(devPath, '.vercel', 'project.json')")
    expect(source).toContain("resolve(path, '.next')")
    expect(source).toContain('package-lock.json differs from dev')
  })

  it('blocks Production outside the clean canonical dev worktree', () => {
    const source = read('scripts/makaron-release-prod.mjs')
    expect(source).toContain('Production deploy is only allowed from the canonical dev worktree')
    expect(source).toContain('Production deploy requires branch dev')
    expect(source).toContain('Production deploy requires a clean dev worktree')
    expect(source).toContain("run('npx', ['vercel', '--prod'])")
  })
})
