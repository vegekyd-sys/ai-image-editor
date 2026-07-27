import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASES = new Set(['font-load', 'image-fetch', 'player-init', 'player-runtime']);
const KINDS = new Set(['network', 'decode', 'font', 'runtime']);

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function cleanUuid(value: unknown): string | undefined {
  const text = cleanString(value, 64);
  return text && UUID_PATTERN.test(text) ? text : undefined;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const phase = cleanString(body.phase, 32);
  const kind = cleanString(body.kind, 32);
  const message = cleanString(body.message, 1000);
  if (!phase || !PHASES.has(phase) || !kind || !KINDS.has(kind) || !message) {
    return NextResponse.json({ error: 'Invalid preview error payload' }, { status: 400 });
  }

  let userId: string | undefined;
  try {
    const supabase = await createClient();
    userId = (await supabase.auth.getUser()).data.user?.id;
  } catch {
    userId = undefined;
  }

  const diagnostic = {
    projectId: cleanUuid(body.projectId),
    snapshotId: cleanUuid(body.snapshotId),
    userId,
    phase,
    kind,
    message,
    recovered: body.recovered === true,
    resourceUrl: cleanString(body.resourceUrl, 1000),
    path: cleanString(body.path, 500),
    userAgent: cleanString(request.headers.get('user-agent'), 500),
    recordedAt: new Date().toISOString(),
  };
  console.error('[remotion-client-error]', JSON.stringify(diagnostic));

  return NextResponse.json({ ok: true });
}
