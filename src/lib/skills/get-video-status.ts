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
    // Provider routing: foldin, piapi, or kling (default)
    const provider = process.env.ANIMATE_PROVIDER || 'kling';

    if (provider === 'foldin') {
      const { getFoldinTaskStatus, getFoldinTaskOutputs } = await import('../foldin');
      const statusData = await getFoldinTaskStatus(taskId);

      // Map foldin status to our status format
      let status: 'pending' | 'processing' | 'completed' | 'failed';
      let message: string;
      let videoUrl: string | undefined;

      switch (statusData.status) {
        case 'PENDING':
          status = 'pending';
          message = 'Video task is queued.';
          break;
        case 'RUNNING':
          status = 'processing';
          message = 'Video is rendering. This typically takes 3-5 minutes.';
          break;
        case 'SUCCESS':
          status = 'completed';
          // Query outputs to get video URL
          const outputs = await getFoldinTaskOutputs(taskId);
          if (outputs.length > 0) {
            videoUrl = outputs[0].object_url || outputs[0].upstream_object_url || undefined;
          }
          message = videoUrl ? 'Video rendering completed!' : 'Video completed but URL not available yet.';
          break;
        case 'FAILED':
          status = 'failed';
          message = `Video rendering failed: ${statusData.error || 'Unknown error'}`;
          break;
        case 'CANCELED':
          status = 'failed';
          message = 'Video rendering was canceled.';
          break;
      }

      return {
        success: true,
        status,
        videoUrl,
        error: statusData.error || undefined,
        message,
      };
    } else if (provider === 'piapi') {
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
