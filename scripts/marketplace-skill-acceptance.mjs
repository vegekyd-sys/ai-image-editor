#!/usr/bin/env node
// Dedicated non-media fixture: old -> published update -> install -> actual Agent
// execution. No real marketplace content, user files, or advertising is modified.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
config({ path: '/Users/tianyicai/ai-image-editor/.env.local', quiet: true });
const statePath = process.env.MARKETPLACE_ACCEPTANCE_STATE || '/tmp/makaron-marketplace-skill-acceptance-private.json';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const phase = process.argv[2];
const base = process.argv[3] || 'https://www.makaron.app';
let state;
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data; };
function save() { writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 }); }
async function install(url = base) {
  const started = performance.now();
  const r = await fetch(`${url}/api/skills`, { method: 'POST', headers: { Authorization: `Bearer ${state.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ homeSkillId: state.templateId, skillPath: state.urls[0] }) });
  const data = await r.json(); if (!r.ok) throw new Error(`install ${r.status}: ${data.error}`);
  return { ...data, ms: Math.round(performance.now() - started) };
}
async function content() {
  const row = checked(await admin.from('workspace_files').select('storage_url,marketplace_source').eq('user_id',state.userId).eq('path',`skills/${state.name}/SKILL.md`).single());
  const r = await fetch(row.storage_url); return { text: await r.text(), source: row.marketplace_source };
}
async function execute(templateContext = false) {
  const project = checked(await admin.from('projects').insert({user_id: state.userId, name: 'Marketplace synchronization acceptance'}).select('id').single());
  const prompt = `[Active skill: ${state.name}]\nRun the selected acceptance Skill now. Read its complete SKILL.md first and follow its instructions exactly. This is a text fixture: do not create images, video, audio or any paid media.`;
  let run;
  if (templateContext) {
    const r = await fetch(`${base}/api/agent/run`, {method:'POST',headers:{Authorization:`Bearer ${state.key}`,'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,prompt,skillLaunchContext:{source:'home-skill-template',homeSkillId:state.templateId,skillName:state.name,intent:'complete-result'}})});
    run = await r.json(); if (!r.ok) throw new Error(`start ${r.status}: ${run.error}`);
  } else {
    const cli = process.env.MARKETPLACE_CLI_BIN || '/Users/tianyicai/ai-image-editor/packages/makaron-cli/bin/makaron.mjs';
    run = await new Promise((resolve,reject)=>{
      const p=spawn(process.execPath,[cli,'chat',prompt,'--skill',state.templateId,'--project',project.id,'--background','--json'],{env:{...process.env,MAKARON_URL:base,MAKARON_API_KEY:state.key,MAKARON_DISABLE_UPDATE_CHECK:'1'}});
      let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('exit',code=>code===0?resolve(JSON.parse(out.trim())):reject(new Error(err)));
    });
  }
  console.log(JSON.stringify({execution:templateContext?'App contract':'Chat CLI',projectId:project.id,runId:run.runId}));
  state.runs ||= []; state.runs.push(run.runId);save();
  for(let i=0;i<90;i++) {
    const r=await fetch(`${base}/api/agent/run/${run.runId}`,{headers:{Authorization:`Bearer ${state.key}`}});const data=await r.json();
    const status=data.status || data.run?.status;
    if(['completed','failed','cancelled'].includes(status)) {
      const events=checked(await admin.from('agent_events').select('type,data').eq('run_id',run.runId).order('seq'));
      const serialized=JSON.stringify(events);
      assert.ok(serialized.includes('SYNC-PUBLISHED-V2'), 'latest marker missing from actual execution');
      assert.ok(serialized.includes('read_file'), 'Agent did not read Skill instructions');
      assert.ok(serialized.includes('write_file'), 'Agent did not execute Skill action');
      assert.ok(!serialized.includes('SYNC-LEGACY-V1'), 'old marker executed');
      const result={surface:templateContext?'App contract':'Chat CLI',status,runId:run.runId,latestExecuted:true,readFile:true,writeFile:true};
      console.log(JSON.stringify(result));return result;
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Acceptance run did not complete within 180 seconds');
}
if(phase==='setup') {
  const suffix=randomBytes(6).toString('hex');
  const password=randomBytes(24).toString('base64url');
  const email=`test-marketplace-${suffix}@makaron.app`;
  const user=checked(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
  const key=`mk_live_${randomBytes(32).toString('hex')}`;
  checked(await admin.from('api_keys').insert({user_id:user.id,key_hash:createHash('sha256').update(key).digest('hex'),key_prefix:key.slice(0,16),name:'Marketplace acceptance fixture'}));
  state={userId:user.id,key,email,password,name:`sync-acceptance-${suffix}`,urls:[],timings:{}};
  for(const [version,marker] of [['v1','SYNC-LEGACY-V1'],['v2','SYNC-PUBLISHED-V2']]) {
    const zip=new JSZip();zip.file('SKILL.md',`---\nname: ${state.name}\ndescription: Dedicated Skill publication acceptance fixture\n---\n\nRead assets/proof.txt, then call write_file to write proof.json in the current project containing exactly {"published":"${marker}"}. Reply with ${marker}. This is a text-only test; do not generate media.\n`);zip.file('assets/proof.txt',marker);
    const object=`marketplace/acceptance/${suffix}/${version}.zip`;
    checked(await admin.storage.from('images').upload(object,await zip.generateAsync({type:'nodebuffer'}),{contentType:'application/zip'}));
    state.urls.push(admin.storage.from('images').getPublicUrl(object).data.publicUrl);
  }
  const template=checked(await admin.from('home_skills').insert({labels:{en:'Publication acceptance fixture',zh:'发布验收测试'},image:state.urls[0],prompt:'Text-only publication acceptance',skill_path:state.urls[0],image_count:0,sort_order:100000,is_active:true}).select('id').single());
  state.templateId=template.id;save();
  const first=await install();assert.ok((await content()).text.includes('SYNC-LEGACY-V1'));state.timings.legacyFirst=first;
  state.timings.legacyRepeat=[];for(let i=0;i<5;i++)state.timings.legacyRepeat.push(await install());
  checked(await admin.from('home_skills').update({skill_path:state.urls[1],updated_at:new Date().toISOString()}).eq('id',state.templateId));
  // Old clients already fetched a current URL. Compare old dedup using that URL.
  const oldUrl=state.urls[0];state.urls[0]=state.urls[1];state.timings.legacyAfterPublish=await install();state.urls[0]=oldUrl;
  assert.ok((await content()).text.includes('SYNC-LEGACY-V1'));save();
  console.log(JSON.stringify({baseline:true,oldCopyReproduced:true,templateId:state.templateId,timings:state.timings}));
} else {
  state=JSON.parse(readFileSync(statePath,'utf8'));
  if(phase==='upgrade') {
    const update=await install();assert.ok(update.updated);assert.ok((await content()).text.includes('SYNC-PUBLISHED-V2'));state.timings.update=update;
    state.timings.unchanged=[];for(let i=0;i<5;i++)state.timings.unchanged.push(await install());
    const concurrent=await Promise.all([install(),install(),install()]);assert.ok(concurrent.every(r=>r.alreadyInstalled));
    state.timings.concurrent=concurrent;save();console.log(JSON.stringify({upgrade:true,timings:state.timings}));
  } else if(phase==='execute-cli'||phase==='execute-app') {
    const result=await execute(phase==='execute-app');state.executions ||= [];state.executions.push(result);save();
  } else if(phase==='cleanup') {
    checked(await admin.from('home_skills').update({is_active:false}).eq('id',state.templateId));
    checked(await admin.from('api_keys').update({is_active:false}).eq('user_id',state.userId).eq('name','Marketplace acceptance fixture'));
    console.log('Dedicated fixture hidden and its API key disabled. Acceptance artifacts retained.');
  } else if(phase==='report') console.log(JSON.stringify({templateId:state.templateId,userId:state.userId,timings:state.timings,executions:state.executions},null,2));
}
