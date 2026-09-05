import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { isAdmin } from '@/lib/admin';
import { CORE_PROMPT_CACHE_MS, isCorePromptMode, readCorePromptMode, setCorePromptMode } from '@/lib/core-prompt-mode';

export const dynamic = 'force-dynamic';

async function checkAdmin(req: Request) {
  const result = await authenticateRequest(req);
  return !('error' in result) && await isAdmin(result.auth.userId);
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ mode: await readCorePromptMode(), cacheSeconds: CORE_PROMPT_CACHE_MS / 1000 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Configuration unavailable' }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!isCorePromptMode(body?.mode)) return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  try {
    await setCorePromptMode(body.mode);
    return NextResponse.json({ mode: await readCorePromptMode(), cacheSeconds: CORE_PROMPT_CACHE_MS / 1000 });
  } catch {
    return NextResponse.json({ error: 'Configuration could not be saved' }, { status: 503 });
  }
}
