# Internal Makaron workflows through chat

Use this reference when the user wants Makaron's internal Agent to run a named
production workflow. `makaron chat` owns planning, tools and the persistent
project; direct `video create` / atomic MCP calls execute individual operations.
Reading a guide through plugin `makaron_craft` lets the external host execute it;
it does not start Makaron's internal Agent.

## Discover and select

```bash
makaron skills list --built-in --json
makaron skills search "long video" --built-in --json
makaron skills show long-video-director --built-in --json
makaron skills show video-edit --built-in --json
makaron skills show explainer-video --built-in --json
```

Use the live returned `name`, description and input requirements. `skills show`
reads a summary, not the complete SKILL.md or execution history. Built-in Skills
are server-owned and need no marketplace installation. Marketplace discovery is
the same command without `--built-in`. A missing workflow needs an availability
check, not a guessed slug or a substitute paid generation.

| Intent | Selection | Required production evidence |
| --- | --- | --- |
| Multi-part generated narrative with consistent people/scenes | `long-video-director` | Story/asset plan; reviewed character/scene/prop anchors as required; segment/seam plan; Director Beat Board; reviewed per-segment storyboard images; scripts and actual submitted anchor/storyboard references; generated segments and joined-result QA |
| Recreate an exact reference's shot order, timing, framing, camera/action and beats with replacement content | `video-edit`, explicitly request its **replication** profile | Exact reference and replacement roles; full-clip evidence; Shot Blueprint; preserve/change contract; appropriate reference submission; measured structure/identity/audio comparison and final QA |
| Explain a topic/product/process with requested narration/text | `explainer-video` | Chosen visual carrier and plan; generated audiovisual scenes or authored diagrams/source assembly; relevant visual/audio QA; final video; editable composition/preview/export when that route is requested or selected |

For loose reference inspiration use the discovered `reference-video-studio`
instead of demanding structural replication. An explainer label or duration alone
does not force Remotion. For provider-generated video, take single-call duration
and reference limits from current capabilities, not an old fixed 15-second rule.
Supporting anchor/storyboard Skills are dependencies; select the director as the
entrypoint rather than submitting independent helper runs.

## Start the complete authorized workflow

Use one project for the conversation. Supply the full user brief, exact source
roles, duration/aspect/language/sound, final deliverable, budget/retry ceiling and
the review authority the user actually granted. Examples below show invocation
shape; fill the brief with the user's requirements and authorization.

```bash
makaron chat --project auto --image person.jpg --skill long-video-director \
  --json -b "<complete narrative brief, production/review authority and final MP4 requirements>"
makaron chat --project auto --video reference.mp4 --image replacement.jpg \
  --skill video-edit --json -b "<recreate this reference using the replication profile; preserve/change roles, brief and QA priorities>"
makaron chat --project auto --skill explainer-video \
  --json -b "<topic, audience, language, duration, sound and final deliverables>"
```

`--skill` inserts `[Active skill: <resolved-name>]` before the brief sent to the
internal Agent, whose contract is to read `skills/<name>/SKILL.md` first and
follow its required dependencies. Mentioning a name without selecting it is only natural-language
guidance. Selecting a Skill requests its workflow; it is not a deterministic
proof that all stages ran. Preserve returned `projectId`, `runId` and project URL.
For a follow-up use that `--project <projectId>` and repeat `--skill` when helpful.
Poll/recover an active run before sending another message; new input may append
to or interrupt active work depending on the deployed runtime.

When the user grants autonomous review, carry that authority explicitly, e.g.
"Execute the complete selected Skill, including its production stages and visual
reviews. You may approve intermediate gates on my behalf within <authorized
budget/retry ceiling>; continue to <deliverable> without asking at every gate.
Record review evidence and stop for scope/budget changes or a real blocker."
Use this only when authorized. Delegated approval removes repeated confirmation,
not anchors, beat boards, storyboard production, reference binding or QA.

## Verify execution and delivery

```bash
makaron responses get <runId> --wait --json
makaron project media <projectId> --json
makaron usage --run <runId> --json
# Only if an animated composition still needs the requested MP4:
makaron responses get <runId> --materialize --wait --pick first_video_url
```

Keep polling the same run while incomplete; follow `next_poll_after_ms`. A
timeout, terminal planning response, or completed provider task alone does not
establish complete-workflow delivery. Inspect the actual plans/review evidence,
project assets and final media. Usage proves calls/charges, not visual quality
or exactly which references reached the provider. If these surfaces do not expose
the plans or submission references, report that evidence gap; ask the same
project for a production audit, not a new paid rendering of missing stages.

For the long-video storyboard route, supplied portraits alone are not evidence
of completed anchors/boards. Check the generated/reused assets and their visual
reviews, and each segment's actual reference binding. Play segment joins and the
full film, with audio. For replication compare the final result with the reference
against the Blueprint. For explainers check visual clarity, timing and the
requested speech/text/audio; inspect composition previews before export when
applicable. Download and verify a playable final file before declaring delivery.
Distinguish selected, loaded, produced, reviewed, submitted and delivered.

Any new paid repair or retry must stay inside existing authorization. Reuse
successful assets/tasks and preserve the original project and source roles.
