import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const exec = promisify(execFile);
const base = 'http://localhost:3042';
const directory = new URL('../test-results/deepseek-language/', import.meta.url);
await mkdir(directory, { recursive: true });
const resume = process.argv.includes('--resume-chinese');
const results = resume ? JSON.parse(await readFile(new URL('cli-results.json', directory), 'utf8')).results : [];
async function cli(args) {
  const { stdout } = await exec('makaron', args, { env: { ...process.env, MAKARON_URL: base }, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}
async function wait(runId) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    let result;
    try { result = await cli(['responses', 'get', runId, '--json']); }
    catch (error) {
      console.log(JSON.stringify({readRetry:runId,error:error.message}));
      await new Promise(resolve => setTimeout(resolve, 3000));
      continue;
    }
    if (!result.incomplete) return result;
    await new Promise(resolve => setTimeout(resolve, result.next_poll_after_ms || 3000));
  }
  throw new Error(`Timeout ${runId}`);
}
async function sequence(name, project, cases) {
  for (const [label, expected, prompt, existingRun] of cases) {
    const start = Date.now();
    try {
      const submit = existingRun ? { runId: existingRun, projectId: project } : await cli(['chat', '--project', project, '--agent-model', 'deepseek-v4-pro', '--json', '-b', prompt]);
      project = submit.projectId;
      const result = await wait(submit.runId);
      const entry = { sequence: name, label, expected, prompt, projectId: project, runId: submit.runId, status: result.status, text: result.result?.text || result.output?.filter(x => x.type === 'text').map(x => x.content).join('\n'), durationSeconds: result.completed_at ? (Date.parse(result.completed_at) - Date.parse(result.created_at))/1000 : null, observedMs: Date.now() - start, outputTypes: result.output?.map(x => x.type) };
      results.push(entry);
      console.log(JSON.stringify(entry));
      await writeFile(new URL('cli-results.json', directory), JSON.stringify({ base, model: 'deepseek-v4-pro', snapshot: 'e09b0af90fc656d3f242674d80cfc58be78d38af', results }, null, 2));
      if (result.status !== 'completed') break;
    } catch (error) { console.log(JSON.stringify({sequence:name,label,error:error.message})); break; }
  }
}
await Promise.all([
  sequence('Chinese conversation', '75540ed3-450c-4ff8-8d62-efe5576dc371', [
    ...(!resume ? [['Chinese initial', 'zh', '我想拍一个雨天咖啡馆的小故事，只讨论想法，不调用工具、不生成媒体。用两句话给我一个故事梗概。', 'c0080928-e68a-48ec-a84e-e5e2efb78b94']] : []),
    ['Chinese + ok', 'zh', 'ok', resume ? '09fa97fa-c7f0-4a38-9e39-69d0e2eb1751' : undefined],
    ['Chinese + repeated ok', 'zh', 'ok'],
    ['Substantive English switch', 'en', 'How would you frame the opening shot and light the cafe window? Please keep it to two sentences; discussion only, no tools or media generation.'],
    ['Substantive Chinese switch', 'zh', '如果只用手机拍，怎样保持窗外的雨丝清晰？两句话说一下，只讨论、不调用工具。'],
    ['English artifact request', 'English title (intentional)', '给这个故事起一个英文标题，只输出标题，不调用工具。'],
    ['English artifact + ok', 'zh', 'ok'],
  ]),
  ...(resume ? [] : [sequence('Multilingual conversation', 'auto', [
    ['English initial', 'en', 'I am planning a quiet seaside short film. Suggest a two-sentence story idea. Discuss only; do not call tools or generate media.'],
    ['English + 好', 'en', '好'],
    ['Substantive Japanese switch', 'ja', '冒頭の場面はどんな構図にするとよいですか？二文で提案してください。相談だけで、ツールや画像生成は使わないでください。'],
    ['Japanese + ok', 'ja', 'ok'],
    ['Substantive Spanish switch', 'es', '¿Cómo iluminarías esta escena al amanecer? Responde en dos frases; solo estamos conversando, sin herramientas ni generación de medios.'],
    ['Spanish + emoji', 'es', '👍'],
    ['Explicit English preference', 'en', '之后即使我说中文，也请一直用英文回答。简单说一下海边拍摄应该注意什么，不调用工具。'],
    ['Explicit preference + Chinese follow-up', 'en', '如果当天有大风，收音怎么办？两句话，不调用工具。'],
  ])]),
]);
if (!resume) await sequence('Traditional Chinese', 'auto', [
  ['Traditional Chinese initial', 'zh-Hant', '我想拍一個雨天咖啡店的小故事，請用兩句話給我一個故事梗概。我們只討論，不使用工具，也不生成圖片或影片。'],
]);
