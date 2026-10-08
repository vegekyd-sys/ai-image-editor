/** Test-process preload only. No production code/config/database changes. */
import fs from 'node:fs';
const nativeFetch=globalThis.fetch;
const configFile='/tmp/image-capability-cli-fault.json';
const logFile='/tmp/image-capability-cli-fault-events.jsonl';
function record(mode,stage){fs.appendFileSync(logFile,JSON.stringify({at:new Date().toISOString(),mode,stage})+'\n');}
globalThis.fetch=async function(input,options){
  let config;try{config=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch{return nativeFetch(input,options);}
  if(!config.mode)return nativeFetch(input,options);
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  const method=(options?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  if(config.mode==='insufficient'&&url.pathname.endsWith('/rest/v1/credit_balances')&&method==='GET'){
    record(config.mode,'balance-read');return Response.json({balance:0});
  }
  if(config.mode==='missing-price'&&url.pathname.endsWith('/rest/v1/token_rates')&&method==='GET'){
    record(config.mode,'price-read');const response=await nativeFetch(input,options);const rows=await response.json();
    return Response.json(rows.filter(row=>!String(row.model_id).startsWith('gpt-image-2.5-')));
  }
  if(url.hostname==='queue.fal.run'){
    if(method==='POST'){
      record(config.mode,'supplier-post-intercepted-no-real-payment');
      if(config.mode==='reject')return Response.json({detail:[{type:'content_policy_violation'}]},{status:422});
      if(config.mode==='timeout')throw new DOMException('Acceptance injected uncertain submission timeout','TimeoutError');
      if(config.mode==='empty')return Response.json({request_id:'acceptance-empty-image'});
      throw new Error(`Acceptance guard: unexpected provider POST in ${config.mode}`);
    }
    if(config.mode==='empty'&&url.pathname.includes('/requests/acceptance-empty-image')){
      record(config.mode,url.pathname.endsWith('/status')?'status':'result');
      return Response.json(url.pathname.endsWith('/status')?{status:'COMPLETED'}:{images:[]});
    }
  }
  // Guard other paid providers in negative cases: do not turn a failure into a real paid retry.
  if(method==='POST'&&(['openrouter.ai','api.mulerouter.ai','dashscope-intl.aliyuncs.com','dashscope.aliyuncs.com','generativelanguage.googleapis.com'].includes(url.hostname)||url.hostname.endsWith('.maas.aliyuncs.com'))){
    record(config.mode,'cross-provider-post-blocked');throw new Error('Acceptance guard: cross-provider paid submission blocked');
  }
  return nativeFetch(input,options);
};
