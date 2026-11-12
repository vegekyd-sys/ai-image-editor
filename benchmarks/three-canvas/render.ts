import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateDesign } from '../../src/lib/design-harness';
import { renderDesignFrameLocal, renderDesignVideoLocal } from '../../src/lib/remotion-local-renderer';

async function main() {
  const out = path.resolve(process.argv[2] || 'artifacts/three-canvas');
  await mkdir(out, { recursive: true });
  const code = await readFile('benchmarks/three-canvas/planetary.jsx', 'utf8');
  const design = {
    code, width: 960, height: 540,
    props: {
      title: 'Planetary gears', inputLabel: 'The orange sun gear drives the three blue planet gears.',
      orbitLabel: 'A fixed outer ring makes the planets orbit the sun.',
      outputLabel: 'Four turns at the sun produce one turn at the carrier.', cleanPlate: false,
    },
    animation: { fps: 24, durationInSeconds: 8 },
  };
  const error = validateDesign(design);
  if (error) throw new Error(error);
  await writeFile(path.join(out, 'composition.json'), JSON.stringify(design));
  for (const frame of [0, 72, 191]) {
    await writeFile(path.join(out, 'frame-' + frame + '.jpg'), await renderDesignFrameLocal(design, frame));
  }
  for (const cleanPlate of [false, true]) {
    const buffer = await renderDesignVideoLocal({ ...design, props: { ...design.props, cleanPlate } }, { concurrency: 2 });
    await writeFile(path.join(out, cleanPlate ? 'motion-reference.mp4' : 'planetary-gears.mp4'), buffer);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
