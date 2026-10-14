/** Read/poll the initial supplier-baseline receipts. New experiments MUST use
 * run-cases.ts through the application's real Eco path. The old estimated
 * reservation ceiling was not settled spend and is intentionally retired.
 * Usage: ... experiment.ts poll|transcribe <private-dir>
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getEvolinkTask } from '../../src/lib/evolink';
import { transcribeWithVolcengineAsr } from '../../src/lib/volcengine-asr';

type Sample = { variant: string; taskId?: string; status?: string; readyAt?: string; error?: string };
async function main() {
  const [operation, directory] = process.argv.slice(2);
  if (!directory || !['poll', 'transcribe'].includes(operation)) throw new Error('Expected poll|transcribe <private-dir>; new submissions use run-cases.ts.');
  const root = path.resolve(directory);
  const statePath = path.join(root, 'state.json');
  const samples: Sample[] = JSON.parse(await readFile(statePath, 'utf8'));
  const save = () => writeFile(statePath, JSON.stringify(samples, null, 2), { mode: 0o600 });
  if (operation === 'poll') {
    for (const sample of samples) {
      if (!sample.taskId || ['completed', 'failed'].includes(sample.status || '')) continue;
      const result = await getEvolinkTask(sample.taskId);
      sample.status = result.status;
      sample.error = result.error;
      if (result.status === 'completed' && result.videoUrl) {
        const response = await fetch(result.videoUrl);
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        await writeFile(path.join(root, sample.variant + '.mp4'), Buffer.from(await response.arrayBuffer()));
        sample.readyAt = new Date().toISOString();
        const probe = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(root, sample.variant + '.mp4')], { encoding: 'utf8' });
        await writeFile(path.join(root, sample.variant + '.probe.json'), probe);
      }
      await save();
      console.log(JSON.stringify({ variant: sample.variant, status: sample.status, error: sample.error, readyAt: sample.readyAt }));
    }
  } else {
    for (const sample of samples.filter(s => s.status === 'completed')) {
      const target = path.join(root, sample.variant + '.asr.json');
      if (await readFile(target).then(() => true).catch(() => false)) continue;
      const transcript = await transcribeWithVolcengineAsr({ mediaUrl: 'https://local.invalid/' + sample.variant + '.mp4', localMediaPath: path.join(root, sample.variant + '.mp4'), language: 'en', requestId: 'studio-native-' + sample.variant });
      await writeFile(target, JSON.stringify(transcript, null, 2));
      console.log(sample.variant, transcript.text);
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
