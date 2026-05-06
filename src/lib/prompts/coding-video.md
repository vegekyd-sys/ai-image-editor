# Video Editing with <Video>

The `<Video>` component syncs with Remotion Player (play/pause/seek all work). NEVER use HTML `<video>`.

## Props
- `src` — video URL (Supabase Storage)
- `muted` — silent playback (required for autoplay on mobile)
- `startFrom={frame}` — skip first N frames (trim start)
- `endAt={frame}` — stop at frame N (trim end)
- `playbackRate={1.5}` — speed (0.25 to 4x)
- `volume={0.5}` — audio volume (0 to 1, or function of frame for fade)
- `style` — CSS (objectFit, filter, transform, opacity)

## Multi-clip Splice (CORRECT pattern)

Use `<Sequence>` per clip. Each clip gets its own mount lifecycle:

```jsx
const { fps } = useVideoConfig();
const clips = [
  { src: url1, duration: 150 },  // 5s at 30fps
  { src: url2, duration: 120 },  // 4s
];
let offset = 0;
{clips.map((clip, i) => {
  const from = offset;
  offset += clip.duration;
  return (
    <Sequence key={i} from={from} durationInFrames={clip.duration}>
      <AbsoluteFill>
        <Video src={clip.src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
    </Sequence>
  );
})}
```

**WRONG**: Do NOT use opacity/display toggle with all videos mounted simultaneously — causes playback sync issues.

## Trim & Speed

```jsx
// Play only frames 30-150 of the video (skip first 1s, end at 5s)
<Video src={url} startFrom={30} endAt={150} />

// Slow motion
<Video src={url} playbackRate={0.5} />

// Speed up
<Video src={url} playbackRate={2} />
```

## Crossfade Transition Between Clips

```jsx
const FADE = 15; // 0.5s fade at 30fps
<Sequence from={0} durationInFrames={150 + FADE}>
  <AbsoluteFill style={{ opacity: interpolate(frame, [150, 150 + FADE], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
    <Video src={url1} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  </AbsoluteFill>
</Sequence>
<Sequence from={150} durationInFrames={120}>
  <AbsoluteFill style={{ opacity: interpolate(frame - 150, [0, FADE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
    <Video src={url2} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  </AbsoluteFill>
</Sequence>
```

## Text Overlay on Video

```jsx
<AbsoluteFill>
  <Video src={url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  <Sequence from={30} durationInFrames={90}>
    <div style={{ position: 'absolute', bottom: '10%', width: '100%', textAlign: 'center' }}>
      <span data-editable="subtitle" style={{ fontSize: 64, fontWeight: 800, color: '#fff', textShadow: '0 4px 20px rgba(0,0,0,0.8)' }}>
        {props.subtitle}
      </span>
    </div>
  </Sequence>
</AbsoluteFill>
```

## Audio Control

```jsx
// Fade in audio over first second
<Video src={url} volume={(f) => interpolate(f, [0, 30], [0, 1], { extrapolateRight: 'clamp' })} />

// Mute video, add separate music
<Video src={url} muted style={{ ... }} />
<Audio src={musicUrl} volume={0.7} />
```

## CSS Effects

```jsx
<Video src={url} style={{ filter: 'brightness(1.2) contrast(1.1) saturate(1.3)' }} />
<Video src={url} style={{ mixBlendMode: 'overlay' }} />
```
