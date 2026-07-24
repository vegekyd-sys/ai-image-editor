#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const MODEL = 'gemini-3.1-flash-lite-image';
const OPENROUTER_MODEL = `google/${MODEL}`;
const DEFAULT_PROMPT = 'Create a clean 1:1 photorealistic studio image of a tiny banana-shaped desk lamp on a white table. No text.';

function parseArgs(argv) {
  const args = {
    provider: 'both',
    generate: false,
    prompt: DEFAULT_PROMPT,
    outDir: '/tmp',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--provider') args.provider = argv[++i] || args.provider;
    else if (arg === '--generate') args.generate = true;
    else if (arg === '--prompt') args.prompt = argv[++i] || args.prompt;
    else if (arg === '--out-dir') args.outDir = argv[++i] || args.outDir;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Nano Banana 2 Lite smoke test

Usage:
  node scripts/test-nano-banana-lite.mjs [--provider google|openrouter|both] [--generate]

Options:
  --provider   Which provider to test. Default: both.
  --generate   Run a real image generation. Without this, only metadata/model listing is checked.
  --prompt     Prompt for generation.
  --out-dir    Directory for generated images. Default: /tmp.
`);
}

function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    '/Users/tianyicai/ai-image-editor/.env.local',
  ];
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ||= value;
  }
  console.log(`Loaded env from ${envPath}`);
}

async function checkGoogleModel() {
  if (!process.env.GOOGLE_API_KEY) {
    console.log('Google: GOOGLE_API_KEY missing');
    return false;
  }
  const started = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}?key=${encodeURIComponent(process.env.GOOGLE_API_KEY)}`,
  );
  const text = await res.text();
  console.log(`Google metadata: ${res.status} ${res.statusText} ${Date.now() - started}ms`);
  if (!res.ok) {
    console.log(text.slice(0, 500));
    return false;
  }
  const data = JSON.parse(text);
  console.log(`Google model: ${data.name} (${data.displayName})`);
  console.log(`Google methods: ${(data.supportedGenerationMethods || []).join(',')}`);
  return true;
}

async function generateGoogle(prompt, outDir) {
  const body = {
    model: MODEL,
    input: prompt,
    store: false,
    generation_config: { thinking_level: 'low' },
    response_format: {
      type: 'image',
      mime_type: 'image/jpeg',
      aspect_ratio: '1:1',
      image_size: '1K',
    },
  };
  const started = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(process.env.GOOGLE_API_KEY)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Revision': '2026-05-20',
      },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  console.log(`Google generate: ${res.status} ${res.statusText} ${Date.now() - started}ms`);
  if (!res.ok) {
    console.log(text.slice(0, 800));
    return;
  }
  const data = JSON.parse(text);
  const image = extractInteractionImage(data);
  console.log(`Google usage: ${JSON.stringify(data.usage || data.usage_metadata || {})}`);
  if (!image) {
    console.log(text.slice(0, 800));
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'nano-banana-lite-google-rest.jpg');
  fs.writeFileSync(out, Buffer.from(image, 'base64'));
  console.log(`Google saved: ${out}`);
}

function extractInteractionImage(data) {
  for (const step of data.steps || []) {
    if (step.type !== 'model_output') continue;
    for (const part of step.content || []) {
      if (part.type === 'image' && part.data) return part.data;
    }
  }
  return null;
}

async function checkOpenRouterModel() {
  const started = Date.now();
  const headers = process.env.OPENROUTER_API_KEY
    ? { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }
    : undefined;
  const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
  const text = await res.text();
  console.log(`OpenRouter models: ${res.status} ${res.statusText} ${Date.now() - started}ms`);
  if (!res.ok) {
    console.log(text.slice(0, 500));
    return false;
  }
  const data = JSON.parse(text);
  const found = data.data?.find((model) => model.id === OPENROUTER_MODEL);
  console.log(`OpenRouter listed: ${Boolean(found)}`);
  if (found) {
    console.log(`OpenRouter context: ${found.context_length}`);
    console.log(`OpenRouter pricing: ${JSON.stringify(found.pricing || {})}`);
  }
  return Boolean(found);
}

async function generateOpenRouter(prompt, outDir) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('OpenRouter: OPENROUTER_API_KEY missing');
    return;
  }
  const body = {
    model: OPENROUTER_MODEL,
    stream: false,
    modalities: ['image', 'text'],
    reasoning: { effort: 'low' },
    image_config: { aspect_ratio: '1:1' },
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ],
  };
  const started = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://www.makaron.app',
      'X-Title': 'Makaron Nano Banana Lite Spike',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`OpenRouter generate: ${res.status} ${res.statusText} ${Date.now() - started}ms`);
  if (!res.ok) {
    console.log(text.slice(0, 800));
    return;
  }
  const data = JSON.parse(text);
  const message = data.choices?.[0]?.message;
  const imageUrl = message?.images?.[0]?.image_url?.url || message?.images?.[0]?.url;
  console.log(`OpenRouter model: ${data.model || OPENROUTER_MODEL}`);
  console.log(`OpenRouter usage: ${JSON.stringify(data.usage || {})}`);
  if (!imageUrl?.startsWith('data:')) {
    console.log(`No data URL image returned: ${String(imageUrl).slice(0, 120)}`);
    return;
  }
  const match = imageUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) return;
  fs.mkdirSync(outDir, { recursive: true });
  const ext = match[1].includes('jpeg') || match[1].includes('jpg') ? 'jpg' : 'png';
  const out = path.join(outDir, `nano-banana-lite-openrouter.${ext}`);
  fs.writeFileSync(out, Buffer.from(match[2], 'base64'));
  console.log(`OpenRouter saved: ${out}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const providers = args.provider === 'both' ? ['google', 'openrouter'] : [args.provider];
  if (providers.includes('google')) {
    const ok = await checkGoogleModel();
    if (ok && args.generate) await generateGoogle(args.prompt, args.outDir);
  }
  if (providers.includes('openrouter')) {
    const ok = await checkOpenRouterModel();
    if (ok && args.generate) await generateOpenRouter(args.prompt, args.outDir);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
