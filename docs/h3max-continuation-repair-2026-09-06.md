# H3 Max continuation environment repair

The local editor selected `fal-h3-max`, but an interrupted durable execution could be claimed by an older production worker through the shared database. That worker did not have the Max adapter; its error caused the Agent to submit with Seedance Fast instead. Changing the default again would not repair this execution path.

## Change

- New durable runs record their owning request origin. Initial execution, explicit continuation and cron recovery verify that origin before changing or claiming a run.
- Atomic database claiming applies the same ownership rule. The original RPC signature remains available to old deployments, but cannot claim newly pinned local or Preview jobs.
- Production aliases are equivalent. Untagged pre-migration jobs keep the legacy database recovery behavior.
- Attempt metadata records execution origin and worker/deployment identifiers for future diagnosis.

Code commit: `abe60470`, fast-forwarded into local `dev`. Migration `20260905190237_isolate_agent_execution_origins.sql` was applied to the shared database and recorded in migration history. The localhost:3000 dev process was restarted with this code. No production application deployment or new Preview deployment was made for this repair.

## Validation

- 38 isolated database checks using the real migration SQL: reproduced the previous cross-origin claim, rejected old and foreign claims without changing the row, accepted the owning worker, preserved lease/legacy behavior, and checked authenticated tenant isolation.
- 60 tests across five relevant suites passed; TypeScript, lint/i18n/contracts, production webpack build and diff whitespace checks passed.
- A real `/api/agent/run` request created the `executionOwnerOrigin: http://localhost:3000` marker.
- The live cron candidate query parsed successfully and selected the local fixture.
- Live old-RPC and production-origin claim attempts returned no rows and did not increment the fixture's attempt count or acquire a lease.

## Real continuation acceptance

Test project: `1fb41c50-5366-4db6-84c8-db49dc7fa867`. The uploaded source was a previously accepted bookstore video. The request changes the red book to blue using the normal default video model; no model override was supplied in the execution request.

This test uses a controlled interrupted first-attempt record with no prior provider side effect, followed by the actual local execution endpoint and a paid provider request in attempt 2. It does not recreate a five-minute network timeout. The first script-writing continuation completed on the correct origin and asked for the normal product confirmation; the subsequent confirmed-render continuation is run `7b8de5a8-03f8-4b42-a268-9bd111145d16`.

The confirmed-render continuation completed in attempt 2 on `http://localhost:3000`. It produced one completed `generate_animation` operation with task `fal-h3max-reference-01a07301-4837-7720-bce3-f1648938aea9`, using `fal-h3-max`, `minimax/h3-max/reference-to-video`, 768p. There was no Seedance submission or missing-adapter error. One matching `create_video` usage entry charged 219 credits, including the reference-video input cost.

Result snapshot `28e39379-c3eb-4fa3-a453-8e16e748fde2` completed and persisted at:
https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/1fb41c50-5366-4db6-84c8-db49dc7fa867/videos/28e39379-c3eb-4fa3-a453-8e16e748fde2.mp4

Source and output both decode completely with FFmpeg: 5.184 seconds, 1344×768 H.264 video and AAC audio. Five sampled frames from each were inspected: the red book becomes blue, with the person, bookstore composition and book retrieval/opening motion retained. This verifies media decoding and sampled visual output, not a frame-exact preservation guarantee or in-page browser playback.

Evidence is retained locally under ignored `artifacts/h3max-dev-merge/origin-live/`; raw prompts, account logs and credentials are not published.
