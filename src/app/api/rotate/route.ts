import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InferenceClient } from '@huggingface/inference';

export const maxDuration = 300;

const HF_TOKEN = process.env.HF_TOKEN;

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { image, prompt } = await req.json();
    if (!image || !prompt) {
      return Response.json({ error: 'image and prompt are required' }, { status: 400 });
    }

    if (!HF_TOKEN) {
      return Response.json({ error: 'HF_TOKEN not configured' }, { status: 500 });
    }

    // Convert image (URL or base64 dataurl) to Uint8Array for Blob
    let imgBytes: Uint8Array;
    if (image.startsWith('http')) {
      const res = await fetch(image);
      imgBytes = new Uint8Array(await res.arrayBuffer());
    } else {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(base64Data, 'base64');
      imgBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const blob = new Blob([imgBytes as BlobPart], { type: 'image/jpeg' });

    const client = new InferenceClient(HF_TOKEN);
    const result = await client.imageToImage({
      provider: 'fal-ai',
      model: 'fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA',
      inputs: blob,
      parameters: { prompt },
    });

    // result is a Blob — convert to base64
    const resultBuf = Buffer.from(await result.arrayBuffer());
    const resultBase64 = `data:image/jpeg;base64,${resultBuf.toString('base64')}`;

    return Response.json({ image: resultBase64 });
  } catch (error) {
    console.error('Rotate API error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to generate rotated view' },
      { status: 500 },
    );
  }
}
