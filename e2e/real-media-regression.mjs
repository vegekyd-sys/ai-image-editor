import { chromium } from 'playwright'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3002'
const outputDir = process.env.E2E_OUTPUT_DIR || '/tmp/makaron-real-media-regression'
const envPath = process.env.E2E_ENV_FILE || '/tmp/makaron-agent-video-style-probe/e2e-env.json'
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const timeoutMs = Number(process.env.E2E_AGENT_TIMEOUT_MS || 900_000)

await mkdir(outputDir, { recursive: true })

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return {}
  return JSON.parse(await readFile(filePath, 'utf8'))
}

const savedEnv = await readJsonIfExists(envPath)
const loginEmail = email || savedEnv.email
const loginPassword = password || savedEnv.password
if (!loginEmail || !loginPassword) {
  throw new Error('Set E2E_EMAIL/E2E_PASSWORD or provide E2E_ENV_FILE.')
}

function parseSse(text) {
  const events = []
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean)
    const dataLine = lines.find((line) => line.startsWith('data: '))
    if (!dataLine) continue
    try {
      events.push(JSON.parse(dataLine.slice(6)))
    } catch {
      events.push({ type: 'parse_error', raw: dataLine.slice(6) })
    }
  }
  return events
}

function summarizeAgent(caseName, projectUrl, status, events) {
  const toolEvents = events
    .filter((event) => event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'animation_task' || event.type === 'music_task')
    .map((event) => ({
      type: event.type,
      toolName: event.toolName || event.name,
      taskId: event.taskId,
      input: event.input,
      result: event.result,
    }))

  return {
    caseName,
    ok: status === 200 && events.some((event) => event.type === 'done'),
    status,
    projectUrl,
    eventTypes: [...new Set(events.map((event) => event.type))],
    toolEvents,
    content: events.filter((event) => event.type === 'content').map((event) => event.text).join('').slice(0, 2000),
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await context.newPage()
page.setDefaultTimeout(90_000)

async function login() {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  if (page.url().includes('/login')) {
    await page.locator('input[type="email"]').first().fill(loginEmail)
    await page.locator('input[type="password"]').first().fill(loginPassword)
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 90_000 }),
      page.locator('button[type="submit"]').first().click(),
    ]).catch(async () => {
      await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
    })
  }
  await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
}

async function sampleImageBase64() {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 720
    canvas.height = 960
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 720, 960)
    gradient.addColorStop(0, '#f7d488')
    gradient.addColorStop(0.45, '#3d7f8f')
    gradient.addColorStop(1, '#1c1f3a')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 720, 960)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(240, 380, 240, 300)
    ctx.fillStyle = '#2a2f42'
    ctx.fillRect(270, 420, 180, 190)
    ctx.fillStyle = '#f2c14e'
    ctx.beginPath()
    ctx.arc(360, 310, 86, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#101828'
    ctx.font = 'bold 54px sans-serif'
    ctx.fillText('MK', 292, 335)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 44px sans-serif'
    ctx.fillText('Media Lab', 244, 780)
    return canvas.toDataURL('image/jpeg', 0.9)
  })
}

async function createProject({ title, imageBase64 }) {
  return page.evaluate(async ({ title, imageBase64 }) => {
    const response = await fetch('/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(imageBase64 ? { title, imageBase64 } : { title }),
    })
    const json = await response.json()
    return { status: response.status, json }
  }, { title, imageBase64 })
}

async function runAgent(projectId, prompt, extra = {}) {
  return page.evaluate(async ({ projectId, prompt, extra }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), extra.timeoutMs)
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          prompt,
          headless: true,
          ...extra.body,
        }),
        signal: controller.signal,
      })
      return { status: response.status, text: await response.text() }
    } finally {
      clearTimeout(timer)
    }
  }, { projectId, prompt, extra: { ...extra, timeoutMs } })
}

async function callTips(imageBase64, category, existingLabels = []) {
  return page.evaluate(async ({ imageBase64, category, existingLabels }) => {
    const response = await fetch('/api/tips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, category, count: 2, existingLabels }),
    })
    return { status: response.status, text: await response.text() }
  }, { imageBase64, category, existingLabels })
}

const summaries = []

try {
  await login()
  const imageBase64 = await sampleImageBase64()

  const imageProject = await createProject({ title: 'Codex real image regression', imageBase64 })
  if (imageProject.status !== 200) throw new Error(`Image project create failed: ${JSON.stringify(imageProject)}`)
  const imageProjectId = imageProject.json.projectId
  const imageProjectUrl = `${baseUrl}/projects/${imageProjectId}`
  summaries.push({
    caseName: 'image_upload_project_create',
    ok: true,
    projectUrl: imageProjectUrl,
    snapshots: imageProject.json.snapshots,
  })

  const tipsCategories = ['enhance', 'creative', 'wild']
  const tipsResults = []
  const existingLabels = []
  for (const category of tipsCategories) {
    const tipsResult = await callTips(imageBase64, category, existingLabels)
    const labels = Array.from(tipsResult.text.matchAll(/"label"\s*:\s*"([^"]+)"/g), (match) => match[1])
    existingLabels.push(...labels)
    tipsResults.push({
      category,
      ok: tipsResult.status === 200 && tipsResult.text.includes('[DONE]') && labels.length > 0,
      status: tipsResult.status,
      labels,
      sample: tipsResult.text.slice(0, 800),
    })
  }
  summaries.push({
    caseName: 'image_tips_generation',
    ok: tipsResults.every((item) => item.ok),
    projectUrl: imageProjectUrl,
    categories: tipsResults,
  })

  const imageAgent = await runAgent(
    imageProjectId,
    '把这张图片变成更高级的夜晚霓虹产品海报，保留主体构图，直接生成，不要问我确认。',
  )
  summaries.push(summarizeAgent('image_generate_edit', imageProjectUrl, imageAgent.status, parseSse(imageAgent.text)))

  const designProject = await createProject({ title: 'Codex real design regression' })
  if (designProject.status !== 200) throw new Error(`Design project create failed: ${JSON.stringify(designProject)}`)
  const designProjectId = designProject.json.projectId
  const designProjectUrl = `${baseUrl}/projects/${designProjectId}`
  const designAgent = await runAgent(
    designProjectId,
    '用 run_code 做一个 5 秒竖版可编辑 motion design：主题是 Makaron Video Lab，包含标题、三段节奏卡点文字、动态色块和轻微镜头推进。直接发布到时间线。',
  )
  summaries.push(summarizeAgent('run_code_design_publish', designProjectUrl, designAgent.status, parseSse(designAgent.text)))

  const musicAgent = await runAgent(
    designProjectId,
    '给这个 motion design 生成一段适合科技产品 demo 的背景音乐，轻快、有推进感、纯音乐，直接生成。',
  )
  summaries.push(summarizeAgent('music_generate_suno', designProjectUrl, musicAgent.status, parseSse(musicAgent.text)))

  const videoProject = await createProject({ title: 'Codex real 5s Kling video regression', imageBase64 })
  if (videoProject.status !== 200) throw new Error(`Video project create failed: ${JSON.stringify(videoProject)}`)
  const videoProjectId = videoProject.json.projectId
  const videoProjectUrl = `${baseUrl}/projects/${videoProjectId}`
  const videoAgent = await runAgent(
    videoProjectId,
    '用 Kling 把这张图生成 5 秒竖版视频：镜头缓慢推进，主体微微发光，背景有干净的科技感光线流动。直接提交渲染，不要问我确认。',
    { body: { videoModel: 'kling' } },
  )
  summaries.push(summarizeAgent('video_generate_5s_kling', videoProjectUrl, videoAgent.status, parseSse(videoAgent.text)))

  await page.goto(videoProjectUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.screenshot({ path: path.join(outputDir, 'last-video-project.png'), fullPage: true }).catch(() => {})

  const reportPath = path.join(outputDir, 'summary.json')
  await writeFile(reportPath, JSON.stringify({ ok: summaries.every((item) => item.ok), baseUrl, summaries }, null, 2))
  console.log(JSON.stringify({ ok: summaries.every((item) => item.ok), reportPath, summaries }, null, 2))
  if (!summaries.every((item) => item.ok)) process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}
