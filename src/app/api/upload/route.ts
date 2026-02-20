import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import sharp from 'sharp';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

async function convertHeicWithSips(buffer: Buffer): Promise<Buffer> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const inputPath = join(tmpdir(), `upload-${id}.heic`);
  const outputPath = join(tmpdir(), `upload-${id}.jpg`);

  await writeFile(inputPath, buffer);
  await new Promise<void>((resolve, reject) => {
    execFile('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', inputPath, '--out', outputPath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const jpegBuffer = await readFile(outputPath);
  unlink(inputPath).catch(() => {});
  unlink(outputPath).catch(() => {});
  return jpegBuffer;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif'
      || /\.(heic|heif)$/i.test(file.name);

    let inputBuffer: Buffer<ArrayBuffer> = buffer;
    if (isHeic) {
      // sips (macOS) handles HEIC → JPEG conversion
      inputBuffer = await convertHeicWithSips(buffer) as Buffer<ArrayBuffer>;
    }

    const jpegBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const base64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    return NextResponse.json({ image: base64 });
  } catch (error) {
    console.error('Upload conversion error:', error);
    return NextResponse.json({ error: 'Failed to process image' }, { status: 500 });
  }
}
