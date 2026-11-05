# OpenAI direct provider: acceptance (2026-11-05, local, branch claude/openai-provider)

The owner's OpenAI API key (about $200/month) is used first for GPT Agent models and GPT Image 2.6,
then the existing suppliers take over. The key lives only in `.env.local` / Vercel env, never in docs or memory.

## Routing
| Traffic | Order |
|---|---|
| GPT Agent models (gpt-6-luna / gpt-6-sol / gpt-6.1-sol / gpt-5.6-*) | Codex subscription (its allowed users) → **OpenAI direct (budget left)** → GPT56_AGENT_PROVIDER (Azure) |
| GPT Image 2.6 Flare / Sunburst | **OpenAI direct (budget left)** → fal |
| deepseek-flash (prod default Agent), grok, other image models | unchanged |

Budget: `OPENAI_MONTHLY_BUDGET_USD` (default 200) minus `OPENAI_BUDGET_RESERVE_USD` (default 5), per UTC month,
from the `openai_direct_spend` ledger (OpenAI gives this key no usage API: `api.usage.read` missing).
A quota refusal (`insufficient_quota` etc.) marks the month exhausted. Kill switch: `OPENAI_DIRECT_ENABLED=false`.
User billing is unchanged (same token rates / supplier cost × markup).

## Live acceptance (same 4 requests on each server)
| Case | Result |
|---|---|
| Normal | Agent gpt-6-luna on `openai` (cache hit 65%); JPEG/GIF/SVG/chat-GIF all `provider=openai`; 7 ledger rows, $0.131 total; hand-checked agent row cost |
| Budget 0 | `routing: fallback`; Agent on `azure-openai`, all images `provider=fal`; no new ledger rows |
| Invalid key (401) | Images try OpenAI, fall to fal; durable Agent attempt 1 fails 401 on `openai`, attempt 2 completes on `azure-openai`; health marks openai_direct unhealthy |
| Unit | 19 new tests (budget gate, priority, pinned provider, failover, costs, request translation, quota/content-policy handling, stream ledger) + full suite 2755 pass |

## OpenAI official vs fal for GPT Image 2.6 (live probes)
| Item | OpenAI official | fal |
|---|---|---|
| GIF frame_count | 2–16 (17/32/64 rejected, no charge) | 2–16 (same message; fal proxies OpenAI) |
| GIF sheet limits | same grid errors (10×896, 2×1024 rejected) | same |
| GIF `size: auto` | 512×512 | n/a in our requests |
| frame_duration_ms | 3000 accepted (reference caps encoded delay 655,350) | schema 20–2000 |
| Transparent GIF | works | not verified |
| Reasoning control | `complexity` (`reasoning_effort` unknown) | `reasoning_effort` |
| Quality tiers | auto/low/medium/high/xhigh/max (xhigh 2.5×, max 5.6× output tokens vs high-ish) | we expose auto–high |
| References | `/images/edits` JSON `images:[{image_url}]`; GIF inputs rejected | `image_urls` |
| SVG | needs `svg.model` (text model traces; extra `svg_usage` tokens), generation only | works today (was 422 earlier) |
| Speed, same prompts | JPEG 6.4s · GIF 13.2s · SVG 29.0s · ref GIF 16.8s | 22.6s · 26.0s · 48.8s · 22.8s |
| Cost, same prompts | $0.0236 · $0.0314 · $0.0304 | $0.0236 · $0.0315 · $0.0293 |

## Not done here
Production needs `OPENAI_API_KEY` in Vercel Production + Preview, merge to dev, release, and a CLI patch
version (README / bundled Skill SVG wording changed). The ledger migration `20261105160000_openai_direct_spend`
is already applied to the shared database (additive table + read-only function).
