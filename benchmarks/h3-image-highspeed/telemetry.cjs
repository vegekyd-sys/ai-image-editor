// Observe application fetches without copying base64 responses or logging private URLs.
function observe(row, elapsed, checkpoint) {
  const original = global.fetch;
  let submitted = false;
  global.fetch = async function (input, options = {}) {
    const url = new URL(input.url ?? input);
    const method = options.method ?? input.method ?? 'GET';
    const isMedia = url.hostname.endsWith('.fal.media');
    if (!isMedia && !['queue.fal.run', 'api.openai.com', 'openrouter.ai'].includes(url.hostname))
      return original(input, options);
    if (method === 'POST') {
      if (submitted) throw Error('Benchmark stopped a second supplier submission');
      submitted = true;
    }
    const event = {
      method,
      endpoint: isMedia
        ? 'fal CDN'
        : url.origin + url.pathname.replace(/\/requests\/[^/]+/, '/requests/{id}'),
      startMs: elapsed(),
    };
    row.calls.push(event);
    checkpoint();
    const response = await original(input, options);
    event.http = response.status;
    event.headersMs = elapsed();
    const units = response.headers.get('x-fal-billable-units');
    if (units !== null) event.units = Number(units);
    for (const reader of ['json', 'text', 'arrayBuffer']) {
      const read = response[reader].bind(response);
      response[reader] = async () => {
        const value = await read();
        event.bodyMs = elapsed();
        if (reader === 'json' && value.status) event.queueStatus = value.status;
        if (reader === 'json' && value.metrics) event.metrics = value.metrics;
        if (reader === 'json' && value.timings) event.timings = value.timings;
        if (reader === 'json' && value.usage) event.usage = value.usage;
        if (url.hostname === 'openrouter.ai' && reader === 'text') {
          const data = JSON.parse(value);
          event.usage = data.usage;
        }
        checkpoint();
        return value;
      };
    }
    return response;
  };
  return () => {
    global.fetch = original;
  };
}
module.exports = { observe };
