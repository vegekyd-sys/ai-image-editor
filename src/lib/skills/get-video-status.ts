export interface GetVideoStatusInput {
  taskId: string;
}

export interface GetVideoStatusResult {
  success: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
  message: string;
}

export async function getVideoStatus(input: GetVideoStatusInput): Promise<GetVideoStatusResult> {
  const { taskId } = input;

  if (!taskId) {
    return {
      success: false,
      status: 'failed',
      message: 'Task ID is required.',
    };
  }

  try {
    // Route by taskId prefix: task-unified-* = Evolink, cgt-* = SeeDance Volcengine, xai-* = Grok, google-omni-* = Gemini Omni
    const isEvolink = taskId.startsWith('task-unified-');
    const isSeedance = isEvolink || taskId.startsWith('cgt-');
    const isXai = taskId.startsWith('xai-');
    const isGoogleOmni = taskId.startsWith('google-omni-');
    const isMinimax = taskId.startsWith('minimax-h3-');

    if (isXai) {
      const { getXaiVideoTask } = await import('../xai-video');
      const result = await getXaiVideoTask(taskId);

      let message: string;
      switch (result.status) {
        case 'pending': message = 'Grok video task is queued.'; break;
        case 'processing': message = `Grok video is rendering${result.progress != null ? ` (${result.progress}%)` : ''}. It is usually around 30-40 seconds.`; break;
        case 'completed': message = `Grok video rendering completed${result.costUsd != null ? ` (reported cost $${result.costUsd.toFixed(4)})` : ''}!`; break;
        case 'failed': message = `Grok video rendering failed: ${result.error || 'Unknown error'}`; break;
      }

      return {
        success: true,
        status: result.status,
        videoUrl: result.videoUrl,
        error: result.error,
        message,
      };
    }

    if (isGoogleOmni) {
      const { getGoogleOmniVideoTask } = await import('../google-omni-video');
      const result = await getGoogleOmniVideoTask(taskId);
      return {
        success: result.status !== 'failed',
        status: result.status,
        videoUrl: result.videoUrl,
        error: result.error,
        message: result.status === 'completed'
          ? 'Gemini Omni video completed.'
          : `Gemini Omni standalone task cannot be re-fetched from taskId alone: ${result.error || 'missing provider URL'}`,
      };
    }

    if (isMinimax) {
      const { getMinimaxVideoTask } = await import('../minimax-video');
      const result = await getMinimaxVideoTask(taskId);
      return {
        success: result.status !== 'failed',
        status: result.status,
        videoUrl: result.videoUrl,
        error: result.error,
        message: result.status === 'completed'
          ? 'MiniMax H3 video rendering completed!'
          : result.status === 'failed'
            ? `MiniMax H3 video rendering failed: ${result.error || 'Unknown error'}`
            : 'MiniMax H3 video is rendering.',
      };
    }

    if (isEvolink) {
      const { getEvolinkTask } = await import('../evolink');
      const result = await getEvolinkTask(taskId);

      let message: string;
      switch (result.status) {
        case 'pending': message = 'Video task is queued.'; break;
        case 'processing': message = 'Video is rendering. This typically takes 3-5 minutes.'; break;
        case 'completed': message = 'Video rendering completed!'; break;
        case 'failed': message = `Video rendering failed: ${result.error || 'Unknown error'}`; break;
      }

      return {
        success: true,
        status: result.status,
        videoUrl: result.videoUrl,
        error: result.error,
        message,
      };
    }

    if (isSeedance) {
      const { getSeedanceTask } = await import('../seedance');
      const result = await getSeedanceTask(taskId);

      let message: string;
      switch (result.status) {
        case 'pending':
          message = 'Video task is queued.';
          break;
        case 'processing':
          message = 'Video is rendering. This typically takes 3-5 minutes.';
          break;
        case 'completed':
          message = 'Video rendering completed!';
          break;
        case 'failed':
          message = `Video rendering failed: ${result.error || 'Unknown error'}`;
          break;
      }

      return {
        success: true,
        status: result.status,
        videoUrl: result.videoUrl,
        error: result.error,
        message,
      };
    }

    // Fallback: piapi/kling-style task ids.
    const provider = process.env.ANIMATE_PROVIDER || 'kling';

    if (provider === 'piapi') {
      const { getKlingTask: getKlingTaskPiAPI } = await import('../piapi');
      const result = await getKlingTaskPiAPI(taskId);

      let message: string;
      switch (result.status) {
        case 'pending':
          message = 'Video task is queued.';
          break;
        case 'processing':
          message = 'Video is rendering. This typically takes 3-5 minutes.';
          break;
        case 'completed':
          message = 'Video rendering completed!';
          break;
        case 'failed':
          message = `Video rendering failed: ${result.error || 'Unknown error'}`;
          break;
      }

      return {
        success: true,
        status: result.status,
        videoUrl: result.videoUrl,
        error: result.error,
        message,
      };
    } else {
      const { getKlingTask } = await import('../kling');
      const result = await getKlingTask(taskId);

      let message: string;
      switch (result.status) {
        case 'pending':
          message = 'Video task is queued.';
          break;
        case 'processing':
          message = 'Video is rendering. This typically takes 3-5 minutes.';
          break;
        case 'completed':
          message = 'Video rendering completed!';
          break;
        case 'failed':
          message = `Video rendering failed: ${result.error || 'Unknown error'}`;
          break;
      }

      return {
        success: true,
        status: result.status,
        videoUrl: result.videoUrl,
        error: result.error,
        message,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[get_video_status error]', msg);
    return {
      success: false,
      status: 'failed',
      message: `Failed to query video status: ${msg}`,
    };
  }
}
