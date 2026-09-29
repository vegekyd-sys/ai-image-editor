import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

// Real hosted MCP calls, using the same JSON-RPC interface as Makaron CLI.
// One in-flight generation; persist intent before any billed submission.
const origin = process.env.MAKARON_URL || 'https://www.makaron.app';
if (origin !== 'https://www.makaron.app') throw new Error('This acceptance targets the canonical production domain only.');
const dir = path.resolve('artifacts/h3max-production');
fs.mkdirSync(dir, { recursive: true });
const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.makaron/auth.json'), 'utf8'));
const headers = { Authorization: `Bearer ${auth._apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
const imageUrl = 'https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/98b49532-a3eb-4cd3-a5e6-d069de21a02f/uploads/eccba79b-223d-4749-ae3f-b8d5995fbda7.jpg';
const videoUrl = 'https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/98b49532-a3eb-4cd3-a5e6-d069de21a02f/videos/d80efdef-a656-4d34-9b96-24cfcadca091.mp4';

async function tool(name, args) {
  const started = performance.now();
  const response = await fetch(`${origin}/api/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0,300)}`);
  const data = JSON.parse(raw);
  if (data.error) throw new Error(JSON.stringify(data.error));
  const text = data.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
  if (data.result?.isError) throw new Error(text);
  return { text, seconds: (performance.now()-started)/1000, serverTiming: response.headers.get('server-timing'), vercelId: response.headers.get('x-vercel-id') };
}

async function runCase(kind, duration, round) {
  const name = `${kind}-${duration}s-r${round}`;
  const file = `${name}.json`;
  if (fs.existsSync(path.join(dir, file))) {
    const existing = JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
    if (existing.status === 'completed') { console.log(JSON.stringify({ skipped: name, seconds: existing.urlSeconds })); return; }
    throw new Error(`${name} has a prior intent or incomplete receipt. Inspect it; never blindly resubmit.`);
  }
  const args = {
    script: kind === 'image'
      ? 'Use <<<media_1>>> as the character reference. Preserve his short curly hair, face, olive jacket and white shirt. In a warm bookstore, he slowly takes a red hardcover book from the shelf and opens it. A single steady medium shot, natural movement, soft paper sounds, no captions.'
      : 'Use <<<media_1>>> as the source video. Change only the red hardcover book to a blue hardcover book. Preserve the same person, olive jacket, bookstore, camera framing and natural book-handling motion. Keep the blue book consistent throughout. No captions or extra objects.',
    images: kind === 'image' ? [imageUrl] : [],
    ...(kind === 'video' ? { videoUrls: [videoUrl] } : {}),
    duration, aspectRatio: '16:9', videoResolution: '768p',
    // Omit model on the first case to verify the hosted default itself.
    ...(kind === 'image' && duration === 5 && round === 1 ? {} : { videoModel: 'fal-h3-max' }),
    billingRequestId: randomUUID(),
  };
  const result = { name, kind, duration, round, origin, args, sourceVideoSeconds: kind === 'video' ? 5.184 : 0, startedAt: new Date().toISOString(), status: 'intent', polls: [] };
  save(file,result);
  const start = performance.now();
  try {
    result.submission = await tool('makaron_create_video',args);
    result.submitSeconds = (performance.now()-start)/1000;
    result.taskId = result.submission.text.match(/^Task ID:\s*(\S+)\s*$/m)?.[1];
    result.url = result.submission.text.match(/(?:Provider )?Video URL:\s*(https?:\/\/\S+)/)?.[1];
    if (!result.taskId) throw new Error(`No task receipt: ${result.submission.text}`);
    if (!result.taskId.startsWith('fal-h3max-reference-')) throw new Error(`Unexpected model/route: ${result.taskId}`);
    result.status = 'submitted'; save(file,result);
    while (!result.url && performance.now()-start < 600_000) {
      await new Promise(resolve => setTimeout(resolve,4000));
      const poll = await tool('makaron_get_video_status',{ taskId: result.taskId });
      result.polls.push({ elapsedSeconds: (performance.now()-start)/1000, ...poll });
      result.url = poll.text.match(/Video URL:\s*(https?:\/\/\S+)/)?.[1];
      if (/failed|Error:/i.test(poll.text) && !/query failed|temporar|transport/i.test(poll.text)) throw new Error(poll.text);
      save(file,result);
    }
    if (!result.url) throw new Error('No URL within 10 minutes; preserve receipt for later polling.');
    result.urlSeconds = (performance.now()-start)/1000;
    result.urlObservedAt = new Date().toISOString();
    result.status = 'completed'; save(file,result);
    const fetchStart = performance.now();
    const media = await fetch(result.url,{ headers: { Range:'bytes=0-1023' }, signal:AbortSignal.timeout(30_000) });
    result.mediaCheck = { status:media.status, type:media.headers.get('content-type'), seconds:(performance.now()-fetchStart)/1000 };
    await media.body?.cancel();
    save(file,result);
    console.log(JSON.stringify({ name,status:result.status,submitSeconds:result.submitSeconds,urlSeconds:result.urlSeconds,taskId:result.taskId,url:result.url,mediaCheck:result.mediaCheck }));
  } catch(error) {
    result.error = error.message;
    if (result.status !== 'completed') result.status = result.taskId ? 'needs_polling' : 'submission_unconfirmed';
    save(file,result); throw error;
  }
}

if (['run', 'case'].includes(process.argv[2])) {
  const gate = JSON.parse(fs.readFileSync(path.join(dir,'production-gate.json'),'utf8'));
  if (!gate.ready || !gate.canonicalAliasesVerified) throw new Error('Production deployment has not passed its gate.');
  if (process.argv[2] === 'case') {
    const [kind, duration, round] = process.argv.slice(3);
    if (!['image', 'video'].includes(kind) || ![5,10,15].includes(Number(duration)) || !Number.isInteger(Number(round))) throw new Error('Invalid case');
    await runCase(kind,Number(duration),Number(round));
  } else for (const round of [1,2]) {
    for (const duration of round === 1 ? [5,10,15] : [15,10,5]) {
      for (const kind of round === 1 ? ['image','video'] : ['video','image']) await runCase(kind,duration,round);
    }
  }
} else {
  console.log('Run only after production-gate.json confirms both production aliases. Usage: node scripts/h3max-production-acceptance.mjs run');
}
