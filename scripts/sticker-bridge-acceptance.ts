import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { prepareChromaKeyCutout, renderCutoutContactSheet } from '../src/lib/visual-assets/image-cutout';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function makeAdversarialFixture(): Promise<Buffer> {
  return sharp(Buffer.from(`<svg width="768" height="768" xmlns="http://www.w3.org/2000/svg">
    <rect width="768" height="768" fill="#00ff00"/>
    <g>
      <path d="M384 92 C365 54 372 32 408 22" stroke="#6f35dc" stroke-width="24" stroke-linecap="round" fill="none"/>
      <path d="M213 193 Q384 95 555 193 L527 250 Q384 197 241 250 Z" fill="#2c155e" stroke="#31ef38" stroke-width="7"/>
      <rect x="185" y="202" width="398" height="432" rx="178" fill="#5125a8" stroke="#24ed31" stroke-width="6"/>
      <ellipse cx="312" cy="347" rx="39" ry="49" fill="#fffafc"/>
      <ellipse cx="456" cy="347" rx="39" ry="49" fill="#fffafc"/>
      <circle cx="322" cy="358" r="15" fill="#140d2d"/>
      <circle cx="446" cy="358" r="15" fill="#140d2d"/>
      <path d="M305 481 Q384 545 463 481" stroke="#f3d6ff" stroke-width="22" stroke-linecap="round" fill="none"/>
      <rect x="381" y="436" width="6" height="6" fill="#00ee00"/>
      <path d="M210 441 Q116 464 124 562" stroke="#7439df" stroke-width="30" stroke-linecap="round" fill="none"/>
      <path d="M558 441 Q652 464 644 562" stroke="#7439df" stroke-width="30" stroke-linecap="round" fill="none"/>
      <path d="M295 620 Q275 689 239 706" stroke="#3a1c80" stroke-width="32" stroke-linecap="round" fill="none"/>
      <path d="M473 620 Q493 689 529 706" stroke="#3a1c80" stroke-width="32" stroke-linecap="round" fill="none"/>
      <circle cx="650" cy="146" r="58" fill="#00ff00" stroke="#7439df" stroke-width="18"/>
    </g>
  </svg>`)).png().toBuffer();
}

async function main() {
  const sourcePath = arg('--source');
  const outDir = path.resolve(arg('--out') || '/tmp/makaron-sticker-bridge-acceptance');
  const keyColor = arg('--key-color');
  await mkdir(outDir, { recursive: true });
  const source = sourcePath ? await readFile(path.resolve(sourcePath)) : await makeAdversarialFixture();
  const result = await prepareChromaKeyCutout(source, { keyColor });
  const contactSheet = await renderCutoutContactSheet(result.png);
  const sourceOutput = path.join(outDir, '01-chroma-source.png');
  const cutoutOutput = path.join(outDir, '02-transparent-cutout.png');
  const qaOutput = path.join(outDir, '03-five-background-qa.png');
  const reportOutput = path.join(outDir, 'acceptance.json');
  await Promise.all([
    writeFile(sourceOutput, source),
    writeFile(cutoutOutput, result.png),
    writeFile(qaOutput, contactSheet),
    writeFile(reportOutput, JSON.stringify({
      status: result.quality.status,
      source: sourcePath ? path.resolve(sourcePath) : 'generated-adversarial-fixture',
      keyColor: result.keyColor,
      width: result.width,
      height: result.height,
      subjectBox: result.subjectBox,
      safeArea: result.safeArea,
      quality: result.quality,
      outputs: { sourceOutput, cutoutOutput, qaOutput },
    }, null, 2)),
  ]);
  console.log(JSON.stringify({
    status: result.quality.status,
    issues: result.quality.issues,
    metrics: result.quality.metrics,
    outputs: { sourceOutput, cutoutOutput, qaOutput, reportOutput },
  }, null, 2));
  if (result.quality.status !== 'pass') process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
