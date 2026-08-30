import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { isDynamicCodexSubscriptionUserAllowed } from '@/lib/codex-subscription-allowlist';
import {
  getCodexSubscriptionUsage,
  type CodexSubscriptionUsage,
} from '@/lib/codex-subscription';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;
let cachedUsage: { expiresAt: number; value: CodexSubscriptionUsage } | undefined;
let usageInFlight: Promise<CodexSubscriptionUsage> | undefined;

async function loadUsage(userId: string): Promise<CodexSubscriptionUsage> {
  if (cachedUsage && cachedUsage.expiresAt > Date.now()) return cachedUsage.value;
  if (!usageInFlight) {
    usageInFlight = getCodexSubscriptionUsage(userId)
      .then((value) => {
        cachedUsage = { expiresAt: Date.now() + CACHE_TTL_MS, value };
        return value;
      })
      .finally(() => {
        usageInFlight = undefined;
      });
  }
  return usageInFlight;
}

export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest(req);
  if ('error' in authResult) return authResult.error;

  if (!(await isDynamicCodexSubscriptionUserAllowed(authResult.auth.userId))) {
    return NextResponse.json(
      { available: false, defaultProvider: 'azure-openai' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    const usage = await loadUsage(authResult.auth.userId);
    return NextResponse.json(
      { available: true, defaultProvider: 'codex-subscription', ...usage },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[codex-subscription] usage unavailable:', error);
    return NextResponse.json(
      { available: true, defaultProvider: 'codex-subscription', error: 'usage_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
