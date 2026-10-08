/** Internal trial, no Makaron customer billing. Run with node --import tsx. */
import { readFile, writeFile, rename, mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { MidjourneyClient, MidjourneyRequestError, type MidjourneyRequest, type MidjourneyTask } from '../src/lib/midjourney';

type Receipt = {
  request: MidjourneyRequest;
  submittedAt: string;
  state: 'submitting' | 'submitted' | 'unknown' | 'rejected' | 'not_submitted';
  task?: MidjourneyTask;
  recoverableTaskId?: string;
  queriedAt?: string;
  completedAt?: string;
  files?: { index: number; path: string; width: number; height: number }[];
};
async function run() {
  const [command, outputArg, requestArg, ...flags] = process.argv.slice(2);
  if (!['submit', 'status', 'download'].includes(command) || !outputArg) {
    throw new Error('Usage: node --import tsx tools/midjourney-trial.ts submit OUT_DIR REQUEST.json [--env PATH]\n       node --import tsx tools/midjourney-trial.ts status|download OUT_DIR [--env PATH]');
  }
  // status/download have no request file: include the third argument in flag parsing.
  const options = command === 'submit' ? flags : [requestArg, ...flags].filter(Boolean);
  const envIndex = options.indexOf('--env');
  let providerKey = process.env.EVOLINK_API_KEY?.trim();
  if (envIndex >= 0) {
    if (!options[envIndex + 1]) throw new Error('--env requires a path.');
    const values = dotenv.parse(await readFile(resolve(options[envIndex + 1])));
    // Never load production DB credentials into an image-provider trial.
    providerKey = values.EVOLINK_API_KEY?.trim();
    if (!providerKey) throw new Error('The selected env file has no EVOLINK_API_KEY.');
  }
  const directory = resolve(outputArg);
  const receiptPath = join(directory, 'receipt.json');
  const client = new MidjourneyClient(providerKey);
  async function save(receipt: Receipt) {
    const temp = join(directory, `receipt.${process.pid}.tmp`);
    await writeFile(temp, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    await rename(temp, receiptPath);
  }
  async function main() {
    if (command === 'submit') {
      if (!requestArg) throw new Error('submit requires a request JSON file.');
      const request: MidjourneyRequest = JSON.parse(await readFile(resolve(requestArg), 'utf8'));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Exclusive intent prevents a repeated CLI invocation from duplicating a paid POST.
      const handle = await open(receiptPath, 'wx', 0o600).catch(error => {
        if (error.code === 'EEXIST') throw new Error('A submission receipt already exists. Query or download the same task; do not submit it again.');
        throw error;
      });
      const receipt: Receipt = { request, submittedAt: new Date().toISOString(), state: 'submitting' };
      await handle.writeFile(JSON.stringify(receipt, null, 2));
      await handle.close();
      let task: MidjourneyTask;
      try { task = await client.submit(request); } catch (error) {
        receipt.state = error instanceof MidjourneyRequestError && ['rejected', 'not_submitted'].includes(error.outcome)
          ? error.outcome as 'rejected' | 'not_submitted' : 'unknown';
        if (error instanceof MidjourneyRequestError) receipt.recoverableTaskId = error.taskId;
        await save(receipt);
        throw error;
      }
      // A disk-save failure after POST leaves 'submitting', never a retryable rejection.
      receipt.state = 'submitted'; receipt.task = task;
      await save(receipt);
      console.log(JSON.stringify({ taskId: task.taskId, status: task.status, creditsReserved: task.creditsReserved, receiptPath }));
      return;
    }
    const receipt: Receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const id = receipt.task?.taskId ?? receipt.recoverableTaskId;
    if (!id) throw new Error('No known task ID. Inspect the provider dashboard; do not resubmit automatically.');
    const task = await client.get(id);
    receipt.task = task;
    receipt.queriedAt = new Date().toISOString();
    if (task.status === 'completed' && !receipt.completedAt) receipt.completedAt = receipt.queriedAt;
    await save(receipt);
    console.log(JSON.stringify({ taskId: task.taskId, status: task.status, progress: task.progress, imageCount: task.images.length, providerCostUsd: task.providerCostUsd, creditsUsed: task.creditsUsed, providerDurationSeconds: task.providerDurationSeconds, errorCode: task.errorCode }));
    if (command !== 'download') return;
    if (task.status !== 'completed') throw new Error('Download requires a completed task. Query this task later.');
    const files: NonNullable<Receipt['files']> = [];
    for (const image of task.images) {
      const response = await fetch(image.url, { redirect: 'error', signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`Could not download candidate ${image.index + 1}. Retry download only.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 30 * 1024 * 1024) throw new Error('Candidate exceeds 30MB.');
      const decoder = sharp(bytes, { limitInputPixels: 32_000_000 });
      const metadata = await decoder.metadata();
      // Decode the entire image, rather than accepting its header as proof.
      const png = await decoder.png().toBuffer();
      const path = join(directory, `candidate-${image.index + 1}.png`);
      await writeFile(path, png, { mode: 0o600 });
      files.push({ index: image.index, path, width: metadata.width!, height: metadata.height! });
      receipt.files = [...files]; await save(receipt);
    }
    const largeBatch = files.length > 4;
    const width = largeBatch ? 320 : 480; const height = largeBatch ? 200 : 320;
    const cols = largeBatch ? 6 : 2; const rows = Math.ceil(files.length / cols);
    const thumbs = await Promise.all(files.map(async (file, i) => ({
      input: await sharp(file.path).resize(width, height, { fit: 'contain', background: '#171a21' }).png().toBuffer(),
      left: (i % cols) * width, top: Math.floor(i / cols) * height,
    })));
    await sharp({ create: { width: cols * width, height: rows * height, channels: 3, background: '#171a21' } })
      .composite(thumbs).png().toFile(join(directory, 'contact-sheet.png'));
    console.log(JSON.stringify({ files, contactSheet: join(directory, 'contact-sheet.png') }));
  }
  await main();
}
run().catch(error => { console.error(error instanceof Error ? error.message : 'Midjourney trial failed.'); process.exitCode = 1; });
