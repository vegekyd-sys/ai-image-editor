import { chromium } from 'playwright'
import { mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3002'
const videoPath = process.env.E2E_VIDEO_PATH || '/Users/tianyicai/Downloads/20260530-034323.mp4'
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const prompt = process.env.E2E_AGENT_PROMPT || '把这个视频换成赛博朋克风格，用 Kling，便宜点，直接做，不要先问我确认。'
const outputDir = process.env.E2E_OUTPUT_DIR || '/tmp/makaron-agent-video-style-probe'

if (!existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`)
if (!email || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD.')
await mkdir(outputDir, { recursive: true })

async function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const raw = await readFile(filePath, 'utf8')
  return Object.fromEntries(
    raw.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')]
      })
  )
}

const localEnv = await readEnvFile(path.resolve('.env.local'))
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY

async function waitForUploadedVideo(projectId, timeoutMs = 120_000) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase env for probe.')
  const deadline = Date.now() + timeoutMs
  let lastRows = []
  while (Date.now() < deadline) {
    const res = await fetch(`${supabaseUrl}/rest/v1/snapshots?project_id=eq.${projectId}&select=id,type,image_url,video_meta,sort_order&order=sort_order.asc`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    })
    if (!res.ok) throw new Error(`Snapshot query failed: ${res.status} ${await res.text()}`)
    const rows = await res.json()
    lastRows = rows
    const video = rows.find(row => row.type === 'video' && row.video_meta?.videoUrl)
    if (video) {
      return {
        snapshotId: video.id,
        videoUrl: video.video_meta.videoUrl,
        duration: video.video_meta.duration,
        width: video.video_meta.width,
        height: video.video_meta.height,
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error(`Timed out waiting for uploaded video snapshot. Last rows: ${JSON.stringify(lastRows)}`)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()
page.setDefaultTimeout(60_000)

async function loginAndCreateProject() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  if (page.url().includes('/login')) {
    await page.locator('input[type="email"]').first().fill(email)
    await page.locator('input[type="password"]').first().fill(password)
    await Promise.all([
      page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 60_000, waitUntil: 'domcontentloaded' }),
      page.locator('button[type="submit"]').first().click(),
    ]).catch(async () => {
      await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
    })
  }

  await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
  await page.goto(`${baseUrl}/projects/00000000-0000-0000-0000-000000000000`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1000)
  await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="create-project"]', { state: 'visible' })

  await page.locator('input[type="file"][accept*="video"]').first().setInputFiles(videoPath)
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="create-project"]')
    return !!btn && !btn.hasAttribute('disabled')
  })
  await page.locator('[data-testid="create-project"]').first().click()
  await page.waitForURL(url => /^\/projects\/[^/]+/.test(url.pathname), { timeout: 120_000, waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="editor"]', { state: 'attached', timeout: 90_000 })
  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
  const uploaded = await waitForUploadedVideo(projectId)
  return { projectId, ...uploaded }
}

async function callAgent({ projectId, videoUrl }) {
  return page.evaluate(async ({ prompt, projectId, videoUrl }) => {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        projectId,
        snapshotImages: [videoUrl],
        currentSnapshotIndex: 0,
        videoModel: 'kling',
      }),
    })
    const text = await res.text()
    const events = []
    for (const block of text.split('\n\n')) {
      const line = block.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      try {
        events.push(JSON.parse(line.slice(6)))
      } catch {
        events.push({ type: 'parse_error', raw: line.slice(6) })
      }
    }
    return { status: res.status, events }
  }, { prompt, projectId, videoUrl })
}

try {
  const project = await loginAndCreateProject()
  const agent = await callAgent(project)
  await page.screenshot({ path: path.join(outputDir, 'probe.png'), fullPage: true }).catch(() => {})

  const summary = {
    ok: agent.status === 200,
    prompt,
    project,
    eventTypes: agent.events.map(e => e.type),
    toolCalls: agent.events
      .filter(e => e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'code_stream')
      .map(e => ({
        type: e.type,
        toolName: e.toolName || e.name,
        input: e.input,
        result: e.result,
        text: e.text?.slice?.(0, 300),
      })),
    content: agent.events
      .filter(e => e.type === 'content')
      .map(e => e.text)
      .join(''),
    done: agent.events.some(e => e.type === 'done'),
    screenshot: path.join(outputDir, 'probe.png'),
  }
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) process.exit(1)
} finally {
  await context.close()
  await browser.close()
}
