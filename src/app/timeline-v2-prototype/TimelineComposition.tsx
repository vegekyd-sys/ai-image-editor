'use client';

// Prototype compile target: TimelineDoc → Remotion tree. Production version
// compiles to <Track>/<Sequence>/TransitionSeries (plan §3.6).
import { AbsoluteFill, Audio, Img, Sequence, Video, interpolate, useCurrentFrame } from 'remotion';
import type { Clip, TimelineDoc } from './prototype-doc';
import { TRACK_ORDER } from './prototype-doc';

function ClipBody({ clip, fps }: { clip: Clip; fps: number }) {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });

  if (clip.kind === 'video' && clip.src) {
    const media = (
      <Video
        src={clip.src}
        muted
        trimBefore={Math.round((clip.sourceIn ?? 0) * fps)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
    if (clip.box) {
      const b = clip.box;
      return (
        <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.radius ?? 0, overflow: 'hidden', border: '6px solid rgba(255,255,255,0.9)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)', opacity: fadeIn, transform: `scale(${interpolate(fadeIn, [0, 1], [0.9, 1])})` }}>
          {media}
        </div>
      );
    }
    return <AbsoluteFill>{media}</AbsoluteFill>;
  }

  if (clip.kind === 'image' && clip.poster) {
    return <AbsoluteFill><Img src={clip.poster} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></AbsoluteFill>;
  }

  if (clip.kind === 'pending' && clip.box) {
    const b = clip.box;
    return (
      <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.radius ?? 0, border: '4px dashed rgba(255,255,255,0.45)', background: 'rgba(10,10,14,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 40, fontFamily: 'var(--font-geist-sans), system-ui' }}>
        {Math.round((clip.progress ?? 0) * 100)}%
      </div>
    );
  }

  if (clip.kind === 'text' && clip.box) {
    const b = clip.box;
    const y = interpolate(frame, [0, 14], [40, 0], { extrapolateRight: 'clamp' });
    return (
      <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#fff', fontSize: 132, fontWeight: 800, letterSpacing: 4, lineHeight: 1.05, textShadow: '0 8px 40px rgba(0,0,0,0.6)', opacity: fadeIn, transform: `translateY(${y}px)`, fontFamily: 'var(--font-geist-sans), system-ui' }}>
        {clip.text}
      </div>
    );
  }

  if (clip.kind === 'caption' && clip.segments) {
    const t = frame / fps;
    const current = clip.segments.find(s => t >= s.start && t < s.end);
    if (!current) return null;
    return (
      <div style={{ position: 'absolute', left: 80, right: 80, bottom: 260, display: 'flex', justifyContent: 'center' }}>
        <span style={{ background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 58, fontWeight: 600, padding: '14px 30px', borderRadius: 18, fontFamily: 'var(--font-geist-sans), system-ui' }}>{current.text}</span>
      </div>
    );
  }

  if (clip.kind === 'audio' && clip.src) {
    return <Audio src={clip.src} volume={0.6} />;
  }
  return null;
}

export default function TimelineComposition({ doc }: { doc: TimelineDoc }) {
  // Lower tracks render first; TRACK_ORDER is top→bottom in the dock, so reverse for paint order.
  const paintOrder = [...TRACK_ORDER].reverse();
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {paintOrder.map(track => (
        <AbsoluteFill key={track.id}>
          {Object.values(doc.clips).filter(c => c.trackId === track.id).map(clip => (
            <Sequence
              key={clip.id}
              from={Math.round(clip.start * doc.fps)}
              durationInFrames={Math.max(1, Math.round(clip.duration * doc.fps))}
              layout="none"
            >
              <ClipBody clip={clip} fps={doc.fps} />
            </Sequence>
          ))}
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
}
