import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rotateCamera } from '@/lib/skills/rotate-camera';
import { deductCredits, requireCredits } from '@/lib/billing/credits';
import { FAL_ROTATE_CAMERA_TOOL, getToolPrice } from '@/lib/billing/pricing';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.image !== 'string' || typeof body.azimuth !== 'number'
    || typeof body.elevation !== 'number' || typeof body.distance !== 'number') {
    return Response.json({ error: 'image, azimuth, elevation and distance are required' }, { status: 400 });
  }
  const price = await getToolPrice(FAL_ROTATE_CAMERA_TOOL);
  if (!price) return Response.json({ error: 'Camera rotation pricing is unavailable' }, { status: 503 });
  const check = await requireCredits(user.id, price.credits);
  if (!check.ok) return check.response;

  const started = Date.now();
  const result = await rotateCamera(
    { azimuth: body.azimuth, elevation: body.elevation, distance: body.distance },
    { currentImage: body.image },
  );
  if (!result.success || !result.image) return Response.json({ error: result.message }, { status: 502 });
  try {
    await deductCredits(user.id, null, FAL_ROTATE_CAMERA_TOOL, undefined, Date.now() - started);
  } catch (error) {
    console.error('[rotate] Billing failed after completed generation:', error);
    return Response.json({ error: 'Camera rotation completed but billing reconciliation is required' }, { status: 503 });
  }
  return Response.json({ image: result.image, provider: result.provider, message: result.message });
}
