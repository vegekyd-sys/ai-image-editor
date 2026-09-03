// @vitest-environment node

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { clearSkillCache, loadBuiltInSkills } from '@/lib/skill-registry'
import { clearWorkspaceCache, getSkillManifest, listBuiltInFiles, readBuiltInFile } from '@/lib/workspace'

const guideName = 'video-mature-themes'
const guidePath = `skills/${guideName}/SKILL.md`
const retiredGuideName = 'wan-3-0-vivid-prompt'
const retiredGuidePath = `skills/${retiredGuideName}/SKILL.md`

describe('conditional video prompt guides', () => {
  it('resolves the animate index through the real built-in file reader', () => {
    const animate = readBuiltInFile('prompts/animate.md')
    expect(animate?.contentType).toBe('text/markdown')
    expect(animate?.content).toContain(guidePath)
    expect(animate?.content).not.toContain(retiredGuidePath)
    const guide = readBuiltInFile(guidePath)
    expect(guide?.contentType).toBe('text/markdown')
    expect(guide?.content.length).toBeGreaterThan(0)
    expect(listBuiltInFiles(guidePath)).toEqual([
      expect.objectContaining({ path: guidePath, isBuiltIn: true, contentType: 'text/markdown' }),
    ])
  })

  it('registers the guide without adding it to global startup context or the picker', async () => {
    clearSkillCache()
    clearWorkspaceCache()
    const skills = loadBuiltInSkills()
    const guide = skills.get(guideName)
    expect(skills.has(retiredGuideName)).toBe(false)
    expect(readBuiltInFile(retiredGuidePath)).toBeNull()
    expect(guide).toBeDefined()
    expect(guide?.makaron).toMatchObject({
      builtIn: true, userSelectable: false, manifestVisible: false, sourceSkill: guideName,
    })
    const manifest = await getSkillManifest()
    expect(manifest).not.toContain(guideName)
    expect(manifest).not.toContain(retiredGuideName)
    expect(guide!.template.length).toBeGreaterThan(0)
    expect(manifest).not.toContain(guide!.template)
  })

  it('preserves the supplied instructions while renaming the Skill and heading', () => {
    const content = readBuiltInFile(guidePath)!.content
    const body = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1].trim()
    expect(body).toBeDefined()
    expect(body).toMatch(/^# Video Mature Themes\n/)
    const originalBody = body!.replace(/^# Video Mature Themes\n/, '# Wan 3.0 Vivid Prompt\n')
    // SHA-256 of the user-supplied body, excluding frontmatter and outer whitespace.
    // No dependency on a developer's Downloads folder in CI.
    expect(createHash('sha256').update(originalBody).digest('hex')).toBe(
      '35f2427edb7909ad5610c013ed80936a438fb014a88eb12dfc96b04daeef27a4',
    )
  })
})
