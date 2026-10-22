/** Native video currentTime is rounded to microseconds. A seek at exactly a
 * frame boundary can land a microsecond before it and display the prior frame,
 * while the deterministic export decoder selects the requested frame. Nudge
 * paused seeks inside that frame, without shifting continuous playback. */
export function alignPausedPreviewFrame(video: HTMLVideoElement, expectedTime: number, fps: number): boolean {
  if (!video.paused || !Number.isFinite(video.duration) || video.duration <= 0) return false;
  const target = Math.min(Math.max(0, expectedTime) + 0.0001, Math.max(0, video.duration - 0.0001));
  if (Math.abs(video.currentTime - expectedTime) > 1 / fps || Math.abs(video.currentTime - target) < 0.00002) return false;
  video.currentTime = target;
  return true;
}
