# Wan 2.7 Image — Alibaba international

This integration adds an explicit image choice, `wan2.7-image`. It does not replace
Auto, Qwen, Gemini, GPT Image 2, video providers, or the production Qwen worker.

## Configuration (server only)

- `DASHSCOPE_API_KEY`: the Alibaba international workspace key, injected securely.
- `DASHSCOPE_API_HOST`: `ws-<workspace-id>.ap-southeast-1.maas.aliyuncs.com`.
- No default personal workspace host or credential is embedded in source.
- Workspace key and endpoint must both belong to Singapore. Other regions are
  rejected because their price/availability is a different contract.
- Use the native `/api/v1/services/aigc/multimodal-generation/generation`
  endpoint, not `/compatible-mode/v1`.
- Apply `20260903111815_wan27_image_pricing.sql` during an approved release so
  Admin → Billing can display/edit the price. The runtime fallback is also 6
  credits, so an absent pricing row does not make this model free.

Do not commit keys or copy credentials into reports. Rotate credentials exposed
in conversation before production configuration. This work does not deploy,
set Vercel environment variables, publish the CLI, or modify production balances.

## Public behavior

- App Image selector, Agent `generate_image`, MCP `makaron_edit_image`, and CLI
  `makaron edit --image-model wan2.7-image` share the canonical model identifier.
- Standard Wan 2.7 only; no Pro tier or automatic paid upgrade.
- Exactly one image: `n=1`, `enable_sequential=false`, `watermark=false`.
- Default output is `1K`. Explicit `--aspect 16:9` requests `1280*720`; other
  ratios use approximately 0.92 MP, aligned to 16 pixels, within 1:8–8:1.
- `thinking_mode=false` avoids optional T2I reasoning. It does not affect edits.
- Supports text-to-image, a single base image, and ordered multi-image editing
  (maximum 9 total images). CLI's existing reference option retains its existing
  documented limit. Input is HTTPS or image data URL; no lossy input resizing.
- Output is decoded and converted to JPEG quality 95, matching ordinary Makaron
  image storage. No resizing, sharpening, face replacement or other retouching.
- No token-usage billing: Wan's token counters are explicitly non-billable.
- The adapter submits once. No implicit retry or alternative-model fallback.
  On timeout/download failure, an upstream charge can exist without a delivered
  image; Makaron does not charge the user for that failed delivery.
- Transparent output follows the existing strict GPT Image 2 route. Wan does
  not claim alpha output or camera-rotate LoRA support.

## Billing contract

Official Singapore price checked 2026-09-03: **$0.03 per successful output**.
Input images/tokens are not charged. Free allowances are provider promotions,
not the application's sustainable rate. USD pricing requires no FX conversion.

`ceil($0.03 × 2 markup / $0.01 per credit) = 6 credits` for the single output.
Both T2I and editing use `credit_pricing.tool_name = edit_image_wan2.7-image`.
`supplier_cost = 0.03`, `credits = 6`, `is_free = false`.

The existing Admin price override is respected. App preflight and MCP preflight
resolve the model-specific price; successful per-action calls await the shared
atomic `deduct_and_log` debit and usage row. `model_used` records `wan2.7-image`,
and App/MCP source/API-key identity are preserved. Agent LLM usage remains a
separate charge. No output means no image debit. This is not a new wallet,
separate ledger, or token-rate entry.

## Verification

- Adapter tests: native endpoint, region/host restrictions, size bounds, URL and
  data inputs, ordered references, single output, decode, error redaction and
  no resubmission.
- Routing tests: unchanged Auto/transparent behavior, actual provider/model,
  unconfigured provider, no outer retry or fallback.
- HTTP MCP integration tests exercise the real server, shared image skill,
  provider adapter and billing code against isolated provider/DB fixtures:
  100→94 after one success; 5 credits rejects before POST; failure/download
  failure leaves 100; missing price row still charges 6; Admin override charges
  8. App-source debit records the same model with a null API-key identity.
- Selector interaction tests cover opt-in selection and unchanged video choice.
- Live product-router smoke uses `benchmarks/wan27-product-smoke.ts`, with the
  supplied reference as full JPEG data URL and the existing short KBO prompt.
  Results in `outputs/wan27-integration/live-1/results.json` (ignored media):
  editing: URL 9.184s, decoded image 10.702s, 1280×720;
  T2I: URL 4.545s, decoded image 5.966s, 1024×1024.
- These are two measured calls, not a P95/SLA. Nominal provider cost $0.06;
  provider invoice/free-quota usage not reconciled. No production debit made.
- Visual review: mug meets the product-photo prompt; KBO setting/broadcast badge
  work, but the woman's eyes/nose/jaw drift and jersey text is misspelled. Strict
  identity preservation is **not** accepted; this model remains opt-in.

Before release: configure a rotated key/host, apply the price migration, deploy
through the normal approval gate, verify a real authenticated production image,
and reconcile the image debit separately from Agent token usage.

Sources:
- [Native API](https://www.alibabacloud.com/help/zh/model-studio/wan-image-generation-and-editing-api-reference)
- [Official pricing](https://www.alibabacloud.com/help/zh/model-studio/model-pricing)
