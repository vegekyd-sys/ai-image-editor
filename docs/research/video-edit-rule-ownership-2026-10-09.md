# Video edit rule ownership after local-edit consolidation

Local editing supplements existing video editing. This change removes conflicting
instructions and duplicated context; it does not replace the original generation,
composition, audio, continuation or assembly implementations.

| Owner | Responsibility |
| --- | --- |
| prompts/agent.md | Route user intent and source scope; execution authorization and completion standard |
| skills/video-edit/SKILL.md | One workflow entry for supplied videos; bounded versus full-source work; comparisons and corrections |
| skills/video-edit/references/frame-location.md | Unknown screenshot location only, including verification and low-confidence fallback |
| inspect_retake description | Frame/audio evidence reading contract |
| retake_video description and schema | Parameters, modify/replace, audio, supported controls and scene-neutral prompt craft |
| inspection result | Actual evidence, signed receipt and measured clocks; no repeated craft/reading guide |
| video-retake*.ts | Validation, provider preparation, durable jobs and deterministic delivery |

The retired video-segment-edit entry is hidden from normal Skill discovery and
selection. Its short redirect preserves historical explicit launches without
retaining the old screenshot→patch→manual-merge workflow. Multi-angle-video is
for whole takes; bounded coverage delegates to video-edit.

Replication profile wording, protocols and reference files are outside this
acceptance scope and remain unchanged. This cleanup only routes bounded local
edits away from unrelated guides and checks that whole-video editing remains
available. New-generation script confirmation does not become a confirmation
gate for authorized source edits.

MCP expansion is intentionally outside this cleanup, per the user's instruction.
Legacy boundary_mode remains a backend compatibility field, not a new workflow.

## Verification

- Full suite: 2327 passed, 1 skipped; 343 files passed, 1 skipped.
- Core prompt ownership: 54 paragraphs, 12 protected creative files, real bundled
  read_file paths checked. Historical rollback documents remain frozen.
- Skill startup manifest and TypeScript passed.
- New Makaron Chat CLI projects: whole-character replacement, bounded multiview,
  shot replacement, generated speech and visual layers. Results and failed
  attempts are retained separately in the local acceptance report:
  http://localhost:3046/rule-cleanup/ . Generation is not a semantic pass.
- Unsupported native controls return a repair retaining model/edit intent.
  Multiple planned phases must also appear in the actual provider prompt; a
  validated shot_plan does not itself reach the provider. Both gates reject
  before paid submission and retain scene-neutral instructions.

## Efficiency measurements

Core agent.md before cleanup: 13,567 characters. The new core is 8,781 characters (about 35% fewer).
The video-segment-edit guide was 12,766 characters; it is now a 446-character
compatibility redirect and is absent from the startup manifest. Actual unknown-
frame localization guidance is loaded only when needed. Local inspection no
longer returns another copy of both complete evidence-reading and prompt-writing
guides. These are context-size reductions, not measured first-token guarantees.

## Actual outcome boundary

Whole-source character replacement, bounded camera coverage and whole-shot
replacement delivered visible changes through their respective tools in fresh
CLI projects. The retained soundtrack matches the source (AAC packets for
skate samples; decoded PCM for the layering sample).

Visual layering remains **not accepted**: the second run correctly kept Eco and
modify without intermediate images or a model swap, but still mainly stacked
complete images. Generated-speech attempts also have failed versions (speaking
before turning, unwanted captions); they are retained in the report rather than
reported as successful. Parameter and timing gates improve execution contracts,
but do not guarantee provider semantic compliance. This work is local only; it
has not been merged into dev or deployed.
