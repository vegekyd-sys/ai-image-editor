/** Bounded, operator-only real-project A/B. Does not write projects or publish exports. */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import type {DesignPayload} from '../src/types';
import {mediaDeliveryUrl} from '../src/lib/media-delivery';
import {localizePreviewMedia} from '../src/lib/remotion-preview-media';
import {resolveRemotionMediaDelivery} from '../src/lib/remotion-media-delivery';
import {createDeliveryVerifier} from './remotion-delivery-verifier';

function arg(name: string) {const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1];}

async function main() {
  if (!process.argv.includes('--cloud')) throw new Error('Explicit --cloud required for real Lambda comparisons');
  dotenv.config({path: arg('--env-file'), quiet: true});
  if (arg('--delivery-env-file')) dotenv.config({path: arg('--delivery-env-file'), quiet: true, override: true});
  const input = arg('--design-json'); const userId = arg('--owner-id');
  if (!input || !userId) throw new Error('A design and its authenticated owner are required');
  const output = path.resolve(arg('--output-dir') || '/tmp/makaron-media-delivery-acceptance');
  await mkdir(output, {recursive: true, mode: 0o700});
  const design = JSON.parse(await readFile(input, 'utf8')) as DesignPayload;
  // Load the same compatibility stage as production before changing transport.
  const {prepareRemotionExportMedia} = await import('../src/lib/remotion-export-media');
  const {renderDesignVideoLambdaToUrl} = await import('../src/lib/remotion-lambda-renderer');
  console.log(JSON.stringify({stage: 'prepare', width: design.width, height: design.height, animation: design.animation}));
  const prepared = await prepareRemotionExportMedia(design, {userId});
  console.log(JSON.stringify({stage: 'prepared', summary: prepared.summary}));
  const origin = 'https://media-cache.makaron.app';
  const found = new Set<string>();
  function collect(value: unknown): void {
    if (typeof value === 'string') for (const match of value.matchAll(/https?:\/\/[^\s"'`<>)}\]]+/g)) found.add(match[0]);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  collect(prepared.design.code); collect(prepared.design.props);
  const urls = [...found].filter(url => mediaDeliveryUrl(url, origin) !== url);
  if (!urls.length || urls.length > 12) throw new Error('Acceptance requires 1–12 eligible sources');
  const sources = [];
  let totalBytes = 0;
  const verifier = await createDeliveryVerifier();
  const versionProbes = new Map<string, {status: number; headers: Record<string, string>; elapsedMs: number}>();
  try {
  for (const url of urls) {
    console.log(JSON.stringify({stage: 'verify-original-source', index: sources.length}));
    const baseline = await verifier.verify(url);
    const versionProbe = await verifier.probe(url);
    versionProbes.set(versionProbe.url, versionProbe);
    totalBytes += baseline.bytes;
    if (totalBytes > 512 * 1024 ** 2) throw new Error('Acceptance exceeds 512 MiB source budget');
    let copied;
    for (let attempt = 0; attempt < 5; attempt++) {
      console.log(JSON.stringify({stage: 'verify-delivery-source', index: sources.length, attempt}));
      copied = await verifier.verify(mediaDeliveryUrl(url, origin));
      if (copied.sha256 !== baseline.sha256 || copied.bytes !== baseline.bytes) throw new Error('Delivery source bytes differ');
      if (['R2', 'HIT'].includes(copied.cache || '')) break;
    }
    if (!copied || !['R2', 'HIT'].includes(copied.cache || '')) throw new Error('Delivery replica not ready');
    sources.push({bytes: baseline.bytes, sha256: baseline.sha256, cache: copied.cache});
    console.log(JSON.stringify({stage: 'source-verified', bytes: baseline.bytes, cache: copied.cache}));
  }
  const plan = await resolveRemotionMediaDelivery(prepared.design, {userId, origin, budgetMs: 5000,
    fetch: (async input => {
      const probe = versionProbes.get(String(input));
      if (!probe) throw new Error('Only regionally verified versions are allowed');
      return new Response(new Uint8Array([0]), {status: probe.status, headers: probe.headers});
    }) as typeof fetch});
  if (!plan.summary.enabled || plan.summary.versioned < 1) throw new Error('Versioned render gateway is not configured/ready');
  const mediaSources = plan.sources(prepared.design);
  await writeFile(path.join(output, 'sources.json'), JSON.stringify({preparation: prepared.summary, sources}, null, 2));
  if (process.env.MAKARON_ACCEPTANCE_PREPARE_ONLY === 'true') {
    await writeFile(path.join(output, 'prepared.private.json'), JSON.stringify(prepared.design), {mode: 0o600});
    await writeFile(path.join(output, 'sources.json'), JSON.stringify({preparation: prepared.summary, sources}, null, 2));
    console.log(JSON.stringify({stage: 'preflight-complete'})); return;
  }
  const results = [];
  const priming = [];
  const coldDesign = localizePreviewMedia(prepared.design, urls.map(url => {
    const variant = new URL(url); variant.searchParams.set('download', `acceptance-${Date.now()}`);
    return {url, path: variant.href};
  }));
  for (const mode of ['baseline', 'cloudflare']) {
    const r = await renderDesignVideoLambdaToUrl(coldDesign, mode === 'cloudflare' ? {mediaSources: plan.sources(coldDesign)} : {});
    const decoded = await verifier.verify(r.url, true);
    priming.push({rendererMs: r.renderSeconds * 1000, cost: r.progress.costs, videoHash: decoded.videoHash, audioHash: decoded.audioHash});
    console.log(JSON.stringify({stage: 'prime', round: priming.length, rendererMs: r.renderSeconds * 1000}));
  }
  if (priming[0].videoHash !== priming[1].videoHash || priming[0].audioHash !== priming[1].audioHash) throw new Error('Cold-path decoded output differs');
  const order = ['baseline', 'cloudflare', 'cloudflare', 'baseline', 'baseline', 'cloudflare', 'cloudflare', 'baseline'];
  const rounds = process.argv.includes('--extended') ? [...order, ...order] : order;
  for (const [index, mode] of rounds.entries()) {
    const start = Date.now();
    const rendered = await renderDesignVideoLambdaToUrl(prepared.design, mode === 'cloudflare' ? {mediaSources} : {});
    const wallMs = Date.now() - start;
    console.log(JSON.stringify({stage: 'render-completed', round: index + 1, mode, wallMs}));
    const file = path.join(output, `${index + 1}-${mode}.mp4`);
    const verified = await verifier.verify(rendered.url, true, index < 2);
    results.push({mode, wallMs, rendererMs: rendered.renderSeconds * 1000, bytes: rendered.outputSizeInBytes,
      videoHash: verified.videoHash, audioHash: verified.audioHash, sampleIndex: index < 2 ? verified.index : null,
      timings: rendered.timings,
      file: path.basename(file), cost: rendered.progress.costs});
    const qualityEqual = new Set(results.map(r => r.videoHash)).size === 1 && new Set(results.map(r => r.audioHash)).size === 1;
    await writeFile(path.join(output, 'results.json'), JSON.stringify({preparation: prepared.summary, sources,
      sourceVersionProbes: [...versionProbes.values()].map(p => ({status: p.status, elapsedMs: p.elapsedMs})),
      delivery: plan.summary, priming, qualityEqual, results}, null, 2));
    console.log(JSON.stringify({round: index + 1, mode, wallMs, rendererMs: rendered.renderSeconds * 1000, qualityEqual}));
    if (!qualityEqual) throw new Error('Decoded output differs; stop before promotion');
  }
  for (const result of process.argv.includes('--skip-samples') ? [] : results.slice(0, 2)) {
    const bytes = await verifier.readSample(result.sampleIndex!);
    if (!bytes) throw new Error('Missing playable sample');
    await writeFile(path.join(output, result.file), bytes, {mode: 0o600});
  }
  } finally {await verifier.stop();}
}
main().catch(error => {console.error(String(error.message).replace(/https?:\/\/[^\s"'<>]+/g, '[URL]').slice(0, 1000)); process.exitCode = 1;});
