import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createEvolinkTask, getEvolinkTask, type EvolinkTaskInput } from '../src/lib/evolink';

type Config = EvolinkTaskInput & {
  name: string;
  outputDir?: string;
  pollSeconds?: number;
  timeoutMinutes?: number;
};

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: seedance25-live.mts <config.json>');

const config = JSON.parse(await readFile(resolve(configPath), 'utf8')) as Config;
const outputDir = resolve(config.outputDir || 'test-results/seedance-25');
await mkdir(outputDir, { recursive: true });

const startedAt = new Date().toISOString();
const taskId = await createEvolinkTask(config);
const taskPath = resolve(outputDir, `${config.name}.task.json`);
await writeFile(taskPath, JSON.stringify({ taskId, startedAt, config }, null, 2));

const deadline = Date.now() + (config.timeoutMinutes ?? 30) * 60_000;
let result = await getEvolinkTask(taskId);
while (result.status !== 'completed' && result.status !== 'failed' && Date.now() < deadline) {
  console.log(`[seedance-live] ${config.name}: ${result.status}`);
  await new Promise(resolveWait => setTimeout(resolveWait, (config.pollSeconds ?? 15) * 1000));
  result = await getEvolinkTask(taskId);
}

const completedAt = new Date().toISOString();
const report = { taskId, startedAt, completedAt, result, config };
await writeFile(resolve(outputDir, `${config.name}.result.json`), JSON.stringify(report, null, 2));

if (result.status !== 'completed' || !result.videoUrl) {
  throw new Error(`${config.name} failed: ${result.error || result.status}`);
}

const response = await fetch(result.videoUrl);
if (!response.ok) throw new Error(`Video download failed: ${response.status}`);
const ext = config.outputFormat === 'mov' ? 'mov' : 'mp4';
const outputPath = resolve(outputDir, `${config.name}.${ext}`);
await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
console.log(JSON.stringify({ taskId, videoUrl: result.videoUrl, outputPath, source: basename(configPath), taskPath: dirname(taskPath) }));
