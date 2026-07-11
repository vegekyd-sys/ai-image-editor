---
name: creative-direction
description: >
  Create a compact, subject-specific Creative Treatment that gives any complete
  video an authored visual idea before script, storyboard, and composition.
allowed-tools: read_file studio_run run_code preview_frame
metadata:
  makaron:
    icon: "✦"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: false
    manifestVisible: false
    tags: [video, creative-direction, treatment, studio-run, internal]
---

# Creative Direction

Use for every complete video that needs a new visual direction. Skip only for
mechanical edits, explicit template replication, or an A/B baseline marked
`creativeMode: "baseline"`.

The goal is not a prettier template. Find one visual idea that belongs to this
subject, then make script, storyboard, motion, audio, and review obey it.

## Inspiration Pass

Ask these internally, then decide. Do not present a long questionnaire.

1. **Theme evidence**: Name at least two concrete objects, behaviors, spaces,
   rituals, constraints, or cultural signals that belong to this subject. Avoid
   generic claims such as innovative, premium, or fast.
2. **Productive tension**: Which contrast gives the piece energy: private/public,
   chaos/control, tiny/immense, human/system, past/future, or a better specific pair?
3. **Best visual form**: Consider three forms before choosing one: object
   transformation, system choreography, journey/map, process/ritual, scale
   reveal, evidence montage, character behavior, or spatial reveal. A form is
   only a candidate when it grows directly from the theme evidence.
4. **Visual mechanism**: Turn the truth and tension into an action the viewer can
   see over time. Prefer transformation, accumulation, pursuit, collision, reveal,
   compression, or another meaningful behavior over decorative floating objects.
5. **Signature frame**: Describe one still frame that would identify this video
   with the logo and copy hidden.
6. **Scene contrast**: Give adjacent scenes different silhouettes, focal positions,
   scale relationships, and image/text roles while preserving one visual grammar.
7. **Restraint**: Ban the three most tempting cliches for this exact project.

## Theme-Fit Selection

Do this inside the Proposal; do not render three candidate videos and do not
write a separate analysis. Each concept gets only `themeConnection`,
`visualForm`, and four integer `visualFit` scores: theme specificity,
recognition speed, motion potential, and production efficiency. Keep each
connection to one short sentence. Select the strongest total that still has
theme specificity >= 4, then immediately continue to script and storyboard in
the same planning batch. Reject a visually impressive form when it could
advertise an unrelated product after changing only the copy.

Use this counterfactual test: hide all copy and logos. The signature frame and
main transformation should still suggest this subject or its defining action.
If they do not, return to theme evidence before storyboarding.

This is a diagnostic test, not a delivery instruction. Do not remove useful
copy, narration, or brand naming from the actual film. A complete branded video
must establish a setup, show the subject causing a transformation, deliver a
payoff, and end on an intentional product or subject lockup. The audience should
hear or read the subject name before the ending and see it in the final hold.

Map at least two pieces of theme evidence to a visible cue and a motion role.
Use subject-native visual nouns: for a studio these might be page stacks,
frames, waveforms, edit tracks, review marks, lenses, or a conductor gesture.
Generic circles, squares, glow, arrows, and color changes are supporting
grammar, not theme evidence. A primitive does not become subject-specific just
because a hidden label names it.

The mechanism should simplify production, not justify more decoration. Prefer
one large transformation with a few bold states over many tiny objects, labels,
lines, or effects. For a local video of 15 seconds or less, the directed version
should normally fit within the compact Studio composition budget: 6500 source
characters and no more than three helper components.

## Proposal Contract

For normal complete-video work, write this compact object into the Proposal:

```json
{
  "creativeMode": "directed",
  "creativeTreatmentVersion": 2,
  "creativeTreatment": {
    "thesis": "One sentence joining intended feeling to a subject-specific visual cause.",
    "narrativeSpine": {
      "setup": "The initial tension or unmet need.",
      "transformation": "What the named subject visibly does.",
      "payoff": "The completed outcome or changed state.",
      "finalLine": "The exact final brand or subject line."
    },
    "themeEvidence": ["concrete subject evidence 1", "concrete subject evidence 2"],
    "evidenceMapping": [
      {"evidence": "subject evidence 1", "visibleCue": "recognizable shape or material", "motionRole": "meaningful action"},
      {"evidence": "subject evidence 2", "visibleCue": "recognizable shape or material", "motionRole": "meaningful action"}
    ],
    "bestVisualForm": "The selected form or scene archetype.",
    "formRationale": "Why this form expresses the theme better than the alternatives.",
    "rejectedForms": ["alternative and why it is weaker", "alternative and why it is weaker"],
    "visualFit": {
      "themeSpecificity": 5,
      "recognitionSpeed": 4,
      "motionPotential": 5,
      "productionEfficiency": 4
    },
    "visualMechanism": "The recurring action or transformation that carries meaning.",
    "signatureFrame": "The strongest recognizable frame with copy hidden.",
    "rhythm": "Opening, escalation, release, and final hold in one short line.",
    "materialSystem": "Palette behavior, type character, image treatment, texture, and motion physics.",
    "contrastPlan": ["scene-to-scene contrast rule 1", "scene-to-scene contrast rule 2"],
    "antiCliches": ["specific banned shortcut 1", "specific banned shortcut 2", "specific banned shortcut 3"]
  }
}
```

Keep the entire treatment concise enough to scan in the CUI. It is a decision,
not an essay. Two concepts must differ in theme-derived visual form, not only
palette. The complete candidate comparison and treatment should stay below 220
English words or 350 Chinese characters. Generate only the selected composition.

## Handoff

- Script: pace ideas according to the treatment's rhythm. Preserve the complete
  narrative spine and name the product or subject explicitly; visual metaphor
  never replaces semantic clarity.
- Storyboard: each scene names a distinct focal composition and a meaningful
  event derived from the visual mechanism.
- Composition: use the material system consistently; do not add a generic card
  or centered-title spine when the treatment calls for another behavior.
- Audio: reinforce meaningful visual events, not every entrance.
- Review: inspect hook/body/end together. Fail a visually clean result when it
  is generic, repetitive, or unrelated to the treatment. Hide copy mentally:
  fail `themeFidelity`, `signatureFrameAchieved`, or `visualFormFit` when the
  underlying imagery does not carry the chosen theme. Set
  `visibleThemeEvidenceCount` from the contact sheet and fail when it is below
  two. Set `genericShapeRisk: true` when generic primitives carry the idea only
  because labels or narration explain them.
  Also fail `subjectNamed`, `storyArcComplete`, `endingResolves`, or
  `audioSupportsStory` when the result is a visual study rather than a complete
  film.

## A/B Review

For controlled comparisons, keep subject, script, assets, duration, aspect, and
render settings identical. Change only `creativeMode`. Score both versions 1-5:

- first-frame recognition;
- scene distinctness;
- subject specificity;
- motion carrying meaning;
- slideshow/PPT risk, reverse scored.

Prefer the directed version only when the contact sheet and final MP4 show a
visible improvement. The existence of a treatment is not evidence by itself.

## Timing Every Test

Every sample, A/B variant, and revision round must be timed. Record the CLI
run ID and wall-clock start before execution. Report cumulative seconds for:

- audio/assets ready, when applicable;
- planning artifacts complete;
- first valid composition;
- first and final contact sheet;
- export queued and MP4 actually ready;
- Agent response complete and Studio Delivery complete.

Also report composition source characters, revision count, preview count, and
export count. Distinguish model/tool time from asynchronous export queue and
render time. Never claim a speed improvement from fewer steps or shorter code
alone. Compare the same milestone against the previous controlled run. A test
without timing evidence is incomplete.
