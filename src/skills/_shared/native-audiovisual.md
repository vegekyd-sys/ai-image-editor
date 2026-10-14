# Generate The Complete Audiovisual Scene

Choose the production method from the requested result before entering a recipe.
Studio tracks production; its stages do not require separate model generations.

- Bind reference markers from the current Media Index and actual image contents;
  attachment order and labels copied from an earlier attempt are not identity
  evidence. Keep presenter and product references in their correct roles.
- For new generated motion within the selected model's single-call limit, use
  one `generate_animation` with all shots, quoted dialogue, voice performance,
  music, ambience, and sound effects in `story_prompt`. Preserve user/app model
  selection; otherwise follow `prompts/animate.md`. Do not generate standalone
  audio, a silent plate, a lip-sync pass, or an intermediate still by default.
- Requested subtitles, product labels, branding, a presenter, or a multi-shot
  script can also be directed inside that same generation. Do not infer an
  editable deliverable from these requirements or from the Skill's name.
- Try native subtitles when a finished generated video is the requested asset.
  Review the actual words, readability and speech alignment in the MP4. Model
  support is not proof of accurate copy. If deterministic/editable text is
  explicitly required, generate the complete sound and picture WITHOUT baked
  text, then add only the required overlays; preserve the existing soundtrack.
- Only explicitly editable/programmatic work or source-led assembly needs the
  composition contract. For generated footage used in that composition,
  generate the complete audiovisual clip after Script, transcribe THAT clip,
  then derive Storyboard and subtitle timing from the real speech. Editable
  captions do not require editable speech or separate music generation.
- Simple captions/labels over one accepted generated clip use direct
  composition, preview, publish and materialize. They do not start Studio or
  require separate Brief, Proposal, Script, Storyboard and Assets documents.
- Record a ready audible video in the Asset Manifest as `type: "video"` with
  `hasAudio: true` and its actual URL/workspace path. The server verifies the
  embedded audio track. Keep it audible in Remotion and avoid duplicating it
  with a second `<Audio>` or muting it under a platform's source-footage rule.
- ASR supplies timing and a fallible transcript. Check ambiguous names or
  numbers against the audible video before paying to regenerate speech; a
  transcription typo alone does not prove the native voice said it wrong.
- Independent audio generation remains appropriate for an audio deliverable,
  a locally animated/code-led film without generated speaking footage, or an
  explicitly requested replacement soundtrack. Those routes follow the shared
  audio director; they do not override native audio in generated scenes.
- A pending provider task is not the promised finished MP4. Retain its task ID;
  never regenerate to resume delivery. When post-production is needed, include
  concrete `completion_actions` and persist the required next step. Do not
  describe a plate or saved composition source as completed delivery.
