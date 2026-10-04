import { spawn, execFile } from 'child_process'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import dotenv from 'dotenv'
import { chromium, type Browser } from 'playwright'
import { getSupabaseAdmin } from '@/lib/supabase/service'
import * as workspace from '@/lib/workspace'

dotenv.config({ path: '.env.local' })
if (process.env.MAKARON_ENV_FILE && process.env.MAKARON_ENV_FILE !== '.env.local') {
  dotenv.config({ path: process.env.MAKARON_ENV_FILE })
}
dotenv.config({ path: '.env' })

type Json = Record<string, unknown>

const port = Number(process.env.REMOTION_FRONTEND_AGENT_E2E_PORT || 4308)
const baseUrl = `http://127.0.0.1:${port}`

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJson(url: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(url, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} failed ${res.status}: ${text}`)
  return data
}

async function waitForServer(proc: ReturnType<typeof spawn>) {
  const started = Date.now()
  while (Date.now() - started < 90_000) {
    if (proc.exitCode !== null) throw new Error(`Next dev server exited with ${proc.exitCode}`)
    try {
      const res = await fetch(`${baseUrl}/api/projects/list`)
      if (res.status === 401 || res.status === 200 || res.status === 404) return
    } catch {
      // booting
    }
    await wait(1000)
  }
  throw new Error('Timed out waiting for Next dev server')
}

function ffprobe(filePath: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-of', 'json',
      filePath,
    ], (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message))
      const stream = JSON.parse(stdout).streams?.[0]
      resolve({
        width: Number(stream?.width),
        height: Number(stream?.height),
        duration: Number(stream?.duration),
      })
    })
  })
}

async function downloadAndProbe(url: string, outputPath: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`MP4 download failed ${res.status}`)
  await writeFile(outputPath, Buffer.from(await res.arrayBuffer()))
  const meta = await ffprobe(outputPath)
  if (meta.width !== 720 || meta.height !== 1280) {
    throw new Error(`Expected 720x1280 MP4, got ${meta.width}x${meta.height}`)
  }
  if (Math.abs(meta.duration - 2) > 0.25) {
    throw new Error(`Expected ~2s MP4, got ${meta.duration}s`)
  }
  return meta
}

function makeDesign() {
  return {
    width: 1080,
    height: 1920,
    animation: { fps: 30, durationInSeconds: 2 },
    props: { title: 'Frontend Agent E2E' },
    code: `function Composition(props) {
  const frame = useCurrentFrame();
  return React.createElement(AbsoluteFill, {
    style: {
      background: '#0f172a',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 72,
      fontWeight: 800
    }
  }, (props.title || 'E2E') + ' ' + frame);
}`,
  }
}

async function createProjectWithComposition(userId: string, title: string) {
  const admin = getSupabaseAdmin()
  const projectId = crypto.randomUUID()
  const snapshotId = crypto.randomUUID()
  const designPath = `${projectId}/code/${snapshotId}.json`
  const design = makeDesign()

  const { error: projectError } = await admin.from('projects').insert({
    id: projectId,
    user_id: userId,
    title,
    timeline_version: 2,
  })
  if (projectError) throw new Error(projectError.message)

  const written = await workspace.writeFile(designPath, JSON.stringify(design), admin, userId, 'application/json')
  if (!written.success) throw new Error(written.error || 'workspace write failed')

  const { error: snapshotError } = await admin.from('snapshots').insert({
    id: snapshotId,
    project_id: projectId,
    image_url: '/video-placeholder.png',
    tips: [],
    message_id: '',
    sort_order: 0,
    type: 'edit',
    design_path: designPath,
    description: '[Remotion composition]',
  })
  if (snapshotError) throw new Error(snapshotError.message)

  return { projectId, snapshotId, designPath }
}

async function createTempUser() {
  const admin = getSupabaseAdmin()
  const email = `remotion-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const password = `Pass-${crypto.randomUUID()}`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(error?.message || 'createUser failed')
  await admin.from('user_profiles').upsert({ id: data.user.id, activated: true }, { onConflict: 'id' })
  await admin.from('credit_balances').upsert({ user_id: data.user.id, balance: 1000 }, { onConflict: 'user_id' })
  return { userId: data.user.id, email, password }
}

async function browserLogin(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1100 } })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/login`)
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30_000 })
  return { context, page }
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Executable doesn\'t exist')) throw error
    return chromium.launch({ headless: true, channel: 'chrome' })
  }
}

async function cleanup(userId: string, projectIds: string[], tmpDir: string) {
  const admin = getSupabaseAdmin()
  const ignore = async (value: PromiseLike<unknown>) => {
    try { await value } catch {}
  }
  for (const projectId of projectIds) {
    const { data: jobs } = await admin
      .from('remotion_export_jobs')
      .select('workspace_path')
      .eq('project_id', projectId)
    const storagePaths = (jobs || [])
      .map((job: { workspace_path?: string | null }) => job.workspace_path ? `${userId}/workspace/${job.workspace_path}` : '')
      .filter(Boolean)
    if (storagePaths.length) await admin.storage.from('images').remove(storagePaths).catch(() => {})
    await ignore(admin.from('agent_events').delete().eq('project_id', projectId))
    await ignore(admin.from('agent_runs').delete().eq('project_id', projectId))
    await ignore(admin.from('snapshots').delete().eq('project_id', projectId))
    await ignore(admin.from('remotion_export_jobs').delete().eq('project_id', projectId))
    await ignore(admin.from('messages').delete().eq('project_id', projectId))
    await ignore(admin.from('workspace_files').delete().eq('user_id', userId).like('path', `${projectId}/%`))
    await ignore(admin.from('projects').delete().eq('id', projectId))
  }
  await admin.auth.admin.deleteUser(userId).catch(() => {})
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
}

async function ignore(value: PromiseLike<unknown>) {
  try { await value } catch {}
}

async function runFrontendSaveE2E(browser: Browser, email: string, password: string, projectId: string, tmpDir: string) {
  const { context, page } = await browserLogin(browser, email, password)
  const admin = getSupabaseAdmin()
  const exportRequests: string[] = []
  page.on('request', req => {
    const url = req.url()
    if (url.includes('/api/remotion/export')) exportRequests.push(`${req.method()} ${url}`)
  })
  await page.goto(`${baseUrl}/projects/${projectId}`)
  await page.getByRole('button', { name: 'Save' }).waitFor({ timeout: 60_000 })
  const saveButton = page.getByRole('button', { name: 'Save' })
  const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
  await saveButton.click()
  await page.getByRole('button', { name: 'Saving' }).waitFor({ timeout: 30_000 })
  const download = await downloadPromise
  const outputPath = path.join(tmpDir, 'frontend-save.mp4')
  await download.saveAs(outputPath)
  const probe = await ffprobe(outputPath)
  if (Math.abs(probe.duration - 2) > 0.25) {
    throw new Error(`Frontend Save expected ~2s MP4, got ${probe.duration}s`)
  }
  if (!probe.width || !probe.height) {
    throw new Error(`Frontend Save produced invalid MP4 dimensions: ${probe.width}x${probe.height}`)
  }
  if (exportRequests.some(req => req.includes('/api/remotion/export'))) {
    throw new Error('Frontend Save unexpectedly called /api/remotion/export')
  }
  const { count, error } = await admin
    .from('snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('type', 'video')
  if (error) throw new Error(error.message)
  if ((count || 0) !== 0) {
    throw new Error(`Frontend Save unexpectedly published ${count} video snapshots`)
  }
  await context.close()
  return { probe, exportRequests: exportRequests.length, outputPath }
}

async function runAgentE2E(key: string, projectId: string, tmpDir: string) {
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
  const started = await fetchJson(`${baseUrl}/api/agent/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId,
      currentSnapshotIndex: 0,
      prompt: 'Please use materialize_media on the current Remotion composition and export it as an MP4. Do not generate a new design; just export the current composition. It is OK to queue it asynchronously like video generation.',
    }),
  })
  const runId = String(started.runId)
  let final: Json | null = null
  for (let i = 0; i < 120; i++) {
    const data = await fetchJson(`${baseUrl}/api/agent/run/${runId}?events=true`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'aborted') {
      final = data
      break
    }
    await wait(3000)
  }
  if (!final) throw new Error('Agent run timed out')
  if (final.status !== 'completed') throw new Error(`Agent run ended ${final.status}: ${JSON.stringify(final)}`)
  const events = Array.isArray(final.events) ? final.events as Array<{ type?: string; data?: Record<string, unknown> }> : []
  const calledTool = events.some(e => e.type === 'tool_call' && e.data?.tool === 'materialize_media')
  if (!calledTool) throw new Error('Agent did not call materialize_media')
  const output = Array.isArray(final.output) ? final.output as Array<Record<string, unknown>> : []
  const video = output.find(item => item.type === 'video') || {}
  let videoUrl = typeof video.url === 'string' && video.status === 'completed' ? video.url : ''
  if (!videoUrl) {
    const admin = getSupabaseAdmin()
    for (let i = 0; i < 90; i++) {
      const { data, error } = await admin
        .from('snapshots')
        .select('video_meta')
        .eq('project_id', projectId)
        .eq('type', 'video')
        .order('sort_order', { ascending: false })
        .limit(5)
      if (error) throw new Error(error.message)
      const completed = (data || [])
        .map(row => row.video_meta as { status?: string; videoUrl?: string } | null)
        .find(meta => meta?.status === 'completed' && typeof meta.videoUrl === 'string')
      if (completed?.videoUrl) {
        videoUrl = completed.videoUrl
        break
      }
      await wait(3000)
    }
  }
  if (!videoUrl) throw new Error(`Agent materialize did not complete a video snapshot: ${JSON.stringify(output)}`)
  const probe = await downloadAndProbe(videoUrl, path.join(tmpDir, 'agent.mp4'))
  return { runId, probe, videoUrl }
}

async function main() {
  for (const required of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'REMOTION_SNAPSHOT_ID']) {
    if (!process.env[required]) throw new Error(`${required} is required`)
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'remotion-frontend-agent-e2e-'))
  const { userId, email, password } = await createTempUser()
  const admin = getSupabaseAdmin()
  const { generateApiKey } = await import('@/lib/billing/api-keys')
  const { key, id: keyId } = await generateApiKey(userId, 'frontend-agent-remotion-e2e')
  const projectIds: string[] = []
  let browser: Browser | null = null
  const server = spawn('npx', ['next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', String(port)], {
    env: {
      ...process.env,
      MAKARON_APP_URL: baseUrl,
      REMOTION_EXPORT_INLINE_AFTER: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => process.stderr.write(`[next] ${chunk}`))
  server.stderr.on('data', chunk => process.stderr.write(`[next] ${chunk}`))

  try {
    await waitForServer(server)
    const frontendProject = await createProjectWithComposition(userId, 'frontend-save-remotion-e2e')
    projectIds.push(frontendProject.projectId)
    const agentProject = await createProjectWithComposition(userId, 'agent-materialize-remotion-e2e')
    projectIds.push(agentProject.projectId)

    browser = await launchBrowser()
    const frontend = await runFrontendSaveE2E(browser, email, password, frontendProject.projectId, tmpDir)
    const agent = await runAgentE2E(key, agentProject.projectId, tmpDir)

    console.log(JSON.stringify({
      ok: true,
      frontend,
      agent: {
        runId: agent.runId,
        probe: agent.probe,
        videoUrl: agent.videoUrl,
      },
    }, null, 2))
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.kill('SIGTERM')
    await ignore(admin.from('api_keys').update({ is_active: false }).eq('id', keyId))
    await cleanup(userId, projectIds, tmpDir)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exit(1)
})
