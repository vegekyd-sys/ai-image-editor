import { spawn, execFile } from 'child_process'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import dotenv from 'dotenv'
import { generateApiKey, deactivateApiKey } from '@/lib/billing/api-keys'
import { getSupabaseAdmin } from '@/lib/supabase/service'

dotenv.config({ path: '.env.local' })
if (process.env.MAKARON_ENV_FILE && process.env.MAKARON_ENV_FILE !== '.env.local') {
  dotenv.config({ path: process.env.MAKARON_ENV_FILE })
}
dotenv.config({ path: '.env' })

type Json = Record<string, unknown>

const port = Number(process.env.REMOTION_E2E_PORT || 4307)
const remoteBaseUrl = process.env.REMOTION_E2E_BASE_URL?.replace(/\/$/, '')
const baseUrl = remoteBaseUrl || `http://127.0.0.1:${port}`
const cliPath = path.join(process.cwd(), 'packages/makaron-cli/bin/makaron.mjs')

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJson(url: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(url, init)
  const text = await res.text()
  let data: Json
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
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
      // still booting
    }
    await wait(1000)
  }
  throw new Error('Timed out waiting for Next dev server')
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`makaron ${args.join(' ')} exited ${code}\n${stderr}\n${stdout}`))
    })
  })
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
      const data = JSON.parse(stdout)
      const stream = data.streams?.[0]
      resolve({
        width: Number(stream?.width),
        height: Number(stream?.height),
        duration: Number(stream?.duration),
      })
    })
  })
}

async function downloadAndProbe(url: string, outputPath: string, expectedWidth: number, expectedHeight: number) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`MP4 download failed ${res.status}`)
  await writeFile(outputPath, Buffer.from(await res.arrayBuffer()))
  const meta = await ffprobe(outputPath)
  if (meta.width !== expectedWidth || meta.height !== expectedHeight) {
    throw new Error(`Expected ${expectedWidth}x${expectedHeight} MP4, got ${meta.width}x${meta.height}`)
  }
  if (Math.abs(meta.duration - 2) > 0.2) {
    throw new Error(`Expected ~2s MP4, got ${meta.duration}s`)
  }
  await new Promise<void>((resolve, reject) => {
    execFile('ffmpeg', ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], (error, _stdout, stderr) => {
      if (error) reject(new Error(`MP4 decode failed: ${stderr || error.message}`))
      else resolve()
    })
  })
  return meta
}

async function pickUserId(): Promise<string> {
  if (process.env.REMOTION_E2E_USER_ID) return process.env.REMOTION_E2E_USER_ID
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('projects')
    .select('user_id')
    .not('user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.user_id) throw new Error('No existing project user found. Set REMOTION_E2E_USER_ID.')
  return data.user_id
}

async function cleanup(userId: string, keyId: string, projectIds: string[], tmpDir: string) {
  const admin = getSupabaseAdmin()
  await deactivateApiKey(userId, keyId).catch(() => {})
  const ignore = async (value: PromiseLike<unknown>) => {
    try {
      await value
    } catch {
      // best effort cleanup
    }
  }

  for (const projectId of projectIds) {
    const { data: jobs } = await admin
      .from('remotion_export_jobs')
      .select('workspace_path')
      .eq('project_id', projectId)

    const storagePaths = (jobs || [])
      .map((job: { workspace_path?: string | null }) => job.workspace_path ? `${userId}/workspace/${job.workspace_path}` : '')
      .filter(Boolean)
    if (storagePaths.length) {
      await admin.storage.from('images').remove(storagePaths).catch(() => {})
    }

    await ignore(admin.from('snapshots').delete().eq('project_id', projectId))
    await ignore(admin.from('remotion_export_jobs').delete().eq('project_id', projectId))
    await ignore(admin.from('workspace_files').delete().eq('user_id', userId).like('path', `${projectId}/%`))
    await ignore(admin.from('projects').delete().eq('id', projectId))
  }

  await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
}

async function main() {
  for (const required of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REMOTION_SNAPSHOT_ID']) {
    if (!process.env[required]) throw new Error(`${required} is required`)
  }

  const userId = await pickUserId()
  const { key, id: keyId } = await generateApiKey(userId, 'remotion-materialize-e2e')
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'remotion-materialize-e2e-'))
  const projectIds: string[] = []
  const server = remoteBaseUrl ? null : spawn('npx', ['next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', String(port)], {
    env: {
      ...process.env,
      MAKARON_APP_URL: baseUrl,
      REMOTION_EXPORT_INLINE_AFTER: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  server?.stdout.on('data', chunk => process.stderr.write(`[next] ${chunk}`))
  server?.stderr.on('data', chunk => process.stderr.write(`[next] ${chunk}`))

  try {
    if (server) await waitForServer(server)

    const headers = {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }
    const design = {
      width: 1080,
      height: 1920,
      animation: { fps: 30, durationInSeconds: 2 },
      props: { title: 'Remotion E2E' },
      code: `function Composition(props) {
  const frame = useCurrentFrame();
  return React.createElement(AbsoluteFill, {
    style: {
      background: '#111827',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, Arial, sans-serif',
      fontSize: 82,
      fontWeight: 800
    }
  }, (props.title || 'Remotion E2E') + ' ' + frame);
}`,
    }
    const designPath = path.join(tmpDir, 'composition.json')
    await writeFile(designPath, JSON.stringify(design, null, 2))

    const apiProject = await fetchJson(`${baseUrl}/api/projects/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'remotion-api-materialize-e2e' }),
    })
    const apiProjectId = String(apiProject.projectId)
    projectIds.push(apiProjectId)

    const apiQueued = await fetchJson(`${baseUrl}/api/media/materialize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectId: apiProjectId,
        design,
        outputType: 'video',
        publish: false,
        name: 'api-materialize-e2e',
      }),
    })
    const apiJobId = String(apiQueued.jobId || apiQueued.id)
    let apiDone: Json | null = null
    for (let i = 0; i < 80; i++) {
      const status = await fetchJson(`${baseUrl}/api/remotion/export/${apiJobId}`, { headers: { Authorization: `Bearer ${key}` } })
      if (status.status === 'completed') {
        apiDone = status
        break
      }
      if (status.status === 'failed') throw new Error(`API materialize failed: ${status.error}`)
      await wait(Number(status.next_poll_after_ms || 3000))
    }
    if (!apiDone) throw new Error('API materialize timed out')
    const apiUrl = String(apiDone.url || apiDone.storageUrl || '')
    const apiProbe = await downloadAndProbe(apiUrl, path.join(tmpDir, 'api.mp4'), 1080, 1920)

    const fastQueued = await fetchJson(`${baseUrl}/api/media/materialize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectId: apiProjectId,
        design,
        outputType: 'video',
        renderProfile: 'fast_720p',
        publish: false,
        name: 'api-fast-materialize-e2e',
      }),
    })
    const fastJobId = String(fastQueued.jobId || fastQueued.id)
    if (fastJobId === apiJobId) throw new Error('Fast export reused the source-resolution job')
    let fastDone: Json | null = null
    for (let i = 0; i < 80; i++) {
      const status = await fetchJson(`${baseUrl}/api/remotion/export/${fastJobId}`, { headers: { Authorization: `Bearer ${key}` } })
      if (status.status === 'completed') {
        fastDone = status
        break
      }
      if (status.status === 'failed') throw new Error(`Fast materialize failed: ${status.error}`)
      await wait(Number(status.next_poll_after_ms || 3000))
    }
    if (!fastDone) throw new Error('Fast materialize timed out')
    const fastUrl = String(fastDone.url || fastDone.storageUrl || '')
    const fastProbe = await downloadAndProbe(fastUrl, path.join(tmpDir, 'fast.mp4'), 720, 1280)

    const cliProject = await fetchJson(`${baseUrl}/api/projects/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'remotion-cli-materialize-e2e' }),
    })
    const cliProjectId = String(cliProject.projectId)
    projectIds.push(cliProjectId)

    const cliEnv = {
      ...process.env,
      MAKARON_URL: baseUrl,
      MAKARON_APP_URL: baseUrl,
      MAKARON_API_KEY: key,
      HOME: tmpDir,
    }
    const cliUrl = await runCli(['materialize', '--project', cliProjectId, '--design-json', designPath, '--pick', 'url'], cliEnv)
    const cliProbe = await downloadAndProbe(cliUrl, path.join(tmpDir, 'cli.mp4'), 1080, 1920)

    const admin = getSupabaseAdmin()
    const { data: cliSnapshots, error: snapError } = await admin
      .from('snapshots')
      .select('id, type, video_meta')
      .eq('project_id', cliProjectId)
      .eq('type', 'video')
    if (snapError) throw new Error(snapError.message)
    if (!cliSnapshots?.length) throw new Error('CLI materialize did not publish a video snapshot')
    const publishedUrl = cliSnapshots[0]?.video_meta?.videoUrl
    if (publishedUrl !== cliUrl) throw new Error('Published snapshot video URL does not match CLI output URL')

    let agentProbe: { width: number; height: number; duration: number } | undefined
    if (process.env.REMOTION_E2E_AGENT === 'true') {
      const prompt = '用 Remotion run_code composition 创建一个 2 秒、1080x1920、30 FPS 的可编辑竖屏剪辑视频：三段纯色镜头依次出现，每段有清楚的大字标题。无需外部素材，不调用视频生成模型。保存 Composition 后调用 materialize_media({publish:true}) 交付真实 MP4，最终 MP4 必须是 1080x1920。'
      const submitted = JSON.parse(await runCli(['chat', '--project', 'auto', '-b', '--json', prompt], cliEnv)) as Json
      const agentProjectId = String(submitted.projectId || '')
      const runId = String(submitted.runId || '')
      if (!agentProjectId || !runId) throw new Error('Agent chat did not return a project and run ID')
      projectIds.push(agentProjectId)

      let runStatus = ''
      for (let i = 0; i < 120; i++) {
        const run = await fetchJson(`${baseUrl}/api/agent/run/${runId}`, { headers: { Authorization: `Bearer ${key}` } })
        runStatus = String(run.status || '')
        if (runStatus === 'completed') break
        if (['failed', 'aborted'].includes(runStatus)) throw new Error(`Agent run ${runId} ended ${runStatus}`)
        await wait(5000)
      }
      if (runStatus !== 'completed') {
        await fetchJson(`${baseUrl}/api/agent/abort`, {
          method: 'POST', headers, body: JSON.stringify({ runId }),
        }).catch(() => {})
        throw new Error(`Agent run ${runId} timed out`)
      }

      const { data: agentJobs, error: agentJobError } = await admin
        .from('remotion_export_jobs')
        .select('id,status,width,height,storage_url,metadata')
        .eq('project_id', agentProjectId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (agentJobError) throw new Error(agentJobError.message)
      const agentJob = agentJobs?.[0]
      if (!agentJob || agentJob.status !== 'completed' || !agentJob.storage_url) {
        throw new Error(`Agent run ${runId} did not complete a Remotion MP4 export`)
      }
      if (agentJob.metadata?.renderProfile !== 'source') {
        throw new Error(`Agent export used ${String(agentJob.metadata?.renderProfile)} instead of source`)
      }
      agentProbe = await downloadAndProbe(agentJob.storage_url, path.join(tmpDir, 'agent.mp4'), 1080, 1920)
    }

    console.log(JSON.stringify({
      ok: true,
      api: { jobId: apiJobId, probe: apiProbe },
      fast: { jobId: fastJobId, probe: fastProbe },
      cli: { probe: cliProbe, publishedSnapshots: cliSnapshots.length },
      ...(agentProbe ? { agent: { probe: agentProbe } } : {}),
    }, null, 2))
  } finally {
    server?.kill('SIGTERM')
    await cleanup(userId, keyId, projectIds, tmpDir)
  }
}

main().catch(async err => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exit(1)
})
