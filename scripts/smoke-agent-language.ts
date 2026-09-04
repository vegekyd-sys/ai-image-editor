/** Live, text-only acceptance. No tools, media generation, database client or project writes. */
import assert from 'node:assert/strict';
import type { ModelMessage } from 'ai';
import { runMakaronAgent } from '../src/lib/agent';
import { AGENT_REPLY_LANGUAGE_RULE } from '../src/lib/agent-response-policy';

const zh: ModelMessage[] = [
  { role: 'user', content: '帮我想一个纸牌魔术视频的创意。先只聊思路，不要生成素材。' },
  { role: 'assistant', content: '可以让纸牌悬浮在手心，最后变成一只蝴蝶。要继续细化这个思路吗？' },
];
const en: ModelMessage[] = [
  { role: 'user', content: 'Suggest a card magic video idea. Discuss the concept only; do not generate media.' },
  { role: 'assistant', content: 'A card floats above your hand and transforms into a butterfly. Shall we refine this idea?' },
];
const cases: { name: string; history: ModelMessage[]; prompt: string; expected: 'zh' | 'en'; locale: string }[] = [
  { name: 'Chinese + ok', history: zh, prompt: 'ok', expected: 'zh', locale: 'en' },
  { name: 'Chinese + thumbs up', history: zh, prompt: '👍', expected: 'zh', locale: 'en' },
  { name: 'English + 好', history: en, prompt: '好', expected: 'en', locale: 'zh' },
  { name: 'Substantive English switch', history: zh, prompt: 'Explain why this trick would work better with a red card.', expected: 'en', locale: 'zh' },
  { name: 'Substantive Chinese switch', history: en, prompt: '你解释一下为什么选蝴蝶而不是鸽子。', expected: 'zh', locale: 'en' },
  { name: 'English artifact does not switch conversation', history: [
    { role: 'user', content: '给纸牌魔术视频写一句英文标题。' },
    { role: 'assistant', content: 'When Cards Learn to Fly' },
  ], prompt: 'ok', expected: 'zh', locale: 'en' },
  { name: 'English tool result does not switch conversation', history: [
    ...zh,
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'language-analysis', toolName: 'analyze_image', input: { media_index: 1 } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'language-analysis', toolName: 'analyze_image', output: { type: 'json', value: { analysis: 'A performer holds a red playing card against a dark studio background.' } } }] },
  ], prompt: 'ok', expected: 'zh', locale: 'en' },
  { name: 'Explicit language preference persists', history: [
    { role: 'user', content: 'Please keep replying in English, even if I write Chinese. Suggest a card trick.' },
    { role: 'assistant', content: 'A card floats and turns into a butterfly.' },
  ], prompt: '解释一下怎么拍更好看', expected: 'en', locale: 'zh' },
];

async function run(history: ModelMessage[], prompt: string, locale: string) {
  let text = '';
  for await (const event of runMakaronAgent(`[User request]\n${prompt}`, '', 'language-readonly-acceptance', {
    locale, history, disableToolCalls: true, snapshotImages: [], maxSteps: 1,
    abortSignal: AbortSignal.timeout(60_000),
  })) {
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'content') text += event.text;
  }
  assert.ok(text.trim(), 'Missing reply');
  return text.trim();
}

async function main() {
  process.env.AGENT_DEBUG_DUMP = '0';
  if (process.env.LANGUAGE_WIRE_CHECK === '1') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (typeof init?.body === 'string') {
        const body = JSON.parse(init.body);
        const messages = body.input ?? body.messages ?? [];
        console.log(JSON.stringify({ wire: true, roles: Array.isArray(messages) ? messages.map((message: { role?: string }) => message.role) : [], policyPresent: init.body.includes(AGENT_REPLY_LANGUAGE_RULE), historyPresent: init.body.includes('Discuss the concept only') }));
      }
      return originalFetch(input, init);
    };
  }
  const failures: string[] = [];
  let checks = 0;
  for (const test of cases.filter(test => !process.env.LANGUAGE_CASE || test.name === process.env.LANGUAGE_CASE)) {
    const start = Date.now();
    const text = await run(test.history, test.prompt, test.locale);
    const chinese = /[\u3400-\u9fff]/u.test(text);
    const pass = test.expected === 'zh' ? chinese : !chinese;
    console.log(JSON.stringify({ case: test.name, pass, elapsedMs: Date.now() - start, text }));
    checks++;
    if (!pass) failures.push(test.name);
    if (test.name === 'Chinese + ok') {
      const next = await run([...test.history, { role: 'user', content: test.prompt }, { role: 'assistant', content: text }], 'ok', test.locale);
      console.log(JSON.stringify({ case: 'Chinese + repeated ok next turn', pass: /[\u3400-\u9fff]/u.test(next), text: next }));
      checks++;
      if (!/[\u3400-\u9fff]/u.test(next)) failures.push('Chinese + repeated ok next turn');
    }
  }
  console.log(JSON.stringify({ checks, passed: checks - failures.length, failures }));
  assert.equal(failures.length, 0, `Language acceptance failed: ${failures.join(', ')}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Acceptance failed'); process.exitCode = 1; });
