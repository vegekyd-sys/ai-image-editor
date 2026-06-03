import { chromium } from 'playwright'
import { mkdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3002'
const videoPath = process.env.E2E_VIDEO_PATH || '/Users/tianyicai/Downloads/20260530-034323.mp4'
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD

if (!existsSync(videoPath)) {
  throw new Error(`Video file not found: ${videoPath}`)
}
if (!email || !password) {
  throw new Error('Set E2E_EMAIL and E2E_PASSWORD to run the browser e2e.')
}

const outputDir = process.env.E2E_OUTPUT_DIR || '/tmp/makaron-video-upload-e2e'
await mkdir(outputDir, { recursive: true })

async function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const raw = await readFile(filePath, 'utf8')
  return Object.fromEntries(
    raw.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index)
        const value = line.slice(index + 1).replace(/^['"]|['"]$/g, '')
        return [key, value]
      })
  )
}

const localEnv = await readEnvFile(path.resolve('.env.local'))
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || localEnv.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function getSupabaseAccessToken(page) {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw)
        const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token
        if (token) return token
      } catch {
        // Ignore unrelated localStorage entries.
      }
    }
    return null
  })
}

async function fetchVideoSnapshots(page, projectId) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for DB verification.')
  }
  const accessToken = await getSupabaseAccessToken(page)
  if (!accessToken) return []
  const url = `${supabaseUrl}/rest/v1/snapshots?project_id=eq.${encodeURIComponent(projectId)}&select=id,type,image_url,video_meta,sort_order&order=sort_order.asc`
  const response = await fetch(url, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!response.ok) throw new Error(`Snapshot DB query failed: ${response.status} ${await response.text()}`)
  return response.json()
}

async function waitForVideoSnapshot(page, projectId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let lastRows = []
  while (Date.now() < deadline) {
    const rows = await fetchVideoSnapshots(page, projectId)
    if (!Array.isArray(rows)) throw new Error(`Unexpected snapshot DB response: ${JSON.stringify(rows)}`)
    lastRows = rows
    const videoSnapshot = rows.find((snap) => snap.type === 'video' && snap.video_meta?.videoUrl)
    if (videoSnapshot) return { rows, videoSnapshot }
    await page.waitForTimeout(2_000)
  }
  throw new Error(`No completed video snapshot found for project ${projectId}. Last rows: ${JSON.stringify(lastRows)}`)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()

page.setDefaultTimeout(45_000)

const events = []
const remember = (type, message) => {
  events.push({ type, message: String(message).slice(0, 500) })
  if (events.length > 80) events.shift()
}

page.on('console', (msg) => remember(`console:${msg.type()}`, msg.text()))
page.on('pageerror', (err) => remember('pageerror', err.stack || err.message))
page.on('requestfailed', (request) => remember('requestfailed', `${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`))

const fail = async (error) => {
  await page.screenshot({ path: path.join(outputDir, 'video-upload-e2e-failure.png'), fullPage: true }).catch(() => {})
  const state = await page.evaluate(() => ({
    url: location.href,
    pendingVideos: sessionStorage.getItem('pendingVideos'),
    buttonDisabled: document.querySelector('[data-testid="create-project"]')?.hasAttribute('disabled') ?? null,
    fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map((input) => ({
      accept: input.getAttribute('accept'),
      files: input.files?.length || 0,
    })),
    bodyText: document.body.innerText.slice(0, 2000),
  })).catch((evalError) => ({ evalError: String(evalError) }))

  console.error(JSON.stringify({
    ok: false,
    error: error?.stack || String(error),
    state,
    events,
    screenshot: path.join(outputDir, 'video-upload-e2e-failure.png'),
  }, null, 2))
  throw error
}

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })

  if (page.url().includes('/login')) {
    await page.locator('input[type="email"]').first().fill(email)
    await page.locator('input[type="password"]').first().fill(password)
    await Promise.all([
      page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 45_000, waitUntil: 'domcontentloaded' }),
      page.locator('button[type="submit"]').first().click(),
    ]).catch(async () => {
      // Some auth redirects go through "/" quickly; force projects after session cookie is set.
      await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
    })
  }

  await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname.startsWith('/projects'), { timeout: 45_000 })

  // Prewarm the dynamic project route so Turbopack does not Fast Refresh during
  // the one-shot sessionStorage handoff from /projects to /projects/[id].
  await page.goto(`${baseUrl}/projects/00000000-0000-0000-0000-000000000000`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1_000)
  await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname === '/projects', { timeout: 45_000 })
  await page.waitForSelector('[data-testid="create-project"]', { state: 'visible' })

  const createButton = page.locator('[data-testid="create-project"]').first()
  const fileInput = page.locator('input[type="file"][accept*="video"]').first()
  await fileInput.setInputFiles(videoPath)

  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="create-project"]')
    return !!btn && !btn.hasAttribute('disabled')
  })

  await createButton.click()
  await page.waitForURL((url) => /^\/projects\/[^/]+/.test(url.pathname), {
    timeout: 120_000,
    waitUntil: 'domcontentloaded',
  })
  await page.waitForSelector('[data-testid="editor"]', { state: 'attached', timeout: 90_000 })

  const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
  if (!projectId) throw new Error(`Could not parse project id from ${page.url()}`)

  const dbResult = await waitForVideoSnapshot(page, projectId, 10_000).catch(() => null)
  const videoSnapshot = dbResult?.videoSnapshot ?? null

  const editorMode = await page.locator('[data-testid="editor"]').getAttribute('data-view-mode')
  if (editorMode === 'cui') {
    await page.locator('[data-testid="cui-pip"]').click({ timeout: 90_000 })
    await page.waitForFunction(() => {
      return document.querySelector('[data-testid="editor"]')?.getAttribute('data-view-mode') === 'gui'
    }, null, { timeout: 10_000 }).catch(() => {})
  }

  await page.waitForSelector('video', { state: 'attached', timeout: 90_000 })
  await page.waitForFunction(() => {
    const video = document.querySelector('video')
    return !!video
      && !!(video.currentSrc || video.getAttribute('src'))
      && Number.isFinite(video.duration)
      && video.duration > 30
  }, null, { timeout: 120_000 })

  const videoInfo = await page.locator('video').first().evaluate((video) => ({
    src: video.currentSrc || video.getAttribute('src') || '',
    duration: Number.isFinite(video.duration) ? video.duration : null,
    width: video.videoWidth,
    height: video.videoHeight,
  }))

  await page.screenshot({ path: path.join(outputDir, 'video-upload-e2e.png'), fullPage: true })

  if (!videoInfo.src) throw new Error('Editor video element has no src')
  if (!(videoInfo.duration && videoInfo.duration > 30)) throw new Error(`Expected editor video duration >30s, got ${videoInfo.duration}`)

  console.log(JSON.stringify({
    ok: true,
    url: page.url(),
    dbVideoSnapshot: videoSnapshot ? {
      id: videoSnapshot.id,
      duration: videoSnapshot.video_meta.duration,
      width: videoSnapshot.video_meta.width,
      height: videoSnapshot.video_meta.height,
      hasVideoUrl: !!videoSnapshot.video_meta.videoUrl,
    } : null,
    videoElement: videoInfo,
    screenshot: path.join(outputDir, 'video-upload-e2e.png'),
  }, null, 2))
} catch (error) {
  await fail(error)
} finally {
  await context.close()
  await browser.close()
}
