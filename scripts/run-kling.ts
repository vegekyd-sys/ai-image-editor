#!/usr/bin/env npx tsx
/**
 * Quick Kling video generation from image + prompt + optional reference video
 * Usage:
 *   npx tsx scripts/run-kling.ts <image-path> "<prompt>"
 *   npx tsx scripts/run-kling.ts <image-path> "<prompt>" --video <ref-video-path>
 *   npx tsx scripts/run-kling.ts --poll <task-id>
 */
import jwt from 'jsonwebtoken'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const KLING_BASE = process.env.KLING_API_BASE || 'https://api-beijing.klingai.com'

function generateToken() {
  const ak = process.env.KLING_ACCESS_KEY!
  const sk = process.env.KLING_SECRET_KEY!
  const now = Math.floor(Date.now() / 1000)
  return jwt.sign({ iss: ak, exp: now + 1800, nbf: now - 5 }, sk, { header: { alg: 'HS256' as const, typ: 'JWT' as const } })
}

function headers() {
  return { 'Authorization': `Bearer ${generateToken()}`, 'Content-Type': 'application/json' }
}

async function pollTask(taskId: string) {
  console.log(`Polling task ${taskId}...`)
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 4000))
    try {
      const poll = await fetch(`${KLING_BASE}/v1/videos/omni-video/${taskId}`, { headers: headers() })
      const status = await poll.json()
      const task = status.data
      const s = task.task_status
      process.stdout.write(` ${s}`)
      if (s === 'succeed') {
        const url = task.task_result?.videos?.[0]?.url
        console.log(`\n\nVideo URL: ${url}`)
        return
      }
      if (s === 'failed') {
        console.log(`\n\nFailed: ${task.task_status_msg}`)
        return
      }
    } catch (e: unknown) {
      process.stdout.write(' timeout')
    }
  }
  console.log('\nTimeout after 8 minutes')
}

async function main() {
  const args = process.argv.slice(2)

  // Poll mode
  if (args[0] === '--poll') {
    await pollTask(args[1])
    return
  }

  const imgPath = args[0]
  const prompt = args[1]
  if (!imgPath || !prompt) {
    console.error('Usage:\n  npx tsx scripts/run-kling.ts <image> "<prompt>" [--video <ref.mp4>]\n  npx tsx scripts/run-kling.ts --poll <task-id>')
    process.exit(1)
  }

  let videoPath: string | undefined
  const videoIdx = args.indexOf('--video')
  if (videoIdx !== -1) videoPath = args[videoIdx + 1]

  let duration: string | undefined
  const durIdx = args.indexOf('--duration')
  if (durIdx !== -1) duration = args[durIdx + 1]

  const imgBase64 = fs.readFileSync(imgPath).toString('base64')

  const body: Record<string, unknown> = {
    model_name: 'kling-v3-omni',
    image_list: [{ image_url: imgBase64 }],
    prompt,
    mode: 'std',
    aspect_ratio: '9:16',
    ...(duration ? { duration } : {}),
  }

  if (videoPath) {
    let videoUrl = videoPath
    if (!videoPath.startsWith('http')) {
      if (!fs.existsSync(videoPath)) { console.error(`Video not found: ${videoPath}`); process.exit(1) }
      console.log(`Note: --video must be a URL. Use Supabase/S3 to host the video first.`)
      process.exit(1)
    }
    body.video_list = [{ video_url: videoUrl, refer_type: 'feature', keep_original_sound: 'yes' }]
    body.sound = 'off'
    console.log(`Reference video: ${videoUrl}`)
  } else {
    body.sound = 'on'
  }

  console.log('Submitting to Kling omni-video...')
  const res = await fetch(`${KLING_BASE}/v1/videos/omni-video`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (data.code !== 0) { console.error('Error:', data.message || JSON.stringify(data)); process.exit(1) }

  const taskId = data.data?.task_id
  console.log(`Task ID: ${taskId}`)
  await pollTask(taskId)
}

main().catch(console.error)
