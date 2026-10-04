/** Preserve Zod's optional fields instead of letting Responses normalize them
 * into mandatory, non-null arguments. Local Zod validation remains enabled. */
export function preserveOptionalToolFields<T extends Record<string, { strict?: boolean }>>(
  tools: T,
  provider: string,
): T {
  if (provider !== 'azure-openai' && provider !== 'codex-subscription') return tools;
  for (const definition of Object.values(tools)) definition.strict ??= false;
  return tools;
}
