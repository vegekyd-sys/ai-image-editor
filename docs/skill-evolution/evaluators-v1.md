# Evaluators v1

All evaluators produce `pass`, `fail`, or `inconclusive`. Missing evidence is
`inconclusive`. Aesthetic scores never convert a failed hard gate into success.

## Shared evidence bundle

- Agent Run, project, Skill version, evaluator version
- final artifact ID and kind
- provider/model and renderer revision
- requested and delivered duration/aspect/resolution
- tool failures, repair turns, elapsed time, and cost
- bounded media-probe results and evidence timestamps/frame numbers
- explicit human feedback when available

Do not persist raw prompts, transcripts, media bytes, signed URLs, or customer
names in the evaluation tables.

## Animate

Hard gates:

- a final artifact exists;
- the final file fully decodes;
- delivered duration is complete and within the chosen model contract.

Scored dimensions:

- visual quality (30%)
- prompt fidelity (25%)
- motion coherence and temporal consistency (25%)
- narrative clarity (20%)

Segment model/provider failures separately. The Skill is a plausible cause when
scripts repeatedly misstate duration, fragment a valid direct generation,
misuse media references, or fail the user's intended action across providers.

## TikTok Video

Hard gates:

- all shared final-artifact gates;
- delivery resolution/aspect matches the locked platform brief;
- visible text stays inside the platform-safe layout;
- loudness/true peak meet the chosen delivery contract;
- when speech is present, captions follow measured audio timing.

Scored dimensions:

- platform fit and native packaging (25%)
- first-beat hook strength (20%)
- caption readability, hierarchy, and concept ownership (20%)
- audio/visual/caption cohesion (20%)
- visual quality (15%)

Caption timing data is shared infrastructure; font, layout, animation, and visual
language remain composition-owned. Do not optimize toward a single universal
caption style.

## Talking Head

Hard gates:

- all shared final-artifact gates;
- audio continuity with no unintended cut or silence;
- speech captions align to audio-only ASR word timing;
- no unintended repeated/frozen source frames;
- no cue, media range, or sequence ends after composition duration.

Scored dimensions:

- editorial judgment: cuts, B-roll, emphasis, and retained meaning (25%)
- narrative clarity (20%)
- caption readability and emphasis (20%)
- audio/visual/caption cohesion (20%)
- visual quality (15%)

For long inputs, one Edit Plan and stable word IDs must drive rough cut, B-roll,
highlights, and captions. A beautiful output with lost words, truncation, or
subtitle drift is a failure.

## Behavioral signals

Behavioral signals are supporting labels, not truth:

- positive: save/share/export, explicit approval, continued work from result;
- negative: explicit rejection, immediate regeneration, revert to prior artifact,
  abandonment after viewing;
- ambiguous: app close, timeout, provider failure, no subsequent action.

Repeated repair turns matter only after ownership is classified. Harness,
provider, media, and Skill fingerprints must have separate clusters.
