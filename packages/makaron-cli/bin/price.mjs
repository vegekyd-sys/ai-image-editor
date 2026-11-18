import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const quoteKinds = ['image', 'video', 'audio'];
const textFields = {
  resolution: 'resolution', operation: 'operation', aspect: 'aspect_ratio', background: 'background',
  quality: 'image_quality', 'image-reasoning': 'image_reasoning_effort', 'output-format': 'output_format',
};
const numberFields = {
  duration: 'duration_seconds', 'image-count': 'image_count', 'video-reference-count': 'video_reference_count',
  'reference-video-seconds': 'reference_video_seconds', 'reference-image-pixels': 'reference_image_pixels',
  'audio-reference-count': 'audio_reference_count', 'reference-audio-seconds': 'reference_audio_seconds',
  fps: 'output_fps', 'frame-count': 'frame_count',
};
const fields = [...Object.keys(textFields), ...Object.keys(numberFields)];
const options = {
  json: { type: 'boolean' }, input: { type: 'string' }, model: { type: 'string', multiple: true },
  'content-filter': { type: 'string' },
  ...Object.fromEntries(fields.map(name => [name, { type: 'string' }])),
};
const statuses = {
  usage_only: 'Priced after generation', unknown: 'Price unavailable', needs_inputs: 'Missing inputs', unsupported: 'Unsupported request',
};

export function printPriceHelp() {
  console.log(`Makaron price — check media credits on demand

Usage:
  makaron price list [--json]
  makaron price <image|video|audio> --model <id> [--model <id>] [options]
  makaron price --input <file|-> [--json]

  --model <id>                Repeat to compare up to six models with the same parameters
  --duration <seconds>        Requested output duration for video/audio
  --resolution <tier>         Output resolution (for example 720p or 2K)
  --operation <mode>          generate, edit or extend
  --image-count <n>            All input images, including the edit base (default 0)
  --video-reference-count <n> --reference-video-seconds <seconds>
                               Count and total duration of video inputs
  --reference-image-pixels <n> Total input pixels for usage-based video references
  --audio-reference-count <n> --reference-audio-seconds <seconds>
                               Count and total duration of audio inputs
  --fps <n> --content-filter <true|false>
  --aspect <ratio> --background <mode> --quality <tier> --image-reasoning <level>
  --output-format <format> --frame-count <n>
  --input <file|->             JSON {"requests":[...]} for different parameters per quote
  --json                      Machine-readable result with per-quote status

Examples:
  makaron price video --model kling-4-flash --model seedance-2.5-native --duration 5 --resolution 720p
  makaron price image --model seedream-5.5 --resolution 2K --operation edit --image-count 3
  makaron price audio --model evolink-seed-audio --duration 20

Quotes are read-only and cover generation credits. Exit 2 if any requested quote is unavailable,
unsupported or missing inputs. Preflight estimates are labeled. API and usage errors exit 1.
`);
}

function parsePriceRequest(args) {
  const { positionals, values } = parseArgs({ args, options, allowPositionals: true });
  const [kind] = positionals;
  const quoteFlags = [...fields, 'content-filter', 'model'];
  if (values.input != null) {
    if (positionals.length || quoteFlags.some(flag => values[flag] !== undefined)) {
      throw new Error('--input cannot be combined with quote flags or a media kind.');
    }
    let input;
    try {
      input = JSON.parse(readFileSync(values.input === '-' ? 0 : values.input, 'utf8'));
    } catch {
      throw new Error('Could not read pricing JSON. Pass a file path or - for stdin.');
    }
    if (!Array.isArray(input?.requests) || input.requests.length > 6) {
      throw new Error('Pricing JSON must contain a requests array with at most six quotes.');
    }
    return { input, json: values.json };
  }
  if (positionals.length <= 1 && (!kind || kind === 'list') && quoteFlags.every(flag => values[flag] === undefined)) {
    return { input: { requests: [] }, json: values.json };
  }
  if (positionals.length !== 1 || !quoteKinds.includes(kind) || !values.model?.length || values.model.length > 6 || values.model.some(model => !model.trim())) {
    throw new Error('Choose image, video or audio and supply one to six --model IDs. See makaron price --help.');
  }
  const parameters = { kind, image_count: 0 };
  for (const [flag, field] of Object.entries(textFields)) {
    if (values[flag] !== undefined) parameters[field] = values[flag];
  }
  for (const [flag, field] of Object.entries(numberFields)) {
    if (values[flag] === undefined) continue;
    const raw = values[flag];
    const number = Number(raw);
    if (!raw.trim() || !Number.isFinite(number) || number < 0) throw new Error(`--${flag} requires a nonnegative number.`);
    parameters[field] = number;
  }
  if (values['content-filter'] !== undefined) {
    if (!['true', 'false'].includes(values['content-filter'])) throw new Error('--content-filter requires true or false.');
    parameters.content_filter = values['content-filter'] === 'true';
  }
  return { input: { requests: values.model.map(model => ({ ...parameters, model })) }, json: values.json };
}

function printPrices(result) {
  if (result.catalog) {
    for (const [kind, models] of Object.entries(result.catalog)) {
      console.log(`${kind}:`);
      for (const model of models) {
        const resolution = model.resolutions?.length ? ` (${model.resolutions.join(', ')})` : '';
        const duration = model.maxSeconds ? ` · ${model.minSeconds ? `${model.minSeconds}–` : 'up to '}${model.maxSeconds}s` : '';
        console.log(`  ${model.model}${resolution}${duration}`);
      }
    }
    return;
  }
  for (const row of result.estimates) {
    const label = [row.request.model, row.resolution ?? row.request.resolution, row.request.duration_seconds ? `${row.request.duration_seconds}s` : null].filter(Boolean).join(' · ');
    if (row.status === 'estimated' || row.status === 'preflight_only') {
      console.log(`${label}: ${row.credits} credits${row.status === 'preflight_only' ? ' (preflight estimate; final charge may vary)' : ''}`);
      if (row.details?.billableInputImages) console.log(`  Includes ${row.details.billableInputImages} billable input image(s).`);
      for (const item of row.billingBasis ?? []) {
        if (item.billableReferenceVideoSeconds) console.log(`  Includes ${item.billableReferenceVideoSeconds}s of billable reference video.`);
        if (item.billableInputImages) console.log(`  Includes ${item.billableInputImages} billable input image(s).`);
      }
      if (row.details?.settlement && row.status !== 'preflight_only') console.log(`  ${row.details.settlement}`);
    } else {
      console.log(`${label}: ${statuses[row.status] ?? row.status}. ${row.reason ?? ''}${row.missing?.length ? ` (${row.missing.join(', ')})` : ''}`.trim());
    }
  }
  const ranked = result.comparison?.rows ?? [];
  if (ranked.length > 1) {
    console.log(`Lowest known estimate: ${result.comparison.lowestKnownCredits} credits among comparable requests.`);
    if (ranked.length === 2) console.log(`Difference: ${Math.abs(ranked[0].credits - ranked[1].credits)} credits.`);
  }
  console.log(`Observed: ${result.observedAt}`);
}

export async function runPrice(args, getAuth) {
  const { input, json } = parsePriceRequest(args);
  const { headers, baseUrl } = getAuth();
  const response = await fetch(`${baseUrl}/api/billing/model-prices`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Authentication failed. Check your Makaron login or API key.');
  if (response.status === 404) throw new Error('This Makaron server does not support price quotes yet.');
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const fields = Array.isArray(result?.invalidFields) ? ` (${result.invalidFields.join(', ')})` : '';
    throw new Error(response.status === 400 ? `Invalid pricing request${fields}.` : `Pricing request failed (HTTP ${response.status}).`);
  }
  const rows = result?.estimates;
  if (result?.currency !== 'credits' || (input.requests.length ? !Array.isArray(rows) || rows.length !== input.requests.length : !result.catalog)) {
    throw new Error('Invalid Makaron price response.');
  }
  if (json) console.log(JSON.stringify(result));
  else printPrices(result);
  if (rows?.some(row => !['estimated', 'preflight_only'].includes(row.status))) process.exitCode = 2;
}
