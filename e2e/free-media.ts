/** Isolated acceptance. --live uses real model providers; payments are never made. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium, type Browser } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { parse } from 'dotenv'
import type { VideoMeta } from '../src/types'

async function main() {
const root = process.cwd()
const live = process.argv.includes('--live')
const saveOnly = process.argv.includes('--save-only')
const paymentsOnly = process.argv.includes('--payments-only')
const reuseServer = process.argv.includes('--reuse-server')
assert.ok(!reuseServer || !process.argv.includes('--serve'), '--reuse-server cannot start another server')
const base = 'http://127.0.0.1:3002'
const stamp = Date.now().toString()
const artifacts = process.env.MAKARON_E2E_ARTIFACT_DIR || `/tmp/makaron-free-media-e2e-${stamp}`
const workdir = 'e2e/ios-subscription'
const container = 'supabase_db_makaron-ios-subscription-e2e'
const env = JSON.parse(execFileSync('npx', ['supabase', 'status', '--workdir', workdir, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
assert.equal(env.API_URL, 'http://127.0.0.1:55321', 'Refusing non-isolated database')
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const sql = (input: string) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input, stdio: ['pipe', 'pipe', 'pipe'] })
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const checked = <T extends { error: unknown }>(value: T): T => { assert.equal(value.error, null, JSON.stringify(value.error)); return value }
await mkdir(artifacts, { recursive: true })

// Extend only the disposable fixture schema, reusing the production debit RPC.
sql(`CREATE TABLE IF NOT EXISTS public.credit_pricing (tool_name text PRIMARY KEY, supplier_cost numeric DEFAULT 0, credits integer, is_free boolean DEFAULT false);
ALTER TABLE public.snapshots ALTER COLUMN id TYPE text USING id::text;
CREATE TABLE IF NOT EXISTS public.usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, api_key_id uuid, tool_name text, model_used text, credits_charged integer, input_tokens integer, output_tokens integer, duration_ms integer, source text, cache_read_tokens integer, cache_write_tokens integer, trial_credits_charged integer DEFAULT 0, refunded_credits integer DEFAULT 0, created_at timestamptz DEFAULT now());
ALTER TABLE public.credit_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.credit_pricing, public.usage_logs TO service_role;
INSERT INTO public.credit_pricing(tool_name, credits) VALUES ('preview', 5), ('edit_image_qwen-spicy', ${live ? 8 : 5}), ('tips', 1) ON CONFLICT (tool_name) DO UPDATE SET credits=EXCLUDED.credits;
`)
sql(await readFile('supabase/migrations/20260919000000_usage_logs_run_attribution.sql', 'utf8'))
sql(await readFile('supabase/migrations/20260605090000_marketing_events.sql', 'utf8'))
checked(await admin.storage.updateBucket('images', { public: true, allowedMimeTypes: null }))

if (live) {
  // This fixture predates durable Agent execution. Preserve accounts and projects.
  sql(`CREATE SCHEMA IF NOT EXISTS local_acceptance;
    CREATE TABLE IF NOT EXISTS local_acceptance.migrations (name text PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS public.agent_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id), status text NOT NULL DEFAULT 'running', prompt text,
      started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, metadata jsonb);
    ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS local_own_runs ON public.agent_runs;
    CREATE POLICY local_own_runs ON public.agent_runs FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE;
    ALTER TABLE public.agent_events ADD COLUMN IF NOT EXISTS seq integer;
    CREATE INDEX IF NOT EXISTS idx_agent_events_run_seq ON public.agent_events(run_id,seq);
    GRANT SELECT, INSERT, UPDATE ON public.agent_runs TO authenticated;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='agent_runs') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='agent_events') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_events;
      END IF;
    END $$;`)
  for (const migration of [
    '20260413000000_billing_token_rates.sql', '20260428000000_token_rates_cache.sql',
    '20260702000000_add_gemini_flash_lite_image_rate.sql', '20260704000000_fix_gemini_flash_lite_image_rate.sql',
    '20260601000000_agent_tool_history.sql', '20260712000000_durable_agent_executions.sql',
    '20260712010000_agent_context_project_scope.sql', '20260722000000_agent_run_inputs.sql',
    '20260905190237_isolate_agent_execution_origins.sql', '20260923012615_gpt6_agent_models.sql',
    '20260903113857_media_pricing_catalog.sql',
    '20260922123000_qwen_spicy_pricing.sql', '20260927075458_qwen_spicy_operation_pricing.sql',
  ]) {
    const applied = execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-Atc',
      `SELECT count(*) FROM local_acceptance.migrations WHERE name='${migration}'`], { encoding: 'utf8' }).trim()
    if (applied === '0') sql(`BEGIN;\n${await readFile(path.join('supabase/migrations', migration), 'utf8')}\nINSERT INTO local_acceptance.migrations VALUES ('${migration}'); COMMIT;`)
  }
  sql(`ALTER TABLE public.token_rates ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.agent_attempts, public.agent_context_snapshots, public.agent_operations, public.agent_tool_history TO authenticated;
    NOTIFY pgrst, 'reload schema';`)
}

// Never copy database, payment, or storage credentials from the main checkout.
const providerEnv: Record<string, string> = {}
if (live) {
  assert.ok(process.env.MAKARON_LIVE_PROVIDER_ENV, 'Set MAKARON_LIVE_PROVIDER_ENV to a provider env file')
  const config = parse(await readFile(process.env.MAKARON_LIVE_PROVIDER_ENV!, 'utf8'))
  for (const key of ['OPENROUTER_API_KEY', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_RESPONSES_URL',
    'AZURE_OPENAI_EDITS_URL', 'AZURE_OPENAI_GENERATIONS_URL', 'FAL_KEY', 'IMAGE_MODEL', 'AGENT_MODEL',
    'XAI_API_KEY', 'XAI_VIDEO_MODEL', 'XAI_REFERENCE_VIDEO_MODEL', 'WAVESPEED_API_KEY',
    'MULEROUTER_API_KEY', 'DASHSCOPE_API_KEY', 'DASHSCOPE_API_HOST']) {
    if (config[key]) providerEnv[key] = config[key]
  }
  assert.ok(providerEnv.OPENROUTER_API_KEY || providerEnv.AZURE_OPENAI_API_KEY, 'No real Agent provider configured')
}

if (reuseServer) {
  const fixture = await fetch(`${base}/api/e2e/skill-fixture`)
  assert.equal(fixture.status, 200, 'Target must be the isolated E2E preview')
  assert.equal(fixture.headers.get('content-type'), 'application/zip')
} else try { await fetch(`${base}/api/e2e/skill-fixture`); throw new Error('Port 3002 is occupied; refusing to reuse an unknown build') }
catch (e) { if (!(e instanceof TypeError)) throw e }
const log = openSync(path.join(artifacts, 'next.log'), 'a')
const server = reuseServer ? undefined : spawn('npm', ['run', 'dev', '--', '-H', '127.0.0.1', '-p', '3002'], {
  cwd: root, detached: true, stdio: ['ignore', log, log], env: {
    NODE_ENV: 'development', PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
    ...providerEnv,
    MAKARON_E2E: '1', MOCK_AI: live ? 'false' : 'true', NEXT_PUBLIC_FREE_MEDIA_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: env.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
  },
})
closeSync(log)
let browser: Browser | undefined
let serving = false
const results: string[] = []
const pass = (name: string) => { results.push(name); console.log(`PASS ${name}`) }

async function otp(email: string) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const res = await fetch('http://127.0.0.1:55324/api/v1/messages')
    const list = await res.json()
    const mail = list.messages?.find((m: { To?: { Address: string }[] }) => m.To?.some(to => to.Address === email))
    if (mail) {
      const message = await (await fetch(`http://127.0.0.1:55324/api/v1/message/${mail.ID}`)).json()
      const code = `${message.Text} ${message.HTML}`.match(/\b\d{8}\b/)?.[0]
      if (code) return code
    }
    await sleep(500)
  }
  throw new Error('Local OTP not delivered')
}

async function register(mobile: boolean) {
  const context = await browser!.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' } : {}) })
  const page = await context.newPage()
  const httpErrors: { path: string; status: number }[] = []
  page.on('response', response => {
    if (response.status() >= 500) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() })
  })
  page.setDefaultTimeout(30_000)
  page.on('requestfailed', request => console.log(`BROWSER request failed: ${new URL(request.url()).pathname} ${request.failure()?.errorText}`))
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.log(`BROWSER ${message.type()}: ${message.text().slice(0, 400)}`) })
  if (!live) await page.route('**/api/agent', async route => {
    const input = route.request().postDataJSON()
    if (!input.analysisOnly && !input.nameProject) return route.continue()
    // Only the optional photo description/name is stubbed; preview billing and media delivery are real.
    await route.fulfill({ contentType: 'text/event-stream', body: [
      { type: 'content', text: input.nameProject ? 'Watermark test' : 'Local photo fixture. Choose an editing preview.' },
      { type: 'done' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') })
  })
  const errors: string[] = []
  page.on('pageerror', e => { errors.push(e.message); console.log(`BROWSER exception: ${e.stack || e.message}`) })
  const email = `free-media-${mobile ? 'h5' : 'web'}-${stamp}@e2e.makaron.test`
  await page.goto(`${base}/login?focus=email`, { timeout: 120_000 })
  await page.waitForLoadState('networkidle')
  await page.getByTestId('auth-email').fill(email)
  await page.getByTestId('auth-password').fill(`Local-test-${randomUUID()}`)
  await page.getByTestId('auth-continue').click()
  await page.getByTestId('auth-otp-0').waitFor({ timeout: 60_000 })
  const code = await otp(email)
  const completed = page.waitForResponse(r => r.url().endsWith('/api/auth/complete') && r.request().method() === 'POST', { timeout: 90_000 })
  for (let i = 0; i < 8; i++) await page.getByTestId(`auth-otp-${i}`).fill(code[i])
  const completionResponse = await completed
  assert.equal(completionResponse.status(), 200)
  await page.waitForURL('**/home**', { timeout: 90_000 })
  const completion = await context.request.post(`${base}/api/auth/complete`)
  assert.equal((await completion.json()).trialRequired, false)
  await page.getByTestId('home-skill-card').first().waitFor({ timeout: 30_000 })
  await page.screenshot({ path: path.join(artifacts, mobile ? 'h5-signup.png' : 'web-signup.png') })
  assert.equal(await page.getByTestId('credit-popup-trial-shell').count(), 0)
  assert.deepEqual(errors, [])
  const users = checked(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users
  const user = users.find(u => u.email === email)!
  assert.ok(user?.email_confirmed_at)
  const balance = checked(await admin.from('credit_balances').select('*').eq('user_id', user.id).single()).data
  assert.equal(balance.balance, 500)
  assert.equal(balance.trial_balance, 0)
  const claims = checked(await admin.from('welcome_credit_claims').select('*').eq('user_id', user.id)).data!
  assert.equal(claims.length, 1)
  assert.equal(claims[0].grant_channel, 'web_signup')
  pass(`${mobile ? 'H5 mobile' : 'desktop'} UI registration + OTP + 500 credits exactly once, no trial gate`)
  return { context, page, userId: user.id, errors, httpErrors }
}

try {
  for (let i = 0; i < 100; i++) {
    if (server) assert.equal(server.exitCode, null, 'Next server exited')
    try { if ((await fetch(base + '/api/e2e/skill-fixture')).ok) break } catch {}
    if (i === 99) throw new Error('Next server did not become ready')
    await sleep(1000)
  }
  for (const route of ['/api/projects/create', '/api/photo-metadata', '/api/agent', '/api/tips']) await fetch(base + route)
  if (process.argv.includes('--serve')) {
    serving = true
    server!.unref()
    console.log('Local H5 fixture ready: ' + base + '/home; process group: ' + server!.pid + '; logs: ' + artifacts + '/next.log')
    return
  }
  browser = await chromium.launch({ headless: true })
  const web = await register(true)
  await register(false)
  let imageProjectId = '', imageUrl = ''
  let liveRunId: string | undefined
  if (live) {
    await web.context.request.get(base + '/projects')
    await web.page.goto(base + '/projects')
    await web.page.locator('input[type="file"][accept*="image"]').first().setInputFiles('public/landing/trial-selfie-poster.jpg')
    await web.page.getByTestId('create-project').click()
    await web.page.waitForURL('**/projects/*', { timeout: 120_000 })
    await web.page.getByTestId('editor').waitFor({ timeout: 120_000 })
    imageProjectId = new URL(web.page.url()).pathname.split('/').pop()!
    if (await web.page.getByTestId('editor').getAttribute('data-view-mode') !== 'cui') {
      await web.page.getByRole('button', { name: 'Chat', exact: true }).click()
    }
    await web.page.getByTestId('chat-input').fill('Generate exactly one edited image from my photo: preserve identity, change the background to a bright turquoise creative studio. Use Gemini. Generate the image now, not just a plan. Do not generate tips or videos.')
    await web.page.getByTestId('chat-send').click()
    let run: { id: string; status: string; total_output_tokens: number } | undefined
    for (let attempt = 0; attempt < 180; attempt++) {
      run = checked(await admin.from('agent_runs').select('id,status,total_output_tokens').eq('project_id', imageProjectId).order('started_at', { ascending: false }).limit(1)).data?.[0]
      if (run && ['failed', 'cancelled', 'blocked'].includes(run.status)) throw new Error('Real Agent failed: ' + run.status)
      const snapshots = checked(await admin.from('snapshots').select('image_url,message_id').eq('project_id', imageProjectId)).data!
      imageUrl = snapshots.find(row => row.message_id && row.image_url)?.image_url || ''
      if (run?.status === 'completed' && imageUrl) break
      await sleep(2000)
    }
    assert.equal(run?.status, 'completed')
    assert.ok(run.total_output_tokens > 0)
    liveRunId = run.id
    assert.ok(imageUrl && !imageUrl.includes('/free-previews/'), 'Agent persists the clean original')
    const charges = checked(await admin.from('usage_logs').select('credits_charged').eq('user_id', web.userId)).data!
    assert.ok(charges.some(row => row.credits_charged > 0))
    pass('fresh H5 signup -> upload -> real first Agent message -> Gemini -> clean persisted image + billed usage')
  } else {
    const source = await readFile('public/landing/trial-selfie-poster.jpg')
    if (!saveOnly) {
      const preview = await web.context.request.post(base + '/api/preview', { data: {
        image: 'data:image/jpeg;base64,' + source.toString('base64'), editPrompt: 'E2E fixture', category: 'creative',
      }, timeout: 120_000 })
      assert.equal(preview.status(), 200, await preview.text())
      assert.equal((await preview.json()).image, 'data:image/jpeg;base64,' + source.toString('base64'))
      assert.equal(checked(await admin.from('credit_balances').select('balance').eq('user_id', web.userId).single()).data!.balance, 495)
      pass('preview API returns clean provider output; existing debit still applies')
    }
    const key = web.userId + '/web-save-image.jpg'
    checked(await admin.storage.from('images').upload(key, source, { contentType: 'image/jpeg' }))
    imageUrl = admin.storage.from('images').getPublicUrl(key).data.publicUrl
    imageProjectId = randomUUID()
    const messageId = randomUUID()
    checked(await admin.from('projects').insert({ id: imageProjectId, user_id: web.userId, title: 'Save image' }))
    checked(await admin.from('messages').insert({ id: messageId, project_id: imageProjectId, role: 'assistant', content: 'Local generated-image fixture', has_image: true }))
    checked(await admin.from('snapshots').insert({ id: randomUUID(), project_id: imageProjectId, image_url: imageUrl, message_id: messageId, type: 'edit', tips: [{ emoji: '+', label: 'Fixture', desc: 'Save acceptance', editPrompt: 'Fixture', category: 'creative', previewStatus: 'done', previewImage: imageUrl }] }))
    pass('clean image fixture persisted for browser save acceptance')
  }
  const imageSource = Buffer.from(await (await fetch(imageUrl)).arrayBuffer())
  await writeFile(path.join(artifacts, 'image-original'), imageSource)
  async function openEditor(id: string) {
    await web.page.goto(base + '/projects/' + id)
    await web.page.getByTestId('editor').waitFor({ timeout: 90_000 })
    if (await web.page.getByTestId('editor').getAttribute('data-view-mode') === 'cui') await web.page.getByTestId('cui-pip').click()
    await web.page.getByRole('button', { name: 'Save', exact: true }).waitFor()
    assert.equal(await web.page.getByTestId('watermark-download-banner').count(), 0)
  }
  async function openSave() {
    await web.page.getByRole('button', { name: 'Save', exact: true }).click()
    await web.page.getByTestId('save-media-dialog').waitFor()
    await web.page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="save-free"], [data-testid="save-clean"]')
      const media = document.querySelector<HTMLImageElement | HTMLVideoElement>('[data-testid="save-media-preview"] img, [data-testid="save-media-preview"] video')
      return button && !button.disabled && media && (media instanceof HTMLVideoElement ? media.readyState >= 2 : media.naturalWidth > 0)
    }, undefined, { timeout: 60_000 })
    assert.ok(!await web.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), 'No horizontal overflow')
  }
  async function checkLayouts(shape: string) {
    const signature = await sharp(Buffer.from((await web.page.getByTestId('save-watermark').getAttribute('src'))!.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let rightmostInk = 0
    for (let y = 0; y < signature.info.height; y++) for (let x = 0; x < signature.info.width; x++) {
      const index = (y * signature.info.width + x) * 4
      if (signature.data[index] > 200 && signature.data[index + 3] > 150) rightmostInk = Math.max(rightmostInk, x)
    }
    assert.ok((signature.info.width - rightmostInk) / signature.info.width < .04, 'Visible white ink has no trailing transparent padding')
    for (const [width, height] of [[320, 568], [390, 844], [1280, 900]]) {
      await web.page.setViewportSize({ width, height })
      await web.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const fits = await web.page.getByTestId('save-media-dialog').evaluate(el => {
        const box = el.getBoundingClientRect()
        const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[data-testid^="save-"]')]
        return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
          && buttons.every(button => button.scrollWidth <= button.clientWidth + 1)
      })
      assert.ok(fits, `${shape} save dialog fits ${width}x${height}`)
      // Measure both boxes in the same rendered frame during responsive resizing.
      const { frame, mark } = await web.page.evaluate(() => ({
        frame: document.querySelector('[data-testid="save-media-preview"]')!.getBoundingClientRect().toJSON(),
        mark: document.querySelector('[data-testid="save-watermark"]')!.getBoundingClientRect().toJSON(),
      }))
      const geometry = JSON.stringify({ shape, width, height, frame, mark })
      assert.ok(mark.x > frame.x + frame.width * .6 && mark.y > frame.y + frame.height * .8, 'Bottom-right position: ' + geometry)
      assert.ok(mark.x + mark.width <= frame.x + frame.width + 1 && mark.y + mark.height <= frame.y + frame.height + 1, 'Watermark stays inside media: ' + geometry)
      if (width === 390) await web.page.screenshot({ path: path.join(artifacts, shape + '-mobile.png') })
    }
    await web.page.setViewportSize({ width: 390, height: 844 })
  }
  async function download(name: string, free: boolean) {
    const pending = web.page.waitForEvent('download', { timeout: 120_000 })
    await web.page.getByTestId(free ? 'save-free' : 'save-clean').click()
    const result = await pending
    const file = path.join(artifacts, name)
    await result.saveAs(file)
    await web.page.getByTestId('save-media-dialog').waitFor({ state: 'hidden' })
    return readFile(file)
  }
  async function downloadPaidDirectly(name: string) {
    const pending = web.page.waitForEvent('download', { timeout: 120_000 })
    await web.page.getByRole('button', { name: 'Save', exact: true }).click()
    const result = await pending
    const file = path.join(artifacts, name)
    await result.saveAs(file)
    assert.equal(await web.page.getByTestId('save-media-dialog').count(), 0)
    return readFile(file)
  }
  await openEditor(imageProjectId)
  await web.page.screenshot({ path: path.join(artifacts, 'h5-clean-preview.png') })
  await openSave()
  await web.page.screenshot({ path: path.join(artifacts, 'h5-image-save-dialog.png') })
  await web.page.getByTestId('save-upgrade').click()
  await web.page.getByTestId('watermark-checkout-description').waitFor()
  assert.deepEqual(await web.page.getByRole('tab').allTextContents(), ['Subscribe', 'Top Up'])
  assert.equal(await web.page.getByRole('tab', { name: 'Subscribe' }).getAttribute('aria-selected'), 'true')
  await web.page.screenshot({ path: path.join(artifacts, 'h5-watermark-checkout.png') })
  await web.page.getByRole('button', { name: '×', exact: true }).click()
  await web.page.getByTestId('save-free').waitFor()
  const savedImage = await download('h5-watermarked-image.png', true)
  const before = await sharp(imageSource).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const after = await sharp(savedImage).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.deepEqual(after.info, before.info)
  const aboveMark = before.info.width * Math.floor(before.info.height * .8) * 4
  const imageError = before.data.subarray(0, aboveMark).reduce((sum, value, i) => sum + Math.abs(value - after.data[i]), 0) / aboveMark
  assert.ok(imageError < 2, 'Image color drift outside watermark')
  assert.notDeepEqual(after.data, before.data)
  pass('H5 clean preview -> Save with white mark -> upgrade/top-up explanation -> free PNG download')

  const images: { projectId: string; original: Buffer; shape: string }[] = [{ projectId: imageProjectId, original: imageSource, shape: 'initial' }]
  for (const [shape, width, height] of paymentsOnly ? [] : [['square', 720, 720], ['portrait', 540, 960], ['landscape', 960, 540], ['ultrawide', 1500, 300], ['tall', 300, 1500], ['large', 2048, 1536], ['transparent', 640, 800]] as const) {
    let pipeline = sharp(imageSource).resize(width, height, { fit: 'fill' }).ensureAlpha()
    if (shape === 'transparent') pipeline = pipeline.removeAlpha().joinChannel(await sharp({ create: { width, height, channels: 3, background: '#808080' } }).extractChannel(0).png().toBuffer())
    const original = await pipeline.png().toBuffer(), key = `${web.userId}/save-image-${shape}.png`
    checked(await admin.storage.from('images').upload(key, original, { contentType: 'image/png' }))
    const url = admin.storage.from('images').getPublicUrl(key).data.publicUrl
    const projectId = randomUUID(), messageId = randomUUID()
    checked(await admin.from('projects').insert({ id: projectId, user_id: web.userId, title: 'Save ' + shape }))
    checked(await admin.from('messages').insert({ id: messageId, project_id: projectId, role: 'assistant', content: 'Image dimensions fixture', has_image: true }))
    checked(await admin.from('snapshots').insert({ id: randomUUID(), project_id: projectId, image_url: url, message_id: messageId, type: 'edit', tips: [{ emoji: '+', label: 'Fixture', desc: 'Save acceptance', editPrompt: 'Fixture', category: 'creative', previewStatus: 'done', previewImage: url }] }))
    images.push({ projectId, original, shape })
    await openEditor(projectId);await openSave();await checkLayouts('image-' + shape)
    const saved = await download('image-' + shape + '-watermarked.png', true)
    const before = await sharp(original).ensureAlpha().raw().toBuffer()
    const after = await sharp(saved).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.deepEqual([after.info.width, after.info.height], [width, height])
    assert.deepEqual(after.data.subarray(0, width * Math.floor(height * .8) * 4), before.subarray(0, width * Math.floor(height * .8) * 4))
    assert.notDeepEqual(after.data, before)
    pass(shape + ' PNG -> three viewport layouts, original dimensions, no color/alpha drift outside bottom-right mark')
  }

  const videos: { projectId: string; original: Buffer; source: string; shape: string }[] = []
  const videoFixtures: [string, number, number, string?][] = paymentsOnly ? [['portrait', 540, 960], ['landscape', 960, 540]] : [['portrait', 540, 960], ['landscape', 960, 540], ['square', 640, 640], ['classic', 800, 600], ['tall', 600, 800], ['ultrawide', 1200, 400]]
  if (process.env.MAKARON_E2E_VIDEO_SOURCE) {
    const file = process.env.MAKARON_E2E_VIDEO_SOURCE
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { encoding: 'utf8' })).streams[0]
    videoFixtures.push(['provider', probe.width, probe.height, file])
  }
  for (const [shape, width, height, providerSource] of videoFixtures) {
    const file = path.join(artifacts, shape + '-original.mp4')
    if (providerSource) await writeFile(file, await readFile(providerSource))
    else execFileSync('ffmpeg', ['-y', '-loop', '1', '-i', 'public/landing/trial-selfie-poster.jpg', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-vf', 'scale=' + width + ':' + height + ':out_range=tv:out_color_matrix=bt709', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', file], { stdio: 'ignore' })
    const original = await readFile(file), key = web.userId + '/web-save-' + shape + '.mp4'
    checked(await admin.storage.from('images').upload(key, original, { contentType: 'video/mp4' }))
    const url = admin.storage.from('images').getPublicUrl(key).data.publicUrl
    const projectId = randomUUID()
    checked(await admin.from('projects').insert({ id: projectId, user_id: web.userId, title: 'Save ' + shape }))
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim())
    const meta: VideoMeta = { status: 'completed', model: 'grok', prompt: 'Local codec acceptance fixture', sourceSnapshotIds: [], sourceUrls: [], duration, aspectRatio: width === height ? '1:1' : height > width ? '9:16' : '16:9', videoUrl: url, taskId: 'fixture-' + stamp + '-' + shape }
    checked(await admin.from('snapshots').insert({ id: randomUUID(), project_id: projectId, type: 'video', video_meta: meta, sort_order: 0 }))
    videos.push({ projectId, original, source: file, shape })
    if (paymentsOnly) continue
    await openEditor(projectId)
    await openSave()
    await checkLayouts('video-' + shape)
    const mark = await web.page.getByTestId('save-watermark').boundingBox()
    const frame = await web.page.getByTestId('save-media-preview').boundingBox()
    assert.ok(mark && frame)
    assert.ok(mark.x > frame.x + frame.width * .6)
    assert.ok(mark.y > frame.y + frame.height * .8)
    assert.ok(mark.x + mark.width <= frame.x + frame.width && mark.y + mark.height <= frame.y + frame.height)
    await web.page.getByRole('button', { name: /Play preview/ }).click()
    await web.page.waitForFunction(() => document.querySelector<HTMLVideoElement>('[data-testid="save-media-preview"] video')!.currentTime > .25)
    await web.page.getByRole('button', { name: /Pause preview/ }).click()
    await web.page.screenshot({ path: path.join(artifacts, 'h5-' + shape + '-save-dialog.png') })
    await download(shape + '-watermarked.mp4', true)
    const saved = path.join(artifacts, shape + '-watermarked.mp4')
    execFileSync('ffmpeg', ['-v', 'error', '-i', saved, '-f', 'null', '-'], { stdio: 'pipe' })
    const audioHash = (p: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' })
    assert.equal(audioHash(saved), audioHash(file), 'Audio packets copied intact')
    const metaSaved = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', saved], { encoding: 'utf8' })).streams.find((s: { codec_type: string }) => s.codec_type === 'video')
    assert.deepEqual([metaSaved.width, metaSaved.height], [width, height])
    const decode = (p: string) => execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', p, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 4 * 1024 * 1024 })
    const sourcePixels = decode(file), markedPixels = decode(saved)
    const upper = width * Math.floor(height * .8) * 3
    const error = sourcePixels.subarray(0, upper).reduce((sum, value, i) => sum + Math.abs(value - markedPixels[i]), 0) / upper
    assert.ok(error < 5, 'Video color drift: ' + error)
    const lower = width * Math.floor(height * .9) * 3
    assert.notDeepEqual(sourcePixels.subarray(lower), markedPixels.subarray(lower), 'Downloaded frames contain the watermark')
    pass(shape + ' video -> bottom-right white preview -> playback -> browser-encoded MP4 -> full decode, dimensions, audio and color')
  }
  for (const width of [320, 390, 1280]) {
    await web.page.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await openEditor(imageProjectId)
    await openSave()
    const fits = await web.page.getByTestId('save-media-dialog').evaluate(el => {
      const box = el.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
    })
    assert.ok(fits, 'Save dialog fits at ' + width)
    await web.page.screenshot({ path: path.join(artifacts, 'save-dialog-' + width + '.png') })
    await web.page.getByTestId('save-media-dialog').getByRole('button', { name: 'Close', exact: true }).click()
  }
  pass('Save dialog fits 320px, 390px and desktop 1280px')

  // Simulate the hosted checkout return, including a delayed local webhook ledger.
  await web.page.setViewportSize({ width: 390, height: 844 })
  let paymentId = ''
  for (const kind of ['topup', 'subscription'] as const) {
    await openEditor(kind === 'topup' ? imageProjectId : videos[0].projectId);await openSave()
    const previewSrc = await web.page.locator('[data-testid="save-media-preview"] > img, [data-testid="save-media-preview"] > video').first().getAttribute('src')
    await web.page.getByTestId('save-upgrade').click()
    await web.page.getByTestId('watermark-checkout-description').waitFor()
    await web.page.getByRole('tab', { name: kind === 'topup' ? 'Top Up' : 'Subscribe' }).click()
    const projectId = kind === 'topup' ? imageProjectId : videos[0].projectId
    if (kind === 'subscription') {
      const originalMeta = checked(await admin.from('snapshots').select('video_meta').eq('project_id', projectId).single()).data!.video_meta
      const newUrl = admin.storage.from('images').getPublicUrl(web.userId + '/web-save-landscape.mp4').data.publicUrl
      checked(await admin.from('snapshots').insert({ id: randomUUID(), project_id: projectId, type: 'video', sort_order: 1,
        video_meta: { ...originalMeta, videoUrl: newUrl, taskId: 'new-while-checking-out-' + stamp } }))
    }
    await web.page.goto(base + '/projects/' + projectId + (kind === 'topup' ? '?topped_up=1' : '?subscription=success'))
    await web.page.getByTestId('save-free').waitFor({ timeout: 90_000 })
    assert.equal(await web.page.getByTestId('save-watermark').getAttribute('data-visible'), 'true')
    assert.equal(await web.page.getByTestId('watermark-checkout-description').count(), 0)
    assert.ok(previewSrc)
    const resumedSrc = await web.page.locator('[data-testid="save-media-preview"] > img, [data-testid="save-media-preview"] > video').first().getAttribute('src')
    await web.page.screenshot({ path: path.join(artifacts, kind + '-fade-00.png') })
    paymentId = randomUUID()
    await sleep(1500)
    checked(await admin.from('credit_purchases').insert({ id: paymentId, user_id: web.userId, stripe_session_id: 'local-return-' + kind + '-' + stamp, credits: 100, amount_usd: 5, status: 'completed', source: kind, provider: 'stripe' }))
    checked(await admin.from('credit_balances').update({ balance: 800 }).eq('user_id', web.userId))
    await web.page.waitForFunction(() => document.querySelector('[data-testid="save-watermark"]')?.getAttribute('data-visible') === 'false')
    await sleep(180)
    const intermediateOpacity = await web.page.getByTestId('save-watermark').evaluate(el => Number(getComputedStyle(el).opacity))
    assert.ok(intermediateOpacity > 0 && intermediateOpacity < 1, 'White mark animates out after verified payment: ' + intermediateOpacity)
    await web.page.screenshot({ path: path.join(artifacts, kind + '-watermark-fading.png') })
    for (let frame = 1; frame <= 10; frame++) {
      await web.page.screenshot({ path: path.join(artifacts, kind + '-fade-' + String(frame).padStart(2, '0') + '.png') })
      await sleep(70)
    }
    await web.page.waitForFunction(() => Number(getComputedStyle(document.querySelector('[data-testid="save-watermark"]')!).opacity) === 0)
    assert.equal(await web.page.locator('[data-testid="save-media-preview"] > img, [data-testid="save-media-preview"] > video').first().getAttribute('src'), resumedSrc, 'The media itself never reloads or fades')
    await web.page.screenshot({ path: path.join(artifacts, kind + '-paid-save.png') })
    const expected = kind === 'topup' ? imageSource : videos[0].original
    assert.deepEqual(await download(kind + '-return-original', false), expected)
    pass(kind + ' checkout return -> restored Save -> delayed verified purchase -> white-only fade -> byte-identical original')
    if (kind === 'topup') checked(await admin.from('credit_purchases').update({ status: 'refunded' }).eq('id', paymentId))
  }
  await openEditor(imageProjectId)
  assert.deepEqual(await downloadPaidDirectly('paid-original-image'), imageSource)
  for (const image of images.slice(1)) {
    await openEditor(image.projectId)
    assert.deepEqual(await downloadPaidDirectly(image.shape + '-paid-original.png'), image.original)
  }
  for (const video of videos.slice(1)) {
    await openEditor(video.projectId)
    assert.deepEqual(await downloadPaidDirectly(video.shape + '-paid-original.mp4'), video.original)
  }
  pass('local completed-purchase fixture -> direct Save without dialog -> byte-identical clean original images and videos')
  checked(await admin.from('credit_purchases').update({ status: 'refunded' }).eq('id', paymentId))
  await openEditor(imageProjectId)
  await openSave()
  assert.ok(await web.page.getByTestId('save-free').isVisible())
  pass('refunded purchase returns to the free-watermarked save choice')
  assert.deepEqual(web.errors, [])
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ passed: results, runId: liveRunId, imageError, httpErrors: web.httpErrors, scope: 'Real browser registration, Auth, welcome credits, Storage, save UI, Canvas/WebCodecs MP4 and downloads. Video sources and payment records are local fixtures; live mode also exercises the real Agent/image provider. No actual checkout or native iOS.', artifacts }, null, 2))
  console.log('WEB SAVE ACCEPTANCE PASS: ' + artifacts)
} catch (error) {
  for (const [i, context] of (browser?.contexts() || []).entries()) {
    const page = context.pages()[0]
    if (page) {
      await page.screenshot({ path: path.join(artifacts, `failure-${i}.png`) }).catch(() => {})
      await writeFile(path.join(artifacts, `failure-${i}.txt`), await page.locator('body').innerText().catch(() => '')).catch(() => {})
    }
  }
  throw error
} finally {
  await browser?.close()
  if (!serving && server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM') } catch {}
    await new Promise<void>(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', () => resolve()) })
  }
}
}

main().catch(error => { console.error(error); process.exitCode = 1 })
