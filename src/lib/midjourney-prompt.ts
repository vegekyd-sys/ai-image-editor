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
The user can speak naturally in any language. Convert intent into a concise English description of the desired visible image: subject, medium, environment, composition, lighting, color and mood, only as relevant.
Preserve explicit counts, materials, colors, framing, placement, intended use and quoted text. Keep quoted text in its original language. Do not invent a new subject, change the purpose, add brands or replace specific requirements with generic aesthetic adjectives.
Translate vague aesthetic requests into a coherent, restrained visual direction when necessary. Avoid long instruction lists, repetition, generic quality tags (masterpiece, 8k, award-winning) and appeals to the model. Do not mention Midjourney syntax or put --parameters into prompt.
Put exclusions into negativePrompt as a comma-separated list; do not place 'no X' in the visual description. Use only exclusions the user asked for. Use aspectRatio when requested or strongly implied by the intended format. Do not infer HD unless explicitly selected outside this conversion.
If a style reference is attached, describe the new subject and composition; avoid inventing conflicting palette, medium or lighting. Style Reference transfers appearance, not identity or exact structure.
This route is generation, not precise editing. Do not promise identity preservation, exact typography, unchanged source pixels or access to the new Edit Model. Do not rewrite a required edit as a different text-to-image concept.
Return only a JSON object with prompt and optional negativePrompt, aspectRatio, stylize, raw. Use stylize=100 by default, or 250 for explicit artistic exploration; raw=true for explicit photographic/product precision. No markdown, commentary, extra keys, URLs, seed, speed or quality.`;

export function validateMidjourneyPrompt(value: unknown): MidjourneyRequest {
  const result = midjourneyPromptSchema.parse(value);
  buildMidjourneyRequest(result);
  return result;
}

export async function prepareMidjourneyPrompt(brief: string, hasStyleReference = false): Promise<MidjourneyRequest> {
  if (!brief.trim() || brief.length > 4000) throw new Error('invalid_brief');
  const [{ generateText }, { createAgentModelRuntime }] = await Promise.all([import('ai'), import('./agent-model-runtime')]);
  const runtime = createAgentModelRuntime('gpt-6-luna', 'midjourney-local-lab', 'openrouter');
  const result = await generateText({
    model: runtime.model, system: MIDJOURNEY_PROMPT_SYSTEM,
    prompt: JSON.stringify({ brief, hasStyleReference }),
    maxOutputTokens: 1600, maxRetries: 0, abortSignal: AbortSignal.timeout(60_000),
  });
  const text = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return validateMidjourneyPrompt(JSON.parse(text));
}
