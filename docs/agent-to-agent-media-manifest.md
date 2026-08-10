# Agent-to-Agent Media Manifest

Makaron accepts one provider-neutral source-range manifest per creative task.
The upstream orchestrator owns retrieval, multi-plan allocation, concurrency,
and result aggregation. Makaron owns the editable Media List, creative Agent,
voiceover, composition, and final delivery.

## Responsibility boundary

```text
User brief
  -> Orchestrator retrieves and plans N source sets
  -> Orchestrator writes N Makaron media manifests
  -> Orchestrator starts N independent Makaron chat tasks
  -> Makaron returns N project/run URLs and final artifacts
  -> Orchestrator aggregates the result cards
```

Makaron deliberately does not install or authenticate an upstream retrieval
CLI in its default Runtime. A separately installed skill may still combine the
two products for standalone use, but it is not required by this contract.

## Manifest contract

```json
{
  "title": "How rackets are made · English",
  "source_ranges": [
    {
      "source_url": "https://media.example.com/original.mp4",
      "start_sec": 10.25,
      "end_sec": 16.75,
      "source_uri": "dam://project/asset",
      "project_id": "upstream-project",
      "asset_id": "upstream-asset",
      "file_name": "molding.mov",
      "description": "A worker removes a carbon racket frame from its mold. Editorial purpose: opening reveal."
    }
  ]
}
```

Each task accepts 1-20 ranges. `source_url`, `start_sec`, and `end_sec` are
required. Existing understanding belongs in `description`; durable provider
identity belongs in `source_uri` or `project_id + asset_id`.

## Atomic CLI flow

```bash
makaron chat --project auto \
  --media-manifest set-01.json \
  --json -b \
  "Make a 30-second 9:16 TikTok with English VO and burned-in captions"
```

The command validates first, then performs:

1. create one Makaron project;
2. publish every source range to its Media List;
3. mark the imported ranges as current-turn video media;
4. submit one Agent run;
5. return the project, run, and imported Media List refs as JSON.

If retrieval returns five plans, the orchestrator repeats this command five
times, preferably concurrently. It does not flatten all plans into one Makaron
project or require Makaron to understand the retrieval provider's batch schema.

## Delivery requirements

External URLs should remain valid for the full render window and support video
seeking or HTTP byte ranges. Browser preview also needs compatible CORS, or the
deployment must provide an authorized proxy. Makaron keeps bounded FFmpeg
materialization as a fallback for explicit Node media work; it is not the
normal transfer path.
