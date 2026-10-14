/** Bounded real-provider experiment. Private input/results stay outside Git.
 * Usage: node --import tsx .../experiment.ts <submit|poll|transcribe> <private-dir>
 * input.json: { images: [presenterUrl, productUrl], budgetUsd: 10 }
 * Load credentials in the parent process. Never automatically resubmit.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createEvolinkTask, getEvolinkTask } from '../../src/lib/evolink';
import { transcribeWithVolcengineAsr } from '../../src/lib/volcengine-asr';
import { estimateVideoProviderCostUsd } from '../../src/lib/video-model-capabilities';

export const lines = [
  'Meet the TT04S — a stainless-steel range hood built for hard-working kitchens.',
  'Its 900-by-480 canopy covers more of your hob, so smoke never gets away.',
  'Three stainless-steel filters wash clean again and again — no replacements, ever.',
  'An iron fan and housing outlast plastic, with a sealed 180-watt motor and a 3-year warranty.',
  'Oil drains into the cup; add carbon filters for duct-free air. TT04S — cleaner air, easier living.',
];
const visuals = [
  'Modern warm kitchen, medium frontal shot of the presenter beside the complete hood.',
  'Overhead product canopy and hob coverage, slow stable push, preserve the exact product.',
  'Three steel filters: remove, rinse with water, reinstall. Continuous plausible action.',
  'Restrained technical illustration of iron fan/housing and sealed motor, then presenter gestures to the same product.',
  'Oil cup and optional carbon filter in a clearly illustrative detail, resolve on the same product and presenter.',
];
function prompt(nativeCaptions: boolean): string {
  return [
    'TT04S Presenter Intro',
    '25 seconds, 9:16 vertical commercial. Image 1 is the sole presenter identity: same face, beige headscarf, black abaya. She is empty-handed with small natural gestures. Image 2 is the sole stainless-steel hood product: preserve its exact canopy, chimney, proportions and material. No other faces or brands.',
    'Generate the complete synchronized soundtrack WITH the picture: one warm clear female international English voice; same voice throughout; visible mouth matches her speech whenever she is on camera. Music is clean, upbeat, modern and instrumental, softly ducked under all speech. No extra voices. Speak every supplied line exactly, clearly pronounce TT04S as tee tee zero four ess, 900-by-480 as nine hundred by four hundred eighty, 180-watt as one hundred eighty watt. Complete the last line within 25 seconds.',
    ...lines.map((line, i) => `Shot ${i + 1} (${i * 5}–${(i + 1) * 5}s): ${visuals[i]} The SAME presenter says: "${line}"`),
    nativeCaptions
      ? 'Render accurate English captions matching the spoken words, one bottom-centered subtitle layer, at most two lines, comfortable safe margins, clear white type on a subtle dark backing. Keep TT04S in the upper right throughout; end with the exact company name 中山市沪颖电器有限公司. No misspellings or extra text.'
      : 'Do not render subtitles, labels, logos or any other text. Preserve a clear lower subtitle-safe area and upper-right corner for subsequent caption and TT04S overlay. This text-only post-production requirement does NOT remove the generated voice, lip sync or music.',
  ].join('\n');
}

type Sample = { variant: string; prompt: string; reservedUsd: number; submittedAt: string; taskId?: string; status?: string; readyAt?: string; error?: string };
async function main() {
  const [operation, directory] = process.argv.slice(2);
  if (!directory || !['submit', 'poll', 'transcribe'].includes(operation)) throw new Error('Expected submit|poll|transcribe <private-dir>');
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });
  const input = JSON.parse(await readFile(path.join(root, 'input.json'), 'utf8')) as { images: string[]; budgetUsd: number };
  if (input.images.length !== 2 || input.budgetUsd > 10) throw new Error('This experiment requires exactly two verified references and a ceiling of $10.');
  const statePath = path.join(root, 'state.json');
  const samples: Sample[] = await readFile(statePath, 'utf8').then(JSON.parse).catch((e: NodeJS.ErrnoException) => { if(e.code === 'ENOENT') return []; throw e; });
  const save = () => writeFile(statePath, JSON.stringify(samples, null, 2), { mode: 0o600 });
  if (operation === 'submit') {
    // Reserve BEFORE submission, including ambiguous transport failures. Never
    // reuse a variant reservation or spend the ASR/overrun reserve on retries.
    const quote = estimateVideoProviderCostUsd({ model: 'seedance-2.5', resolution: '480p', durationSec: 25 });
    if (!quote || quote * 2 + 1 > input.budgetUsd) throw new Error('Two generations plus the $1 reserve exceed the approved budget.');
    for (const variant of ['native-captions', 'post-captions']) {
      if (samples.some(s => s.variant === variant)) continue;
      const sample: Sample = { variant, prompt: prompt(variant === 'native-captions'), reservedUsd: quote, submittedAt: new Date().toISOString(), status: 'submitting' };
      samples.push(sample);
      await save();
      try {
        sample.taskId = await createEvolinkTask({ prompt: sample.prompt, images: input.images, duration: 25, aspectRatio: '9:16', quality: '480p', model: 'seedance-2.5-reference-to-video', generateAudio: true, contentFilter: true });
        sample.status = 'pending';
      } catch (error) {
        sample.status = 'submission-error';
        sample.error = error instanceof Error ? error.message : String(error);
      }
      await save();
      console.log(JSON.stringify({ variant, taskId: sample.taskId, status: sample.status, reservedUsd: quote }));
    }
  } else if (operation === 'poll') {
    for (const sample of samples) {
      if (!sample.taskId || ['completed', 'failed'].includes(sample.status || '')) continue;
      const result = await getEvolinkTask(sample.taskId);
      sample.status = result.status;
      sample.error = result.error;
      if (result.status === 'completed' && result.videoUrl) {
        const response = await fetch(result.videoUrl);
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        await writeFile(path.join(root, sample.variant + '.mp4'), Buffer.from(await response.arrayBuffer()));
        sample.readyAt = new Date().toISOString();
        const probe = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(root, sample.variant + '.mp4')], { encoding: 'utf8' });
        await writeFile(path.join(root, sample.variant + '.probe.json'), probe);
      }
      await save();
      console.log(JSON.stringify({ variant: sample.variant, status: sample.status, error: sample.error, readyAt: sample.readyAt }));
    }
  } else {
    for (const sample of samples.filter(s => s.status === 'completed')) {
      const target = path.join(root, sample.variant + '.asr.json');
      if (await readFile(target).then(() => true).catch(() => false)) continue;
      const transcript = await transcribeWithVolcengineAsr({ mediaUrl: 'https://local.invalid/' + sample.variant + '.mp4', localMediaPath: path.join(root, sample.variant + '.mp4'), language: 'en', requestId: 'studio-native-' + sample.variant });
      await writeFile(target, JSON.stringify(transcript, null, 2));
      console.log(sample.variant, transcript.text);
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
