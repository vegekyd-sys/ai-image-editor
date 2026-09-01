#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const API_BASE = process.env.XAI_API_BASE || 'https://api.x.ai'
const GENERATION_MODEL = 'grok-imagine-video-1.5'
const EDIT_MODEL = 'grok-imagine-video'

const { values } = parseArgs({
  options: {
    prompt: { type: 'string' },
    image: { type: 'string', multiple: true },
    video: { type: 'string' },
    voice: { type: 'string', multiple: true },
    operation: { type: 'string', default: 'generate' },
    resolution: { type: 'string', default: '720p' },
    'aspect-ratio': { type: 'string', default: '16:9' },
    duration: { type: 'string', default: '6' },
    'poll-ms': { type: 'string', default: '2000' },
    'out-dir': { type: 'string' },
    label: { type: 'string' },
  },
  strict: true,
})

const apiKey = process.env.XAI_API_KEY?.trim()
  || process.env.X_AI_API_KEY?.trim()
  || process.env.GROK_API_KEY?.trim()
if (!apiKey) throw new Error('XAI_API_KEY is required. Run with node --env-file=/path/to/.env.local.')

const operation = values.operation
if (!['generate', 'edit', 'extend'].includes(operation)) {
  throw new Error('--operation must be generate, edit, or extend')
}
const duration = Number(values.duration)
if (!Number.isFinite(duration)) throw new Error('--duration must be a number')
if (operation === 'generate' && (duration < 1 || duration > 15)) {
  throw new Error('Grok Imagine Video 1.5 generation duration must be 1-15 seconds')
}
if (operation === 'extend' && (duration < 2 || duration > 10)) {
  throw new Error('Grok extension duration must be 2-10 seconds')
}
if ((operation === 'edit' || operation === 'extend') && !values.video) {
  throw new Error(`--operation ${operation} requires --video`)
}
if (!['480p', '720p', '1080p'].includes(values.resolution)) {
  throw new Error('--resolution must be 480p, 720p, or 1080p')
}
const images = values.image || []
const voices = values.voice || []
if (images.length > 7) throw new Error('Grok Imagine Video 1.5 accepts at most 7 image references')
if (voices.length > 3) throw new Error('Grok Imagine Video 1.5 accepts at most 3 preset voices')
if ((images.length > 1 || voices.length > 0) && values.resolution === '1080p') {
  throw new Error('Grok reference-to-video is capped at 720p')
}
if ((operation === 'edit' || operation === 'extend') && (images.length || voices.length)) {
  throw new Error('Grok edit/extend cannot be combined with image or voice references')
}

const defaultPrompt = operation === 'edit'
  ? 'Change the lighting to a warm golden-hour look. Preserve the subject, geometry, timing, camera motion, composition, and all other details.'
  : operation === 'extend'
    ? 'Continue the established camera motion and subject action naturally. Preserve the subject, style, lighting, framing, and audio continuity.'
    : 'A polished Makaron icon rotates gently as a small magenta spark orbits it. Preserve the logo shape and lettering. One continuous shot with subtle native ambience.'
const prompt = values.prompt || defaultPrompt
const runStamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
const safeLabel = (values.label || `${operation}-${values.resolution}`).replaceAll(/[^a-zA-Z0-9._-]/g, '_')
const outDir = resolve(values['out-dir'] || `artifacts/grok-imagine-video/${runStamp}-${safeLabel}`)
mkdirSync(outDir, { recursive: true })

function mimeFor(path, kind) {
  const ext = extname(path).toLowerCase()
  if (kind === 'video') {
    if (ext === '.mov') return 'video/quicktime'
    if (ext === '.webm') return 'video/webm'
    return 'video/mp4'
  }
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function sourceUrl(value, kind) {
  if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) return value
  const path = resolve(value)
  return `data:${mimeFor(path, kind)};base64,${readFileSync(path).toString('base64')}`
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value, (key, child) => {
    if ((key === 'url' || key === 'data') && typeof child === 'string' && child.startsWith('data:')) {
      return `[data URL omitted: ${child.length} chars]`
    }
    return child
  }))
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: init.signal || AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!response.ok) {
    const message = json?.error?.message || json?.message || text.slice(0, 1000)
    throw new Error(`xAI API ${response.status}: ${message}`)
  }
  return json
}

function buildRequest() {
  if (operation === 'edit' || operation === 'extend') {
    const body = {
      model: EDIT_MODEL,
      prompt,
      video: { url: sourceUrl(values.video, 'video') },
    }
    if (operation === 'extend') body.duration = duration
    return {
      endpoint: operation === 'edit' ? '/v1/videos/edits' : '/v1/videos/extensions',
      model: EDIT_MODEL,
      mode: operation,
      body,
    }
  }

  const body = {
    model: GENERATION_MODEL,
    prompt,
    duration,
    resolution: values.resolution,
    generate_audio: true,
  }
  if (images.length === 0 && voices.length === 0) {
    body.aspect_ratio = values['aspect-ratio']
    return { endpoint: '/v1/videos/generations', model: GENERATION_MODEL, mode: 'text-to-video', body }
  }
  if (images.length === 1 && voices.length === 0) {
    body.image = { url: sourceUrl(images[0], 'image') }
    return { endpoint: '/v1/videos/generations', model: GENERATION_MODEL, mode: 'image-to-video', body }
  }
  if (images.length) body.reference_images = images.map(image => ({ url: sourceUrl(image, 'image') }))
  if (voices.length) body.reference_audios = voices.map(voiceId => ({ voice_id: voiceId }))
  body.aspect_ratio = values['aspect-ratio']
  return { endpoint: '/v1/videos/generations', model: GENERATION_MODEL, mode: 'reference-to-video', body }
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

async function download(url, target) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Video download failed ${response.status}: ${(await response.text()).slice(0, 500)}`)
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

const request = buildRequest()
const report = {
  createdAt: new Date().toISOString(),
  operation,
  mode: request.mode,
  model: request.model,
  prompt,
  requestedDuration: duration,
  requestedResolution: values.resolution,
  requestedAspectRatio: values['aspect-ratio'],
  imageSources: images.map(value => /^https?:/i.test(value) ? value : resolve(value)),
  videoSource: values.video ? (/^https?:/i.test(values.video) ? values.video : resolve(values.video)) : null,
  voices,
  request: sanitize(request),
  polls: [],
}

const overallStarted = Date.now()
try {
  const submitStarted = Date.now()
  const submitted = await fetchJson(`${API_BASE}${request.endpoint}`, {
    method: 'POST',
    body: JSON.stringify(request.body),
  })
  report.submitLatencyMs = Date.now() - submitStarted
  report.submission = sanitize(submitted)
  const requestId = submitted.request_id
  if (!requestId) throw new Error(`xAI submission returned no request_id: ${JSON.stringify(submitted)}`)
  report.requestId = requestId
  writeFileSync(resolve(outDir, 'submission.json'), `${JSON.stringify(sanitize(submitted), null, 2)}\n`)
  process.stdout.write(`${request.model}/${request.mode}: submitted ${requestId} in ${(report.submitLatencyMs / 1000).toFixed(2)}s\n`)

  const deadline = Date.now() + 15 * 60 * 1000
  const pollMs = Math.max(500, Number(values['poll-ms']) || 2000)
  let result
  while (Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, pollMs))
    const pollStarted = Date.now()
    const status = await fetchJson(`${API_BASE}/v1/videos/${requestId}`)
    const poll = {
      elapsedMs: Date.now() - overallStarted,
      requestLatencyMs: Date.now() - pollStarted,
      status: status.status || null,
      progress: status.progress ?? null,
    }
    report.polls.push(poll)
    process.stdout.write(`  ${(poll.elapsedMs / 1000).toFixed(1)}s status=${poll.status}${poll.progress != null ? ` progress=${poll.progress}` : ''}\n`)
    if (status.status === 'done') {
      result = status
      break
    }
    if (['failed', 'expired'].includes(status.status)) {
      throw new Error(status?.error?.message || status?.error || `xAI task ended with ${status.status}`)
    }
  }
  if (!result) throw new Error('Timed out waiting for xAI video result')

  report.status = 'completed'
  report.elapsedMs = Date.now() - overallStarted
  report.result = sanitize(result)
  report.costUsd = Number.isFinite(Number(result?.usage?.cost_in_usd_ticks))
    ? Number(result.usage.cost_in_usd_ticks) / 10_000_000_000
    : null
  const videoUrl = result?.video?.url
  if (!videoUrl) throw new Error(`Completed xAI response contained no video URL: ${JSON.stringify(result)}`)
  const target = resolve(outDir, `${safeLabel}.mp4`)
  await download(videoUrl, target)
  report.videoPath = target
  report.ffprobe = ffprobe(target)
  writeFileSync(resolve(outDir, 'result.json'), `${JSON.stringify(sanitize(result), null, 2)}\n`)
  process.stdout.write(`completed in ${(report.elapsedMs / 1000).toFixed(1)}s -> ${target}\n`)
  process.stdout.write(`source=${values.video ? basename(values.video) : images.length ? `${images.length} image(s)` : 'text'} cost=${report.costUsd == null ? 'n/a' : `$${report.costUsd.toFixed(4)}`}\n`)
} catch (error) {
  report.status = 'failed'
  report.elapsedMs = Date.now() - overallStarted
  report.error = error instanceof Error ? error.message : String(error)
  process.stderr.write(`FAILED after ${(report.elapsedMs / 1000).toFixed(1)}s: ${report.error}\n`)
  process.exitCode = 1
} finally {
  writeFileSync(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`Report: ${resolve(outDir, 'report.json')}\n`)
}
