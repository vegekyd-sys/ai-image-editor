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

// H3 Max is the sole approved exception: the provider currently exposes T2V
// and single-start-frame I2V, but no reference-to-video route. Keep the
// exception explicit in both the capability registry and its isolated adapter.
const capabilitySource = await readFile(
  path.join(repositoryRoot, 'src', 'lib', 'video-model-capabilities.ts'),
  'utf8',
)
const h3MaxBlock = capabilitySource.match(/'minimax-h3-max':\s*\{[\s\S]*?\n\s*\},\n\s*piapi:/)?.[0] ?? ''
if (
  !h3MaxBlock.includes("defaultImageWorkflow: 'image-to-video'")
  || !h3MaxBlock.includes('supportsExplicitImageToVideo: true')
  || !h3MaxBlock.includes('maxImageReferences: 1')
  || !h3MaxBlock.includes('supportsVideoReference: false')
) {
  violations.push({
    file: 'src/lib/video-model-capabilities.ts',
    line: 1,
    reason: 'H3 Max image-to-video exception lacks its complete capability contract',
    match: 'minimax-h3-max',
  })
}

const h3MaxAdapter = await readFile(
  path.join(repositoryRoot, 'src', 'lib', 'fal-h3-max-video.ts'),
  'utf8',
)
if (
  !h3MaxAdapter.includes("const TEXT_ENDPOINT = 'minimax/h3-max-turbo/text-to-video'")
  || !h3MaxAdapter.includes("const IMAGE_ENDPOINT = 'minimax/h3-max-turbo/image-to-video'")
  || !h3MaxAdapter.includes('if (images.length > 1)')
) {
  violations.push({
    file: 'src/lib/fal-h3-max-video.ts',
    line: 1,
    reason: 'H3 Max adapter must keep T2V and single-image I2V routes explicit',
    match: 'H3 Max endpoint contract',
  })
}

if (violations.length > 0) {
  console.error('Video image workflow contract failed.')
  console.error('Image inputs must default to reference-to-video. Any image-to-video exception requires an explicit capability and adapter contract.')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.reason}: ${violation.match}`)
  }
  process.exit(1)
}

console.log('Video image workflow contract passed: reference-to-video remains the default and the H3 Max I2V exception is explicit.')
