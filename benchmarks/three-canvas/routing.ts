// Natural briefs, a fresh production system prompt, and read-only local guides.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { buildSystemPrompt } from '../../src/lib/agent';
import { createAgentModelRuntime, getAgentProviderOptions } from '../../src/lib/agent-model-runtime';
import { bundleAgentPrompt } from '../../src/lib/agent-prompt-bundles';

async function main() {
  const runtime = createAgentModelRuntime(undefined, 'three-canvas-routing');
  const system = await buildSystemPrompt();
  const briefs = [
    '用八秒解释相机镜头内部的镜片如何组成，从装配状态拆开并绕到侧面看空间关系。',
    '两行黑白大字分三拍进场，再叠上日期，做一个极简会议片头。',
    '给后续生成模型准备一条干净的参考片，镜头从三道拱门之间穿过去再绕回第一道，位置和节奏需要可以精确调整。',
  ];
  for (const brief of briefs) {
    const result = await generateText({
      model: runtime.model, providerOptions: getAgentProviderOptions(runtime), system,
      prompt: brief + ' 这次先只给技术选型和镜头计划，一两句话，具体到实现组件。暂时不用制作。',
      tools: { read_file: tool({
        description: 'Read a built-in Makaron prompt or creative skill.',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path: file }) => {
          if (!/^(?:prompts|skills)\/[\w./-]+\.md$/.test(file) || file.split('/').includes('..')) return { error: 'Unknown guide' };
          const base = file.startsWith('prompts/') ? 'src/lib' : 'src';
          try { return { content: bundleAgentPrompt(file, await readFile(path.join(base, file), 'utf8')) }; }
          catch { return { error: 'Unknown guide' }; }
        },
      }) },
      stopWhen: stepCountIs(6), maxOutputTokens: 1500, maxRetries: 0,
      abortSignal: AbortSignal.timeout(100_000),
    });
    console.log(JSON.stringify({ model: runtime.spec.id, brief, plan: result.text, reads: result.steps.flatMap(s => s.toolCalls.map(c => c.input)) }));
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error.name, error.statusCode); process.exit(1); });
