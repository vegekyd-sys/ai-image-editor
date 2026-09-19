#!/usr/bin/env node

import { createHash, createHmac, randomUUID } from 'node:crypto';

const relayUrl = process.env.GROK_SUBSCRIPTION_RELAY_URL?.trim() || 'http://127.0.0.1:25985';
const secret = process.env.GROK_SUBSCRIPTION_RELAY_SECRET?.trim();
const userId = process.env.GROK_SUBSCRIPTION_OWNER_USER_ID?.trim();
if (!secret || !userId) throw new Error('relay secret and owner user id are required');

async function signedFetch(method, pathname, body = Buffer.alloc(0)) {
  const timestamp = String(Date.now());
  const requestId = randomUUID();
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = [method, pathname, timestamp, requestId, userId, bodyHash].join('\n');
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  return fetch(new URL(pathname, relayUrl), {
    method,
    headers: {
      'x-makaron-relay-timestamp': timestamp,
      'x-makaron-relay-request-id': requestId,
      'x-makaron-relay-user-id': userId,
      'x-makaron-relay-signature': signature,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body } : {}),
  });
}

const preflightBody = Buffer.from('{}');
const preflight = await signedFetch('POST', '/v1/preflight', preflightBody);
if (!preflight.ok) throw new Error(`preflight failed (${preflight.status}): ${await preflight.text()}`);

if (process.argv.includes('--usage')) {
  const usageResponse = await signedFetch('GET', '/v1/usage');
  const usageText = await usageResponse.text();
  if (!usageResponse.ok) throw new Error(`usage failed (${usageResponse.status}): ${usageText}`);
  const usage = JSON.parse(usageText);
  process.stdout.write(`${JSON.stringify(usage)}\n`);
  process.exit(0);
}

const createBody = Buffer.from(JSON.stringify({
  model: 'grok-imagine-video-1.5',
  prompt: 'A single white paper airplane glides across a plain blue studio background, static camera.',
  duration: 1,
  resolution: '480p',
  aspect_ratio: '16:9',
}));
const created = await signedFetch('POST', '/v1/videos/generations', createBody);
const createdText = await created.text();
if (!created.ok) throw new Error(`submit failed (${created.status}): ${createdText}`);
const createdValue = JSON.parse(createdText);
if (typeof createdValue?.request_id !== 'string') throw new Error('submit response is missing request_id');
process.stdout.write(`task=xai-sub-${createdValue.request_id}\nstatus=submitted\n`);

const deadline = Date.now() + 12 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 5_000));
  const statusResponse = await signedFetch('GET', `/v1/videos/${createdValue.request_id}`);
  const statusText = await statusResponse.text();
  if (!statusResponse.ok) throw new Error(`status failed (${statusResponse.status}): ${statusText}`);
  const status = JSON.parse(statusText);
  const normalized = String(status.status || '').toLowerCase();
  if (normalized === 'done') {
    process.stdout.write(`status=done\nvideo=${status.video?.url || ''}\n`);
    process.exit(0);
  }
  if (['failed', 'error', 'expired', 'cancelled'].includes(normalized)) {
    throw new Error(`generation ${normalized}: ${status.error?.message || 'unknown error'}`);
  }
}
throw new Error('generation timed out');
