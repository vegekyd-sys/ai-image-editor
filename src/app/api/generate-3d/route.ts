import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createImageTo3DTask, getTaskStatus, isMeshyAvailable } from '@/lib/meshy';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (!isMeshyAvailable()) {
      return Response.json({ error: 'MESHY_API_KEY not configured' }, { status: 500 });
    }

    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return Response.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    const taskId = await createImageTo3DTask(imageUrl);
    return Response.json({ taskId });
  } catch (e) {
    console.error('[generate-3d] POST error:', e);
    return Response.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const taskId = req.nextUrl.searchParams.get('taskId');
    if (!taskId) {
      return Response.json({ error: 'taskId is required' }, { status: 400 });
    }

    const task = await getTaskStatus(taskId);
    return Response.json({
      status: task.status,
      progress: task.progress,
      modelUrls: task.model_urls,
      thumbnailUrl: task.thumbnail_url,
    });
  } catch (e) {
    console.error('[generate-3d] GET error:', e);
    return Response.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
