import assert from 'node:assert/strict';
import { streamText, generateText, stepCountIs, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import sharp from 'sharp';
import { createAgentModelRuntime, getAgentProviderOptions } from '../src/lib/agent-model-runtime';

async function main() {
  const wire: { model: string; assistantCount: number; reasoningCount: number; imageCount: number }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.deepseek.com/') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      const assistants = body.messages?.filter((m: any) => m.role === 'assistant') ?? [];
      wire.push({ model: body.model, assistantCount: assistants.length,
        reasoningCount: assistants.filter((m: any) => typeof m.reasoning_content === 'string').length,
        imageCount: body.messages?.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((p: any) => p.type === 'image_url').length ?? 0 });
    }
    return originalFetch(input, init);
  };
  const runtime = createAgentModelRuntime('deepseek-flash', 'flash41-live-smoke');
  const started = Date.now();
  const calls: string[] = [];
  const messages: ModelMessage[] = [{ role: 'user', content: 'First call get_number. Then call double_number using that result. Finally reply exactly RESULT_42.' }];
  const tools = {
    get_number: tool({ description: 'Return the secret input number.', inputSchema: z.object({}), execute: async () => {calls.push('get_number'); return { number: 21 };} }),
    double_number: tool({ description: 'Double the retrieved number.', inputSchema: z.object({number: z.number()}), execute: async ({number}) => {assert.equal(number,21);calls.push('double_number');return {number:number*2};} }),
  };
  const result = streamText({ model: runtime.model, messages, tools, stopWhen: stepCountIs(4), providerOptions: getAgentProviderOptions(runtime), maxRetries: 0 });
  let text = ''; let firstTextMs: number | undefined;
  for await (const delta of result.textStream) { firstTextMs ??= Date.now()-started; text += delta; }
  assert.deepEqual(calls, ['get_number','double_number']);
  assert.match(text, /RESULT_42/);
  const response = await result.response;
  const turn2 = await generateText({ model: runtime.model, messages: runtime.normalizeMessages([...messages, ...response.messages, { role: 'user', content: 'What was the doubled result? Do not call tools. Reply exactly RESULT_42_AGAIN.' }]), tools, providerOptions: getAgentProviderOptions(runtime), maxRetries: 0 });
  assert.match(turn2.text,/RESULT_42_AGAIN/);
  const png = await sharp({create:{width:96,height:96,channels:3,background:'#ff0000'}}).png().toBuffer();
  const vision = await generateText({model:runtime.model,messages:[{role:'user',content:[{type:'file',data:png,mediaType:'image/png'},{type:'text',text:'Name the dominant image color in one English word.'}]}],providerOptions:getAgentProviderOptions(runtime),maxRetries:0});
  assert.match(vision.text,/red/i);
  assert(wire.every(r=>r.model==='deepseek-flash' && r.assistantCount===r.reasoningCount));
  assert(wire.some(r=>r.imageCount===1));
  console.log(JSON.stringify({passed:true,model:runtime.spec.id,firstTextMs,totalMs:Date.now()-started,calls,wire,usage:await result.totalUsage,vision:vision.text},null,2));
}
main().catch(error=>{console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;});
