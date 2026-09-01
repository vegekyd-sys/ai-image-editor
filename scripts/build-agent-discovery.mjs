import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const checkOnly = process.argv.includes('--check')
const sourceRoot = path.join(root, 'packages/makaron-cli/skills')
const publicRoot = path.join(root, 'public/.well-known/agent-skills')
const canonicalSkillName = 'makaron'
const skillNames = [canonicalSkillName]

function parseFrontmatter(content, file) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) throw new Error(`${file}: missing YAML frontmatter`)

  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim()
  if (!name || !description) throw new Error(`${file}: frontmatter needs name and description`)
  return { name, description }
}

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function ensureFile(file, content) {
  if (checkOnly) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) {
      throw new Error(`${path.relative(root, file)} is stale; run npm run build:agent-discovery`)
    }
    return
  }

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function ensureDirectory(source, target) {
  if (checkOnly) {
    const sourceFiles = new Map()
    const targetFiles = new Map()

    const collect = (rootDir, currentDir, output) => {
      for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
        const absolute = path.join(currentDir, entry.name)
        if (entry.isDirectory()) collect(rootDir, absolute, output)
        else output.set(path.relative(rootDir, absolute), readFileSync(absolute))
      }
    }

    collect(source, source, sourceFiles)
    if (existsSync(target)) collect(target, target, targetFiles)

    if (
      sourceFiles.size !== targetFiles.size
      || [...sourceFiles].some(([file, content]) => !targetFiles.get(file)?.equals(content))
    ) {
      throw new Error(`${path.relative(root, target)} is stale; run npm run build:agent-discovery`)
    }
    return
  }

  rmSync(target, { recursive: true, force: true })
  mkdirSync(path.dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
}

const skills = skillNames.map((expectedName) => {
  const source = path.join(sourceRoot, expectedName, 'SKILL.md')
  const content = readFileSync(source, 'utf8')
  const metadata = parseFrontmatter(content, source)
  if (metadata.name !== expectedName) {
    throw new Error(`${source}: name must match parent directory (${expectedName})`)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)) {
    throw new Error(`${source}: invalid Agent Skill name`)
  }

  ensureDirectory(path.dirname(source), path.join(publicRoot, expectedName))

  return {
    name: metadata.name,
    type: 'skill-md',
    description: metadata.description,
    url: `/.well-known/agent-skills/${metadata.name}/SKILL.md`,
    digest: sha256(content),
  }
})

const index = `${JSON.stringify({
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills,
}, null, 2)}\n`

ensureFile(path.join(publicRoot, 'index.json'), index)
ensureFile(
  path.join(root, 'public/skill.md'),
  readFileSync(path.join(sourceRoot, canonicalSkillName, 'SKILL.md'), 'utf8'),
)

console.log(`${checkOnly ? 'Checked' : 'Built'} ${skills.length} public Makaron Agent Skills.`)
