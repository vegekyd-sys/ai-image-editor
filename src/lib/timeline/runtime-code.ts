// Constant design code that renders props.timeline (MTP v1). Because every
// timeline video ships this same code and keeps its content in props, it goes
// through the existing design pipeline unchanged: evalRemotionJSX for Player
// preview + browser export, DynamicDesign for Lambda export and poster capture,
// and the pinned-font preparation (literal default stack + props scan).
//
// Only scope names present in BOTH runtimes are used: React, AbsoluteFill,
// Sequence, Video, Audio, Img, interpolate, useCurrentFrame, useVideoConfig.
// Bump TIMELINE_RUNTIME_VERSION when changing behaviour; old snapshots keep
// the code they were saved with.

export const TIMELINE_RUNTIME_VERSION = 1;
export const TIMELINE_RUNTIME_MARKER = `// makaron-timeline-runtime v${TIMELINE_RUNTIME_VERSION}`;

export const TIMELINE_RUNTIME_CODE = `${TIMELINE_RUNTIME_MARKER}
const DEFAULT_FONT = { fontFamily: "Inter, Noto Sans SC, sans-serif" };
const PAINT_ORDER = ['main', 'overlay', 'text', 'caption', 'audio'];

function tlEnter(effect, frame, fps) {
  const t = Math.min(1, frame / Math.max(1, Math.round(fps * 0.45)));
  const ease = 1 - Math.pow(1 - t, 3);
  if (effect === 'fade') return { opacity: ease };
  if (effect === 'rise') return { opacity: ease, transform: 'translateY(' + ((1 - ease) * 60) + 'px)' };
  if (effect === 'pop') return { opacity: ease, transform: 'scale(' + (0.82 + 0.18 * ease) + ')' };
  return {};
}

function tlBoxStyle(box) {
  return {
    position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
    borderRadius: box.radius || 0, opacity: box.opacity === undefined ? 1 : box.opacity,
    transform: box.rotation ? 'rotate(' + box.rotation + 'deg)' : undefined, overflow: 'hidden',
  };
}

function TimelineVisual({ clip }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = tlEnter(clip.enter, frame, fps);
  const fit = clip.fit || 'cover';
  let media = null;
  if (clip.kind === 'video') {
    media = <Video src={clip.src} trimBefore={Math.round((clip.sourceIn || 0) * fps)} muted={!!clip.muted} volume={clip.volume === undefined ? 1 : clip.volume} objectFit={fit} style={{ width: '100%', height: '100%' }} />;
  } else if (clip.kind === 'image') {
    const zoom = clip.zoom ? interpolate(frame, [0, Math.max(1, clip.duration * fps)], [1, 1.08]) : 1;
    media = <Img src={clip.src} style={{ width: '100%', height: '100%', objectFit: fit, transform: 'scale(' + zoom + ')' }} />;
  } else if (clip.kind === 'pending') {
    const pct = Math.round((clip.progress || 0) * 100);
    media = (
      <AbsoluteFill style={{ background: 'rgba(12,12,16,0.72)', border: '4px dashed rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 44, fontFamily: DEFAULT_FONT.fontFamily }}>
        {pct + '%'}
      </AbsoluteFill>
    );
  }
  if (!media) return null;
  if (clip.box) {
    return <div style={{ ...tlBoxStyle(clip.box), ...enter }}>{media}</div>;
  }
  return <AbsoluteFill style={enter}>{media}</AbsoluteFill>;
}

function TimelineText({ clip }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = clip.style || {};
  const box = clip.box;
  const align = s.align || 'center';
  return (
    <div style={{ ...tlBoxStyle(box), overflow: 'visible', display: 'flex', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', ...tlEnter(clip.enter || 'rise', frame, fps) }}>
      <div style={{
        fontFamily: s.fontFamily || DEFAULT_FONT.fontFamily, fontSize: s.fontSize || 96, fontWeight: s.fontWeight || 800,
        color: s.color || '#ffffff', textAlign: align, lineHeight: 1.12, letterSpacing: s.letterSpacing || 0,
        whiteSpace: 'pre-wrap', background: s.background, padding: s.background ? '0.18em 0.42em' : 0, borderRadius: s.background ? '0.3em' : 0,
        textShadow: s.shadow === false ? 'none' : '0 6px 32px rgba(0,0,0,0.55)',
      }}>{clip.text}</div>
    </div>
  );
}

function TimelineCaption({ clip }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const seg = (clip.segments || []).find((x) => t >= x.start && t < x.end);
  if (!seg) return null;
  const s = clip.style || {};
  const preset = s.preset || 'pill';
  const local = Math.round((t - seg.start) * fps);
  const appear = Math.min(1, local / Math.max(1, Math.round(fps * 0.15)));
  const size = s.fontSize || Math.round(width * 0.052);
  const pos = s.position || 'bottom';
  const text = {
    fontFamily: s.fontFamily || DEFAULT_FONT.fontFamily, fontSize: size, fontWeight: 700, lineHeight: 1.3,
    color: s.color || '#ffffff', textAlign: 'center', maxWidth: width * 0.86, whiteSpace: 'pre-wrap',
  };
  let inner;
  if (preset === 'outline') inner = <span style={{ ...text, WebkitTextStroke: Math.max(2, size * 0.08) + 'px rgba(0,0,0,0.85)', paintOrder: 'stroke fill' }}>{seg.text}</span>;
  else if (preset === 'plain') inner = <span style={{ ...text, textShadow: '0 3px 14px rgba(0,0,0,0.8)' }}>{seg.text}</span>;
  else if (preset === 'highlight') inner = <span style={{ ...text, color: '#111111', background: s.accent || '#fde047', padding: '0.12em 0.4em', borderRadius: '0.2em' }}>{seg.text}</span>;
  else inner = <span style={{ ...text, background: 'rgba(0,0,0,0.58)', padding: '0.28em 0.7em', borderRadius: '0.5em' }}>{seg.text}</span>;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: pos === 'top' ? 'flex-start' : pos === 'center' ? 'center' : 'flex-end', paddingTop: height * 0.12, paddingBottom: height * 0.14, opacity: appear, transform: 'translateY(' + ((1 - appear) * 12) + 'px)' }}>
      {inner}
    </AbsoluteFill>
  );
}

function TimelineAudio({ clip }) {
  const { fps } = useVideoConfig();
  const total = Math.max(1, Math.round(clip.duration * fps));
  const base = clip.volume === undefined ? 1 : clip.volume;
  const fadeIn = Math.round((clip.fadeIn || 0) * fps);
  const fadeOut = Math.round((clip.fadeOut || 0) * fps);
  return <Audio src={clip.src} trimBefore={Math.round((clip.sourceIn || 0) * fps)} volume={(f) => {
    let v = base;
    if (fadeIn > 0) v *= Math.min(1, f / fadeIn);
    if (fadeOut > 0) v *= Math.min(1, Math.max(0, (total - f) / fadeOut));
    return v;
  }} />;
}

function TimelineClip({ clip }) {
  if (clip.kind === 'text') return <TimelineText clip={clip} />;
  if (clip.kind === 'caption') return <TimelineCaption clip={clip} />;
  if (clip.kind === 'audio') return <TimelineAudio clip={clip} />;
  return <TimelineVisual clip={clip} />;
}

function Composition(props) {
  const tl = props.timeline;
  const { fps } = useVideoConfig();
  if (!tl || !tl.clips) return <AbsoluteFill style={{ background: '#000' }} />;
  const clips = Object.values(tl.clips);
  const kindOf = {};
  (tl.tracks || []).forEach((tr) => { kindOf[tr.id] = tr.kind; });
  const hidden = {};
  (tl.tracks || []).forEach((tr) => { if (tr.hidden || tr.muted) hidden[tr.id] = true; });
  const ordered = clips
    .filter((c) => !hidden[c.trackId] && kindOf[c.trackId])
    .sort((a, b) => PAINT_ORDER.indexOf(kindOf[a.trackId]) - PAINT_ORDER.indexOf(kindOf[b.trackId]) || a.start - b.start);
  return (
    <AbsoluteFill style={{ background: tl.background || '#000000' }}>
      {ordered.map((clip) => (
        <Sequence key={clip.id} name={clip.label || clip.kind} from={Math.round(clip.start * fps)} durationInFrames={Math.max(1, Math.round(clip.duration * fps))}>
          <TimelineClip clip={clip} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
`;
