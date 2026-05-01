import type { DesignPayload } from '@/types';

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
      <Video src="${escaped}" muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
