# Multi-angle Skill: director review and four H3 tests

Candidate: `codex/multi-angle-video`, based on `373ac826`. Local application:
127.0.0.1:3048. No merge or production deployment. This iteration improves the
selected product Skill, then tests the same four existing 15s excerpts through
Makaron CLI Chat. It does **not** establish that automatic output beats the
human-directed versions, and the batch remains creatively unaccepted.

## Changes used in the paid tests

The Skill asks Chat to interpret the main semantic/action turn, create two
substantively different coverage sequences, compare/revise them, and save actual
rejected choices before generating. It directs observable composition rather
than lens adjectives, readable body/object relations for demonstrations, stable
cameras unless motion reveals information, and source-grounded ending states.
Shot timing/JSON validity is explicitly separate from creative acceptance.
Native QA compares planned and observed attention, cuts and central-beat timing.

All planning and submitted creative prompts came from Chat with
`multi-angle-video` selected. No human rewrote shot lists/prompts or submitted a
direct video-create call. Two options cost no second video generation. Each take
used exactly one successful paid FAL H3 Max 768p, 15s task. Account Agent routing
remained automatic Codex Luna. There was no Seedance or paid quality retry.

Source `analyze_video` was attempted but the local Google geography restriction
persisted. Chat used source ASR and decoded frames and recorded the limitation.
The exact tested Skill copy and SHA256 are in the evidence root, distinct from
the final, subsequently refined candidate.

## Runs and charges

| Take | Source/excerpt | Project | Successful generation run | Native task |
| --- | --- | --- | --- | --- |
| Courtyard | influencer_seo/2104983795854434684; 0–15s | 62cb6b23-989f-48a3-9b6b-2fe936f7d4de | f073e3f7-c397-4dfa-b09a-74b637ee2394 | fal-h3max-reference-01a0f5a7-ba03-7a33-b6a5-08ae7c8d7a1d |
| Product | jasonugc/2105203608010756379; 14.20–29.20s | 0bdc53d0-88aa-4146-a8b4-5c810a639a61 | 737c9ff2-b219-4a29-9bdd-1e1ae62fc56b | fal-h3max-reference-01a0f5a8-f60a-7b81-866e-a8bc0787f452 |
| Solo golf | KraftyGolf_/2093005980002869343; 0–15s | 12614daf-187d-4451-b10b-c104e8d98dbf | 5739e96d-5c90-4493-b6ca-eec4d09a6d96 | fal-h3max-reference-01a0f595-518f-7152-9ced-5d324c8f98b7 |
| Coaching | arya_stark47/2079935187123650593; 30–45s | 6631f0a8-f6c1-413b-991a-a7455102c0f0 | 5f783c33-de29-4e85-8bd0-6c49b51edd8e | fal-h3max-reference-01a0f5a0-e2e4-7321-b375-15e0232149cd |

The live account usage ledger records four `create_video` charges of 676 each:
**2,704 credits**. No additional charged video task resulted from transport
recovery. This is the observed total for these four experiment projects, not a
general price quotation.

Local CDN/Supabase read failures caused preflight failures, interrupted Agent
runs and failed/empty Media Index reads in QA. Technical follow-ups reused
persisted creative plans/prompts and existing native tasks. After local server
restarts, two stale leases were expired with scoped compare-and-set guards only
on these owned experiment runs. Receipts preserve the previous lease states.
Thus creative planning/submission was autonomous, but the execution was **not**
four uninterrupted, intervention-free requests.

A temporary local fetch wrapper routed only `cdn.makaron.app` requests to its
verified same Supabase origin. Public URLs, provider/app configuration and source
bytes were unchanged. No transport helper was committed. Production origin/CLI
readbacks were used where necessary; this is still a local candidate test.

## Observed quality and failed acceptance

| Take | Observed improvement | Remaining failure/uncertainty |
| --- | --- | --- |
| Courtyard | Readable face, table/keyboard, cup, courtyard and apple coverage; native speech windows approximately align with source, improving the prior early second utterance | Dense paired 11–15s source/native samples show no corresponding airborne apple during the source toss around 12.4–12.6s. Similar final bite/held-object states do not certify the intervening action. Fails action fidelity. |
| Product | More natural one-hand testimonial delivery than the previous two-hand presentation pose | Predominantly similar medium/tighter portraits; weak product insert/perspective contrast. Native speech opening/sequence/repetition problems. Fails creative diversity and sound fidelity. |
| Solo golf | More coherent body/shaft emphasis and source-caption meaning; opening/closing swing visible | Matching before/after side coverage is weak. Performer rotation is not proof of a new camera axis. Motion continuity remains unverified; no established superiority to the manual version. Source is music/captions, not instructional speech. |
| Coaching | Lower body/ball view explores the lesson's spatial relation | Tight crop hides the chest/ball relation; visible picture-in-picture in the later portion violates full-frame multi-angle coverage. Chat QA caught these issues. Fails creative acceptance. |

These paired observations support specific findings, not a causal score for
each new prompt rule. Two alternatives and a self-review document alone do not
ensure stronger actual H3 cinematography. ASR similarity and sparse matching
poses cannot certify continuous mouth/action timing. Original sound replacement
does not repair or conceal native performance failure.

## Refinements after viewing these outputs

The final candidate now requires at least one strongly contrasted,
source-supported coverage option; explicit `compositionDelta` for the central
beat/inserts; no automatic rejection of motivated detail just because the source
is a presenter portrait; and review that the final submitted prompt retains the
observable composition. Generated shots must be one full-frame perspective,
without PIP, inset, split or collage unless the user explicitly wants that film
format. Separate review grids remain allowed.

Native QA now explicitly compares consequential same-clock states in fast action
chains; a matching final pose cannot pass a missed release/airborne/catch state.
**These final refinements have not been tested with another paid generation.**
They address observed failures but must not be described as validated fixes.

## Deliverables and verification

Evidence root:
`/Users/tianyicai/Documents/Codex/2026-10-01/multi-angle-h3-director-v2/`.
Each take folder includes source/native videos, exact requests/events and
initial plans/prompts, generation identities, Chat QA/final comparisons, probes,
decoded frame evidence, four-panel report and publication receipts.

The four-panel files are `<take>/four-panel-director-v2-15s.mp4`. Layout:
top-left source, top-right human-intervention H3, bottom-left first selected-Skill
Chat H3, bottom-right this director-review selected-Skill Chat H3. New native
picture is used unchanged apart from trimming its provider tail; PIP/other
failures are retained. Grids are local presentation assembly, not Skill-generated
creative edits. Common original AAC sound is packet-identical to each source,
verified by MD5. Shared sound does not certify lip synchronization.

All four grids and Chat comparisons decode fully, have 360 frames at 24fps and
15.000s duration. Native outputs have 362 frames and 15.104s container duration.
Grid previews were inspected; courtyard is 960×632, the others 960×1800. Chat
comparisons re-encode AAC for three speaking takes; golf retains packet-identical
AAC. They remain explicitly unverified comparisons, not accepted restorations.

Grids were uploaded and appended to their respective project timelines. Public
CDN HEAD checks timed out locally; HEAD checks against the verified same storage
origin returned 200 with content lengths matching the local files for all four.
Local playable files are available independently of that CDN transport issue.
Golf's final CLI result omitted its output URL, but project Media Index confirmed
the published comparison, which was downloaded and fully decoded.

Validation: Skill frontmatter/JSON example, startup manifest checks, video
reference workflow contract, contiguous initial plan clocks, diff whitespace,
full media decoding/probes and audio packet comparison. No UI acceptance or
production launch is claimed. The next creative acceptance must use selected
Chat Skill outputs from the final candidate, with the remaining failures checked
against the source clock and manual comparator.
