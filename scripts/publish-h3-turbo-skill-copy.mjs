/** Publish reviewed versioned skill copy. Compare old URL before changing each live row. */
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {parse} from 'dotenv'
import {createClient} from '@supabase/supabase-js'
const root='artifacts/h3max-integration/skill-copy'
const manifest=JSON.parse(readFileSync(`${root}/manifest.json`,'utf8'))
const env=parse(readFileSync('.env.local'))
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const log=[]
for(const item of manifest){
 const data=readFileSync(`${item.directory}/updated.zip`)
 if(createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Reviewed ZIP changed')
 const url=new URL(item.newUrl)
 if(url.host!=='cdn.makaron.app'||!url.pathname.startsWith('/storage/v1/object/public/images/'))throw Error('Unexpected storage destination')
 const key=decodeURIComponent(url.pathname.split('/public/images/')[1])
 const {error}=await db.storage.from('images').upload(key,data,{contentType:'application/zip',cacheControl:'31536000',upsert:false})
 if(error&&!/already exists|Duplicate/i.test(error.message))throw Error(error.message)
 const downloaded=await fetch(item.newUrl,{headers:{'User-Agent':'Makaron-Compatibility-Audit'}})
 if(!downloaded.ok)throw Error(`Public ZIP verification ${downloaded.status}`)
 if(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex')!==item.sha256)throw Error('Public ZIP differs')
 for(const id of item.ids){
  const {data:current,error:readError}=await db.from('home_skills').select('id,skill_path,updated_at').eq('id',id).single()
  if(readError)throw Error(readError.message)
  if(current.skill_path!==item.oldUrl&&current.skill_path!==item.newUrl)throw Error(`Concurrent skill update ${id}`)
  if(current.skill_path===item.oldUrl){
   const {data:changed,error:err}=await db.from('home_skills').update({skill_path:item.newUrl,updated_at:new Date().toISOString()}).eq('id',id).eq('skill_path',item.oldUrl).select('id')
   if(err||changed?.length!==1)throw Error(err?.message||'Concurrent update')
  }
  log.push({id,name:item.name,oldUrl:item.oldUrl,newUrl:item.newUrl,sha256:item.sha256,verifiedAt:new Date().toISOString()})
  writeFileSync(`${root}/published.json`,JSON.stringify(log,null,2))
 }
 console.log('VERIFIED',item.name,item.ids.length)
}
