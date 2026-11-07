/** Explicit, paid smoke on public first-party fixtures. No product ledger writes. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeVideoWithProvider } from '../src/lib/video-analysis';
import { analyzeVideoWithRouting } from '../src/lib/gemini-video-subscription';
import { isAdmin } from '../src/lib/admin';

async function main() {
  if (!process.argv.includes('--run-api')) {
    console.info('No model requests made. Use --run-api after loading private credentials. Optional --compare-current requires GEMINI_VIDEO_RELAY_TEST_USER_ID.');
    return;
  }
  const compare = process.argv.includes('--compare-current');
  const userId = process.env.GEMINI_VIDEO_RELAY_TEST_USER_ID;
  if (compare && (!userId || !await isAdmin(userId))) throw new Error('An existing administrator is required for the comparison.');
  const directory = resolve(process.env.GEMINI_VIDEO_CHECK_OUTPUT || '/tmp/makaron-gemini-video-check');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const rows: unknown[] = [];
  const question = '请用中文准确描述开场、镜头运动、中段变化、结尾画面和声音。给出时间位置；不确定的细节明确说不确定，不要把画面中的主体替换成别的事物。';
  for (const fixture of ['floral-v2', 'android-v2', 'cloud-house-v2']) {
    const url = `https://www.makaron.app/home-hero/${fixture}.mp4`;
    for (const route of compare ? ['api', 'candidate-current'] : ['api']) {
      process.env.GEMINI_VIDEO_RELAY_ENABLED = route === 'api' ? 'false' : 'true';
      const started = Date.now();
      try {
        const result = route === 'api' ? await analyzeVideoWithProvider(url, question)
          : await analyzeVideoWithRouting(url, question, userId);
        rows.push({ fixture, route, status: 'success', ...result });
        console.info(JSON.stringify({ fixture, route, provider: result.provider, actualModel: result.reportedModel,
          elapsedMs: result.elapsedMs, fallbackReason: result.fallbackReason ?? null }));
      } catch {
        process.exitCode = 1;
        rows.push({ fixture, route, status: 'failed', elapsedMs: Date.now() - started });
        console.error(JSON.stringify({ fixture, route, status: 'failed' }));
      }
      await writeFile(resolve(directory, 'smoke.json'), JSON.stringify({
        checkedAt: new Date().toISOString(), location: 'operator Mac, not a Vercel deployment',
        question, note: 'candidate-current may be an API fallback. Only provider=gemini-subscription is a Relay result. These are three distinct fixtures, not latency percentiles or a quality non-regression acceptance.', rows,
      }, null, 2), { mode: 0o600 });
    }
  }
}

main().catch(() => { console.error('Video check failed; inspect private configuration.'); process.exitCode = 1; });
