import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

interface CheckResult {
  name: string;
  url: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

async function checkService(name: string, url: string, timeoutMs = 5000): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const res = await Promise.race([
      fetch(url),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { name, url, healthy: false, latencyMs, error: `HTTP ${res.status}` };
    return { name, url, healthy: true, latencyMs };
  } catch (e) {
    return { name, url, healthy: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: Request) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checks: Promise<CheckResult>[] = [];

  if (process.env.COMFYUI_QWEN_URL) {
    checks.push(checkService('comfyui_qwen', `${process.env.COMFYUI_QWEN_URL}/system_stats`));
  }
  if (process.env.COMFYUI_PONY_URL) {
    checks.push(checkService('comfyui_pony', `${process.env.COMFYUI_PONY_URL}/system_stats`));
  }
  if (process.env.COMFYUI_WAI_URL) {
    checks.push(checkService('comfyui_wai', `${process.env.COMFYUI_WAI_URL}/system_stats`));
  }

  const results = await Promise.all(checks);
  const unhealthy = results.filter(r => !r.healthy);

  if (unhealthy.length > 0) {
    // Log to DB for admin visibility
    try {
      const supabase = await createClient();
      for (const r of unhealthy) {
        await supabase.from('health_alerts').insert({
          service: r.name,
          error: r.error || 'unreachable',
          latency_ms: r.latencyMs,
        });
      }
    } catch { /* best effort */ }

    console.error(`[health-check] UNHEALTHY: ${unhealthy.map(r => `${r.name}: ${r.error}`).join(', ')}`);
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    results,
    unhealthy: unhealthy.length,
  });
}
