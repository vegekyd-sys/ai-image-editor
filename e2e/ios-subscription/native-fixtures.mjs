import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(root + '/package.json');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const sharp = require('sharp');
const env = JSON.parse(fs.readFileSync(process.env.MAKARON_E2E_RUNTIME_FILE || '/tmp/makaron-local-live-runtime/runtime-private.json'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:55321');
assert.equal(env.MAKARON_E2E, '1');
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const checked = result => {if (result.error) throw Error(result.error.message);return result.data;};
const directory = process.env.MAKARON_E2E_NATIVE_ARTIFACTS || '/tmp/makaron-ios-free-media-evidence';
const simulator = process.env.MAKARON_E2E_SIMULATOR_ID;
assert.match(simulator || '', /^[0-9a-f-]{36}$/i, 'Provide the owned test simulator ID');
fs.mkdirSync(directory, { recursive: true });
const seeded = new Map();
async function ownUser(email) {
  assert.match(email, /^ios-free-media\+[a-z0-9-]+@e2e\.makaron\.test$/);
  const { users } = checked(await db.auth.admin.listUsers({ perPage: 1000 }));
  const user = users.find(user => user.email === email && user.email_confirmed_at);
  assert.ok(user, 'Expected a UI-registered, verified local test account');
  return user;
}
async function seed(email) {
  if (seeded.has(email)) return seeded.get(email);
  const user = await ownUser(email), fixtures = [];
  const retained = `${directory}/${user.id}-fixtures.json`;
  if (fs.existsSync(retained)) {
    const previous = JSON.parse(fs.readFileSync(retained));
    checked(await db.from('projects').update({ timeline_version: 2 }).eq('user_id', user.id).in('id', previous.fixtures.map(item => item.projectId)));
    return previous;
  }
  for (const kind of ['image', 'video']) {
    const original = kind === 'video' ? fs.readFileSync(process.env.MAKARON_E2E_NATIVE_VIDEO || '/tmp/makaron-h3-reference-fixed.mp4')
      : await sharp(process.env.MAKARON_E2E_NATIVE_IMAGE || '/tmp/makaron-h3-reference-fixed-frame.png').resize(768, 1024).png().toBuffer();
    const projectId = randomUUID(), messageId = randomUUID(), key = `${user.id}/native-${kind}.${kind === 'video' ? 'mp4' : 'png'}`;
    checked(await db.storage.from('images').upload(key, original, { contentType: kind === 'video' ? 'video/mp4' : 'image/png' }));
    const source = db.storage.from('images').getPublicUrl(key).data.publicUrl;
    const title = kind === 'image' ? 'iOS Save Image' : 'iOS Save Video';
    checked(await db.from('projects').insert({ id: projectId, user_id: user.id, title, timeline_version: 2 }));
    checked(await db.from('messages').insert({ id: messageId, project_id: projectId, role: 'assistant', content: 'Native media acceptance fixture', has_image: true }));
    checked(await db.from('snapshots').insert({ id: randomUUID(), project_id: projectId, message_id: messageId, image_url: kind === 'image' ? source : '', type: kind === 'video' ? 'video' : 'edit',
      tips: kind === 'image' ? [{ emoji: '+', label: 'Fixture', desc: 'Cached acceptance', editPrompt: 'Fixture', category: 'creative', previewStatus: 'done', previewImage: source }] : [],
      video_meta: kind === 'video' ? { status: 'completed', model: 'fal-h3-max', prompt: 'Real H3 artifact, native-save fixture', sourceSnapshotIds: [], sourceUrls: [], duration: 10.144, width: 768, height: 768, aspectRatio: '1:1', videoUrl: source, taskId: 'native-' + projectId } : null }));
    fs.writeFileSync(`${directory}/${user.id}-${kind}-original.${kind === 'video' ? 'mp4' : 'png'}`, original);
    fixtures.push({ kind, title, projectId, source });
  }
  const result = { userId: user.id, email, fixtures };
  seeded.set(email, result);
  fs.writeFileSync(`${directory}/${user.id}-fixtures.json`, JSON.stringify(result, null, 2));
  return result;
}
async function state(email) {
  const user = await ownUser(email);
  const balance = checked(await db.from('credit_balances').select('*').eq('user_id', user.id).single());
  const purchases = checked(await db.from('credit_purchases').select('id,provider,apple_transaction_id,apple_environment,amount_usd,credits,source,status').eq('user_id', user.id));
  const result = { userId: user.id, email, balance, purchases };
  fs.writeFileSync(`${directory}/${user.id}-state.json`, JSON.stringify(result, null, 2));
  return result;
}
async function storeKitHistory(email) {
  await ownUser(email);
  const rows = checked(await db.from('credit_purchases').select('user_id,apple_transaction_id')
    .eq('provider', 'apple').eq('apple_environment', 'Xcode'));
  const transactions = rows.filter(row => /^\d+$/.test(row.apple_transaction_id));
  assert.ok(transactions.length < 100, 'Unexpected local StoreKit history');
  return { transactions };
}
async function photos(email) {
  await ownUser(email);
  const dcim = path.join(process.env.HOME, 'Library/Developer/CoreSimulator/Devices', simulator, 'data/Media/DCIM');
  return { files: fs.readdirSync(dcim, { recursive: true }).filter(name => /\.(jpg|png|heic|mov|mp4)$/i.test(name)) };
}
async function paidFixture(email) {
  const user = await ownUser(email);
  const sessionId = 'native-clean-original-fixture-' + user.id;
  checked(await db.from('credit_purchases').upsert({ user_id: user.id, stripe_session_id: sessionId, credits: 500, amount_usd: 4.99, source: 'topup', status: 'completed', provider: 'stripe' }, { onConflict: 'stripe_session_id' }));
  return { userId: user.id, fixture: 'deterministic-local-stripe-entitlement' };
}
async function session(email) {
  const user = await ownUser(email), cookies = [];
  const auth = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: values => cookies.push(...values) },
  });
  const signed = checked(await auth.auth.signInWithPassword({ email, password: 'E2ePass123!' }));
  assert.equal(signed.user.id, user.id);
  return { userId: user.id, cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:3004'), email = url.searchParams.get('email');
    assert.equal(req.socket.remoteAddress, '127.0.0.1');
    const result = url.pathname === '/seed' ? await seed(email) : url.pathname === '/state' ? await state(email) : url.pathname === '/storekit-history' ? await storeKitHistory(email) : url.pathname === '/photos' ? await photos(email) : url.pathname === '/session' ? await session(email) : url.pathname === '/paid-fixture' && req.method === 'POST' ? await paidFixture(email) : url.pathname === '/health' ? { e2e: true, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL } : null;
    assert.ok(result, 'Unknown fixture endpoint');
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (error) {res.writeHead(400).end(JSON.stringify({ error: error.message }));}
});
server.listen(3004, '127.0.0.1', () => console.log('Local-only native fixtures ready on port 3004'));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
