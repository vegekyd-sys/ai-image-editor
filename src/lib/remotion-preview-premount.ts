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
  if (!iosWebKit) return fps * 8;

  // iOS WebKit has a much smaller practical decoder budget than desktop
  // browsers. Basing the lead on the incoming scene's own duration keeps
  // rapid-cut compositions to roughly the active clip plus two neighbours,
  // while long source ranges still get enough time to seek before their cut.
  const duration = Number.isFinite(authoredDuration) && authoredDuration > 0
    ? authoredDuration
    : fps;
  const halfSecond = Math.round(fps / 2);
  const minimumLead = Math.round(fps * 1.5);
  const maximumLead = fps * 6;

  return Math.min(maximumLead, Math.max(minimumLead, duration + halfSecond));
}
