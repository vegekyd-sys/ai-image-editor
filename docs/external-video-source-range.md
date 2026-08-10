# External Video Source Range Protocol

Makaron can represent an externally hosted video interval in a project's Media
List without uploading the original video or a derivative clip.

## Canonical payload

```json
{
  "source_url": "https://cdn.example.com/source.mp4",
  "start": 12.5,
  "end": 19,
  "description": "Racket frame molding under warm factory lighting.\nEditorial purpose: opening manufacturing beat.\nEvidence: worker positions the frame in the mold | close-up shows resin around the rim.\nBoundary confidence: high"
}
```

Required fields:

- `source_url`: an HTTP(S) video URL reachable by browser preview and render
  runtimes;
- `start`: inclusive start in the original source timebase, in seconds, `>= 0`;
- `end`: exclusive end in the original source timebase, in seconds, `> start`;
- `description`: existing useful understanding of this exact interval.

Those are the only four public fields. `source_url` is an opaque, stable media
capability and is the complete source identity at this boundary. Do not add
provider-specific ids and do not parse the URL path. Republishing the same URL
and exact range updates its description instead of creating a duplicate Media
List item.

`description` is the existing, provider-neutral Media List understanding field.
When an upstream service already understands the media, put its summary,
editorial purpose, concrete scene evidence, confidence, and limitations into
this field. It is intentionally not a Scene-specific schema. Makaron gives the
full description to the Agent, which should use covered facts directly and call
`analyze_image` or `analyze_video` only for missing, uncertain, or
request-critical details. Republishing the same durable range also refreshes
its description, so better upstream understanding is not discarded.

## Publish APIs

HTTP:

```text
POST /api/projects/:projectId/media
Authorization: Bearer <Makaron API key>
Content-Type: application/json

{"clips": [<canonical payload>, ...]}
```

CLI:

```bash
makaron project media add <projectId> \
  --source-url "https://cdn.example.com/source.mp4" \
  --start 12.5 --end 19 \
  --description "Racket frame molding"
```

## Atomic agent-to-agent handoff

An upstream orchestrator can create a Makaron project, publish one source plan,
and start the creative Agent with one CLI call:

```json
{
  "title": "Racket Process · Japanese",
  "clips": [
    {
      "source_url": "https://cdn.example.com/source-a.mp4",
      "start": 3.5,
      "end": 9,
      "description": "Carbon frame molding close-up. Editorial purpose: opening beat."
    }
  ]
}
```

```bash
makaron chat --project auto \
  --media-manifest set-01.json \
  --json -b \
  "Make a 30-second 9:16 TikTok with Japanese VO and burned-in captions"
```

The CLI validates the complete manifest before creating a project, creates the
project, publishes every range through the ordinary Media List API, marks the
published videos as this turn's media, and then starts one Agent run. Its JSON
response includes `projectId`, `projectUrl`, `runId`, and `importedMedia` refs.

Multi-plan retrieval stays outside Makaron. The orchestrator converts each
upstream plan into one provider-neutral manifest and starts one Makaron task per
plan. Makaron does not parse an upstream provider's batch or multi-set schema.

Agent, in the current project and session (`rangeA` and `rangeB` use the same
four public fields):

```js
write_file({sourceRanges: [rangeA, rangeB]})
```

Each path returns a 1-based reference such as `<<<media_4>>>`. The reference is
available immediately to subsequent Agent tools in the same session.

## Runtime semantics

- Media List duration is `end - start` (stored internally in the existing
  source-range representation).
- Native preview seeks to `start`, reports a zero-based range time, and stops at
  `end`.
- Remotion resolves the marker to `source_url`, with trim frames derived from
  the public `start` and `end` seconds.
- `preview_frame` accepts a zero-based time inside the Media List item and adds
  the range start before extracting from the original source.
- Video analysis is restricted to the bounded source interval.
- ASR and explicit Node/FFmpeg work create only an ephemeral range-bounded
  runtime input. That runtime file is not published unless the user explicitly
  asks for a standalone derivative.

The protocol is stored inside the existing snapshot `video_meta` JSON, so it
does not require a database migration.
