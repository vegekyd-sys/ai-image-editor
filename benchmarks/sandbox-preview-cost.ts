import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from 'dotenv';
import type { Sandbox as SandboxInstance } from '@vercel/sandbox';
import { renderDesignFrame, renderDesignFrames } from '../src/lib/remotion-server';
import type { DesignPayload } from '../src/types';

async function main() {
  const { Sandbox } = await import('@vercel/sandbox');
  config({path: '.env.sandbox-cost.production', quiet: true});
  const vcpus = Number(process.env.BENCHMARK_VCPUS || 8);
  const project = JSON.parse(fs.readFileSync(path.join(process.env.SANDBOX_AUDIT_PROJECT_PATH || process.cwd(),'.vercel/project.json'), 'utf8'));
  const authPath = [`${os.homedir()}/Library/Application Support/com.vercel.cli/auth.json`, `${os.homedir()}/.local/share/com.vercel.cli/auth.json`].find(p=>fs.existsSync(p))!;
  const token = JSON.parse(fs.readFileSync(authPath, 'utf8')).token;
  process.env.REMOTION_SANDBOX_VCPUS = String(vcpus);
  const created: SandboxInstance[] = [];
  const create = Sandbox.create.bind(Sandbox);
  Sandbox.create = async options => {
    const sandbox = await create({...options, token, projectId: project.projectId, teamId: project.orgId});
    created.push(sandbox);
    return sandbox;
  };
  const root = `artifacts/sandbox-cost/${process.env.BENCHMARK_MODE === 'candidate' ? 'candidate' : 'benchmark'}-${vcpus}`;
  fs.mkdirSync(root, {recursive:true});
  const source = 'https://media.w3.org/2010/05/sintel/trailer.mp4';
  const caption = `React.createElement('div',{style:{position:'absolute',bottom:180,left:80,color:'white',fontFamily:'Noto Sans SC',fontSize:60,fontWeight:700,backgroundColor:'#000a',padding:20}},'降本验证 · Frame '+useCurrentFrame())`;
  const designs: Record<string, DesignPayload> = {
    text: {code:`function Design(){return React.createElement(AbsoluteFill,{style:{background:'#123047',alignItems:'center',justifyContent:'center',color:'white',fontFamily:'Inter',fontSize:70}},'Makaron Sandbox',${caption});}`,width:1080,height:1920,props:{},animation:{fps:30,durationInSeconds:10}},
    video: {code:`function Design(){return React.createElement(AbsoluteFill,null,React.createElement(Video,{src:'${source}',muted:true,style:{width:'100%',height:'100%',objectFit:'cover'}}),${caption});}`,width:1080,height:1920,props:{},animation:{fps:30,durationInSeconds:10}},
    tiled: {code:`function Design(){return React.createElement(AbsoluteFill,{style:{background:'#123047'}},...[0,1,2,3].map(i=>React.createElement(Video,{key:i,src:'${source}',muted:true,trimBefore:i*15,style:{position:'absolute',left:(i%2)*540,top:Math.floor(i/2)*960,width:540,height:960,objectFit:'cover'}})),${caption});}`,width:1080,height:1920,props:{},animation:{fps:30,durationInSeconds:10}},
  };
  const results: unknown[] = [];
  try {
    for (const [name, design] of Object.entries(designs)) {
      if (process.env.BENCHMARK_MODE === 'candidate') {
        const started = Date.now();
        const buffers = await renderDesignFrames(design, [30,90]);
        for (const [i,frame] of [30,90].entries()) fs.writeFileSync(path.join(root,`${name}-${frame}.jpg`),buffers[i]);
        const result = {name,frames:[30,90],vcpus,elapsedMs:Date.now()-started,bytes:buffers.map(b=>b.length)};
        results.push(result); console.log(JSON.stringify(result)); continue;
      }
      for (const frame of [30, 90]) {
        const started = Date.now();
        const jpeg = await renderDesignFrame(design, frame);
        fs.writeFileSync(path.join(root,`${name}-${frame}.jpg`),jpeg);
        const result = {name,frame,vcpus,elapsedMs:Date.now()-started,bytes:jpeg.length};
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
  } finally {
    await Promise.all(created.map(s=>s.stop().catch(()=>undefined)));
    fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({vcpus,results,sandboxIds:created.map(s=>s.sandboxId)},null,2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
