// @vitest-environment node
/** Opt-in paid acceptance. Only supplier APIs are real; the app ledger is in memory. */
import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const ledger = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/lib/supabase/service', () => ({ getSupabaseAdmin: () => ({
  rpc: async () => ({ data: { spent_usd: 0, exhausted: false, calls: 0 }, error: null }),
  from: () => ({ insert: async (row: unknown) => { ledger.rows.push(row); return { error: null }; } }),
}) }));
import { generateImage } from '@/lib/model-router';

it.skipIf(process.env.COPYRIGHT_RECOVERY_LIVE !== '1')('real Flare → Nano recovery preserves the input NSFW assessment', async () => {
  const dir = path.resolve('test-output/image-copyright-candidate-20261112');
  const file = path.join(dir, 'receipt.json');
  fs.mkdirSync(dir, { recursive: true });
  // A rerun cannot resubmit an operation with a prior receipt, including an unknown one.
  if (fs.existsSync(file)) throw new Error('Acceptance receipt already exists; inspect it before any further paid submission.');
  const benchmark = JSON.parse(fs.readFileSync('test-output/image-copyright-20261112/report.json', 'utf8'));
  const request = Object.freeze({ prompt: benchmark.cases.find((c: any) => c.id === 'pikachu').prompt as string, aspectRatio: '1:1', benignCharacterContent: true, isNsfw: false });
  const receipt: any = { startedAt: new Date().toISOString(), stage: 'starting', calls: [], ledger: [], isNsfwBefore: request.isNsfw };
  const save = () => fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
  const fetcher = globalThis.fetch;
  const started = Date.now();
  vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit) => {
    const parsed = new URL(String(url));
    if (!['api.openai.com', 'openrouter.ai'].includes(parsed.hostname)) throw new Error('App/database network access is forbidden in acceptance');
    if (receipt.calls.length >= 2) throw new Error('More than two submissions forbidden');
    const body = JSON.parse(String(init.body));
    const call: any = { model: body.model, provider: parsed.hostname, startedMs: Date.now() - started, stage: 'submitting' };
    receipt.calls.push(call); save();
    const response = await fetcher(url, init);
    const data = await response.clone().json();
    Object.assign(call, { stage: 'responded', status: response.status, durationMs: Date.now() - started - call.startedMs,
      usage: data.usage ?? null, errorCode: data.error?.code ?? null });
    save(); return response;
  });
  save();
  try {
    const result = await generateImage(request);
    expect(result.image).toBeTruthy();
    const bytes = Buffer.from(result.image!.split(',')[1], 'base64');
    await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
    fs.writeFileSync(path.join(dir, 'output.png'), await sharp(bytes).png().toBuffer());
    expect(request.isNsfw).toBe(false);
    expect(result.contentBlocked).toBeUndefined();
    // This frozen scenario produced the actual provider refusal in the benchmark.
    expect(result.fallbackUsed).toBe(true);
    expect(result.model).toBe('gemini-2.1');
    expect(receipt.calls.map((c: any) => c.model)).toEqual(['gpt-image-2.6-flare', 'google/gemini-nano-banana-2.1']);
    Object.assign(receipt, { stage: 'complete', elapsedMs: Date.now() - started, isNsfwAfter: request.isNsfw,
      usedModel: result.model, fallbackUsed: result.fallbackUsed, usage: result.usage, ledger: ledger.rows });
  } finally { save(); vi.unstubAllGlobals(); }
}, 300_000);
