# Timing And Review

## Establish one music timeline

- Confirm track version, cue-in, playback rate, timeline start and intended
  ending. For an uploaded track, measure accents in the chosen source window,
  bind the same Audio Index asset in the Composition, and apply the cue-in
  once. If the track is too short for a fixed duration, clarify how to handle
  the shortfall before editing. Use a volume envelope for a natural ending
  when the chosen window needs a fade. Retain any intentional fade already
  present in the selected audio.
- Listen and inspect the retained audio waveform with available tools. For
  numerical checks, use `run_code` in Node mode with FFmpeg to decode the exact
  soundtrack as PCM. Compare changes in short-window energy across frequency
  bands to find kicks and other candidate transients, then inspect their
  repetition and phrase changes. Use the resolved Audio
  Index asset for standalone music, `workspace_paths` for workspace files, or
  `media_refs` for timeline video. Confirm the kick, snare, drop, fill or vocal
  accent by listening. BPM is an estimate of spacing. When the music swings,
  starts off-beat or changes tempo, measured accents govern the edit.
- Mark the strong accents across each phrase before assigning the pictures.
  Keep the back half in the same cue sheet and account for intentional pauses
  and the final fade. Record audio offset, output frame, story step, the cut
  or visible action, its source trim or action time, and any caption response.
  At 1×, a sound at local audio time `t` is at `musicStart + t` on the timeline.
  Quantize cues to the nearest frame at output fps. For an action landing,
  locate the contact frame in the source and solve back to the shot's start
  using playback rate and source handles. When the hit sits inside a shot,
  preserve a readable approach and reaction where the footage allows.

Build the cue sheet inside Makaron from the footage and selected recording.
Carry it into the editable composition. Use `function Composition(props)`
with the injected Remotion components and preserve the exact video and audio
bindings through patches and publish.

## Check the rendered edit

- **Picture.** At phone size, review the hook, the thumbnails of all shots in
  sequence, and the frames around every important join. The viewer should see
  what the subject is, what changes, and why the angle changed. Check for cut-off
  hands or products, obscured contact, near-identical angles, broken screen
  direction, gaps and a rushed closing frame.
- **Text.** Inspect the intended accent and a stable reading frame for
  representative cues across the video. Check contrast, reading time, safe
  areas, and how the type responds to different moments. Review the back
  half for purposeful caption motion as well as picture changes.
- **Timing.** Listen through the encoded MP4 at normal speed. Compare the
  intended accented frame with the actual edit, action or reveal in the
  encoded video. For deliberate hard hits, aim within one output frame of the
  cue measured in the encoded audio. Recheck audio alignment after rendering.
  Step through the cue sheet from the midpoint to the last active hit as well
  as the opening. A repeated or static view over consecutive unassigned hits
  fails review unless it is an intentional pause or the planned fade. Confirm
  the action chain also reads with the sound off and hear the full fade while
  the final image remains clear.
- **Delivery.** Check runtime and aspect ratio against the brief. Report an
  export as queued until it can be played and reviewed. If available, deliver
  the playable project or MP4 with a brief note on the selected track and
  strongest visual cue.

## Sources for these practices

- Opening, body, close and sound in short-form ads. [TikTok Creative Codes](https://ads.tiktok.com/business/en/blog/creative-best-practices-top-performing-ads?redirected=1)
- Using successive views of one action to make a product clearer. [Douyin creator tutorial on multi-angle product filming](https://www.douyin.com/video/7222749459443158328)
- Choosing beat density for the music and story. [Douyin creator tutorial on music-led editing](https://www.douyin.com/video/7452701942297513231)
- Selecting meaningful hits and checking synchronization over the full track. [CapCut music video workflow](https://www.capcut.com/features/how-to-make-a-music-video-capcut-workflow)
- Following a material across manufacturing steps. [Douyin factory tour from forming to packing](https://www.douyin.com/video/7585548864824954158)
