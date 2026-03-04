import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InferenceClient } from '@huggingface/inference';

export const maxDuration = 120;

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

    // Convert base64/dataurl to Blob
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: 'image/jpeg' });

    const client = new InferenceClient(HF_TOKEN);
    const result = await client.imageToImage({
      provider: 'fal-ai',
      model: 'fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA',
      inputs: blob,
      parameters: { prompt },
    });

    // result is a Blob — convert to base64
    const arrayBuf = await result.arrayBuffer();
    const resultBase64 = `data:image/jpeg;base64,${Buffer.from(arrayBuf).toString('base64')}`;

    return Response.json({ image: resultBase64 });
  } catch (error) {
    console.error('Rotate API error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to generate rotated view' },
      { status: 500 },
    );
  }
}
