import { z } from 'zod';
import { buildMidjourneyRequest, type MidjourneyRequest } from './midjourney';

export const midjourneyPromptSchema = z.object({
  prompt: z.string().min(1).max(1024),
  negativePrompt: z.string().optional(),
  aspectRatio: z.string().optional(),
  stylize: z.number().int().min(0).max(1000).optional(),
  raw: z.boolean().optional(),
}).strict();

export const MIDJOURNEY_PROMPT_SYSTEM = `You prepare Midjourney V8.2 text-to-image requests for Makaron.
The user can speak naturally in any language. Art-direct the brief into a concise English description of a visible image, not a literal translation or a list of wishes. Put the primary subject and its framing FIRST, then the environment, medium, lighting and color as relevant. Aim for 3-5 concrete sentences, usually 60-110 words, within 1024 characters.
Preserve explicit counts, materials, colors, framing, placement, intended use and quoted text. Keep quoted text in its original language. Do not invent a new subject, change the purpose, add brands or replace specific requirements with generic aesthetic adjectives.
Honor the user's visual hierarchy. When people must dominate, specify a close foreground portrait or waist-up crop, visible facial features and a large frame-filling subject; describe the city as a receding backdrop. Do not lead with an immense city or a vast panorama that reduces the person to a distant silhouette. Choose compatible framing unless the user specified another shot. Never turn 'dominant' or '震撼' into a literal giant person unless requested.
Make aesthetic wishes visible: turn '大胆构图' into a deliberate camera angle, asymmetric crop, strong diagonals or foreground overlap; turn '震撼' into scale contrast, light and depth. Choose one coherent direction rather than stacking every trick. For imaginative artistic briefs, make concrete creative choices consistent with the intent; avoid defaulting to restrained generic scenery. Ground distinct environments in recognizable physical features (e.g. exposed red regolith and a dusty rust sky for Mars) alongside the requested architecture. Preserve explicit user framing over these examples.
Avoid long instruction lists, repetition, generic quality tags (masterpiece, 8k, award-winning) and appeals to the model. Do not mention Midjourney syntax or put --parameters into prompt.
Put exclusions into negativePrompt as a comma-separated list; do not place 'no X' in the visual description. Use only exclusions the user asked for. Use aspectRatio when requested or strongly implied by the intended format. Do not infer HD unless explicitly selected outside this conversion.
If a style reference is attached, describe the new subject and composition; avoid inventing conflicting palette, medium or lighting. Style Reference transfers appearance, not identity or exact structure.
This route is generation, not precise editing. Do not promise identity preservation, exact typography, unchanged source pixels or access to the new Edit Model. Do not rewrite a required edit as a different text-to-image concept.
Return only a JSON object with prompt and optional negativePrompt, aspectRatio, stylize, raw. Use stylize=100 by default, or 250 for explicit artistic exploration, bold imaginative scenes or concept art. Use raw=true only when the user explicitly wants strict photographic/product accuracy or minimal model styling; a photograph alone does not imply raw. No markdown, commentary, extra keys, URLs, seed, speed or quality.`;

export function validateMidjourneyPrompt(value: unknown): MidjourneyRequest {
  const result = midjourneyPromptSchema.parse(value);
  buildMidjourneyRequest(result);
  return result;
}

export async function prepareMidjourneyPromptWithUsage(brief: string, hasStyleReference = false) {
  if (!brief.trim() || brief.length > 4000) throw new Error('invalid_brief');
  const [{ generateText }, { createAgentModelRuntime, sumOpenRouterProviderCost }] = await Promise.all([import('ai'), import('./agent-model-runtime')]);
  const runtime = createAgentModelRuntime('gpt-6-luna', 'midjourney-prompt', 'openrouter');
  const result = await generateText({
    model: runtime.model, system: MIDJOURNEY_PROMPT_SYSTEM,
    prompt: JSON.stringify({ brief, hasStyleReference }),
    maxOutputTokens: 1600, maxRetries: 0, abortSignal: AbortSignal.timeout(60_000),
  });
  const text = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const cost = sumOpenRouterProviderCost(runtime, [{ providerMetadata: result.providerMetadata as Record<string, unknown> }]);
  return { request: validateMidjourneyPrompt(JSON.parse(text)), cost, usage: result.usage };
}

export async function prepareMidjourneyPrompt(brief: string, hasStyleReference = false): Promise<MidjourneyRequest> {
  return (await prepareMidjourneyPromptWithUsage(brief, hasStyleReference)).request;
}
