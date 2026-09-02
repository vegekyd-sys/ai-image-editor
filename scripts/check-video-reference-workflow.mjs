import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const sourceRoots = [
  path.join(repositoryRoot, 'src', 'lib'),
  path.join(repositoryRoot, 'src', 'app'),
]

const forbiddenPatterns = [
  {
    pattern: /\b(?:first_frame|first_frame_image|firstFrame|firstFrameImage)\s*:/g,
    reason: 'first-frame payload field',
  },
  {
    pattern: /["'](?:first_frame|first_frame_image|firstFrame|firstFrameImage)["']\s*:/g,
    reason: 'quoted first-frame payload field',
  },
  {
    pattern: /\.(?:first_frame|first_frame_image|firstFrame|firstFrameImage)\s*=/g,
    reason: 'first-frame payload assignment',
  },
  {
    pattern: /\b(?:task|mode|model|model_name)\s*:\s*["'][^"']*(?:image[_-]to[_-]video|first[_-]frame)[^"']*["']/gi,
    reason: 'implicit image-to-video provider route',
  },
]

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath))
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

const violations = []
for (const sourceRoot of sourceRoots) {
  for (const filePath of await listSourceFiles(sourceRoot)) {
    const source = await readFile(filePath, 'utf8')
    for (const { pattern, reason } of forbiddenPatterns) {
      pattern.lastIndex = 0
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split('\n').length
        violations.push({
          file: path.relative(repositoryRoot, filePath),
          line,
          reason,
          match: match[0],
        })
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Video image workflow contract failed.')
  console.error('Image inputs must default to reference-to-video. First-frame/image-to-video requires an explicit architecture change and corresponding capability contract.')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.reason}: ${violation.match}`)
  }
  process.exit(1)
}

console.log('Video image workflow contract passed: no implicit first-frame/image-to-video provider routes found.')
