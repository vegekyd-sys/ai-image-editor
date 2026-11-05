import fs from 'node:fs';import crypto from 'node:crypto';import {createClient} from '@supabase/supabase-js';
const c=JSON.parse(fs.readFileSync('/tmp/gpt26-runtime-env.json'));if(c.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55451')throw new Error('Refuse shared database');
const admin=createClient(c.NEXT_PUBLIC_SUPABASE_URL,c.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const checked=x=>{if(x.error)throw new Error(x.error.message);return x.data;};
let a;
if(fs.existsSync('/tmp/gpt26-product-account.json'))a=JSON.parse(fs.readFileSync('/tmp/gpt26-product-account.json'));
else{
 const email=`gpt26-${Date.now()}@local.makaron.test`, password=crypto.randomBytes(24).toString('hex');
 const {user}=checked(await admin.auth.admin.createUser({email,password,email_confirm:true}));
 checked(await admin.from('user_profiles').upsert({id:user.id,activated:true,is_agent:true}));
 checked(await admin.from('credit_balances').upsert({user_id:user.id,balance:1000,lifetime_purchased:0,lifetime_used:0}));
 const key='mk_live_'+crypto.randomBytes(32).toString('hex');
 checked(await admin.from('api_keys').insert({user_id:user.id,key_hash:crypto.createHash('sha256').update(key).digest('hex'),key_prefix:key.slice(0,16),name:'Dedicated GPT26 acceptance'}));
 const project=checked(await admin.from('projects').insert({user_id:user.id,title:'GPT Image 2.6 · GIF / SVG 验收'}).select('id').single());
 a={email,password,userId:user.id,projectId:project.id,key};fs.writeFileSync('/tmp/gpt26-product-account.json',JSON.stringify(a),{mode:0o600});
}
console.log('Dedicated local account, project and API key ready; no production identities or credentials used.');
fs.writeFileSync('/tmp/gpt26-cli.env',`MAKARON_API_KEY=${a.key}\nMAKARON_URL=http://127.0.0.1:3051\nMAKARON_DISABLE_UPDATE_CHECK=1\n`,{mode:0o600});
