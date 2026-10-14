/** Engineering acceptance through the SAME createVideo/getVideoStatus path as
 * the App, including Seedance 2.5 Eco enhancement. Credentials remain in env.
 * Usage: ... run-cases.ts submit|poll <private-dir>
 * cases.json = [{label,input:CreateVideoInput}], state uses diagnosis.json.
 * Every label reserves one POST before submission; poll never regenerates.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createVideo, type CreateVideoInput } from '../../src/lib/skills/create-video';
import { getVideoStatus } from '../../src/lib/skills/get-video-status';

type Entry = { label: string; model: string; submittedAt: string; input?: CreateVideoInput; status?: string; result?: { taskId?: string; [key: string]: unknown }; readyAt?: string; error?: string };
async function main() {
  const [operation, directory] = process.argv.slice(2);
  if (!directory || !['submit', 'poll'].includes(operation)) throw new Error('Expected submit|poll <private-dir>');
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const statePath = path.join(root, 'diagnosis.json');
  const state = JSON.parse(await readFile(statePath, 'utf8')) as { userId: string; projectId: string; jobs: Entry[] };
  const save = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  if (operation === 'submit') {
    const cases = JSON.parse(await readFile(path.join(root, 'cases.json'), 'utf8')) as { label: string; input: CreateVideoInput }[];
    for (const item of cases) {
      if (state.jobs.some(j => j.label === item.label)) continue;
      const input = { ...item.input, userId: state.userId, projectId: state.projectId };
      const job: Entry = { label: item.label, model: input.videoModel!, input, submittedAt: new Date().toISOString(), status: 'submitting' };
      state.jobs.push(job); await save();
      try { job.result = await createVideo(input) as unknown as Entry['result']; job.status = job.result?.success === false ? 'failed' : 'processing'; }
      catch (e) { job.status = 'submission-uncertain'; job.error = e instanceof Error ? e.message : String(e); }
      await save();
      console.log(JSON.stringify({ label: job.label, model: job.model, status: job.status, taskId: job.result?.taskId, error: job.error }));
    }
  } else {
    for (const job of state.jobs) {
      if (!job.result?.taskId || ['completed', 'failed'].includes(job.status || '')) continue;
      const result = await getVideoStatus({ taskId: job.result.taskId, userId: state.userId });
      if (result.queryFailed) { console.log(JSON.stringify({ label: job.label, queryFailed: true })); continue; }
      job.status = result.status;
      job.error = result.error;
      await writeFile(path.join(root, job.label + '.status.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
      if (result.status === 'completed' && result.videoUrl) {
        const local = path.join(root, job.label + '.mp4');
        const response = await fetch(result.videoUrl);
        if (!response.ok) throw new Error('Video download failed: ' + response.status);
        await writeFile(local, Buffer.from(await response.arrayBuffer()));
        const probe = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', local], { encoding: 'utf8' });
        await writeFile(path.join(root, job.label + '.probe.json'), probe);
        job.readyAt = new Date().toISOString();
      }
      await save();
      console.log(JSON.stringify({ label: job.label, model: job.model, status: job.status, error: job.error, stage: result.stage, readyAt: job.readyAt }));
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
