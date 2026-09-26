/** Real provider smoke for the Vast retirement candidate. Does not touch Vast. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { qwenSpicyBackend } from '../src/lib/models/qwen-spicy';
import { rotateCamera } from '../src/lib/skills/rotate-camera';

const outputDir = path.resolve('test-results/vast-retirement');

async function saveImage(name: string, image: string) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(image);
  if (!match) throw new Error(`${name} did not return an image data URL`);
  const bytes = Buffer.from(match[1], 'base64');
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  const file = path.join(outputDir, `${name}.${metadata.format === 'jpeg' ? 'jpg' : metadata.format ?? 'bin'}`);
  await writeFile(file, bytes);
  return { file, width: metadata.width, height: metadata.height, bytes: bytes.length };
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  if (process.argv.includes('--fal-only')) {
    const fixture = await readFile('public/landing/uc-retouch.jpg');
    const cropped = await sharp(fixture).extract({ left: 680, top: 0, width: 600, height: 600 }).jpeg().toBuffer();
    const started = Date.now();
    const rotated = await rotateCamera(
      { azimuth: 45, elevation: 0, distance: 1 },
      { currentImage: `data:image/jpeg;base64,${cropped.toString('base64')}` },
    );
    if (!rotated.success || !rotated.image || rotated.provider !== 'fal') throw new Error(rotated.message);
    console.log(JSON.stringify({ camera: { ...await saveImage('03-fal-rotate', rotated.image), ms: Date.now() - started } }, null, 2));
    return;
  }
  if (process.argv.includes('--spicy-edit-only')) {
    const fixture = await readFile('public/landing/uc-retouch.jpg');
    const cropped = await sharp(fixture).extract({ left: 680, top: 0, width: 600, height: 600 }).jpeg().toBuffer();
    const started = Date.now();
    const edited = await qwenSpicyBackend.generate({
      image: `data:image/jpeg;base64,${cropped.toString('base64')}`,
      prompt: 'This is a clearly adult woman, age 30. Restyle her portrait as tasteful editorial boudoir photography with an elegant black lace lingerie top and a draped satin robe. Preserve her identity and face, keep the image non-explicit, and do not add text.',
      isNsfw: true,
    });
    if (!edited.image || edited.provider !== 'mulerouter') throw new Error('Spicy image edit returned no image');
    console.log(JSON.stringify({ imageEdit: { ...await saveImage('02-spicy-edit', edited.image), ms: Date.now() - started } }, null, 2));
    return;
  }
  const start = Date.now();
  const generated = await qwenSpicyBackend.generate({
    prompt: 'Create a tasteful editorial boudoir portrait of a clearly adult woman, age 30, wearing elegant black lace lingerie and a satin robe. Warm cinematic light, confident pose, no nudity or explicit anatomy, no text.',
    isNsfw: true,
  });
  if (!generated.image || generated.provider !== 'mulerouter') {
    throw new Error('NSFW-routed text-to-image failed');
  }
  const textToImage = { ...await saveImage('01-spicy-text', generated.image), model: 'qwen-spicy', ms: Date.now() - start };

  const editStarted = Date.now();
  const edited = await qwenSpicyBackend.generate({
    image: generated.image,
    prompt: 'Keep this clearly adult woman and her face recognizable. Change the satin robe to deep emerald green and the room background to a softly lit art-deco bedroom. Preserve the tasteful lingerie styling, pose, composition, and all other details. No nudity or text.',
    isNsfw: true,
  });
  if (!edited.image || edited.provider !== 'mulerouter') {
    throw new Error('NSFW-routed edit failed');
  }
  const imageEdit = { ...await saveImage('02-spicy-edit', edited.image), model: 'qwen-spicy', ms: Date.now() - editStarted };

  const rotateStarted = Date.now();
  const rotated = await rotateCamera({ azimuth: 45, elevation: 0, distance: 1 }, { currentImage: edited.image });
  if (!rotated.success || !rotated.image || rotated.provider !== 'fal') {
    throw new Error(`fal camera rotation failed: ${rotated.message}`);
  }
  const camera = { ...await saveImage('03-fal-rotate', rotated.image), provider: rotated.provider, ms: Date.now() - rotateStarted };
  console.log(JSON.stringify({ textToImage, imageEdit, camera }, null, 2));
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
