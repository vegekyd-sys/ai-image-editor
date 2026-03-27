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
    // Provider routing: Kling direct (default) or PiAPI
    const usePiAPI = process.env.ANIMATE_PROVIDER === 'piapi';

    if (usePiAPI) {
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
