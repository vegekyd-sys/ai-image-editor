import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { renderDesignFrames } from '@/lib/remotion-server';
import type { PreviewRenderMetrics } from '@/lib/remotion-preview-metrics';
import * as workspace from '@/lib/workspace';

export const maxDuration = 360;

/** Deployment-only acceptance harness. Disabled in production and by default. */
export async function POST(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.SANDBOX_ACCEPTANCE_ENABLED !== 'true') {
    return new NextResponse(null,{status:404});
  }
  const auth = await authenticateRequest(req);
  if ('error' in auth) return auth.error;
  const {userId,supabase} = auth.auth;
  if (userId !== process.env.SANDBOX_ACCEPTANCE_USER_ID) return new NextResponse(null,{status:403});
  const body = await req.json();
  if (body.projectId !== process.env.SANDBOX_ACCEPTANCE_PROJECT_ID) return new NextResponse(null,{status:403});
  const {data:project} = await supabase.from('projects').select('id').eq('id',body.projectId).eq('user_id',userId).maybeSingle();
  if (!project) return new NextResponse(null,{status:404});
  const {data:snapshot} = await supabase.from('snapshots').select('design_path').eq('project_id',project.id).eq('id',body.snapshotId).maybeSingle();
  if (!snapshot?.design_path) return new NextResponse(null,{status:404});
  const frames = body.frames;
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 10 || frames.some(f=>!Number.isSafeInteger(f)||f<0)) {
    return NextResponse.json({error:'Expected one to ten nonnegative frame numbers'},{status:400});
  }
  const saved = await workspace.readFile(snapshot.design_path,supabase,userId);
  if (!saved) return new NextResponse(null,{status:404});
  const started = Date.now();
  let metrics: PreviewRenderMetrics | undefined;
  try {
    const images = await renderDesignFrames(JSON.parse(saved.content),frames,{
      signal:req.signal,
      sandboxScope:`${userId}:${project.id}`,
      onMetrics:value=>{metrics=value;},
    });
    return NextResponse.json({elapsedMs:Date.now()-started,metrics,frames,images:images.map(image=>image.toString('base64'))},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    console.error('[sandbox-acceptance] render failed',error instanceof Error?error.name:'unknown');
    return NextResponse.json({error:'Preview rendering failed',elapsedMs:Date.now()-started},{status:500});
  }
}
