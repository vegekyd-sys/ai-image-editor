import { createHash, createHmac, randomUUID } from 'node:crypto';
import { isAdmin } from './admin';
import { getDynamicCodexSubscriptionAllowedUserIds } from './codex-subscription-allowlist';
import { getGeminiCloudIdentity } from './google-relay-identity';
import {
  analyzeVideoWithProvider, normalizeVideoUsage, VIDEO_ANALYSIS_MODEL,
  type VideoAnalysisResult,
} from './video-analysis';

// This is deliberately a separate capability. Scene's fps=4 / JSON recipe
// cannot stand in for Makaron's unmodified media + free-text + LOW recipe.
const CAPABILITY = 'makaron_video_analysis';
const JOBS = '/v1/makaron-video-jobs';
const MAX_BYTES = 38_500_000; // keep the current product ceiling
const MODELS = new Set(['gemini-3.8-flash', 'gemini-3.8-flash-n']);
const SAFE_REJECTIONS = new Set([
  'quota_exhausted', 'quota_unavailable', 'relay_busy', 'unauthorized',
  'native_auth_unavailable', 'native_capacity_unavailable',
  'video_source_unsupported', 'video_request_rejected',
]);

export class GeminiVideoRelayError extends Error {
  constructor(readonly reason: string, readonly safeToFallback = false) {
    super(`Gemini video relay: ${reason}`);
  }
}

export interface RelayConfig { url: URL; secret: string; owner: string }
type Json = Record<string, unknown>;

export function geminiRelayConfig(): RelayConfig | undefined {
  const raw = process.env.GEMINI_VIDEO_RELAY_URL?.trim();
  const secret = process.env.GEMINI_VIDEO_RELAY_SECRET?.trim();
  const owner = process.env.GEMINI_VIDEO_RELAY_OWNER_ID?.trim();
  if (!raw || !secret || secret.length < 32 || !owner) return;
  try {
    const url = new URL(raw);
    const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !loopback) || url.username || url.password || url.search || url.hash) return;
    return { url, secret, owner };
  } catch { return; }
}

/** Canonical bytes also bind the durable result to the exact submitted recipe. */
export function canonicalVideoRelayJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalVideoRelayJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Json;
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonicalVideoRelayJson(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function videoRelaySignature(input: {
  method: string; path: string; timestamp: string; requestId: string;
  owner: string; body: string; secret: string;
}): string {
  return createHmac('sha256', input.secret).update([
    input.method, input.path, input.timestamp, input.requestId, input.owner,
    createHash('sha256').update(input.body).digest('hex'),
  ].join('\n')).digest('hex');
}

export async function geminiRelayRequest(cfg: RelayConfig, path: string, signal: AbortSignal, payload?: Json): Promise<Json> {
  const url = new URL(cfg.url);
  url.pathname = url.pathname.replace(/\/$/, '') + path;
  const method = payload ? 'POST' : 'GET';
  const body = payload ? canonicalVideoRelayJson(payload) : '';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = randomUUID();
  // Fetch errors deliberately remain unknown outcomes after admission.
  const response = await fetch(url, {
    method, redirect: 'error', signal,
    headers: {
      'content-type': 'application/json',
      ...(!payload && path.startsWith(`${JOBS}/`) ? { 'x-makaron-wait-ms': '1000' } : {}),
      'x-scene-relay-owner-id': cfg.owner,
      'x-scene-relay-timestamp': timestamp,
      'x-scene-relay-request-id': requestId,
      'x-scene-relay-signature': videoRelaySignature({
        method, path: url.pathname, timestamp, requestId, owner: cfg.owner, body, secret: cfg.secret,
      }),
    },
    ...(payload ? { body } : {}),
  });
  if (!response.body) throw new GeminiVideoRelayError('invalid_relay_response');
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new GeminiVideoRelayError('invalid_relay_response');
    }
    chunks.push(value);
  }
  let value: Json;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  } catch { throw new GeminiVideoRelayError('invalid_relay_response'); }
  if (!response.ok) {
    const reason = typeof value.error === 'string' && SAFE_REJECTIONS.has(value.error)
      ? value.error : 'relay_unknown_outcome';
    // Admission errors and FAILED receipts both need explicit evidence that
    // inference never started. A familiar error code alone is insufficient.
    const safe = SAFE_REJECTIONS.has(reason) && value.generator_submissions === 0;
    throw new GeminiVideoRelayError(reason, safe);
  }
  return value;
}

function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function eligibleSource(videoUrl: string): boolean {
  try {
    const source = new URL(videoUrl);
    if (source.protocol !== 'https:' || source.username || source.password || source.hash) return false;
    const storageHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : undefined;
    if (['www.makaron.app', 'makaron.app'].includes(source.hostname)) {
      return /^\/home-hero\/[a-z0-9-]+\.(mp4|webm)$/.test(source.pathname);
    }
    return (source.hostname === 'cdn.makaron.app' || source.hostname === storageHost)
      && source.pathname.startsWith('/storage/v1/object/');
  } catch { return false; }
}

export async function boundedGeminiMemberCheck(userId: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all([isAdmin(userId), getDynamicCodexSubscriptionAllowedUserIds(undefined, { strict: true })])
        .then(([admin, members]) => admin && members.includes(userId)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Admin check timed out')), 1500);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function geminiRelayPreflight(cfg: RelayConfig, signal: AbortSignal, operation = CAPABILITY): Promise<void> {
  let status: Json;
  try {
    status = await geminiRelayRequest(cfg, '/v1/status', AbortSignal.any([signal, AbortSignal.timeout(2000)]));
  } catch {
    // No inference was submitted by this read-only call.
    throw new GeminiVideoRelayError('relay_preflight_unavailable', true);
  }
  const recipe = object(status.makaron_video_analysis);
  if (!Array.isArray(status.capabilities) || !status.capabilities.includes(operation)
      || recipe.version !== 1 || recipe.model !== VIDEO_ANALYSIS_MODEL
      || recipe.processing !== 'static' || recipe.thinking !== 'low'
      || recipe.output !== 'text' || recipe.input !== 'cloud-source-url'
      || recipe.source_unmodified !== true || Number(recipe.max_source_bytes) < MAX_BYTES) {
    throw new GeminiVideoRelayError('relay_contract_unavailable', true);
  }
  const quota = object(status.quota);
  const age = Date.now() / 1000 - Number(quota.checked_at);
  const buckets = quota.buckets;
  if (status.available !== true || !Number.isFinite(age) || age < -60 || age > 120
      || !Array.isArray(buckets) || buckets.length !== 2
      || new Set(buckets.map(bucket => object(bucket).id)).size !== 2
      || !buckets.every(bucket => {
        const b = object(bucket);
        return ['gemini-weekly', 'gemini-5h'].includes(String(b.id))
          && typeof b.remaining_fraction === 'number' && b.remaining_fraction > 0 && b.remaining_fraction <= 1
          && Date.parse(String(b.reset_time)) > Date.now();
      })) throw new GeminiVideoRelayError('quota_unavailable', true);
  if (status.quota_exhausted === true) throw new GeminiVideoRelayError('quota_exhausted', true);
}

function resultFromReceipt(result: Json, payload: Json, elapsedMs: number): VideoAnalysisResult {
  const source = object(result.source);
  const usage = object(result.usage);
  const digest = createHash('sha256').update(canonicalVideoRelayJson(payload)).digest('hex');
  const needsVideo = Boolean(payload.source_url);
  if (result.request_sha256 !== digest || result.requested_model !== VIDEO_ANALYSIS_MODEL
      || typeof result.model !== 'string' || !MODELS.has(result.model)
      || result.account_model !== 'gemini-3.8-flash-medium'
      || result.transport !== 'antigravity-native-account' || result.billing !== 'subscription-allowance'
      || !validAllowanceReceipt(result) || result.finish_reason !== 'STOP'
      || result.processing !== 'static' || result.thinking !== 'low'
      || result.generator_submissions !== 1 || result.media_on_v !== false
      || typeof result.analysis !== 'string' || !result.analysis.trim()
      || needsVideo && (source.prepared !== false || !Number.isSafeInteger(source.source_bytes)
        || Number(source.source_bytes) <= 0 || Number(source.source_bytes) > MAX_BYTES
        || source.input_bytes !== source.source_bytes || !/^[a-f0-9]{64}$/.test(String(source.source_sha256))
        || source.input_sha256 !== source.source_sha256)
      || !['promptTokenCount', 'candidatesTokenCount'].every(key =>
        typeof usage[key] === 'number' && Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0)
      || Object.values(usage).some(value => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
    throw new GeminiVideoRelayError('unverified_relay_receipt');
  }
  const duration = source.duration_seconds;
  return {
    analysis: result.analysis, usedModel: result.model, reportedModel: result.model,
    requestedModel: VIDEO_ANALYSIS_MODEL, provider: 'gemini-subscription', billing: 'subscription-allowance',
    subscriptionPaidCreditStatus: result.paid_credit_status as 'not_reported' | 'reported_zero',
    subscriptionConsumedCredits: result.consumed_credits as number | null,
    processing: 'static', thinking: 'low', elapsedMs, transport: 'cloud-url', processingCalls: 0,
    usage: normalizeVideoUsage(usage, result.model, 'static'),
    timingsMs: Object.fromEntries(Object.entries(object(result.timings_ms)).filter(([,value]) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0)) as Record<string, number>,
    ...(typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? { sourceDurationSeconds: duration } : {}),
  };
}

async function subscription(cfg: RelayConfig, videoUrl: string | undefined, question: string | undefined,
  userId: string, signal: AbortSignal, started: number, operation = CAPABILITY,
  images?: UnderstandingImage[]): Promise<VideoAnalysisResult> {
  const preflightStart = Date.now();
  await geminiRelayPreflight(cfg, signal, operation);
  const preflightMs = Date.now()-preflightStart;
  let cloudIdentity: string;
  try { cloudIdentity = await getGeminiCloudIdentity(signal); }
  catch { throw new GeminiVideoRelayError('cloud_identity_unavailable', true); }
  const payload: Json = {
    cloud_identity_token: cloudIdentity,
    operation, job_id: randomUUID(), model: VIDEO_ANALYSIS_MODEL,
    user_id: userId, ...(videoUrl ? { source_url: videoUrl } : {}), max_source_bytes: MAX_BYTES,
    ...(images ? { images } : {}),
    question: question || 'Describe this video in detail: scenes, actions, pacing, visual style, audio/dialogue if any.',
    processing: 'static', thinking: 'low', timeout_ms: Math.max(1000, 120_000 - (Date.now() - started) - 1000),
  };
  const identityMs = Date.now()-preflightStart-preflightMs;
  const path = `${JOBS}/${payload.job_id}`;
  const admissionStart = Date.now();
  let admissionMs = 0;
  let polls = 0;
  try {
    const ack = await geminiRelayRequest(cfg, JOBS, AbortSignal.any([signal, AbortSignal.timeout(5000)]), payload);
    if (ack.job_id !== payload.job_id || ack.state !== 'ACCEPTED') {
      throw new GeminiVideoRelayError('invalid_relay_response');
    }
  } catch (error) {
    if (error instanceof GeminiVideoRelayError && error.safeToFallback) throw error;
    // Lost/malformed acknowledgement: poll this exact job, never POST twice.
  }
  admissionMs = Date.now()-admissionStart;
  while (!signal.aborted) {
    try {
      polls++;
      const job = await geminiRelayRequest(cfg, path, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
      if (job.job_id !== payload.job_id) throw new GeminiVideoRelayError('unverified_relay_receipt');
      if (job.state === 'SUCCEEDED') {
        const result = resultFromReceipt(object(job.result), payload, Date.now() - started);
        result.timingsMs = {...result.timingsMs, preflight:preflightMs, identity:identityMs,
          admission:admissionMs, authorization:preflightStart-started, polls};
        return result;
      }
      if (job.state === 'FAILED') {
        const reason = typeof job.error === 'string' && SAFE_REJECTIONS.has(job.error)
          ? job.error : 'relay_terminal_failure';
        throw new GeminiVideoRelayError(reason, job.generator_submissions === 0 && SAFE_REJECTIONS.has(reason));
      }
      if (!['ACCEPTED', 'RUNNING'].includes(String(job.state))) throw new GeminiVideoRelayError('unverified_relay_receipt');
      // New servers wait for a bounded interval and notify on completion.
      // Older servers keep the existing 500ms retry delay.
      if (job.poll_after_ms === 0) continue;
    } catch (error) {
      if (error instanceof GeminiVideoRelayError && error.reason !== 'relay_unknown_outcome') throw error;
      // Transport failure: only recover the known receipt while the budget remains.
    }
    await new Promise<void>(resolve => {
      if (signal.aborted) return resolve();
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 500);
      signal.addEventListener('abort', done, { once: true });
    });
  }
  throw new GeminiVideoRelayError('relay_unknown_outcome');
}

/** Admission requires BOTH the shared roster and a fresh administrator role. */
export async function analyzeVideoWithRouting(videoUrl: string, question?: string, userId?: string): Promise<VideoAnalysisResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(120_000);
  let fallbackReason: string | undefined;
  if (process.env.GEMINI_VIDEO_RELAY_ENABLED === 'true' && userId) {
    const cfg = geminiRelayConfig();
    const model = process.env.VIDEO_ANALYSIS_MODEL?.trim() || VIDEO_ANALYSIS_MODEL;
    const processing = process.env.VIDEO_ANALYSIS_PROCESSING || 'static';
    let admin = false;
    if (cfg) {
      try { admin = await boundedGeminiMemberCheck(userId); }
      catch { fallbackReason = 'admin_check_unavailable'; }
    }
    if (!cfg) fallbackReason = 'relay_not_configured';
    else if (admin) {
      if (model !== VIDEO_ANALYSIS_MODEL || processing !== 'static') fallbackReason = 'relay_recipe_unsupported';
      else if (!eligibleSource(videoUrl)) fallbackReason = 'relay_source_unsupported';
      else try {
        const result = await subscription(cfg, videoUrl, question, userId, signal, started);
        logRoute(result);
        return result;
      } catch (error) {
        if (!(error instanceof GeminiVideoRelayError) || !error.safeToFallback) {
          // Never reveal provider errors, source URLs, tokens or HMAC material.
          throw new GeminiVideoRelayError(error instanceof GeminiVideoRelayError ? error.reason : 'relay_unknown_outcome');
        }
        fallbackReason = error.reason;
      }
    }
  }
  const result = await analyzeVideoWithProvider(videoUrl, question, { signal });
  result.elapsedMs = Date.now() - started;
  if (fallbackReason) result.fallbackReason = fallbackReason;
  logRoute(result);
  return result;
}

function logRoute(result: VideoAnalysisResult): void {
  console.info('[video-analysis-route]', JSON.stringify({
    application: 'makaron', operation: 'analyze_video', modality: 'video',
    provider: result.provider, billing: result.billing, requestedModel: result.requestedModel,
    actualModel: result.reportedModel ?? null, transport: result.transport,
    googlePaidCreditStatus: result.subscriptionPaidCreditStatus ?? null,
    googleConsumedCredits: result.subscriptionConsumedCredits ?? null,
    timingsMs: result.timingsMs,
    elapsedMs: result.elapsedMs, fallbackReason: result.fallbackReason ?? null,
    credential: result.provider === 'google-api'
      ? (process.env.VIDEO_ANALYSIS_GOOGLE_API_KEY?.trim() ? 'video-dedicated' : 'app-google') : 'subscription',
    ...result.usage,
  }));
}

/** Missing paid-credit telemetry stays explicitly unknown. The native transport
 * must verify an allowance-only account and disabled paid-credit settings. */
export function validAllowanceReceipt(result: Json): boolean {
  return result.allowance_only === true
    && (result.paid_credit_status === 'not_reported' && result.consumed_credits === null
      || result.paid_credit_status === 'reported_zero' && result.consumed_credits === 0);
}

export async function readGeminiSubscriptionRelayAllowlist(_owner: string): Promise<string[]> {
  const cfg = geminiRelayConfig();
  if (!cfg) throw new Error('Google relay is not configured');
  const result = await geminiRelayRequest(cfg, '/v1/makaron-allowlist', AbortSignal.timeout(10000));
  if (!Array.isArray(result.userIds) || !result.userIds.every(id => typeof id === 'string')) throw new Error('Invalid Google roster');
  return result.userIds as string[];
}

export async function syncGeminiSubscriptionRelayAllowlist(userIds: string[], _owner: string): Promise<void> {
  const cfg = geminiRelayConfig();
  if (!cfg) throw new Error('Google relay is not configured');
  await geminiRelayRequest(cfg, '/v1/makaron-allowlist', AbortSignal.timeout(10000), { userIds });
}

export interface UnderstandingImage { mimeType: string; data: string }
export type UnderstandingOperation = 'makaron_image_analysis' | 'makaron_frame_verify' | 'makaron_frame_locate';

/** The auxiliary bridge is used only when an explicit helper needs it. Native
 * vision-capable Agents still receive images through their existing transport. */
export async function tryGeminiUnderstandingSubscription(input: {
  operation: UnderstandingOperation; images: UnderstandingImage[]; question: string;
  userId?: string; videoUrl?: string;
}): Promise<VideoAnalysisResult | undefined> {
  if (process.env.GEMINI_VIDEO_RELAY_ENABLED !== 'true' || !input.userId) return;
  const cfg = geminiRelayConfig();
  if (!cfg) return;
  try { if (!await boundedGeminiMemberCheck(input.userId)) return; }
  catch { return; }
  if (input.videoUrl && !eligibleSource(input.videoUrl)) return;
  const started = Date.now();
  try {
    return await subscription(cfg, input.videoUrl, input.question, input.userId,
      AbortSignal.timeout(120000), started, input.operation, input.images);
  } catch (error) {
    if (error instanceof GeminiVideoRelayError && error.safeToFallback) return;
    throw error;
  }
}
