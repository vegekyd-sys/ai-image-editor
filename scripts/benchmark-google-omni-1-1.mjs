#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const DEFAULT_MODELS = ['gemini-omni-flash-preview', 'gemini-omni-1.1-flash']
const NEW_MODEL = 'gemini-omni-1.1-flash'

const { values } = parseArgs({
  options: {
    prompt: { type: 'string' },
    image: { type: 'string' },
    'last-image': { type: 'string' },
    video: { type: 'string' },
    operation: { type: 'string', default: 'generate' },
    model: { type: 'string', multiple: true },
    resolution: { type: 'string', default: '720p' },
    'aspect-ratio': { type: 'string', default: '9:16' },
    duration: { type: 'string', default: '5' },
    'out-dir': { type: 'string' },
  },
  strict: true,
})

const apiKey = process.env.GOOGLE_API_KEY?.trim().replace(/\\n$/, '')
if (!apiKey) throw new Error('GOOGLE_API_KEY is required. Run with node --env-file=/path/to/.env.local.')

const prompt = values.prompt || [
  'In a single continuous shot, the camera makes a slow 15-degree arc around the subject.',
  'The subject turns slightly toward camera; loose hair and jersey fabric move naturally in a soft stadium breeze.',
  'Preserve the face, jersey number, badge, lighting palette, framing, and all fine details from the source image.',
  'No scene cuts. No extra people. No new text. Native audio: subtle stadium ambience and a gentle cinematic pulse.',
].join(' ')
const duration = Number(values.duration)
if (!Number.isFinite(duration) || duration < 3 || duration > 10) {
  throw new Error('--duration must be between 3 and 10 seconds')
}
if (!['360p', '720p', '1080p', '4k'].includes(values.resolution)) {
  throw new Error('--resolution must be one of 360p, 720p, 1080p, 4k')
}
if (!['9:16', '16:9'].includes(values['aspect-ratio'])) {
  throw new Error('--aspect-ratio must be 9:16 or 16:9')
}
if (!['generate', 'edit', 'extend'].includes(values.operation)) {
  throw new Error('--operation must be generate, edit, or extend')
}
if ((values.operation === 'edit' || values.operation === 'extend') && !values.video) {
  throw new Error(`--operation ${values.operation} requires --video`)
}

const runStamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
const outDir = resolve(values['out-dir'] || `artifacts/google-omni-1-1/${runStamp}`)
mkdirSync(outDir, { recursive: true })

function mimeFor(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function imagePart(path) {
  return {
    type: 'image',
    data: readFileSync(resolve(path)).toString('base64'),
    mime_type: mimeFor(path),
  }
}

function videoPart(path) {
  const ext = extname(path).toLowerCase()
  const mimeType = ext === '.mov' ? 'video/mov' : ext === '.webm' ? 'video/webm' : 'video/mp4'
  return {
    type: 'video',
    data: readFileSync(resolve(path)).toString('base64'),
    mime_type: mimeType,
  }
}

function outputVideoFrom(value) {
  if (!value || typeof value !== 'object') return null
  if (value.output_video && typeof value.output_video === 'object') return value.output_video
  if ((value.type === 'video' || String(value.mime_type || '').startsWith('video/')) && (value.uri || value.data)) return value
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = outputVideoFrom(item)
        if (found) return found
      }
    } else if (child && typeof child === 'object') {
      const found = outputVideoFrom(child)
      if (found) return found
    }
  }
  return null
}

function sanitizedResponse(value) {
  return JSON.parse(JSON.stringify(value, (key, child) => {
    if (key === 'data' && typeof child === 'string' && child.length > 1000) {
      return `[base64 omitted: ${child.length} chars]`
    }
    return child
  }))
}

async function fetchJson(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) {
    const message = json?.error?.message || text.slice(0, 1000)
    throw new Error(`Google API ${res.status}: ${message}`)
  }
  return json
}

function fileNameFromUri(uri) {
  const match = String(uri).match(/files\/([a-zA-Z0-9_-]+)/)
  return match?.[1]
}

async function waitUntilActive(uri) {
  const fileId = fileNameFromUri(uri)
  if (!fileId) return
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    const info = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/files/${fileId}`, {
      headers: { 'x-goog-api-key': apiKey },
    })
    if (info.state === 'ACTIVE') return
    if (info.state === 'FAILED') throw new Error(`Google file ${fileId} entered FAILED state`)
    await new Promise(resolveWait => setTimeout(resolveWait, 5000))
  }
  throw new Error(`Timed out waiting for Google file ${fileId}`)
}

async function downloadVideo(output, target) {
  if (output.data) {
    writeFileSync(target, Buffer.from(output.data, 'base64'))
    return
  }
  if (!output.uri) throw new Error('Response contained no video data or URI')
  await waitUntilActive(output.uri)
  const separator = output.uri.includes('?') ? '&' : '?'
  const url = output.uri.includes('alt=media') ? output.uri : `${output.uri}${separator}alt=media`
  const res = await fetch(url, { headers: { 'x-goog-api-key': apiKey } })
  if (!res.ok) throw new Error(`Video download failed ${res.status}: ${(await res.text()).slice(0, 500)}`)
  writeFileSync(target, Buffer.from(await res.arrayBuffer()))
}

function ffprobe(path) {
  try {
    return JSON.parse(execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
      '-of', 'json',
      path,
    ], { encoding: 'utf8' }))
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function requestFor(model) {
  const input = []
  let task = 'text_to_video'
  let finalPrompt = prompt

  if (values.video) {
    if (model !== NEW_MODEL && values.operation === 'extend') {
      throw new Error('Reference-video extension is only included in the 1.1 run')
    }
    input.push(videoPart(values.video))
    task = values.operation === 'extend' ? 'extend' : 'edit'
    if (task === 'extend') {
      finalPrompt = `Extend this video forward from its tail. ${prompt} Preserve the established visual style, subject, motion, camera direction, lighting, and audio continuity unless explicitly changed.`
    }
  }
  if (values.image) {
    input.push(imagePart(values.image))
    if (!values.video) task = 'image_to_video'
  }
  if (values['last-image']) {
    if (!values.image) throw new Error('--last-image requires --image')
    if (model !== NEW_MODEL) throw new Error('First/last-frame interpolation is only included in the 1.1 run')
    input.push(imagePart(values['last-image']))
    finalPrompt = `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2] ${prompt} Use Image1 as the starting frame and Image2 as the final frame.`
  }
  input.push({ type: 'text', text: `${finalPrompt}\n\nTarget duration: ${duration} seconds.` })

  const responseFormat = {
    type: 'video',
    delivery: 'uri',
  }
  if (task !== 'edit' && task !== 'extend') responseFormat.aspect_ratio = values['aspect-ratio']
  if (model === NEW_MODEL) responseFormat.resolution = values.resolution

  return {
    model,
    input,
    response_format: responseFormat,
    generation_config: { video_config: { task } },
    store: true,
    stream: false,
  }
}

const models = values.model?.length ? values.model : DEFAULT_MODELS
if (values['last-image'] && models.length !== 1) {
  throw new Error('Interpolation runs must pass --model gemini-omni-1.1-flash')
}

const report = {
  createdAt: new Date().toISOString(),
  prompt,
  duration,
  resolution: values.resolution,
  aspectRatio: values['aspect-ratio'],
  sourceImage: values.image ? resolve(values.image) : null,
  lastImage: values['last-image'] ? resolve(values['last-image']) : null,
  sourceVideo: values.video ? resolve(values.video) : null,
  operation: values.operation,
  runs: [],
}

for (const model of models) {
  const startedAt = Date.now()
  const safeModel = model.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
  try {
    const request = requestFor(model)
    const response = await fetchJson(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    })
    const output = outputVideoFrom(response)
    if (!output) throw new Error(`${model} returned no video output`)

    const videoPath = resolve(outDir, `${safeModel}-${values.resolution}.mp4`)
    await downloadVideo(output, videoPath)
    const elapsedMs = Date.now() - startedAt
    const run = {
      model,
      status: 'completed',
      elapsedMs,
      interactionId: response.id || null,
      videoPath,
      ffprobe: ffprobe(videoPath),
      response: sanitizedResponse(response),
    }
    report.runs.push(run)
    writeFileSync(resolve(outDir, `${safeModel}-response.json`), `${JSON.stringify(run, null, 2)}\n`)
    process.stdout.write(`${model}: ${(elapsedMs / 1000).toFixed(1)}s -> ${videoPath}\n`)
  } catch (error) {
    const run = {
      model,
      status: 'failed',
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
    report.runs.push(run)
    writeFileSync(resolve(outDir, `${safeModel}-response.json`), `${JSON.stringify(run, null, 2)}\n`)
    process.stderr.write(`${model}: FAILED - ${run.error}\n`)
  }
}

writeFileSync(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`Report: ${resolve(outDir, 'report.json')}\n`)
