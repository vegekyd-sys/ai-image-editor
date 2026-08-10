import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8')

describe('Makaron CLI Agent discovery', () => {
  it('publishes a valid v0.2 discovery index with matching skill digests', () => {
    const index = JSON.parse(read('public/.well-known/agent-skills/index.json')) as {
      $schema: string
      skills: Array<{ name: string; type: string; url: string; digest: string; description: string }>
    }

    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json')
    expect(index.skills.map((skill) => skill.name)).toEqual(['makaron'])

    for (const skill of index.skills) {
      expect(skill.type).toBe('skill-md')
      expect(skill.description.length).toBeGreaterThan(40)
      const content = read(`public${skill.url}`)
      const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`
      expect(skill.digest).toBe(digest)
      expect(content).toContain(`name: ${skill.name}`)
    }
  })

  it('keeps the top-level skill alias synchronized with the canonical CLI skill', () => {
    expect(read('public/skill.md')).toBe(read('packages/makaron-cli/skills/makaron/SKILL.md'))
  })

  it('keeps discovery routes public and crawlable', () => {
    const proxy = read('src/proxy.ts')
    const robots = read('src/app/robots.ts')
    const sitemap = read('src/app/sitemap.ts')

    expect(proxy).toContain("pathname === '/llms.txt'")
    expect(proxy).toContain("pathname === '/skill.md'")
    expect(proxy).toContain("pathname.startsWith('/.well-known/agent-skills/')")
    expect(robots).toContain("userAgent: 'OAI-SearchBot'")
    expect(robots).toContain("'/mcp'")
    expect(sitemap).toContain('`${SITE_URL}/mcp`')
  })

  it('presents Makaron Chat as the single creative handoff across machine-readable surfaces', () => {
    const registration = read('src/app/api/agent/register/route.ts')
    const copiedGuide = read('src/components/AgentCopyButton.tsx')

    expect(registration).toContain("default_interface: 'makaron chat'")
    expect(registration).toContain('complete user request')
    expect(registration).toContain('responses get $RUN_ID --wait --json')
    expect(copiedGuide).toContain('do not decompose the request into low-level')
    expect(copiedGuide).toContain('responses get $RUN_ID --wait --json')
  })

  it('aligns CLI and plugin versions and avoids a private repository link', () => {
    const pkg = JSON.parse(read('packages/makaron-cli/package.json'))
    const codexPlugin = JSON.parse(read('packages/makaron-cli/.codex-plugin/plugin.json'))
    const claudePlugin = JSON.parse(read('packages/makaron-cli/.claude-plugin/plugin.json'))

    expect(codexPlugin.version).toBe(pkg.version)
    expect(claudePlugin.version).toBe(pkg.version)
    expect(pkg.repository).toBeUndefined()
    expect(codexPlugin.repository).toBeUndefined()
    expect(claudePlugin.repository).toBeUndefined()
  })

  it('ships a repo-local Codex plugin marketplace entry for the CLI package', () => {
    const marketplace = JSON.parse(read('.agents/plugins/marketplace.json')) as {
      plugins: Array<{ name: string; source: { source: string; path: string } }>
    }

    expect(marketplace.plugins).toEqual([
      expect.objectContaining({
        name: 'makaron-cli',
        source: { source: 'local', path: './packages/makaron-cli' },
      }),
    ])
  })

  it('installs only the canonical Makaron Agent Skill by default', () => {
    const cli = read('packages/makaron-cli/bin/makaron.mjs')

    expect(cli).toContain("new URL('../skills/makaron', import.meta.url)")
    expect(cli).toMatch(/'--skill',\s*'makaron'/)
    expect(cli).not.toMatch(/'--skill',\s*'\*'/)
  })

  it('ships the required positive and negative discovery evals', () => {
    const evals = JSON.parse(read('packages/makaron-cli/evals/agent-discovery.json')) as {
      version: string
      positive: Array<{ id: string; prompt: string; expectedSkill: string; expectedBehavior: string }>
      negative: Array<{ id: string; prompt: string; expectedBehavior: string }>
    }
    const pkg = JSON.parse(read('packages/makaron-cli/package.json'))

    expect(evals.version).toBe(pkg.version)
    expect(evals.positive).toHaveLength(5)
    expect(evals.negative).toHaveLength(3)
    expect(new Set(evals.positive.map((test) => test.id)).size).toBe(5)
    expect(new Set(evals.negative.map((test) => test.id)).size).toBe(3)
    expect(evals.positive.every((test) => test.prompt && test.expectedSkill && test.expectedBehavior)).toBe(true)
    expect(evals.positive.every((test) => test.expectedSkill === 'makaron')).toBe(true)
    expect(evals.positive.every((test) => test.expectedBehavior.includes('makaron chat'))).toBe(true)
    expect(evals.negative.every((test) => test.prompt && test.expectedBehavior)).toBe(true)
  })
})
