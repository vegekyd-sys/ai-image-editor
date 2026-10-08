#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
const dir=`${process.cwd()}/test-results/image-capability-cli`;
const values={...dotenv.parse(fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.vercel-prod')),...dotenv.parse(fs.readFileSync('/Users/tianyicai/ai-image-editor/.env.local'))};
const env={...process.env,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.replace(/\\[rn]|[\u0000-\u001F\u007F]/g,'').trim()])),MAKARON_URL:'http://127.0.0.1:3047'};
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const specs=[['N01','R17','insufficient','余额不足'],['N02','R17','missing-price','缺少图片价格'],['N03','R19','reject','供应商内容拒绝'],['N04','R19','timeout','提交结果未知超时'],['N05','R19','empty','供应商空输出']];
function cli(args,name){return new Promise((resolve,reject)=>{let a=fs.openSync(`${dir}/${name}.json`,'w'),b=fs.openSync(`${dir}/${name}.log`,'w');const c=spawn('makaron',args,{env,stdio:['ignore',a,b]});c.on('error',reject);c.on('exit',code=>{fs.closeSync(a);fs.closeSync(b);let data;try{data=JSON.parse(fs.readFileSync(`${dir}/${name}.json`));}catch{}resolve({code,data});});});}
const receipts=[];
try{
  for(const [id,contract,mode,label]of specs){
    const existing=`${dir}/${id}-receipt.json`;if(fs.existsSync(existing)){receipts.push(JSON.parse(fs.readFileSync(existing)));continue;}
    fs.writeFileSync('/tmp/image-capability-cli-fault.json',JSON.stringify({mode}),{mode:0o600});
    const before=fs.existsSync('/tmp/image-capability-cli-fault-events.jsonl')?fs.readFileSync('/tmp/image-capability-cli-fault-events.jsonl','utf8').length:0;
    const sub=await cli(['chat','--project','auto','--agent-model','gpt-6-luna','-b','--json',`图片能力负向回归 ${id}：请使用 GPT Image 2.5 Flare，仅生成一张安全蓝色茶壶图片。若工具报告计费、价格、供应商失败或审核拒绝，立即解释失败并结束，不重复调用，不改变供应商，不用 run_code 或其他方式替代。`],`${id}-submit`);
    let result,projectId=sub.data?.projectId;
    if(sub.data?.runId)result=(await cli(['responses','get',sub.data.runId,'--wait','--json'],`${id}-result`)).data;
    else if(mode!=='insufficient')throw new Error(`${id}: no run, see submission error`);
    if(!projectId){const stderr=fs.readFileSync(`${dir}/${id}-submit.log`,'utf8');projectId=/Project created: ([a-f0-9-]+)/.exec(stderr)?.[1];}
    let tools=[],usage=[],snapshots=[];
    if(sub.data?.runId){const rr=await Promise.all([db.from('agent_tool_history').select('tool_name,input,output').eq('run_id',sub.data.runId),db.from('usage_logs').select('tool_name,credits_charged,model_used,source').eq('run_id',sub.data.runId)]);for(const r of rr)if(r.error)throw new Error(r.error.message);[tools,usage]=rr.map(r=>r.data);}
    if(projectId){const r=await db.from('snapshots').select('id,image_url,type').eq('project_id',projectId);if(r.error)throw new Error(r.error.message);snapshots=r.data;}
    const faults=fs.readFileSync('/tmp/image-capability-cli-fault-events.jsonl','utf8').slice(before).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
    const submissions=faults.filter(f=>f.stage==='supplier-post-intercepted-no-real-payment').length;
    const cross=faults.filter(f=>f.stage==='cross-provider-post-blocked').length;
    const imageCalls=tools.filter(t=>t.tool_name==='generate_image').length;
    const expectedPosts=['insufficient','missing-price'].includes(mode)?0:1;
    const r={id,contract,label,mode,route:'real CLI Chat + real Agent + isolated outbound fault injection',runId:sub.data?.runId,projectId,status:result?.status||`HTTP rejected (${sub.code})`,tools,usage,snapshots,faults,submissions,crossProviderAttempts:cross,technicalPass:(!result||!result.incomplete)&&snapshots.length===0&&!(result?.output||[]).some(x=>x.type==='image')&&usage.filter(x=>x.tool_name!=='agent').length===0&&submissions===expectedPosts&&cross===0&&imageCalls<=(mode==='insufficient'?0:1)};
    fs.writeFileSync(existing,JSON.stringify(r,null,2));receipts.push(r);console.log(JSON.stringify({id,label,status:r.status,submissions,imageCalls,pass:r.technicalPass}));
  }
}finally{fs.writeFileSync('/tmp/image-capability-cli-fault.json','{}',{mode:0o600});}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify(receipts,null,2));
process.exit(receipts.every(r=>r.technicalPass)?0:1);
