import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

export const directorHelp = `makaron director start --prompt <scene> [--image <file|https-url>] [--resolution 480p|768p] [--aspect-ratio 16:9|9:16|1:1] [--memory 1-50] [--seed n] [--open] [--json]
makaron director open <session>
makaron director direct <session> <direction>
makaron director status <session>
makaron director stop <session>
makaron director export <session> --output <file>
Use the player for live voice or text, preview and recording. The player link is private.
Use --request-id <uuid> to recover the same start after a connection failure.`;

export async function runDirector(argv, getAuth, uploadImage) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      prompt: { type: 'string' },
      image: { type: 'string' },
      open: { type: 'boolean' },
      json: { type: 'boolean' },
      resolution: { type: 'string' },
      'aspect-ratio': { type: 'string' },
      memory: { type: 'string' },
      seed: { type: 'string' },
      host: { type: 'boolean' },
      'turn-id': { type: 'string' },
      output: { type: 'string' },
      'request-id': { type: 'string' },
    },
  });
  const [action, id, ...words] = positionals;
  if (!['start', 'open', 'direct', 'status', 'stop', 'export'].includes(action))
    throw Error(directorHelp);
  if (action === 'start' ? !values.prompt?.trim() || id : !id || (action !== 'direct' && words.length))
    throw Error(directorHelp);
  if ((action === 'direct' && !words.join(' ').trim()) || (action === 'export' && !values.output))
    throw Error(directorHelp);
  const { baseUrl, headers } = getAuth();
  const directorUrl = new URL(process.env.MAKARON_DIRECTOR_URL || baseUrl);
  if (
    directorUrl.protocol !== 'https:' &&
    !(
      directorUrl.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(directorUrl.hostname)
    )
  )
    throw Error('Director requires HTTPS or loopback');
  let image = values.image;
  if (image && !/^https:\/\//i.test(image)) {
    image = await uploadImage(directorUrl.origin, headers, image);
    if (!image) throw Error('Opening image upload failed');
  }
  const payload =
    action === 'start'
      ? {
          action,
          prompt: values.prompt,
          image,
          resolution: values.resolution,
          aspectRatio: values['aspect-ratio'],
          memory: values.memory,
          seed: values.seed,
          requestId: values['request-id'] || randomUUID(),
        }
      : { action, id, text: words.join(' '), turnId: values['turn-id'], host: values.host };
  if (action === 'start') process.stderr.write('Director request ID: ' + payload.requestId + '\n');
  const res = await fetch(new URL('/api/director', directorUrl), {
    method: 'POST',
    redirect: 'error',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw Error(e.error || 'Director returned HTTP ' + res.status);
  }
  if (action === 'export') {
    const ext = res.headers.get('content-type')?.includes('mp4') ? '.mp4' : '.webm';
    if (path.extname(values.output).toLowerCase() !== ext)
      throw Error('Use ' + ext + ' for this recording');
    const tmp = values.output + '.' + randomUUID() + '.part';
    try {
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
      await link(tmp, values.output);
    } finally {
      await rm(tmp, { force: true });
    }
    console.log(values.output);
    return;
  }
  const result = await res.json();
  if ((action === 'open' || values.open) && result.playerPath) {
    const url = new URL(result.playerPath, directorUrl);
    if (url.origin !== directorUrl.origin) throw Error('Unexpected Director player origin');
    const exe =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href];
    const child = spawn(exe, args, { stdio: 'ignore', detached: true });
    await new Promise((ok, fail) => {
      child.once('spawn', ok);
      child.once('error', fail);
    });
    child.unref();
  }
  console.log(JSON.stringify(result, null, values.json ? 0 : 2));
}
