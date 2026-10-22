import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/service';

export const maxDuration = 30;

interface CheckResult {
  name: string;
  url: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

function checkProviderKey(name: string, envVar: 'MULEROUTER_API_KEY' | 'FAL_KEY'): CheckResult {
  const healthy = Boolean(process.env[envVar]?.trim());
  return { name, url: `config:${envVar}`, healthy, latencyMs: 0, error: healthy ? undefined : `${envVar} not set` };
}

export async function GET(req: Request) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Configuration only; real paid output is checked in release acceptance.
  // Do not keep polling the retired Vast host after the production cutover.
  const results = [
    checkProviderKey('mulerouter_image_key', 'MULEROUTER_API_KEY'),
    checkProviderKey('fal_rotation_key', 'FAL_KEY'),
  ];
  const unhealthy = results.filter(r => !r.healthy);

  if (unhealthy.length > 0) {
    // Log to DB for admin visibility
    try {
      const supabase = getSupabaseAdmin();
      for (const r of unhealthy) {
        const { error } = await supabase.from('health_alerts').insert({
          service: r.name,
          error: r.error || 'unreachable',
          latency_ms: r.latencyMs,
        });
        if (error) throw new Error('health_alert_insert_failed');
      }
    } catch {
      // Preserve the health response, but do not silently lose persistence failures.
      console.error('[health-check] Failed to persist health alerts');
    }

    console.error(`[health-check] UNHEALTHY: ${unhealthy.map(r => `${r.name}: ${r.error}`).join(', ')}`);
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    results,
    unhealthy: unhealthy.length,
  });
}
