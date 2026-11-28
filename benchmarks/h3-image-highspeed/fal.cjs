// A single queue submission. An accepted receipt is saved before the first poll.
const { setTimeout: delay } = require('node:timers/promises');
const root = 'minimax/h3-image/highspeed/';
const endpointFor = (edit) => root + (edit ? 'edit' : 'text-to-image');
const headers = () => ({
  Authorization: 'Key ' + process.env.FAL_KEY.trim(),
  'Content-Type': 'application/json',
});

async function quote(endpoint) {
  const url = new URL('https://api.fal.ai/v1/models/pricing');
  url.searchParams.set('endpoint_id', endpoint);
  const response = await fetch(url, {
    headers: headers(),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const price = (await response.json()).prices?.find((p) => p.endpoint_id === endpoint);
  if (!response.ok || price?.unit !== 'units' || price.currency !== 'USD' || !(price.unit_price > 0))
    throw Error('Missing fal price');
  return price;
}

async function generate({ prompt, input, price, saveReceipt, originalWire = false }) {
  const endpoint = endpointFor(!!input);
  const signal = AbortSignal.timeout(240000);
  const response = await fetch('https://queue.fal.run/' + endpoint, {
    method: 'POST',
    headers: headers(),
    redirect: 'error',
    signal,
    body: JSON.stringify({
      prompt,
      image_size: { width: 1024, height: 1024 },
      num_images: 1,
      output_format: 'png',
      ...(input ? { image_urls: [input] } : {}),
      ...(!input || originalWire ? { enable_prompt_expansion: false } : {}),
    }),
  });
  if (!response.ok) throw Error('fal submission HTTP ' + response.status);
  const task = await response.json();
  const url = new URL(task.response_url);
  if (
    url.origin !== 'https://queue.fal.run' ||
    url.username ||
    url.password ||
    url.search ||
    !/^[a-zA-Z0-9-]+$/.test(task.request_id) ||
    url.search ||
    url.hash ||
    ![
      '/minimax/h3-image/requests/' + task.request_id,
      '/' + endpoint + '/requests/' + task.request_id,
    ].includes(url.pathname)
  )
    throw Error('Unexpected fal receipt');
  saveReceipt({ id: task.request_id, url: url.href });
  // Transient read failures can be retried against this exact accepted request.
  async function read(target, options) {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(target, { ...options, signal, redirect: 'error' });
        if (r.ok || (r.status < 500 && r.status !== 429) || attempt === 3) return r;
      } catch (error) {
        if (attempt === 3 || signal.aborted) throw error;
      }
      await delay(400 * attempt, undefined, { signal });
    }
  }
  while (true) {
    const r = await read(url.href + '/status', { headers: headers() });
    if (!r.ok) throw Error('fal status HTTP ' + r.status);
    const s = await r.json();
    if (s.status === 'COMPLETED') break;
    if (!['IN_QUEUE', 'IN_PROGRESS'].includes(s.status)) throw Error('Unexpected fal status');
    await delay(250, undefined, { signal });
  }
  const r = await read(url.href, { headers: headers() });
  if (!r.ok) throw Error('fal result HTTP ' + r.status);
  const data = await r.json();
  const units = r.headers.get('x-fal-billable-units');
  const imageUrl = new URL(data.images[0].url);
  if (
    imageUrl.protocol !== 'https:' ||
    imageUrl.username ||
    imageUrl.password ||
    !imageUrl.hostname.endsWith('.fal.media')
  )
    throw Error('Unexpected fal media host');
  const media = await read(imageUrl.href, {});
  if (!media.ok) throw Error('fal download HTTP ' + media.status);
  return {
    bytes: Buffer.from(await media.arrayBuffer()),
    units,
    costUsd:
      units != null && units.trim() !== '' && Number.isFinite(+units) && +units >= 0
        ? +units * price.unit_price
        : null,
    usage: data.usage,
    providerRewrotePrompt: typeof data.actual_prompt === 'string' ? data.actual_prompt !== prompt : null,
    inferenceSeconds: data.timings?.inference,
    flags: data.has_nsfw_concepts,
  };
}
module.exports = { endpointFor, quote, generate };
