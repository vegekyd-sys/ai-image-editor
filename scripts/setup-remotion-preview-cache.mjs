// Provision only private checkpoint metadata storage. No user access policies.
import {createClient} from '@supabase/supabase-js';

const read=name=>{
  const value=process.env[name]?.replace(/\\[rn]|[\r\n]/g,'').trim();
  if(!value)throw new Error(`${name} is required`);
  return value;
};
const admin=createClient(read('NEXT_PUBLIC_SUPABASE_URL'),read('SUPABASE_SERVICE_ROLE_KEY'),{
  auth:{persistSession:false,autoRefreshToken:false},
});
const name='remotion-preview-cache';
let {data,error}=await admin.storage.getBucket(name);
if(error&&(Number(error.statusCode)===404||Number(error.status)===404||/bucket not found/i.test(error.message))){
  const created=await admin.storage.createBucket(name,{
    public:false,fileSizeLimit:16_384,allowedMimeTypes:['application/json'],
  });
  if(created.error)throw new Error(`Could not provision preview cache: ${created.error.message}`);
  ({data,error}=await admin.storage.getBucket(name));
}
if(error)throw new Error(`Could not verify preview cache: ${error.message}`);
if(data.public)throw new Error('Preview cache must be private; refusing to use an existing public bucket');
console.log(JSON.stringify({bucket:data.name,public:data.public,fileSizeLimit:data.file_size_limit}));
