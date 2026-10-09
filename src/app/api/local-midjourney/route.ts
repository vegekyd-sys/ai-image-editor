import { NextResponse } from 'next/server';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { isLocalMidjourneyRequest, listLocalMidjourneyRecords, localMidjourneyDirectory, localMidjourneyView, readLocalMidjourneyRecord, refreshLocalMidjourneyRecord, submitLocalMidjourney } from '@/lib/midjourney-local-lab';
import { prepareMidjourneyPrompt } from '@/lib/midjourney-prompt';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: Request) {
  if (!isLocalMidjourneyRequest(request)) return new NextResponse(null, { status: 404 });
  const query = new URL(request.url).searchParams;
  try {
    const id = query.get('id');
    if (!id) return NextResponse.json({ records: await listLocalMidjourneyRecords() });
    const image = query.get('image');
    if (image !== null) {
      const index = z.coerce.number().int().min(0).max(23).parse(image);
      const record = await readLocalMidjourneyRecord(id);
      const candidate = record.task?.status === 'completed' ? record.task.images.find(item => item.index === index) : undefined;
      if (!candidate) return NextResponse.json({ error: 'image_unavailable' }, { status: 404 });
      const path = join(localMidjourneyDirectory(), `${record.id}-${index}.png`);
      let bytes: Buffer | null = await readFile(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!bytes) {
        const result = await fetch(candidate.url, { redirect: 'error', signal: AbortSignal.timeout(45_000) });
        if (!result.ok) throw new Error('download_failed');
        const buffer = Buffer.from(await result.arrayBuffer());
        if (buffer.length > 30 * 1024 * 1024) throw new Error('image_too_large');
        const decoded = await sharp(buffer, { limitInputPixels: 32_000_000 }).png().toBuffer();
        const temporary = `${path}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, decoded, { mode: 0o600 });
        await rename(temporary, path);
        bytes = decoded;
      }
      return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', ...(query.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="midjourney-${index + 1}.png"` } : {}) } });
    }
    return NextResponse.json(localMidjourneyView(await refreshLocalMidjourneyRecord(id)));
  } catch {
    return NextResponse.json({ error: 'query_failed' }, { status: 502 });
  }
}
export async function POST(request: Request) {
  if (!isLocalMidjourneyRequest(request)) return new NextResponse(null, { status: 404 });
  try {
    const body = await request.json();
    if (body.action === 'prepare') {
      const input = z.object({ action: z.literal('prepare'), brief: z.string().min(1).max(4000), hasStyleReference: z.boolean().optional() }).strict().parse(body);
      return NextResponse.json({ request: await prepareMidjourneyPrompt(input.brief, input.hasStyleReference) });
    }
    if (body.action !== 'submit') return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    const { action: _action, ...input } = body;
    return NextResponse.json(localMidjourneyView(await submitLocalMidjourney(input)));
  } catch {
    return NextResponse.json({ error: 'prepare_or_submit_failed' }, { status: 400 });
  }
}
