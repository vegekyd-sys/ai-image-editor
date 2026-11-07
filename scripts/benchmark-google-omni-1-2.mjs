#!/usr/bin/env node
// Same-request A/B for Gemini Omni Flash model versions (1.1 vs 1.2).
// Every --model gets an identical request and runs in parallel, so end-to-end
// latency is comparable. Media is saved under the ignored artifacts/ folder.
//
//   node --env-file=/Users/tianyicai/ai-image-editor/.env.local \
//     scripts/benchmark-google-omni-1-2.mjs --image ref.png --duration 10 \
//     --prompt "..." --model gemini-omni-1.1-flash --model gemini-omni-1.2-flash
//
// Multi-turn edit of an earlier result (no re-upload):
//   ... --previous gemini-omni-1.2-flash=v1_abc --prompt "Make Spark gold."

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MAX_SECONDS = { 'gemini-omni-1.1-flash': 10, 'gemini-omni-1.2-flash': 15 }

const { values } = parseArgs({
  options: {
    prompt: { type: 'string' },
    image: { type: 'string', multiple: true },
    video: { type: 'string' },
    previous: { type: 'string', multiple: true }, // model=interactionId
    model: { type: 'string', multiple: true },
    resolution: { type: 'string', default: '720p' },
    'aspect-ratio': { type: 'string', default: '16:9' },
    duration: { type: 'string' },
    task: { type: 'string' },
    label: { type: 'string', default: 'run' },
    'out-dir': { type: 'string' },
  },
  strict: true,
})

const apiKey = process.env.GOOGLE_API_KEY?.trim().replace(/\\n$/, '')
if (!apiKey) throw new Error('GOOGLE_API_KEY is required (node --env-file=...).')
if (!values.prompt) throw new Error('--prompt is required')
const models = values.model?.length ? values.model : ['gemini-omni-1.1-flash', 'gemini-omni-1.2-flash']
const previous = Object.fromEntries((values.previous || []).map(entry => entry.split('=')))
const duration = values.duration ? Number(values.duration) : undefined

const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
const outDir = resolve(values['out-dir'] || `artifacts/google-omni-1-2/${stamp}-${values.label}`)
mkdirSync(outDir, { recursive: true })

const mimeFor = path => ({ '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/mov' }[extname(path).toLowerCase()] || 'image/jpeg')
const filePart = (type, path) => ({ type, data: readFileSync(resolve(path)).toString('base64'), mime_type: mimeFor(path) })

function requestFor(model) {
  const previousId = previous[model]
  if (duration && duration > (MAX_SECONDS[model] ?? 15)) throw new Error(`${model} max duration is ${MAX_SECONDS[model]}s`)
  const media = [
    ...(values.video ? [filePart('video', values.video)] : []),
    ...(values.image || []).map(path => filePart('image', path)),
  ]
  const responseFormat = { type: 'video', delivery: 'uri', resolution: values.resolution }
  if (duration) responseFormat.duration = `${duration}s`
  if (!values.video && !previousId) responseFormat.aspect_ratio = values['aspect-ratio']
  return {
    model,
    input: media.length ? [...media, { type: 'text', text: values.prompt }] : values.prompt,
    ...(previousId ? { previous_interaction_id: previousId } : {}),
    response_format: responseFormat,
    // Google rejects an explicit task together with previous_interaction_id.
    ...(values.task && !previousId ? { generation_config: { video_config: { task: values.task } } } : {}),
    store: true,
    stream: false,
  }
}

function outputVideoFrom(value) {
  if (!value || typeof value !== 'object') return null
  if (value.output_video && typeof value.output_video === 'object') return value.output_video
  if ((value.type === 'video' || String(value.mime_type || '').startsWith('video/')) && (value.uri || value.data)) return value
  for (const child of Object.values(value)) {
    for (const item of Array.isArray(child) ? child : [child]) {
      const found = item && typeof item === 'object' ? outputVideoFrom(item) : null
      if (found) return found
    }
  }
  return null
}

const sanitized = value => JSON.parse(JSON.stringify(value, (key, child) =>
  key === 'data' && typeof child === 'string' && child.length > 1000 ? `[base64 ${child.length} chars]` : child))

async function fetchJson(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${json?.error?.message || text.slice(0, 1000)}`)
  return json
}

async function download(output, target) {
  if (output.data) return writeFileSync(target, Buffer.from(output.data, 'base64'))
  const fileId = String(output.uri).match(/files\/([a-zA-Z0-9_-]+)/)?.[1]
  const deadline = Date.now() + 10 * 60 * 1000
  while (fileId && Date.now() < deadline) {
    const info = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/files/${fileId}`, { headers: { 'x-goog-api-key': apiKey } })
    if (info.state === 'ACTIVE') break
    if (info.state === 'FAILED') throw new Error(`file ${fileId} FAILED`)
    await new Promise(r => setTimeout(r, 3000))
  }
  const url = output.uri.includes('alt=media') ? output.uri : `${output.uri}${output.uri.includes('?') ? '&' : '?'}alt=media`
  const res = await fetch(url, { headers: { 'x-goog-api-key': apiKey } })
  if (!res.ok) throw new Error(`download ${res.status}: ${(await res.text()).slice(0, 300)}`)
  writeFileSync(target, Buffer.from(await res.arrayBuffer()))
}

function ffprobe(path) {
  try {
    return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
      'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', path], { encoding: 'utf8' }))
  } catch (error) { return { error: String(error) } }
}

async function run(model) {
  const startedAt = Date.now()
  const safe = model.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
  try {
    const response = await fetchJson(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(requestFor(model)),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    })
    const generatedMs = Date.now() - startedAt
    const output = outputVideoFrom(response)
    if (!output) throw new Error('no video output')
    const videoPath = resolve(outDir, `${safe}.mp4`)
    await download(output, videoPath)
    const result = { model, status: 'completed', generatedMs, elapsedMs: Date.now() - startedAt, interactionId: response.id, usage: response.usage, videoPath, ffprobe: ffprobe(videoPath), response: sanitized(response) }
    writeFileSync(resolve(outDir, `${safe}.json`), `${JSON.stringify(result, null, 2)}\n`)
    process.stdout.write(`${model}: ${(result.elapsedMs / 1000).toFixed(1)}s id=${response.id} -> ${videoPath}\n`)
    return result
  } catch (error) {
    const result = { model, status: 'failed', elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }
    writeFileSync(resolve(outDir, `${safe}.json`), `${JSON.stringify(result, null, 2)}\n`)
    process.stderr.write(`${model}: FAILED ${(result.elapsedMs / 1000).toFixed(1)}s - ${result.error}\n`)
    return result
  }
}

const runs = await Promise.all(models.map(run))
const report = { createdAt: new Date().toISOString(), label: values.label, prompt: values.prompt, duration, resolution: values.resolution, aspectRatio: values['aspect-ratio'], images: values.image || [], video: values.video || null, previous, runs: runs.map(({ response, ...rest }) => rest) }
writeFileSync(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`Report: ${resolve(outDir, 'report.json')}\n`)
