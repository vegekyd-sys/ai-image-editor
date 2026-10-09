import { mkdir, readFile, readdir, open, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { MidjourneyClient, MidjourneyRequestError, buildMidjourneyRequest, type MidjourneyRequest, type MidjourneyTask } from './midjourney';
export { isLocalMidjourneyRequest } from './midjourney-local-access';

export interface LocalMidjourneyRecord {
  id: string;
  brief: string;
  request: MidjourneyRequest;
  createdAt: string;
  state: 'submitting' | 'submitted' | 'unknown' | 'rejected';
  task?: MidjourneyTask;
  recoverableTaskId?: string;
}
const idSchema = z.string().uuid();
const submitSchema = z.object({
  id: idSchema, brief: z.string().max(4000), request: z.unknown(),
  styleFrom: z.object({ id: idSchema, index: z.number().int().min(0).max(23) }).optional(),
  hdFrom: idSchema.optional(),
}).strict();
export const localMidjourneyDirectory = () => join(process.cwd(), '.midjourney-lab');
function recordPath(id: string) { return join(localMidjourneyDirectory(), `${idSchema.parse(id)}.json`); }

export async function readLocalMidjourneyRecord(id: string): Promise<LocalMidjourneyRecord> {
  return JSON.parse(await readFile(recordPath(id), 'utf8'));
}
async function saveRecord(record: LocalMidjourneyRecord) {
  const path = recordPath(record.id);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, path);
}
export function localMidjourneyView(record: LocalMidjourneyRecord) {
  return {
    id: record.id, brief: record.brief, request: { ...record.request, styleReferences: undefined, imageUrls: undefined },
    createdAt: record.createdAt, state: record.state, status: record.task?.status,
    progress: record.task?.progress, cost: record.task?.providerCostUsd, errorCode: record.task?.errorCode,
    images: record.task?.status === 'completed' ? record.task.images.map(image => ({ index: image.index, url: `/api/local-midjourney?id=${record.id}&image=${image.index}` })) : [],
  };
}
export async function submitLocalMidjourney(input: unknown, client = new MidjourneyClient()): Promise<LocalMidjourneyRecord> {
  const data = submitSchema.parse(input);
  // The idempotency key represents one request; a duplicate never creates a new POST.
  try { return await readLocalMidjourneyRecord(data.id); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let request = data.request as MidjourneyRequest;
  if (data.hdFrom) {
    const source = await readLocalMidjourneyRecord(data.hdFrom);
    if (source.task?.status !== 'completed') throw new Error('source_not_completed');
    request = { ...source.request, quality: 'hd', speed: 'fast' };
  } else if (data.styleFrom) {
    const source = await readLocalMidjourneyRecord(data.styleFrom.id);
    const image = source.task?.status === 'completed' ? source.task.images.find(image => image.index === data.styleFrom!.index) : undefined;
    if (!image) throw new Error('source_not_completed');
    request = { ...request, styleReferences: [image.url], styleWeight: 300 };
  }
  buildMidjourneyRequest(request);
  const record: LocalMidjourneyRecord = { id: data.id, brief: data.brief, request, createdAt: new Date().toISOString(), state: 'submitting' };
  await mkdir(localMidjourneyDirectory(), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(recordPath(data.id), 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readLocalMidjourneyRecord(data.id);
    throw error;
  }
  try {
    record.task = await client.submit(request);
    record.state = 'submitted';
  } catch (error) {
    record.state = error instanceof MidjourneyRequestError && ['not_submitted', 'rejected'].includes(error.outcome) ? 'rejected' : 'unknown';
    if (error instanceof MidjourneyRequestError) record.recoverableTaskId = error.taskId;
  }
  await saveRecord(record);
  return record;
}
export async function refreshLocalMidjourneyRecord(id: string, client = new MidjourneyClient()) {
  const record = await readLocalMidjourneyRecord(id);
  const taskId = record.task?.taskId ?? record.recoverableTaskId;
  if (!taskId && record.state === 'submitting' && Date.now() - Date.parse(record.createdAt) > 120_000) {
    record.state = 'unknown';
    await saveRecord(record);
  }
  if (taskId && !['completed', 'failed'].includes(record.task?.status ?? '')) {
    record.task = await client.get(taskId);
    record.state = 'submitted';
    await saveRecord(record);
  }
  return record;
}
export async function listLocalMidjourneyRecords() {
  const paths = await readdir(localMidjourneyDirectory()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const records = await Promise.all(paths.filter(path => /^[a-f\d-]{36}\.json$/i.test(path)).map(path => readLocalMidjourneyRecord(path.slice(0, -5))));
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(localMidjourneyView);
}
