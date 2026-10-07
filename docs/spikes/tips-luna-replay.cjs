// Offline replay of captured initial responses through the candidate product parser.
// node --import tsx --require ./md-loader.cjs docs/spikes/tips-luna-replay.cjs
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const folder = path.join(root, 'test-results/tips-luna-e2e-v1');
process.env.TIPS_PROVIDER = 'openrouter';
process.env.OPENROUTER_API_KEY = 'offline-replay-only';
delete process.env.GOOGLE_API_KEY;
let current, calls;
global.fetch = async (_url, options) => {
  calls++;
  if (calls > 1 || !JSON.parse(options.body).stream) throw Error('Unexpected repair; offline replay prohibits all network calls');
  const text = current.requests[0].rawText;
  let stream = '';
  for (let i = 0; i < text.length; i += 31) stream += 'data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 31) } }] }) + '\n\n';
  stream += 'data: [DONE]\n\n';
  return new Response(stream);
};
async function main() {
  const { streamTipsByCategory } = require('../../src/lib/gemini.ts');
  const results = { networkCalls: 0, chunking: 'synthetic 31-character SSE chunks; no latency inference', rows: [] };
  for (const author of ['online', 'luna']) {
    const record = JSON.parse(await fs.readFile(path.join(folder, author + '.json'), 'utf8'));
    for (const row of record.rows) {
      current = row; calls = 0; const complete = new Map();
      for await (const tip of streamTipsByCategory('data:image/jpeg;base64,YQ==', row.category, undefined, 2, undefined, 'zh')) if (tip.editPrompt) complete.set(tip.label, tip);
      results.rows.push({ author, id: row.id, providerResponsesReplayed: calls, uniqueCompleteTips: complete.size, tips: [...complete.values()] });
      if (calls !== 1 || complete.size !== 2) throw Error(`${author}/${row.id} failed offline replay`);
    }
  }
  await fs.writeFile(path.join(folder, 'parser-replay.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ cells: results.rows.length, complete: results.rows.filter(r => r.uniqueCompleteTips === 2).length, unexpectedRepairs: results.rows.reduce((s,r)=>s+r.providerResponsesReplayed-1,0), networkCalls: 0 }));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
