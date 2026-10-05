interface CanvasIdentity {
  viewIndex: number;
  image?: string;
  videoId?: string;
  videoUrl?: string | null;
  snapshotVideoUrl?: string | null;
  annotationMode: boolean;
}

export function getEditorCanvasKey(input: CanvasIdentity): string {
  const mode = input.annotationMode ? 'annotate' : 'browse';
  // A poster, pipeline stage or delivery URL changes within the same video.
  // Keep the canvas mounted; its native player handles source changes itself.
  if (input.videoId) return `video:${input.videoId}:${mode}`;
  return `${input.viewIndex}:${input.image ?? ''}:${input.videoUrl ?? ''}:${input.snapshotVideoUrl ?? ''}:${mode}`;
}
