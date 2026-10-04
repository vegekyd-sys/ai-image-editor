type PreviewPremountOptions = {
  authoredDuration: number;
  fps: number;
  iosWebKit: boolean;
};

export function getPreviewPremountFrames({
  authoredDuration,
  fps,
  iosWebKit,
}: PreviewPremountOptions): number {
  const duration = Number.isFinite(authoredDuration) && authoredDuration > 0
    ? authoredDuration
    : fps;
  const halfSecond = Math.round(fps / 2);
  const minimumLead = Math.round(fps * 1.5);
  // A fixed eight-second desktop lead mounted four large Scene originals at
  // frame zero in real compositions. Their Range requests competed with the
  // active clip so aggressively that an uncached Chrome could remain at
  // readyState 0/1 for over a minute. A scene-relative lead keeps the active
  // clip plus its immediate successor warm, then rolls the same window forward
  // as playback advances. iOS retains its larger seek allowance because its
  // decoder budget is bounded separately by this same scene-relative window.
  const maximumLead = fps * (iosWebKit ? 6 : 4);

  return Math.min(maximumLead, Math.max(minimumLead, duration + halfSecond));
}
