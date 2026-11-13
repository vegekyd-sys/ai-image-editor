import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { getPublicOrigin } from '@/lib/auth/public-origin';
import { startLayerize, getLayerize, waitLayerize, type LayerizeOwner } from '@/lib/layerize';
import { resolveRequestBillingSource } from '@/lib/billing/attribution';
import type { LayerizeInput } from '@/lib/layerize-provider';

export const maxDuration = 900;
async function owner(req: NextRequest, projectId: string): Promise<LayerizeOwner | Response> {
  const result = await authenticateRequest(req);
  if ('error' in result) return result.error;
  return { userId: result.auth.userId, projectId, origin: getPublicOrigin(req),
    attribution: { source: resolveRequestBillingSource(req, { apiKeyId: result.auth.apiKeyId }), apiKeyId: result.auth.apiKeyId, projectId } };
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as LayerizeInput & { projectId: string; requestId: string };
    const context = await owner(req, body.projectId);
    if (context instanceof Response) return context;
    const result = await startLayerize(context, body.requestId, body);
    if (result.status === 'processing') after(async () => { await waitLayerize(context, result.jobId).catch(() => {}); });
    const { design: _design, ...publicResult } = result;
    return NextResponse.json(publicResult);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Layerize request failed; do not resubmit automatically.' }, { status: 400 });
  }
}
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') || '', id = req.nextUrl.searchParams.get('jobId') || '';
    const context = await owner(req, projectId);
    if (context instanceof Response) return context;
    const { design: _design, ...result } = await getLayerize(context, id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Layerize query failed.' }, { status: 400 });
  }
}
