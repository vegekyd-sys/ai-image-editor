/** Real, paid Preview acceptance for the per-user MCP image billing path.
 * Usage: node scripts/verify-image-billing-preview.mjs <deployment-url> --spend
 * Requires local test-results/camera-angle-preview-matrix/product inputs.
 * Accepts only a unique ai-image-editor Vercel deployment hostname, not an alias.
 * Never pass a production deployment or a legacy MCP key. No paid retries.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const [baseArg, confirmation] = process.argv.slice(2)
if (confirmation !== '--spend') throw new Error('Explicit --spend flag is required')
const baseUrl = new URL(baseArg)
if (!/^ai-image-editor-[a-z0-9]{8,}-[^.]+\.vercel\.app$/.test(baseUrl.hostname)
  || baseUrl.protocol !== 'https:' || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
  throw new Error('A unique HTTPS ai-image-editor Vercel deployment URL is required; aliases are rejected')
}
const auth = JSON.parse(readFileSync(join(homedir(), '.makaron', 'auth.json'), 'utf8'))
const apiKey = auth._apiKey
if (typeof apiKey !== 'string' || !apiKey.startsWith('mk_live_')) throw new Error('A per-user Makaron API key is required')
const headers = { Authorization: `Bearer ${apiKey}` }
const inputDir = join(process.cwd(), 'test-results', 'camera-angle-preview-matrix', 'product')
const outputDir = join(process.cwd(), 'test-results', `billing-preview-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(outputDir, { recursive: true })

async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl), { headers })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json()
}

function dataUrl(filename) {
  return `data:image/jpeg;base64,${readFileSync(join(inputDir, filename)).toString('base64')}`
}

const source = dataUrl('a0-e0-d1.0.jpg')
const side = dataUrl('a45-e0-d1.0.jpg')
const back = dataUrl('a90-e0-d1.0.jpg')
const cases = [
  { name: 'spicy-text', tool: 'generate_image_qwen-spicy', credits: 3, arguments: {
    model: 'qwen-spicy', editPrompt: 'A studio photograph of a single red ceramic teapot on a plain cream background.',
  } },
  { name: 'spicy-edit-1', tool: 'edit_image_qwen-spicy', credits: 8, arguments: {
    model: 'qwen-spicy', image: source, editPrompt: 'Keep the same red ceramic teapot and camera view; use warm studio lighting.',
  } },
  { name: 'spicy-edit-2', tool: 'edit_image_qwen-spicy-2', credits: 9, arguments: {
    model: 'qwen-spicy', image: source, referenceImages: [side], editPrompt: 'Keep the same red ceramic teapot; use the second view as a shape reference and show it on a neutral studio table.',
  } },
  { name: 'spicy-edit-3', tool: 'edit_image_qwen-spicy-3', credits: 10, arguments: {
    model: 'qwen-spicy', image: source, referenceImages: [side, back], editPrompt: 'Keep the red ceramic teapot consistent with all three reference views and place it on a plain cream background.',
  } },
  { name: 'rotate-fal', tool: 'rotate_camera_fal', credits: 7, mcpTool: 'makaron_rotate_camera', arguments: {
    image: source, azimuth: 45, elevation: 30, distance: 1,
  } },
]

let balance = (await getJson('/api/billing/credits')).balance
const initialBalance = balance
const results = []
for (const [index, item] of cases.entries()) {
  const startedAt = new Date()
  const response = await fetch(new URL('/api/mcp', baseUrl), {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: item.mcpTool ?? 'makaron_edit_image', arguments: item.arguments } }),
  })
  const payload = await response.json()
  const image = payload.result?.content?.find(block => block.type === 'image')
  if (!response.ok || payload.result?.isError || !image) {
    throw new Error(`${item.name}: provider or MCP failed (HTTP ${response.status}); no paid retry. ${JSON.stringify(payload.result?.content?.find(block => block.type === 'text') ?? {}).slice(0, 400)}`)
  }
  const charged = Number(response.headers.get('X-Credits-Charged'))
  const nextBalance = (await getJson('/api/billing/credits')).balance
  const usage = (await getJson('/api/billing/usage?limit=30')).usage
  const matchingLog = usage.find(row => row.tool_name === item.tool && row.source === 'mcp'
    && new Date(row.created_at).getTime() >= startedAt.getTime() - 5_000 && row.credits_charged === item.credits)
  if (charged !== item.credits || balance - nextBalance !== item.credits || !matchingLog) {
    throw new Error(`${item.name}: billing mismatch; expected ${item.credits}, header ${charged}, balance delta ${balance - nextBalance}, usage log ${Boolean(matchingLog)}. Do not retry.`)
  }
  const bytes = Buffer.from(image.data, 'base64')
  const metadata = await sharp(bytes).metadata()
  const extension = image.mimeType === 'image/png' ? 'png' : 'jpg'
  writeFileSync(join(outputDir, `${item.name}.${extension}`), bytes)
  const row = { name: item.name, tool: item.tool, credits: charged, balance: nextBalance,
    width: metadata.width, height: metadata.height, bytes: bytes.length, usageAt: matchingLog.created_at }
  results.push(row)
  console.log(JSON.stringify(row))
  balance = nextBalance
}
const report = { preview: baseUrl.origin, initialBalance, finalBalance: balance, results }
writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(`Passed ${results.length} real image/billing paths; ${initialBalance - balance} credits recorded.`)
