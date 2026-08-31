import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/api-auth'
import { transcribeWithVolcengineAsr } from '@/lib/volcengine-asr'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_RECORDING_BYTES = 8 * 1024 * 1024

function extensionFor(file: File) {
  if (file.type.includes('mp4')) return '.m4a'
  if (file.type.includes('ogg')) return '.ogg'
  if (file.type.includes('wav')) return '.wav'
  return '.webm'
}

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request)
  if ('error' in authResult) return authResult.error

  const form = await request.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_RECORDING_BYTES) {
    return NextResponse.json({ error: 'Invalid voice recording' }, { status: 400 })
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'makaron-kids-turn-'))
  const localPath = path.join(workDir, `recording${extensionFor(audio)}`)
  try {
    await writeFile(localPath, Buffer.from(await audio.arrayBuffer()))
    const transcript = await transcribeWithVolcengineAsr({
      mediaUrl: audio.name || localPath,
      localMediaPath: localPath,
      language: 'zh-CN',
      uid: authResult.auth.userId,
    })
    const text = transcript.text.trim().slice(0, 600)
    if (!text) return NextResponse.json({ error: 'No speech detected' }, { status: 422 })
    return NextResponse.json({ text, durationMs: transcript.durationMs })
  } catch (error) {
    console.error('[kids/transcribe] Failed:', error)
    return NextResponse.json({ error: 'Could not understand the recording' }, { status: 502 })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
