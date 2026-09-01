import { describe, expect, it } from 'vitest';
import {
  aspectRatioToCodexSize,
  buildCodexSubscriptionImageRequest,
  parseCodexSubscriptionImageResponse,
} from '@/lib/codex-subscription-image';
import { resolveAnalyzeImageProvider } from '@/lib/agent-image-analysis';

describe('Codex subscription image routing', () => {
  it('builds a GPT Image 2 subscription request with image-edit context', () => {
    const body = buildCodexSubscriptionImageRequest({
      prompt: 'Turn the wall blue.',
      model: 'openai',
      image: 'https://example.com/source.jpg',
      references: [{ url: 'data:image/png;base64,AAAA', role: 'Style reference' }],
      aspectRatio: '16:9',
      codexSubscription: {
        userId: 'allowed-user',
        projectId: 'project-1',
        agentModelId: 'gpt-5.6-sol',
      },
    });

    expect(body).toMatchObject({
      model: 'gpt-5.6-sol',
      stream: true,
      store: false,
      tools: [{
        type: 'image_generation',
        model: 'gpt-image-2',
        size: '1536x1024',
        background: 'opaque',
      }],
      tool_choice: { type: 'image_generation' },
    });
    const content = (body.input as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    expect(content.filter(part => part.type === 'input_image')).toEqual([
      expect.objectContaining({ image_url: 'https://example.com/source.jpg', detail: 'high' }),
      expect.objectContaining({ image_url: 'data:image/png;base64,AAAA', detail: 'high' }),
    ]);
  });

  it('extracts the generated image from an octet-stream SSE response', () => {
    const parsed = parseCodexSubscriptionImageResponse([
      'data: {"type":"response.created"}',
      'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"cG5n"}}',
      'data: {"type":"response.completed","response":{"output":[]}}',
      'data: [DONE]',
      '',
    ].join('\n'));

    expect(parsed.imageBase64).toBe('cG5n');
    expect(parsed.eventTypes).toContain('response.output_item.done');
  });

  it('keeps supported sizes and uses the active Codex Agent for image analysis', () => {
    expect(aspectRatioToCodexSize('1:1')).toBe('1024x1024');
    expect(aspectRatioToCodexSize('9:16')).toBe('1024x1536');
    expect(resolveAnalyzeImageProvider({
      spec: { supportsImageInput: true, provider: 'codex-subscription' },
    } as any)).toBe('codex-subscription');
    expect(resolveAnalyzeImageProvider({
      spec: { supportsImageInput: false, provider: 'deepseek' },
    } as any)).toBe('gemini-api');
  });
});
