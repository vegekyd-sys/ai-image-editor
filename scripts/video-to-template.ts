#!/usr/bin/env npx tsx
/**
 * Video → Kling Prompt → Home Page Template
 *
 * Usage:
 *   npx tsx scripts/video-to-template.ts --url "https://douyin.com/xxx"
 *   npx tsx scripts/video-to-template.ts --file ./video.mp4
 *   npx tsx scripts/video-to-template.ts --image ./frame1.jpg --image ./frame2.jpg
 *   npx tsx scripts/video-to-template.ts --file ./video.mp4 --model gemini-3.1-pro
 */

import { GoogleGenAI } from '@google/genai'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../src/lib/prompts/video-reverse.md'),
  'utf-8'
)

const DEFAULT_MODEL = 'gemini-2.5-flash'

function parseArgs() {
  const args = process.argv.slice(2)
  const opts: { url?: string; file?: string; images: string[]; model: string } = {
    images: [],
    model: DEFAULT_MODEL,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        opts.url = args[++i]
        break
      case '--file':
        opts.file = args[++i]
        break
      case '--image':
        opts.images.push(args[++i])
        break
      case '--model':
        opts.model = args[++i]
        break
      case '--help':
        console.log(`
Usage:
  npx tsx scripts/video-to-template.ts --url <video-url>
  npx tsx scripts/video-to-template.ts --file <path.mp4>
  npx tsx scripts/video-to-template.ts --image <path.jpg> [--image <path2.jpg>]

Options:
  --url <url>       Download video from URL (uses yt-dlp)
  --file <path>     Local video file
  --image <path>    Screenshot/frame image (can repeat)
  --model <name>    Gemini model (default: ${DEFAULT_MODEL})
  --help            Show this help
`)
        process.exit(0)
    }
  }

  if (!opts.url && !opts.file && opts.images.length === 0) {
    console.error('Error: provide --url, --file, or --image')
    process.exit(1)
  }

  return opts
}

function downloadVideo(url: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2t-'))
  const outPath = path.join(tmpDir, 'video.mp4')

  console.log(`Downloading: ${url}`)
  try {
    execSync(
      `yt-dlp -f "best[ext=mp4]/best" --no-playlist -o "${outPath}" "${url}"`,
      { stdio: 'inherit', timeout: 120_000 }
    )
  } catch {
    console.error('yt-dlp failed. Make sure yt-dlp is installed: brew install yt-dlp')
    process.exit(1)
  }

  if (!fs.existsSync(outPath)) {
    const files = fs.readdirSync(tmpDir)
    const video = files.find(f => f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv'))
    if (video) return path.join(tmpDir, video)
    console.error('Download failed: no video file found')
    process.exit(1)
  }

  return outPath
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mimes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  return mimes[ext] || 'application/octet-stream'
}

async function analyzeWithGemini(opts: {
  videoPath?: string
  imagePaths?: string[]
  model: string
}) {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    console.error('Error: GOOGLE_API_KEY not set')
    process.exit(1)
  }

  const ai = new GoogleGenAI({ apiKey })

  if (opts.videoPath) {
    console.log(`Uploading video: ${opts.videoPath} (${(fs.statSync(opts.videoPath).size / 1024 / 1024).toFixed(1)}MB)`)

    // Copy to tmp with ASCII name to avoid header encoding issues
    const tmpPath = path.join(os.tmpdir(), `v2t-upload${path.extname(opts.videoPath)}`)
    fs.copyFileSync(opts.videoPath, tmpPath)

    const uploadResult = await ai.files.upload({
      file: tmpPath,
      config: { mimeType: getMimeType(opts.videoPath) },
    })

    console.log(`Upload complete: ${uploadResult.name}, waiting for processing...`)

    let file = uploadResult
    while (file.state === 'PROCESSING') {
      await new Promise(r => setTimeout(r, 3000))
      file = await ai.files.get({ name: file.name! })
      process.stdout.write('.')
    }
    console.log(` ${file.state}`)

    if (file.state !== 'ACTIVE') {
      console.error(`File processing failed: ${file.state}`)
      process.exit(1)
    }

    console.log(`Analyzing with ${opts.model}...`)

    const response = await ai.models.generateContent({
      model: opts.model,
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: file.uri!, mimeType: file.mimeType! } },
            { text: 'Analyze this video and generate a Kling prompt + template JSON.' },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
      },
    })

    return response.text || ''

  } else if (opts.imagePaths && opts.imagePaths.length > 0) {
    console.log(`Analyzing ${opts.imagePaths.length} image(s) with ${opts.model}...`)

    const parts: Array<{ inlineData: { data: string; mimeType: string } } | { text: string }> = []

    for (const imgPath of opts.imagePaths) {
      const data = fs.readFileSync(imgPath).toString('base64')
      parts.push({
        inlineData: { data, mimeType: getMimeType(imgPath) },
      })
    }

    parts.push({
      text: 'These are screenshots/frames from an AI-generated video. Analyze them and generate a Kling prompt + template JSON that would recreate a similar video effect.',
    })

    const response = await ai.models.generateContent({
      model: opts.model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
      },
    })

    return response.text || ''
  }

  return ''
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()

  const braceMatch = text.match(/\{[\s\S]*\}/)
  if (braceMatch) return braceMatch[0]

  return text.trim()
}

async function main() {
  const opts = parseArgs()

  let videoPath: string | undefined
  let imagePaths: string[] | undefined

  if (opts.url) {
    videoPath = downloadVideo(opts.url)
  } else if (opts.file) {
    if (!fs.existsSync(opts.file)) {
      console.error(`File not found: ${opts.file}`)
      process.exit(1)
    }
    videoPath = opts.file
  } else if (opts.images.length > 0) {
    for (const img of opts.images) {
      if (!fs.existsSync(img)) {
        console.error(`Image not found: ${img}`)
        process.exit(1)
      }
    }
    imagePaths = opts.images
  }

  const raw = await analyzeWithGemini({ videoPath, imagePaths, model: opts.model })

  const jsonStr = extractJson(raw)

  try {
    const template = JSON.parse(jsonStr)

    console.log('\n' + '='.repeat(60))
    console.log('TEMPLATE JSON:')
    console.log('='.repeat(60))
    console.log(JSON.stringify(template, null, 2))

    console.log('\n' + '='.repeat(60))
    console.log('KLING PROMPT:')
    console.log('='.repeat(60))
    console.log(template.prompt)

    console.log('\n' + '='.repeat(60))
    console.log('SKILL_TEMPLATES entry:')
    console.log('='.repeat(60))
    console.log(`  {
    id: '${template.id}',
    label: '${template.label}', labelEn: '${template.labelEn}',
    image: '/skills/${template.id}.jpg',
    prompt: ${JSON.stringify(template.prompt)},${template.imageCount > 1 ? `\n    imageCount: ${template.imageCount},` : ''}
  },`)

  } catch {
    console.log('\n' + '='.repeat(60))
    console.log('RAW OUTPUT (failed to parse JSON):')
    console.log('='.repeat(60))
    console.log(raw)
  }
}

main().catch(console.error)
