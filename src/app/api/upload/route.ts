import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

function isHeicFile(file: File): boolean {
  return file.type === 'image/heic' || file.type === 'image/heif'
    || /\.(heic|heif)$/i.test(file.name);
}

function isSupportedImage(file: File): boolean {
  return file.type.startsWith('image/') || isHeicFile(file)
    || /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
}

type HeicConvert = (input: {
  buffer: Buffer | ArrayBuffer | Uint8Array;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<ArrayBuffer | Buffer | Uint8Array>;

async function convertHeicWithJs(buffer: Buffer): Promise<Buffer> {
  const mod = await import('heic-convert');
  const convert = ((mod as { default?: HeicConvert }).default ?? mod) as HeicConvert;
  const output = await convert({ buffer, format: 'JPEG', quality: 0.9 });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof ArrayBuffer) return Buffer.from(new Uint8Array(output));
  return Buffer.from(output);
}

async function convertHeicWithSips(buffer: Buffer): Promise<Buffer> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const inputPath = join(tmpdir(), `upload-${id}.heic`);
  const outputPath = join(tmpdir(), `upload-${id}.jpg`);

  try {
    await writeFile(inputPath, buffer);
    await new Promise<void>((resolve, reject) => {
      execFile('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', inputPath, '--out', outputPath], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return await readFile(outputPath);
  } finally {
    unlink(inputPath).catch(() => {});
    unlink(outputPath).catch(() => {});
  }
}

async function toJpeg(buffer: Buffer, file: File): Promise<Buffer> {
  try {
    return await sharp(buffer)
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (err) {
    if (!isHeicFile(file)) throw err;

    let jpeg: Buffer;
    try {
      jpeg = await convertHeicWithJs(buffer);
    } catch (jsErr) {
      if (process.platform !== 'darwin') throw jsErr;
      jpeg = await convertHeicWithSips(buffer);
    }

    return sharp(jpeg)
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!isSupportedImage(file)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File too large' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const jpegBuffer = await toJpeg(buffer, file);

    const base64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    return NextResponse.json({ image: base64 });
  } catch (error) {
    console.error('Upload conversion error:', error);
    return NextResponse.json({ error: 'Failed to process image' }, { status: 500 });
  }
}
