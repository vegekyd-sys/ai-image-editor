#!/usr/bin/env node

/**
 * Frozen Enhance A/B: Qwen Image Edit Spicy vs Nano Banana 2 Lite.
 *
 * Paid submissions are checkpointed before the request. Unknown outcomes are
 * never retried automatically. The source images and prompts come from the
 * 2026-09-04 Tips factorial run so the image-model comparison does not
 * regenerate or change Tips text.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import dotenv from 'dotenv'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '../..')
const envFile = process.env.MAKARON_ENV_FILE || '/Users/tianyicai/ai-image-editor/.env.local'
dotenv.config({ path: envFile, quiet: true })
process.env.QWEN_PROVIDER = 'mulerouter'
// Keep failed diagnostic tasks queryable. Successful tasks are also retained
// for this small benchmark; production may use the default cleanup behavior.
process.env.MULEROUTER_IMAGE_DELETE_TASKS = 'false'

const frozenRoot = process.env.TIPS_FROZEN_RUN
  || '/Users/tianyicai/ai-image-editor-tips-wan27-ab/test-results/v1'
const frozenResults = resolve(frozenRoot, 'text-v1/results.json')
const outputDir = resolve(root, 'test-results/qwen-spicy-vs-nano-lite-enhance-v1')
const assetsDir = resolve(outputDir, 'assets')
const statePath = resolve(outputDir, 'results.json')
const models = ['qwen-image-edit-spicy', 'nano-banana-2-lite']
const execFileAsync = promisify(execFile)
const nanoLiteModel = 'google/gemini-3.1-flash-lite-image'
const imageEditSystemPrompt = `你是世界上最好的照片编辑AI。你能深入理解图片的每个细节——主体、情绪、光线、构图、环境、色彩、纹理、瑕疵和故事。

收到图片时，用中文简短点评（2-3句话，展示你真的看懂了这张图）。

当用户要求编辑图片时，你直接生成编辑后的图片。不要只是描述要做什么——直接生成图片！生成图片后用中文简短描述你做了什么（1-2句话）。

人脸保持规则：
- 每个人的身份必须保持：相同的脸型、眼睛、鼻子、嘴巴、面部结构
- 皮肤可以优化，但骨骼结构不能变
- 发型发色保持不变（除非编辑要求改变）
- 表情姿势保持不变（除非编辑要求改变）

小脸保护规则（全身照/合照/远景/广角等人脸占比小的图片）：
- 小脸图片中每个人的面部必须与原图完全一致——不做任何面部修改、补光、美颜
- 编辑时如果需要人物有反应，只用身体语言（转身、倾斜、手势），不改变面部表情`

const sha = value => createHash('sha256').update(value).digest('hex')
const safeId = value => value.replace(/[^a-z0-9-]/gi, '-').toLowerCase()

async function atomicWrite(path, body) {
  const next = `${path}.next`
  await writeFile(next, body)
  await rename(next, path)
}

async function loadOrCreate() {
  await mkdir(assetsDir, { recursive: true })
  const frozenBytes = await readFile(frozenResults)
  const frozen = JSON.parse(frozenBytes)
  const existing = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => null)
  if (existing) {
    if (existing.sourceHash !== sha(frozenBytes) || JSON.stringify(existing.models) !== JSON.stringify(models)) {
      throw new Error('Existing run has different frozen inputs or models')
    }
    return existing
  }

  const cases = []
  for (const [imageIndex, row] of frozen.rows.entries()) {
    const enhance = row.categories.find(category => category.category === 'enhance')
    for (const [author, variant] of Object.entries(enhance.variants)) {
      const tip = variant.tips[0]
      const id = `image-${imageIndex}-${safeId(author)}`
      const aFirst = parseInt(sha(id).slice(0, 2), 16) % 2 === 0
      cases.push({
        id,
        imageIndex,
        author,
        source: resolve(frozenRoot, row.originalPath),
        prompt: tip.editPrompt,
        blindOrder: aFirst ? models : [...models].reverse(),
        outputs: Object.fromEntries(models.map(model => [model, { state: 'pending' }])),
      })
    }
  }
  const state = {
    createdAt: new Date().toISOString(),
    sourceHash: sha(frozenBytes),
    models,
    protocol: {
      category: 'enhance',
      sourceImages: frozen.rows.length,
      cases: cases.length,
      promptSelection: 'First frozen Enhance tip from each of two text authors per source image',
      sameInputAndPrompt: true,
      retryPaidSubmission: false,
      fallback: false,
      spicyPriceUsd: 0.04,
      nanoLitePrice: 'provider-reported actual cost',
    },
    cases,
  }
  await atomicWrite(statePath, JSON.stringify(state, null, 2))
  return state
}

async function saveState(state) {
  await atomicWrite(statePath, JSON.stringify(state, null, 2))
}

async function normalizeSource(sourcePath, caseId) {
  const source = await readFile(sourcePath)
  const normalized = await sharp(source).rotate().jpeg({ quality: 95 }).toBuffer()
  const publicPath = `assets/${caseId}-original.jpg`
  await writeFile(resolve(outputDir, publicPath), normalized)
  return { bytes: normalized, dataUrl: `data:image/jpeg;base64,${normalized.toString('base64')}`, publicPath }
}

async function generateNanoLite(dataUrl, prompt) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://makaron.app',
      'X-Title': 'Makaron Qwen Spicy Enhance Benchmark',
    },
    body: JSON.stringify({
      model: nanoLiteModel,
      stream: false,
      modalities: ['image', 'text'],
      temperature: 1,
      reasoning: { effort: 'low' },
      messages: [
        { role: 'system', content: imageEditSystemPrompt },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ] },
      ],
    }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`OpenRouter rejected request HTTP ${response.status}`)
  const image = data?.choices?.[0]?.message?.images?.map(item => item.image_url?.url || item.url).find(Boolean)
  if (!image) throw new Error('OpenRouter completed without an image')
  return {
    image,
    costUsd: typeof data?.usage?.cost === 'number' ? data.usage.cost : undefined,
    usage: data?.usage ? {
      inputTokens: data.usage.prompt_tokens ?? 0,
      outputTokens: data.usage.completion_tokens ?? 0,
      modelId: data.model || nanoLiteModel,
    } : undefined,
  }
}

async function downloadProviderAsset(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.muleusercontent.com')) {
    throw new Error('Unexpected MuleRouter output host')
  }
  // The local Cloudflare Gateway DNS maps this host to an enterprise-TLS
  // address whose CA Node does not trust. Resolve the public Cloudflare edge
  // via DoH and keep normal hostname/SNI verification with curl --resolve.
  const dnsResponse = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(parsed.hostname)}&type=A`)
  const dns = await dnsResponse.json()
  const address = dns?.Answer?.find(answer => answer.type === 1)?.data
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address || '')) throw new Error('Public asset DNS resolution failed')
  const { stdout } = await execFileAsync('/usr/bin/curl', [
    '--fail', '--silent', '--show-error', '--max-time', '60',
    '--resolve', `${parsed.hostname}:443:${address}`,
    parsed.href,
  ], { encoding: 'buffer', maxBuffer: 35 * 1024 * 1024 })
  return Buffer.from(stdout)
}

async function generateSpicy(state, output, image, prompt) {
  const response = await fetch('https://api.mulerouter.ai/vendors/carrothub/v1/qwen-image-edit-spicy/generation', {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${process.env.MULEROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ image, prompt }),
  })
  const created = await response.json().catch(() => null)
  if (!response.ok || !created?.task_info?.id) throw new Error(`MuleRouter rejected request HTTP ${response.status}`)
  output.taskId = created.task_info.id
  await saveState(state)
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    const query = await fetch(`https://api.mulerouter.ai/vendors/carrothub/v1/qwen-image-edit-spicy/generation/${output.taskId}`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${process.env.MULEROUTER_API_KEY}` },
    })
    const task = await query.json().catch(() => null)
    if (!query.ok) throw new Error(`MuleRouter task query HTTP ${query.status}`)
    if (task?.task_info?.status === 'failed') throw new Error('MuleRouter task failed')
    if (task?.task_info?.status === 'completed') {
      if (!task.images?.[0]) throw new Error('MuleRouter task completed without an image')
      const raw = await downloadProviderAsset(task.images[0])
      return `data:image/png;base64,${raw.toString('base64')}`
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2_000))
  }
  throw new Error('MuleRouter task polling timed out')
}

async function runOutput(state, testCase, model, dataUrl) {
  const output = testCase.outputs[model]
  if (output.state !== 'pending') return
  output.state = 'submitting'
  output.startedAt = new Date().toISOString()
  await saveState(state)
  const started = Date.now()
  try {
    let image
    let costUsd
    if (model === 'qwen-image-edit-spicy') {
      image = await generateSpicy(state, output, dataUrl, testCase.prompt)
      costUsd = 0.04
    } else {
      const result = await generateNanoLite(dataUrl, testCase.prompt)
      image = result.image
      costUsd = result.costUsd
      output.usage = result.usage
    }
    if (!image?.startsWith('data:image/')) throw new Error('Provider completed without an inline image')
    const raw = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64')
    const metadata = await sharp(raw).metadata()
    const relativePath = `assets/${testCase.id}-${model}.jpg`
    await sharp(raw).jpeg({ quality: 95 }).toFile(resolve(outputDir, relativePath))
    Object.assign(output, {
      state: 'success',
      elapsedMs: Date.now() - started,
      costUsd,
      width: metadata.width,
      height: metadata.height,
      path: relativePath,
    })
  } catch (error) {
    output.state = 'failed-unknown-no-retry'
    output.elapsedMs = Date.now() - started
    output.error = error instanceof Error ? error.message.slice(0, 300) : 'Unknown failure'
  }
  await saveState(state)
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])
}

async function writeReport(state) {
  const cards = state.cases.map(testCase => {
    const columns = testCase.blindOrder.map((model, index) => {
      const output = testCase.outputs[model]
      const label = index === 0 ? 'A' : 'B'
      return `<figure><figcaption>${label}</figcaption>${output.path ? `<a href="${output.path}" target="_blank"><img src="${output.path}" alt="Candidate ${label}"></a>` : `<div class="failed">${escapeHtml(output.state)}</div>`}</figure>`
    }).join('')
    return `<article><header><strong>Photo ${testCase.imageIndex + 1}</strong><span>${escapeHtml(testCase.author)}</span></header><p>${escapeHtml(testCase.prompt)}</p><div class="grid"><figure><figcaption>Original</figcaption><a href="assets/${testCase.id}-original.jpg" target="_blank"><img src="assets/${testCase.id}-original.jpg" alt="Original"></a></figure>${columns}</div></article>`
  }).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enhance model blind A/B</title><style>body{font:15px system-ui;background:#111;color:#eee;margin:0;padding:24px}main{max-width:1400px;margin:auto}h1{margin:0}.sub{color:#aaa;margin:8px 0 28px}article{border-top:1px solid #333;padding:24px 0}header{display:flex;gap:12px;align-items:center}header span{color:#888}p{color:#bbb;line-height:1.45;max-height:6.5em;overflow:auto}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}figcaption{font-weight:700;margin:0 0 8px}img{width:100%;aspect-ratio:4/3;object-fit:contain;background:#080808;border-radius:8px}.failed{aspect-ratio:4/3;display:grid;place-items:center;background:#321;border-radius:8px}@media(max-width:720px){body{padding:14px}.grid{grid-template-columns:1fr}p{max-height:8em}}</style></head><body><main><h1>Enhance model blind A/B</h1><div class="sub">10 frozen prompts · same source and prompt · A/B identity intentionally hidden here</div>${cards}</main></body></html>`
  await atomicWrite(resolve(outputDir, 'report.html'), html)
}

async function writeSummary(state) {
  const summary = Object.fromEntries(models.map(model => {
    const outputs = state.cases.map(testCase => testCase.outputs[model])
    const successes = outputs.filter(output => output.state === 'success')
    const elapsed = successes.map(output => output.elapsedMs).sort((a, b) => a - b)
    return [model, {
      success: successes.length,
      total: outputs.length,
      meanMs: successes.length ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length) : null,
      p50Ms: elapsed.length ? elapsed[Math.ceil(elapsed.length * 0.5) - 1] : null,
      p95Ms: elapsed.length ? elapsed[Math.ceil(elapsed.length * 0.95) - 1] : null,
      totalCostUsd: Number(successes.reduce((sum, output) => sum + (output.costUsd || 0), 0).toFixed(6)),
      meanCostUsd: successes.length ? Number((successes.reduce((sum, output) => sum + (output.costUsd || 0), 0) / successes.length).toFixed(6)) : null,
    }]
  }))
  await atomicWrite(resolve(outputDir, 'summary.json'), JSON.stringify(summary, null, 2))
  return summary
}

async function writeContactSheets(state) {
  const paired = state.cases.filter(testCase => models.every(model => testCase.outputs[model].state === 'success'))
  const width = 1080
  const cellWidth = 350
  const rowHeight = 300
  for (let page = 0; page < Math.ceil(paired.length / 3); page++) {
    const rows = paired.slice(page * 3, page * 3 + 3)
    const canvas = sharp({
      create: { width, height: rows.length * rowHeight, channels: 3, background: '#111111' },
    })
    const composites = []
    for (const [rowIndex, testCase] of rows.entries()) {
      const items = [
        { label: `${testCase.id} · Original`, path: `assets/${testCase.id}-original.jpg` },
        ...testCase.blindOrder.map((model, index) => ({
          label: index === 0 ? 'A' : 'B',
          path: testCase.outputs[model].path,
        })),
      ]
      for (const [columnIndex, item] of items.entries()) {
        const image = await sharp(resolve(outputDir, item.path))
          .resize(cellWidth - 10, rowHeight - 42, { fit: 'contain', background: '#080808' })
          .jpeg({ quality: 90 })
          .toBuffer()
        const label = Buffer.from(`<svg width="${cellWidth}" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="8" y="22" fill="white" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeHtml(item.label)}</text></svg>`)
        composites.push({ input: label, left: columnIndex * cellWidth, top: rowIndex * rowHeight })
        composites.push({ input: image, left: columnIndex * cellWidth + 5, top: rowIndex * rowHeight + 36 })
      }
    }
    await canvas.composite(composites).jpeg({ quality: 92 }).toFile(resolve(outputDir, `contact-sheet-${page + 1}.jpg`))
  }
}

async function recoverCompletedSpicyTask(state, spec) {
  const [caseId, taskId] = spec.split(',')
  if (!caseId || !/^[0-9a-f-]{36}$/i.test(taskId || '')) throw new Error('Invalid --recover-completed-spicy value')
  const testCase = state.cases.find(item => item.id === caseId)
  if (!testCase) throw new Error(`Unknown benchmark case: ${caseId}`)
  const output = testCase.outputs['qwen-image-edit-spicy']
  if (!String(output.state).startsWith('failed')) throw new Error(`Case ${caseId} is not in a failed state`)
  const response = await fetch(`https://api.mulerouter.ai/vendors/carrothub/v1/qwen-image-edit-spicy/generation/${taskId}`, {
    headers: { Authorization: `Bearer ${process.env.MULEROUTER_API_KEY}` },
  })
  const task = await response.json()
  const imageUrl = task?.task_info?.status === 'completed' ? task.images?.[0] : undefined
  if (!response.ok || !imageUrl) throw new Error(`Task ${taskId} is not a completed image task`)
  const raw = await downloadProviderAsset(imageUrl)
  const metadata = await sharp(raw).metadata()
  const relativePath = `assets/${testCase.id}-qwen-image-edit-spicy.jpg`
  await sharp(raw).jpeg({ quality: 95 }).toFile(resolve(outputDir, relativePath))
  const createdAt = Date.parse(task.task_info.created_at)
  const updatedAt = Date.parse(task.task_info.updated_at)
  Object.assign(output, {
    state: 'success',
    elapsedMs: Number.isFinite(createdAt) && Number.isFinite(updatedAt) ? updatedAt - createdAt : output.elapsedMs,
    costUsd: 0.04,
    width: metadata.width,
    height: metadata.height,
    path: relativePath,
    recoveredTaskId: taskId,
  })
  delete output.error
  state.protocol.completedTaskRecovery = 'Recovered a provider-completed image with GET only after local Node lacked the macOS system CA. No generation POST was repeated.'
  await saveState(state)
}

async function addReplacementCases(state) {
  const frozen = JSON.parse(await readFile(frozenResults, 'utf8'))
  let added = 0
  for (const [imageIndex, row] of frozen.rows.entries()) {
    if (imageIndex > 2) continue
    const enhance = row.categories.find(category => category.category === 'enhance')
    for (const [author, variant] of Object.entries(enhance.variants)) {
      const id = `replacement-image-${imageIndex}-${safeId(author)}`
      if (state.cases.some(testCase => testCase.id === id)) continue
      const prompt = variant.tips[1]?.editPrompt
      if (!prompt) throw new Error(`Missing second frozen Enhance prompt for ${id}`)
      const aFirst = parseInt(sha(id).slice(0, 2), 16) % 2 === 0
      state.cases.push({
        id,
        imageIndex,
        author,
        source: resolve(frozenRoot, row.originalPath),
        prompt,
        blindOrder: aFirst ? models : [...models].reverse(),
        outputs: Object.fromEntries(models.map(model => [model, { state: 'pending' }])),
      })
      added++
    }
  }
  state.protocol.replacementCases = `${added} second frozen Enhance prompts added for images 0-2; no prior paid prompt was repeated.`
  state.protocol.cases = state.cases.length
  await saveState(state)
}

async function main() {
  for (const name of ['MULEROUTER_API_KEY', 'OPENROUTER_API_KEY']) {
    if (!process.env[name]?.trim()) throw new Error(`${name} missing from ${envFile}`)
  }
  const state = await loadOrCreate()
  if (process.argv.includes('--add-replacement-cases')) await addReplacementCases(state)
  const recoveryArg = process.argv.find(arg => arg.startsWith('--recover-completed-spicy='))
  if (recoveryArg) await recoverCompletedSpicyTask(state, recoveryArg.slice(recoveryArg.indexOf('=') + 1))
  if (process.argv.includes('--recover-local-checkpoint-race')) {
    const interrupted = state.cases[0]?.outputs?.['nano-banana-2-lite']
    if (interrupted?.state !== 'submitting' || interrupted.elapsedMs || interrupted.path || interrupted.error) {
      throw new Error('Expected exact pre-provider checkpoint-race state was not found')
    }
    state.protocol.localCheckpointRecovery = 'Reset the first Nano Lite item only: its checkpoint rename rejected before the provider helper was invoked. No paid request was sent.'
    state.cases[0].outputs['nano-banana-2-lite'] = { state: 'pending' }
    await saveState(state)
  }
  if (process.argv.includes('--recover-local-runner-errors')) {
    let recoveredLite = 0
    for (const testCase of state.cases) {
      const output = testCase.outputs['nano-banana-2-lite']
      if (output.state === 'failed-unknown-no-retry' && output.error === 'Invalid or unexpected token') {
        testCase.outputs['nano-banana-2-lite'] = { state: 'pending' }
        recoveredLite++
      }
    }
    let interruptedCount = 0
    for (const testCase of state.cases) {
      for (const model of models) {
        const output = testCase.outputs[model]
        if (output.state !== 'submitting') continue
        output.state = 'failed-interrupted-no-retry'
        output.error = 'Runner was manually interrupted after submission; outcome unknown.'
        interruptedCount++
      }
    }
    state.protocol.localRunnerRecovery = `Reset ${recoveredLite} Nano Lite items that failed during local module parsing before fetch; ${interruptedCount} interrupted submissions were not retried.`
    await saveState(state)
  }
  let pendingCasesStarted = 0
  for (const testCase of state.cases) {
    const hadPending = models.some(model => testCase.outputs[model].state === 'pending')
    if (hadPending && process.argv.includes('--limit-one-pending-case') && pendingCasesStarted >= 1) break
    if (hadPending) pendingCasesStarted++
    const source = await normalizeSource(testCase.source, testCase.id)
    // Keep paid submission checkpoints serial so two model calls cannot race on
    // the same atomic state file. Provider concurrency is not part of this A/B.
    for (const model of models) await runOutput(state, testCase, model, source.dataUrl)
    console.log(`${testCase.id}: ${models.map(model => `${model}=${testCase.outputs[model].state}`).join(' ')}`)
  }
  await writeReport(state)
  await writeContactSheets(state)
  const summary = await writeSummary(state)
  console.log(JSON.stringify({ summary, report: resolve(outputDir, 'report.html') }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
