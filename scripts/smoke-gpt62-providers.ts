/** Explicit live probe: no project writes, media tools, fallback, or retries. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { createAgentModelRuntime, getAgentProviderOptions } from '../src/lib/agent-model-runtime';

async function main() {
  const envPath = process.argv[2];
  const reportPath = process.argv[3];
  if (!envPath || !reportPath) throw new Error('Usage: tsx scripts/smoke-gpt62-providers.ts <private-env-file> <report.json>');
  Object.assign(process.env, parse(readFileSync(envPath)));
  if (process.env.PROBE_RELAY_URL) process.env.CODEX_SUBSCRIPTION_RELAY_URL = process.env.PROBE_RELAY_URL;
  const owner = process.env.CODEX_SUBSCRIPTION_RELAY_OWNER_USER_ID || process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID;
  process.env.CODEX_SUBSCRIPTION_OWNER_USER_ID = owner;
  const samples: Record<string, unknown>[] = [];
  for (const provider of ['openai', 'azure-openai', 'codex-subscription'] as const) {
    if (process.env.PROBE_PROVIDER && process.env.PROBE_PROVIDER !== provider) continue;
    const models = process.env.PROBE_LEGACY_ONLY === '1'
      ? ['gpt-6-luna', 'gpt-6.1-sol'] as const
      : ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra'] as const;
    for (const model of models) {
      if (process.env.PROBE_MODEL && process.env.PROBE_MODEL !== model) continue;
      const started = Date.now();
      const sample: Record<string, unknown> = { provider, requestedModel: model };
      let toolCalls = 0;
      try {
        const runtime = createAgentModelRuntime(model, 'gpt62-provider-smoke', provider, owner, true);
        assert.equal(runtime.spec.provider, provider);
        let firstTextMs: number | undefined;
        let streamError: unknown;
        const result = streamText({
          model: runtime.model,
          prompt: 'Call get_probe once with value 7. After its result reply with exactly MODEL_PROBE_OK.',
          tools: { get_probe: tool({ description: 'Return the test value. No external side effects.',
            inputSchema: z.object({ value: z.number() }), execute: async ({ value }) => {
              assert.equal(value, 7); toolCalls++; return { ok: true, value };
            } }) },
          stopWhen: stepCountIs(3),
          providerOptions: getAgentProviderOptions(runtime),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(90_000),
          onError: ({ error }) => { streamError = error; },
        });
        let text = '';
        for await (const delta of result.textStream) {
          firstTextMs ??= Date.now() - started;
          text += delta;
        }
        if (streamError) throw streamError;
        const steps = await result.steps;
        const usage = await result.totalUsage;
        assert.equal(toolCalls, 1);
        assert.equal(text.trim(), 'MODEL_PROBE_OK');
        Object.assign(sample, { ok: true, text, toolCalls, firstTextMs, steps: steps.length,
          servedModels: steps.map(step => step.response.modelId),
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      } catch (error) {
        const e = error as { name?: string; statusCode?: number; message?: string };
        // Never retain request headers, credentials, or raw response bodies.
        Object.assign(sample, { ok: false, toolCalls, errorName: e.name, statusCode: e.statusCode,
          message: e.message?.replace(/(?:sk-|eyJ)[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 180) });
      }
      sample.elapsedMs = Date.now() - started;
      samples.push(sample);
      writeFileSync(reportPath, JSON.stringify({ testedAt: new Date().toISOString(), samples }, null, 2)+'\n');
      console.log(JSON.stringify(sample));
    }
  }
  if (samples.some(sample => !sample.ok)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
