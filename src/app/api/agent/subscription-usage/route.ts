import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { isDynamicCodexSubscriptionUserAllowed } from '@/lib/codex-subscription-allowlist';
import {
  getCodexSubscriptionUsage,
  type CodexSubscriptionUsage,
} from '@/lib/codex-subscription';
import {
  getGrokSubscriptionUsage,
  isGrokSubscriptionAllowedUser,
  type GrokSubscriptionUsage,
} from '@/lib/grok-subscription';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;

interface UsageCache<T> {
  expiresAt: number;
  value: T;
}

let cachedCodexUsage: UsageCache<CodexSubscriptionUsage> | undefined;
let codexUsageInFlight: Promise<CodexSubscriptionUsage> | undefined;
let cachedGrokUsage: UsageCache<GrokSubscriptionUsage> | undefined;
let grokUsageInFlight: Promise<GrokSubscriptionUsage> | undefined;

async function loadCodexUsage(userId: string): Promise<CodexSubscriptionUsage> {
  if (cachedCodexUsage && cachedCodexUsage.expiresAt > Date.now()) return cachedCodexUsage.value;
  if (!codexUsageInFlight) {
    codexUsageInFlight = getCodexSubscriptionUsage(userId)
      .then((value) => {
        cachedCodexUsage = { expiresAt: Date.now() + CACHE_TTL_MS, value };
        return value;
      })
      .finally(() => {
        codexUsageInFlight = undefined;
      });
  }
  return codexUsageInFlight;
}

async function loadGrokUsage(userId: string): Promise<GrokSubscriptionUsage> {
  if (cachedGrokUsage && cachedGrokUsage.expiresAt > Date.now()) return cachedGrokUsage.value;
  if (!grokUsageInFlight) {
    grokUsageInFlight = getGrokSubscriptionUsage(userId)
      .then((value) => {
        cachedGrokUsage = { expiresAt: Date.now() + CACHE_TTL_MS, value };
        return value;
      })
      .finally(() => {
        grokUsageInFlight = undefined;
      });
  }
  return grokUsageInFlight;
}

export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;

  const userId = authResult.auth.userId;
  const [codexAvailable, grokAvailable] = await Promise.all([
    isDynamicCodexSubscriptionUserAllowed(userId),
    Promise.resolve(isGrokSubscriptionAllowedUser(userId)),
  ]);
  if (!codexAvailable && !grokAvailable) {
    return NextResponse.json(
      {
        available: false,
        grokAvailable: false,
        defaultProvider: 'azure-openai',
        codex: { available: false },
        grok: { available: false },
      },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const [codexResult, grokResult] = await Promise.allSettled([
    codexAvailable ? loadCodexUsage(userId) : Promise.resolve(undefined),
    grokAvailable ? loadGrokUsage(userId) : Promise.resolve(undefined),
  ]);
  const codexUsage = codexResult.status === 'fulfilled' ? codexResult.value : undefined;
  const grokUsage = grokResult.status === 'fulfilled' ? grokResult.value : undefined;
  if (codexResult.status === 'rejected') {
    console.error('[codex-subscription] usage unavailable:', codexResult.reason);
  }
  if (grokResult.status === 'rejected') {
    console.error('[grok-subscription] usage unavailable:', grokResult.reason);
  }

  return NextResponse.json(
    {
      // Keep legacy Codex fields for older clients while exposing provider-scoped data.
      available: codexAvailable,
      grokAvailable,
      defaultProvider: codexAvailable ? 'codex-subscription' : 'azure-openai',
      ...(codexUsage ?? {}),
      codex: {
        available: codexAvailable,
        ...(codexUsage ?? {}),
        ...(codexAvailable && !codexUsage ? { error: 'usage_unavailable' } : {}),
      },
      grok: {
        available: grokAvailable,
        ...(grokUsage ?? {}),
        ...(grokAvailable && !grokUsage ? { error: 'usage_unavailable' } : {}),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
