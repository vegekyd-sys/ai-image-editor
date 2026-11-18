import type { LanguageModelMiddleware } from 'ai';

function nonnegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// Responses uses the OpenAI SDK's stream parser. Preserve OpenRouter's extra
// billing fields from the raw terminal event before the parser drops them.
export const openRouterResponsesUsage: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  wrapStream: async ({ model, params }) => {
    const result = await model.doStream({ ...params, includeRawChunks: true });
    let usage: { cost?: number; webSearchRequests?: number } | undefined;
    type Part = typeof result.stream extends ReadableStream<infer T> ? T : never;
    return {
      ...result,
      stream: result.stream.pipeThrough(new TransformStream<Part, Part>({
        transform(part, controller) {
          if (part.type === 'raw') {
            const event = part.rawValue as { response?: { usage?: {
              cost?: unknown;
              cost_details?: { upstream_inference_input_cost?: unknown; upstream_inference_output_cost?: unknown };
              server_tool_use_details?: { web_search_requests?: unknown };
            } } } | null;
            const reported = event?.response?.usage;
            if (reported) {
              const webSearchRequests = nonnegative(reported.server_tool_use_details?.web_search_requests);
              const input = nonnegative(reported.cost_details?.upstream_inference_input_cost);
              const output = nonnegative(reported.cost_details?.upstream_inference_output_cost);
              // Makaron already bills each web search separately. With a
              // provider tool, use token-only cost or the standard rate table.
              const cost = webSearchRequests === 0
                ? nonnegative(reported.cost)
                : input !== undefined && output !== undefined ? input + output : undefined;
              usage = { ...(cost === undefined ? {} : { cost }), ...(webSearchRequests === undefined ? {} : { webSearchRequests }) };
            }
            if (!params.includeRawChunks) return;
          }
          if (part.type === 'finish' && usage && Object.keys(usage).length > 0) {
            part = { ...part, providerMetadata: { ...part.providerMetadata, openrouter: { usage } } };
          }
          controller.enqueue(part);
        },
      })),
    };
  },
};
