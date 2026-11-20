---
name: beat-sync-video
description: Direct a music-led video in which cuts, actions, reveals, or transitions land on audible accents. Covers 卡点/踩点, product montages, dance, and editing to an uploaded MP3 or another selected soundtrack.
allowed-tools: read_file analyze_video analyze_image transcribe_audio run_code write_code_file write_file preview_frame publish_draft materialize_media
metadata:
  makaron:
    icon: "♫"
    color: "#6d5ce7"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    tags: [video, music, beat-sync, editing, remotion]
---

# Beat-Sync Video

Use this Skill when music determines what happens on screen and when. Adding
BGM under an existing edit or preserving a reference's existing rhythm follows
the corresponding audio or source-edit workflow. Selected footage and a brief
such as “剪一条30秒卡点视频” are enough to start. Own the story, track, cut
points, transitions, and caption direction inside Makaron. Treat any details
the user supplies as creative constraints. If using `generate_animation`,
read `prompts/animate.md` first and follow its native generation routes. For
TikTok/Douyin source-led or editable delivery, read
`skills/tiktok-video/SKILL.md` before presenting the edit plan. Load it now
if needed for platform framing, text and delivery.

## Storyboard, then retrieve coverage

1. Use the selected media as the starting point. Read their source ranges
   and descriptions and inspect the action where the evidence is unclear.
   Write the story as an ordered series of visible changes from this material.
   Open with a result or action that raises a question, then show what produces
   it and close with proof or a payoff. A product demo can show the result,
   retrace the hand action, then show what moves and why it matters. A factory
   film can open on the finished object, then follow the same material through
   the steps that change it, inspection, and packing when the footage supports
   those stages. Use strong hits for the transitions between story steps.
2. Turn the story into a shot list. For each step, write the visible evidence
   needed, the action phase, shot size or camera position, and usable duration.
   Give major steps a follow-up shot when the edit calls for quick cuts, such
   as a wider view to orient the viewer and a detail to show the change.
3. When additional Scene retrieval is in scope and available through the
   host, search for the required shots by role. For complete process footage,
   start with one process-coverage query, then target only missing shots.
   Verify each role against the actual frames and record its accepted
   range, viable alternate, or gap. Bind the ordered
   `source_url + start + end + description` ranges in seconds. Preserve source
   coordinates and keep the action handles. If necessary, shorten or redesign
   the story to fit supported actions and report the missing step or view.
4. Inspect representative frames and the joins at delivery aspect ratio. Make
   sure the product, hands and impact point stay in frame when they matter.
   Prefer clear silhouettes, steady focus and backgrounds that let the subject
   read on a phone. Match screen direction and action phase across adjacent
   shots when a gesture continues. Reject repetitive frontal coverage that adds
   no new information, a crop that loses the action, or a different product
   used as evidence of the featured one. Label a crop as a change of shot size
   from the same angle. In a process story, adjacent angles should make the
   movement of the material or workpiece easy to follow.

## Use the supplied soundtrack

Footage and an uploaded MP3 or another playable project track are sufficient
to run this Skill. When the current request includes one music attachment,
use it as the soundtrack by default. Follow any explicit track selection
when the project contains several audio assets. Resolve the track from the
Audio Index, choose the cue-in and usable window, and use the exact audio file
for beat analysis and the editable Composition. See
`references/timing-and-review.md` for timing, source offsets, and the final fade.

If the user supplies footage without a soundtrack, ask them to upload a song
or pick a track from the project. If they explicitly request original music,
follow the original music workflow.

## Direct the cut and captions together

- Read `skills/beat-sync-video/references/timing-and-review.md` before
  locking the timeline. Build a cue sheet from accents in the audio that will
  actually play. Account for the back half and give each important hit an
  observable cut, change in framing, reveal, or moment inside an action.
  Use a hold where the phrase or story needs it and make its purpose clear.
- Explore different pacing and visual treatments that suit this footage.
  A process reveal may need an uninterrupted movement followed by a run of
  match cuts. A product demo may use contrasting shot sizes and a reaction at
  the peak. Choose a rhythm for each phrase with room for surprise and breath.
  Let the story, the source actions, and this recording determine the shot
  count, spacing, and transition style anew each time.
- Read `skills/beat-sync-video/references/music-led-captions.md` for
  caption direction. Give the edit expressive, readable text cues on selected
  musical accents throughout the story, including the back half, when on-screen
  text is appropriate. Keep picture hits and caption motion on the same timeline.
- Follow `prompts/agent-coding.md` and `prompts/remotion-composition.md` for the
  editable Composition. Verify its runnable entry, video and audio bindings, and
  safe text placement. Fade out after the last intended accent and leave time
  to register the result. Use `preview_frame` on the Composition to review the
  opening, middle, and ending before publishing. Review changed sections again
  after a repair. Publish the reviewed draft and materialize the same path for
  video delivery. Once the MP4 exists, review it with sound at normal
  speed and inspect the main cues, including the latter section. Repair hits
  that hide the subject or look inert.
