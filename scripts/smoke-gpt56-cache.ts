import { createHash, randomUUID } from 'node:crypto';

interface UsageSnapshot {
  logicalSample: number;
  status: number;
  inputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  cacheHitRatio: number | null;
  detailKeys: string[];
  servedModel: string | null;
}

interface HttpAttempt {
  logicalSample: number;
  attempt: number;
  status: number | null;
  elapsedMs: number;
  requestId: string | null;
  parsedJson: boolean;
  errorCode: string | null;
}

interface SampleError {
  logicalSample: number;
  error: string;
}

interface SurfaceResult {
  samples: UsageSnapshot[];
  errors: SampleError[];
  attempts: HttpAttempt[];
}

const MODEL_ID = process.env.GPT56_CACHE_SMOKE_MODEL?.trim() || 'gpt-5.6-terra';
const API_KEY = process.env.AZURE_OPENAI_API_KEY?.trim();
const RESPONSES_ENDPOINT = process.env.AZURE_OPENAI_RESPONSES_URL?.trim()
  || 'https://meo-ultron.openai.azure.com/openai/responses?api-version=2025-04-01-preview';
const rawRunId = process.env.GPT56_CACHE_SMOKE_RUN_ID?.trim() || randomUUID();
const CACHE_RUN_ID = createHash('sha256').update(rawRunId).digest('hex').slice(0, 16);
const MODEL_TIER = MODEL_ID.replace(/^gpt-5\.6-/, '').replace(/[^a-z0-9-]/gi, '-');

if (!API_KEY) throw new Error('AZURE_OPENAI_API_KEY is required');

// A unique prefix gives each invocation a genuine cold-cache candidate. The
// logical samples vary only in their trailing user message, matching production.
const stablePrefix = [
  `cache-run-${CACHE_RUN_ID}`,
  ...Array.from({ length: 1_800 }, (_, index) =>
    `cache-proof-${String(index).padStart(4, '0')}`,
  ),
].join(' ');

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function readErrorCode(payload: Record<string, any>): string | null {
  const candidate = payload?.error?.code || payload?.response?.error?.code;
  return typeof candidate === 'string' ? candidate.slice(0, 80) : null;
}

function cacheHitRatio(inputTokens: number | null, cachedTokens: number | null): number | null {
  if (!inputTokens || cachedTokens == null) return null;
  return Number((cachedTokens / inputTokens).toFixed(4));
}

function usageFromResponses(
  logicalSample: number,
  status: number,
  body: Record<string, any>,
  headers: Headers,
): UsageSnapshot {
  const usage = body.usage || {};
  const details = usage.input_tokens_details || {};
  const inputTokens = readNumber(usage, 'input_tokens');
  const cachedTokens = readNumber(details, 'cached_tokens');
  return {
    logicalSample,
    status,
    inputTokens,
    cachedTokens,
    cacheWriteTokens: readNumber(details, 'cache_write_tokens', 'cache_written_tokens'),
    cacheHitRatio: cacheHitRatio(inputTokens, cachedTokens),
    detailKeys: Object.keys(details).sort(),
    servedModel: headers.get('x-ms-served-model'),
  };
}

function usageFromChat(
  logicalSample: number,
  status: number,
  body: Record<string, any>,
  headers: Headers,
): UsageSnapshot {
  const usage = body.usage || {};
  const details = usage.prompt_tokens_details || {};
  const inputTokens = readNumber(usage, 'prompt_tokens');
  const cachedTokens = readNumber(details, 'cached_tokens');
  return {
    logicalSample,
    status,
    inputTokens,
    cachedTokens,
    cacheWriteTokens: readNumber(details, 'cache_write_tokens', 'cache_written_tokens'),
    cacheHitRatio: cacheHitRatio(inputTokens, cachedTokens),
    detailKeys: Object.keys(details).sort(),
    servedModel: headers.get('x-ms-served-model'),
  };
}

function retryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get('retry-after');
  const retryAfterSeconds = retryAfter == null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.min(30_000, Math.max(0, retryAfterSeconds * 1_000));
  }
  return Math.min(16_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  logicalSample: number,
  attempts: HttpAttempt[],
) {
  const pathname = new URL(url).pathname;
  for (let attempt = 0; attempt < 5; attempt++) {
    const startedAt = Date.now();
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'api-key': API_KEY!,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      const errorCode = error instanceof Error ? error.name.slice(0, 80) : 'NetworkError';
      attempts.push({
        logicalSample,
        attempt: attempt + 1,
        status: null,
        elapsedMs: Date.now() - startedAt,
        requestId: null,
        parsedJson: false,
        errorCode,
      });
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(undefined, attempt)));
        continue;
      }
      throw new Error(`${pathname}: network error (${errorCode})`);
    }

    const text = await response.text();
    let payload: Record<string, any> = {};
    let parsedJson = true;
    try {
      payload = JSON.parse(text);
    } catch {
      parsedJson = false;
    }
    const errorCode = parsedJson ? readErrorCode(payload) : 'non_json_response';
    attempts.push({
      logicalSample,
      attempt: attempt + 1,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      requestId: response.headers.get('x-request-id') || response.headers.get('apim-request-id'),
      parsedJson,
      errorCode,
    });

    if (response.ok && parsedJson) return { response, payload };

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
      continue;
    }
    throw new Error(`${pathname}: HTTP ${response.status} (${errorCode || 'unknown_error'})`);
  }
  throw new Error(`${pathname}: retry budget exhausted`);
}

async function sampleResponses(
  logicalSample: number,
  attempts: HttpAttempt[],
): Promise<UsageSnapshot> {
  const { response, payload } = await postJson(RESPONSES_ENDPOINT, {
    model: MODEL_ID,
    input: [
      {
        role: 'system',
        content: stablePrefix,
      },
      { role: 'user', content: `Reply with exactly CACHE_OK_${logicalSample}.` },
    ],
    max_output_tokens: 64,
    reasoning: { effort: 'none' },
    prompt_cache_key: `mk-r-${MODEL_TIER}-${CACHE_RUN_ID}`,
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    store: false,
  }, logicalSample, attempts);
  return usageFromResponses(logicalSample, response.status, payload, response.headers);
}

async function sampleChat(
  chatEndpoint: string,
  logicalSample: number,
  attempts: HttpAttempt[],
): Promise<UsageSnapshot> {
  const { response, payload } = await postJson(chatEndpoint, {
    model: MODEL_ID,
    messages: [
      { role: 'system', content: stablePrefix },
      { role: 'user', content: `Reply with exactly CACHE_OK_${logicalSample}.` },
    ],
    max_completion_tokens: 64,
    reasoning_effort: 'none',
    prompt_cache_key: `mk-c-${MODEL_TIER}-${CACHE_RUN_ID}`,
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
  }, logicalSample, attempts);
  return usageFromChat(logicalSample, response.status, payload, response.headers);
}

async function collectSurface(
  sampler: (logicalSample: number, attempts: HttpAttempt[]) => Promise<UsageSnapshot>,
): Promise<SurfaceResult> {
  const result: SurfaceResult = { samples: [], errors: [], attempts: [] };
  for (let logicalSample = 1; logicalSample <= 3; logicalSample++) {
    try {
      result.samples.push(await sampler(logicalSample, result.attempts));
    } catch (error) {
      result.errors.push({
        logicalSample,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
  return result;
}

function coldState(result: SurfaceResult): string {
  const firstSample = result.samples.find((sample) => sample.logicalSample === 1);
  const firstAttempts = result.attempts.filter((attempt) => attempt.logicalSample === 1);
  if (!firstSample) return 'unavailable';
  if (firstAttempts.length !== 1 || firstAttempts[0]?.status !== 200) {
    return 'indeterminate_after_retry';
  }
  return firstSample.cachedTokens === 0 ? 'observed_cold' : 'unexpectedly_warm';
}

async function main() {
  const origin = new URL(RESPONSES_ENDPOINT).origin;
  const chatEndpoint = `${origin}/openai/v1/chat/completions`;
  const responses = await collectSurface(sampleResponses);
  const chat = await collectSurface((sample, attempts) =>
    sampleChat(chatEndpoint, sample, attempts));

  const responsesCacheHit = responses.samples
    .filter((sample) => sample.logicalSample > 1)
    .some((sample) => (sample.cachedTokens ?? 0) >= 1_024);
  const chatCacheHit = chat.samples
    .filter((sample) => sample.logicalSample > 1)
    .some((sample) => (sample.cachedTokens ?? 0) >= 1_024);
  const responsesLargeEnough = responses.samples
    .every((sample) => (sample.inputTokens ?? 0) >= 1_024);
  const primaryPassed = responses.samples.length >= 2
    && responsesLargeEnough
    && responsesCacheHit;

  const report = {
    model: MODEL_ID,
    cacheRunIdHash: CACHE_RUN_ID,
    stablePrefixWords: 1_801,
    cacheKeyLength: `mk-r-${MODEL_TIER}-${CACHE_RUN_ID}`.length,
    responses,
    chat,
    acceptance: {
      primaryStatus: primaryPassed ? 'passed' : 'failed',
      responsesColdState: coldState(responses),
      responsesCacheHit,
      responsesSuccessfulSamples: responses.samples.length,
      responsesReportsCacheWrite: responses.samples
        .some((sample) => sample.cacheWriteTokens !== null),
      responsesCacheWriteTelemetry: responses.samples
        .some((sample) => sample.cacheWriteTokens !== null) ? 'reported' : 'unreported',
      chatDiagnosticStatus: chat.samples.length >= 2 && chatCacheHit ? 'passed' : 'degraded',
      chatColdState: coldState(chat),
      chatCacheHit,
      chatReportsCacheWrite: chat.samples
        .some((sample) => sample.cacheWriteTokens !== null),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (!primaryPassed) {
    console.error('GPT-5.6 Responses cache acceptance failed; see JSON report above.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
