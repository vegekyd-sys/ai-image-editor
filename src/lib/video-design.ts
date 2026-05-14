import type { DesignPayload } from '@/types';

export async function probeVideoDimensions(videoUrl: string): Promise<{ width: number; height: number }> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = videoUrl;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      const w = video.videoWidth || 1080;
      const h = video.videoHeight || 1920;
      video.removeAttribute('src');
      video.load();
      resolve({ width: w, height: h });
    };
    video.onerror = () => resolve({ width: 1080, height: 1920 });
    setTimeout(() => resolve({ width: 1080, height: 1920 }), 5000);
  });
}

export function createVideoDesign(
  videoUrl: string,
  width: number,
  height: number,
  durationSec: number,
): DesignPayload {
  const escaped = videoUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const code = `function Design() {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Video src="${escaped}" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}`;
  return {
    code,
    width: width || 1080,
    height: height || 1440,
    animation: { fps: 30, durationInSeconds: durationSec },
  };
}
