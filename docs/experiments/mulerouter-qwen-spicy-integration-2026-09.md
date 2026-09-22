# MuleRouter Qwen Image Edit Spicy integration

Status: production integration in progress. The original 2026-09-01 experiment
was rebased onto current `dev` on 2026-09-22.

## Product boundary

- The product adds an independent `qwen-spicy` model. It does not replace or
  reconfigure the existing `qwen` backend.
- `qwen-spicy` sends 1-3 image edits to `carrothub/qwen-image-edit-spicy`.
- Its text-to-image compatibility uses `carrothub/z-image-spicy` internally.
- Existing ComfyUI/Vast Qwen routing remains unchanged.
- The current Spicy contract accepts one primary image plus up to two ordered
  `reference_images`, matching Makaron's three-image product cap.
- Camera rotation remains on the existing Qwen Multiple-Angles LoRA path. It is
  not part of the Spicy API contract.

## Environment

```text
MULEROUTER_API_KEY=...
MULEROUTER_IMAGE_TIMEOUT_MS=300000       # optional
MULEROUTER_IMAGE_POLL_INTERVAL_MS=2000   # optional
MULEROUTER_IMAGE_DELETE_TASKS=false      # optional; defaults to cleanup after download
MULEROUTER_Z_IMAGE_PROMPT_EXTEND=true    # optional; defaults false
```

The shared MuleRouter key also serves the existing Wan 3.0 integration. Do not
commit the key.

## Cost and acceptance boundary

The live 2026-09-22 official documentation lists `$0.040` for one input image,
`$0.043` for two, and `$0.046` for three. The earlier `$0.034` sales-sheet price
is stale. The Z-Image prompt-extension call is separate, so Makaron leaves it
off by default. `credit_pricing.edit_image_qwen` must cover the current provider
cost plus Makaron markup before traffic is switched.

An API task reaching `completed` is not sufficient acceptance. Compare against
the current Qwen backend using frozen source images and prompts, then inspect:

1. requested edit visibility and prompt adherence;
2. face/identity, composition, text, and untouched-region preservation;
3. decoded dimensions, container integrity, and output size;
4. end-to-end P50/P95 latency and failure rate;
5. NSFW acceptance on policy-approved test media;
6. single-image, text-to-image, multi-reference, and camera capability gaps.

Official contracts:

- https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/qwen-image-edit-spicy/generation
- https://www.mulerouter.ai/docs/api-reference/endpoint/carrothub/z-image-spicy/generation

## 2026-09-01 observed local evidence

All calls used the same local MuleRouter credential already configured for the
Wan integration. No Vercel environment or production route was changed.

| Case | Spicy | Existing Qwen | Observation |
|---|---:|---:|---|
| Portrait enhance, 640x600 | 13.67s, 640x600 PNG | 8.22s, 640x600 JPEG | Both made the requested golden-hour edit and broadly preserved identity. Spicy was visibly good, but still changed skin tone and generated facial detail. |
| Local wand-color edit, 1376x768 source | 15.19s, 1376x768 PNG | 9.18s, 1024x568 JPEG | Spicy preserved source resolution and text better. Neither obeyed the strict local-only edit: both changed multiple wands/character details; current Qwen damaged more text and removed the back-view star. |
| Text-to-image compatibility, 16:9 | 13.71s, 1536x864 PNG | not rerun | Z-Image Spicy produced a decoded, prompt-matching product image through the Qwen backend. |

Local visual evidence (ignored artifacts, not release assets):

- `artifacts/mulerouter-qwen-spicy/portrait-ab.jpg`
- `artifacts/mulerouter-qwen-spicy/local-edit-ab.jpg`
- `artifacts/mulerouter-qwen-spicy/text-to-image.png`

Original 2026-09-01 verdict: the provider integration was technically viable and the first
visual evidence is competitive, especially for resolution and text retention.
Spicy was about 1.6x slower in both frozen edits and does not replace the
camera-rotation LoRA. The earlier multi-image gap has since closed in the live
API. A fresh Enhance benchmark on frozen Makaron Tips inputs is recorded below
before routing promotion.

## 2026-09-22 independent-model integration and Enhance A/B

The release direction changed from backend replacement to a separate model:

- New public model id: `qwen-spicy`.
- Existing `qwen` remains self-hosted and unchanged, including rotation/LoRA.
- Spicy is selectable in the product, Agent tool, MCP, and CLI.
- One primary plus two ordered reference images are supported.
- Fixed product billing is `8 credits`; live supplier prices are `$0.040`,
  `$0.043`, and `$0.046` for one, two, and three images.

Enhance A/B used five frozen Makaron source photos and frozen prompts from the
2026-09-04 Tips factorial run. No Tips text was regenerated. The first runner
phase exposed a local Cloudflare Gateway CA mismatch on the MuleRouter asset
host; those affected paid prompts were never resubmitted. Six different second
prompts were added as replacements. The fixed runner then delivered Spicy
`10/10`; there were nine prompt/source pairs where both models succeeded.

| Model | Successful outputs | Mean | P50 | P95 | Mean provider cost |
|---|---:|---:|---:|---:|---:|
| Qwen Image Edit Spicy | 10 | 18.20s | 17.53s | 22.96s | `$0.04000` |
| Nano Banana 2 Lite | 13 | 14.99s | 14.79s | 20.85s | `$0.03696` |

Blind visual review of the nine paired successes was close: Spicy won `5/9`,
Lite won `4/9`. Spicy was somewhat better at retaining indoor scene structure,
skin color, and high-resolution detail. Lite was more reliable for explicit
background-person/object cleanup and strong requested bokeh. Spicy was about
22% slower at the mean and about 8% more expensive in this run.

Decision: ship Spicy as an independent model, but do not replace Nano Banana 2
Lite as the Enhance Tips preview default. The quality difference is too small
to justify the current latency and cost regression.

Artifacts (ignored, local):

- `test-results/qwen-spicy-vs-nano-lite-enhance-v1/report.html`
- `test-results/qwen-spicy-vs-nano-lite-enhance-v1/results.json`
- `test-results/qwen-spicy-vs-nano-lite-enhance-v1/summary.json`
- `test-results/qwen-spicy-vs-nano-lite-enhance-v1/contact-sheet-1.jpg`
