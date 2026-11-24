// Provider acknowledgements describe generation. Locate the first chunk for a
// direction on the video timeline, then release its caption on a rendered frame.
export function createPlayoutCues() {
  const prompts = new Map(), chunks = new Map(), cues = [];
  let nextChunk = 0, segmentStart = 0, firstMediaTime, played = 0, displayed = 0;
  return {
    expect(version, text) { prompts.set(version, text); },
    chunk({chunk_index: index, prompt_version: version, playback_seconds: duration, buffer_depth_seconds: buffer}) {
      if (!Number.isInteger(index) || index < nextChunk || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(version)) return;
      chunks.set(index, {version, duration, earliest: played + Math.max(0, (Number(buffer) || 0) - duration)});
      while (chunks.has(nextChunk)) {
        const segment = chunks.get(nextChunk);
        if (prompts.has(segment.version)) {
          cues.push({version: segment.version, text: prompts.get(segment.version), at: Math.max(segmentStart, segment.earliest)});
          prompts.delete(segment.version);
        }
        segmentStart += segment.duration;
        chunks.delete(nextChunk++);
      }
    },
    frame(mediaTime) {
      firstMediaTime ??= mediaTime;
      played = mediaTime - firstMediaTime;
      let newest;
      while (cues.length && cues[0].at <= played) {
        const cue = cues.shift();
        if (cue.version <= displayed) continue;
        displayed = cue.version;
        newest = {version: cue.version, text: cue.text};
      }
      return newest;
    },
  };
}
