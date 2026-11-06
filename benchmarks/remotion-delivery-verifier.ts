import {Sandbox} from '@vercel/sandbox';

const script = String.raw`
const fs=require('node:fs/promises');const {createWriteStream}=require('node:fs');
const {Readable,Transform}=require('node:stream');const {pipeline}=require('node:stream/promises');
const {createHash}=require('node:crypto');const {promisify}=require('node:util');const exec=promisify(require('node:child_process').execFile);
const digest=x=>createHash('sha256').update(x).digest('hex');
(async()=>{
 const input=JSON.parse(await fs.readFile('/vercel/sandbox/verify-input.json','utf8'));
 if(input.probe){
  const start=Date.now(); const response=await fetch(input.url,{headers:{Range:'bytes=0-0',Accept:'*/*','Accept-Encoding':'identity'},signal:AbortSignal.timeout(15000)});
  const result={status:response.status,headers:Object.fromEntries(response.headers),elapsedMs:Date.now()-start};
  await response.body?.cancel();await fs.writeFile('/vercel/sandbox/verify-result.json',JSON.stringify(result));return;
 }
 const response=await fetch(input.url,{signal:AbortSignal.timeout(120000)});
 if(!response.ok||!response.body)throw Error('Media read failed');
 let bytes=0;const hash=createHash('sha256');const file='/vercel/sandbox/verify-'+input.index+'.mp4';
 const counter=new Transform({transform(chunk,enc,done){bytes+=chunk.length;hash.update(chunk);done(bytes>256*1024**2?Error('Size budget'):null,chunk)}});
 await pipeline(Readable.fromWeb(response.body),counter,createWriteStream(file));
 const result={sha256:hash.digest('hex'),bytes,cache:response.headers.get('x-makaron-cache')};
 if(input.decode){
  let ffmpeg='ffmpeg';try{ffmpeg=require('ffmpeg-static')}catch{}
  const video=await exec(ffmpeg,['-v','error','-i',file,'-map','0:v:0','-f','framemd5','-'],{maxBuffer:16*1024**2,timeout:90000});
  result.videoHash=digest(video.stdout);result.audioHash=null;
  try{const audio=await exec(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-f','s16le','-'],{encoding:'buffer',maxBuffer:64*1024**2,timeout:90000});result.audioHash=digest(audio.stdout)}
  catch(e){if(!String(e.stderr).includes('matches no streams'))throw e}
 }
 await fs.writeFile('/vercel/sandbox/verify-result.json',JSON.stringify(result));
 if(!input.keep)await fs.rm(file,{force:true});
})().catch(()=>{console.error('Bounded media verification failed');process.exitCode=1});
`;

export async function createDeliveryVerifier() {
  const snapshotId = process.env.MEDIA_SANDBOX_SNAPSHOT_ID;
  const sandbox = await Sandbox.create({...(snapshotId ? {source: {type: 'snapshot' as const, snapshotId}} : {runtime: 'node24' as const}),
    resources: {vcpus: 2}, timeout: 15 * 60_000});
  try {
    if (!snapshotId) {
      const installed = await sandbox.runCommand({cmd: 'npm', args: ['install', '--no-audit', '--no-fund', 'ffmpeg-static@5.3.0']});
      if (installed.exitCode !== 0) throw new Error('Verifier binary setup failed');
    }
    await sandbox.writeFiles([{path: '/vercel/sandbox/verify.cjs', content: Buffer.from(script)}]);
  } catch (error) {await sandbox.stop(); throw error;}
  let index = 0;
  return {
    async probe(url: string) {
      const canonical = new URL(url); canonical.hostname = 'sdyrtztrjgmmpnirswxt.supabase.co'; canonical.hash = '';
      await sandbox.writeFiles([{path: '/vercel/sandbox/verify-input.json', content: Buffer.from(JSON.stringify({url: canonical.href, probe: true}))}]);
      const command = await sandbox.runCommand({cmd: 'node', args: ['/vercel/sandbox/verify.cjs']});
      if (command.exitCode !== 0) throw new Error('Regional version probe failed');
      const result = await sandbox.readFileToBuffer({path: '/vercel/sandbox/verify-result.json'});
      if (!result) throw new Error('Missing version result');
      return {url: canonical.href, ...JSON.parse(result.toString()) as {status: number; headers: Record<string, string>; elapsedMs: number}};
    },
    async verify(url: string, decode = false, keep = false) {
      const current = index++;
      // The VM gets only one authorized media URL, never cloud account keys.
      await sandbox.writeFiles([{path: '/vercel/sandbox/verify-input.json', content: Buffer.from(JSON.stringify({url, index: current, decode, keep}))}]);
      const command = await sandbox.runCommand({cmd: 'node', args: ['/vercel/sandbox/verify.cjs']});
      if (command.exitCode !== 0) throw new Error('Cloud media verification failed');
      const result = await sandbox.readFileToBuffer({path: '/vercel/sandbox/verify-result.json'});
      if (!result) throw new Error('Missing cloud verification result');
      return {...JSON.parse(result.toString()) as {sha256: string; bytes: number; cache: string | null; videoHash?: string; audioHash?: string | null}, index: current};
    },
    readSample: (index: number) => sandbox.readFileToBuffer({path: `/vercel/sandbox/verify-${index}.mp4`}),
    stop: () => sandbox.stop(),
  };
}
