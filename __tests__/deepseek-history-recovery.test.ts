import { describe, expect, it } from 'vitest';
import { classifyModelTermination } from '../src/lib/agent-terminal';
describe('DeepSeek context rejection', () => {
  const message = "This model's maximum context length is 1048576 tokens. However, you requested 1086949 tokens.";
  const observation = { sawFinish: false, finalStepTextChars: 0, finalStepToolCalls: 0, finalStepDeliveredArtifact: false };
  it.each([
    ['deepseek', 400, message, 'context_length_exceeded'],
    ['deepseek', 503, message, 'stream_error'],
    ['another', 400, message, 'stream_error'],
    ['deepseek', 400, 'invalid tool arguments', 'stream_error'],
  ])('classifies %s %s %s', (provider, statusCode, msg, code) => {
    expect(classifyModelTermination({ ...observation, provider: String(provider),
      streamError: Object.assign(new Error(String(msg)), { statusCode }),
    })).toMatchObject({ code, retryable: code === 'stream_error' });
  });
});
