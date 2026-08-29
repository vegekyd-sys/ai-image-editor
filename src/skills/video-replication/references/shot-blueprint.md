# Shot Blueprint / Video DNA Contract

`shot-blueprint.json` is the P0 machine-readable skeleton between analysis,
asset mapping/generation, Remotion construction, and QA. It is evidence, not a
creative brief. Keep seconds as decimals in reference time; convert to frames
only after the output FPS is locked.

The companion JSON Schema is
`skills/video-replication/references/shot-blueprint.schema.json`.
The offline prototype also rejects inconsistent shot/boundary counts, order,
non-contiguous coverage, duration math, duration-curve length, and an uncovered
ending. Composition/camera/text/audio/style fields are still a P0 skeleton: keep
them `null` until a typed extractor or model review supplies evidence.

## Required P0 Shape

```json
{
  "schema_version": "0.1.0",
  "reference": {
    "source_name": "reference.mp4",
    "duration_sec": 15,
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "video_codec": "h264",
    "audio": { "present": false, "codec": null, "sample_rate": null }
  },
  "analysis": {
    "boundary_method": "adaptive_scene_plus_black",
    "asr_status": "not_run",
    "beat_status": "not_run",
    "model_review_status": "required",
    "unresolved_boundary_candidates": [],
    "warnings": []
  },
  "global_dna": {
    "aspect_ratio": "9:16",
    "shot_duration_curve_sec": [5.02, 5.5, 4.48],
    "cut_rate_per_min": 8,
    "style": null,
    "audio_arc": null
  },
  "boundaries": [
    {
      "time_sec": 5.02,
      "kind": "fade_or_black",
      "confidence": 0.7,
      "evidence": [{ "method": "blackdetect", "time_sec": 5.02 }]
    }
  ],
  "shots": [
    {
      "id": "shot-001",
      "order": 1,
      "source_range": { "start_sec": 0, "end_sec": 5.02 },
      "duration_sec": 5.02,
      "narrative_role": null,
      "subject_action": null,
      "composition": null,
      "camera_motion": null,
      "transition_in": null,
      "transition_out": null,
      "text_layers": [],
      "audio": null,
      "style": null,
      "preserve": ["duration", "order"],
      "replace": ["subject", "brand", "copy"],
      "confidence": 0.5,
      "needs_model_review": true
    }
  ],
  "route": null,
  "qa_targets": null
}
```

## Evidence Ownership

Deterministic tools own numeric/file facts: stream metadata, source ranges,
candidate cut/fade timestamps, decoded frames, ASR word times, waveform/onset
times, output duration, and MP4 decode. A model may correct a boundary only by
adding its frame/time evidence; it must not silently replace measured data.

The multimodal model owns semantic labels: narrative role, subject/action,
shot size, camera intent, composition anchors, transition interpretation,
visible text/style, and which grammar is transferable. Mark unknown fields
`null`; do not fabricate them to satisfy the schema.

## Route Contract

The Studio Run Proposal owns the route decision. If `route` is populated in the
Blueprint, treat it as a read-only projection with the Proposal artifact path,
not a second source of truth. Proposal contains:

- `strategy`: `A`, `B`, or `C`.
- `shot_routes`: one entry per shot with `source_recut`, `generated`, or
  `hybrid_overlay`, plus the exact source/generation artifact.
- `provider_contract`: model/version, operation, duration/reference limits,
  resolution, audio behavior, and the date checked.
- `cost_gate`: currency, estimated total, approved cap, attempt count, and
  whether more approval is required.

The editable composition must use the Blueprint's source ranges and one locked
FPS. Keep provider task IDs and workspace artifact paths in the Studio Run
Assets artifact so the Blueprint remains portable and comparable.

## Resume State

Use the existing `${projectId}/studio-runs/${studioRunId}/run.json` and its eight
stages as the only resume state. Brief points to this supplemental Blueprint;
Proposal owns route/budget; Storyboard owns confirmed shots; Assets own the map
and provider task IDs; Composition owns the design path and pre-materialization
QA. A resumed run validates reference metadata, Blueprint version, assets, and
task IDs, then follows Studio Run approval/invalidation. Do not create a second
stage machine.
