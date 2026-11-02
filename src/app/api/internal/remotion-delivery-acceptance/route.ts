import {timingSafeEqual, randomUUID} from 'node:crypto';
import {NextRequest, NextResponse} from 'next/server';
import {createRemotionExportJob, runRemotionExportJob} from '@/lib/remotion-export';
import type {DesignPayload} from '@/types';

// Temporary Preview-only operator harness. Production has no enable flag/token.
export const maxDuration = 300;
export const preferredRegion = 'iad1';
export async function POST(request: NextRequest) {
  const expected = process.env.REMOTION_DELIVERY_ACCEPTANCE_TOKEN || '';
  const provided = request.headers.get('x-remotion-acceptance') || '';
  const a = Buffer.from(expected), b = Buffer.from(provided);
  if (process.env.VERCEL_ENV !== 'preview' || process.env.REMOTION_DELIVERY_ACCEPTANCE !== '1'
    || a.length < 32 || b.length !== a.length || !timingSafeEqual(b, a)) return new NextResponse(null, {status: 404});
  try {
    const body = await request.json();
    if (!/^[a-f0-9-]{36}$/.test(body.userId || '') || !/^[a-f0-9-]{36}$/.test(body.projectId || '')) throw new Error('Invalid acceptance scope');
    if (!['baseline', 'cloudflare'].includes(body.mode)) throw new Error('Invalid acceptance mode');
    const design = {...body.design} as DesignPayload;
    if (typeof design.code !== 'string' || design.code.length > 250000 || !Number.isFinite(design.width) || !Number.isFinite(design.height)
      || design.width < 2 || design.height < 2 || design.width > 1920 || design.height > 1920
      || !Number.isFinite(design.animation?.fps || 30) || (design.animation?.fps || 30) < 1 || (design.animation?.fps || 30) > 60
      || !(design.animation?.durationInSeconds && design.animation.durationInSeconds > 0 && design.animation.durationInSeconds <= 60)) throw new Error('Acceptance budget exceeded');
    design.code += `\n// delivery acceptance ${randomUUID()}`;
    const start = Date.now();
    const job = await createRemotionExportJob({userId: body.userId, projectId: body.projectId,
      design, outputType: 'video', renderProfile: 'source', publish: false, name: 'media-delivery-acceptance'});
    const result = await runRemotionExportJob(job.id, {mediaDelivery: body.mode !== 'baseline'});
    return NextResponse.json({jobId: job.id, mode: body.mode, wallMs: Date.now() - start,
      status: result.job.status, url: result.job.storage_url, metadata: {
        lambdaRenderSeconds: result.job.metadata?.lambdaRenderSeconds,
        stageTimings: result.job.metadata?.stageTimings,
        mediaDelivery: result.job.metadata?.mediaDelivery,
      }});
  } catch (error) {
    const message = String(error instanceof Error ? error.message : 'Acceptance failed').replace(/https?:\/\/[^\s"'<>]+/g, '[URL]').slice(0, 500);
    return NextResponse.json({error: message}, {status: 500});
  }
}
