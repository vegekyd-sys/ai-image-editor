import { createHmac, timingSafeEqual } from 'node:crypto';
import { isAdmin } from '@/lib/admin';
import { getDynamicCodexSubscriptionAllowedUserIds } from '@/lib/codex-subscription-allowlist';
import { canonicalVideoRelayJson, geminiRelayConfig } from '@/lib/gemini-video-subscription';

export const dynamic = 'force-dynamic';

/** Read-only, short-lived job-bound authorization; never returns roster or PII. */
export async function POST(request: Request): Promise<Response> {
  const cfg = geminiRelayConfig();
  if (!cfg || process.env.GEMINI_VIDEO_RELAY_ENABLED !== 'true') return Response.json({ allowed: false }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 4096) return Response.json({ allowed: false }, { status: 413 });
  const timestamp = request.headers.get('x-makaron-authorization-timestamp') || '';
  const signature = request.headers.get('x-makaron-authorization-signature') || '';
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp)) > 30 || !/^[a-f0-9]{64}$/.test(signature)) {
    return Response.json({ allowed: false }, { status: 403 });
  }
  const expected = createHmac('sha256', cfg.secret).update(`makaron-job-authorization\n${timestamp}\n${raw}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return Response.json({ allowed: false }, { status: 403 });
  try {
    const body = JSON.parse(raw);
    if (canonicalVideoRelayJson(body) !== raw || Object.keys(body).sort().join(',') !== 'job_id,request_sha256,user_id'
        || typeof body.user_id !== 'string' || !/^[\w-]{1,100}$/.test(body.user_id)
        || !/^[a-f0-9-]{36}$/.test(body.job_id) || !/^[a-f0-9]{64}$/.test(body.request_sha256)) {
      return Response.json({ allowed: false }, { status: 400 });
    }
    const [admin, members] = await Promise.all([
      isAdmin(body.user_id), getDynamicCodexSubscriptionAllowedUserIds(undefined, { strict: true }),
    ]);
    return Response.json({ allowed: admin && members.includes(body.user_id), job_id: body.job_id, request_sha256: body.request_sha256 },
      { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ allowed: false }, { status: 503 });
  }
}
