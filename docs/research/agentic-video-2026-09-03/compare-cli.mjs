// Same installed client, source and frozen questions against production/Preview.
// Normal authenticated Makaron inference; credits may be charged by the endpoint.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
for (const name of ['--url', '--out']) if (!args.includes(name)) throw new Error(`${name} required`);
const endpoint = new URL(arg('--url')).origin;
const out = arg('--out');
const video = 'https://storage.googleapis.com/cloud-samples-data/generative-ai/video/pixel8.mp4';
const cli = fileURLToPath(new URL('../../../packages/makaron-cli/bin/makaron.mjs', import.meta.url));
const cases = [
  { id: 'editor-overview', question: 'Describe the entire video chronologically for a creative editor. Cover subjects, setting, actions, scene changes, notable text, framing, mood, and the most useful moments. Be concise but specific.' },
  { id: 'visual-moment', question: 'What is visibly shown around 00:46 to 00:48? Describe the camera composition and objects in this moment in at most three sentences. Do not infer from dialogue.' },
  { id: 'visible-text', question: 'Read the person introduction labels visible near the beginning of this video, including the person name and pronouns if visible. Give only the visible labels, and say uncertain if you cannot read them.' },
];
if (args.includes('--local-video')) cases.push({
  id: 'makaron-intro', video: arg('--local-video'),
  question: 'Describe the major sections of this short product video in chronological order, including the prominent text in each section and approximate transition times. Say whether any spoken dialogue or music is present. Be concise and do not invent text that is not legible.',
});
const result = { checkedAt: new Date().toISOString(), endpoint, video, cases, runs: [] };
for (const item of cases) {
  if (args.includes('--case') && item.id !== arg('--case')) continue;
  const started = performance.now();
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, 'analyze', '--video', item.video || video, item.question], {
      env: { ...process.env, MAKARON_URL: endpoint }, timeout: 180_000, maxBuffer: 1_000_000,
    });
    const ok = stdout.includes('Video analysis completed.');
    result.runs.push({ id: item.id, elapsedMs: Math.round(performance.now() - started), ok, stdout, stderr });
  } catch (error) {
    result.runs.push({ id: item.id, elapsedMs: Math.round(performance.now() - started), ok: false, error: error.message, stdout: error.stdout, stderr: error.stderr });
  }
  await writeFile(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result.runs.at(-1), stdout: undefined, stderr: undefined }));
}
if (result.runs.some(item => !item.ok)) process.exitCode = 1;
