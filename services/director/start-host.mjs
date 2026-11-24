// Single-key Director for one host, such as the V Voice service on the same machine.
// It accepts only the Makaron key in MAKARON_API_KEY (the host's own key), listens on
// loopback, and forwards opening-image uploads to the public Makaron API with that key.
// No Supabase or Next runtime is needed, unlike start.ts.
import {createHash, timingSafeEqual} from 'node:crypto';
import {createFalClient} from '@fal-ai/director-client';
import {createDirectorServer} from './server.mjs';
import {stageOpeningImage} from './opening-image.mjs';

const env = process.env;
for (const name of ['MAKARON_API_KEY', 'FAL_KEY', 'DEEPSEEK_API_KEY', 'MAKARON_DIRECTOR_STATE_DIR'])
  if (!env[name]) throw Error(`Director host configuration is missing ${name}`);
const digest = (value) => createHash('sha256').update(value).digest();
const expected = digest(`Bearer ${env.MAKARON_API_KEY}`);
const actor = {keyId: 'director-host', userId: 'director-host-owner'};
const fal = createFalClient({credentials: env.FAL_KEY});
const makaron = env.MAKARON_URL || 'https://www.makaron.app';
const port = Number(env.MAKARON_DIRECTOR_PORT) || 43936;

createDirectorServer({
  directory: env.MAKARON_DIRECTOR_STATE_DIR,
  providerKey: env.FAL_KEY,
  maxSeconds: Math.min(600, Math.max(30, Number(env.MAKARON_DIRECTOR_MAX_SECONDS) || 120)),
  stageImage: (source) => stageOpeningImage(source, {
    boardOrigin: env.MAKARON_DIRECTOR_BOARD_ORIGIN,
    upload: (file) => fal.storage.upload(file, {lifecycle: {expiresIn: '1h'}}),
  }),
  async authenticate(value) {
    return typeof value === 'string' && timingSafeEqual(digest(value), expected) ? actor : null;
  },
  async activeKey(keyId, userId) {
    return keyId === actor.keyId && userId === actor.userId;
  },
  openingUpload: (authorization, filename, contentType) => fetch(new URL('/api/storage/upload-url', makaron), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: {authorization, 'content-type': 'application/json'},
    body: JSON.stringify({filename, contentType}),
  }),
}).listen(port, '127.0.0.1', () => console.log(JSON.stringify({component: 'director-host', ready: true, port})));
