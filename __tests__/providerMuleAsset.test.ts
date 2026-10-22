// @vitest-environment node
import {EventEmitter} from 'node:events'
import {expect,it,vi} from 'vitest'
vi.mock('node:dns',()=>({lookup:(_host:unknown,_opts:unknown,cb:Function)=>cb(null,[{address:'198.18.0.1',family:4}])}))
vi.mock('node:https',()=>({get:(url:URL,opts:any,respond:Function)=>{const req=new EventEmitter();queueMicrotask(()=>opts.lookup(url.hostname,{},(err:Error|null)=>{if(err){req.emit('error',err);return}const res=Object.assign(new EventEmitter(),{statusCode:200,headers:{},destroy:vi.fn()});respond(res);res.emit('data',Buffer.from('video'));res.emit('end')}));return req}}))
import {readProviderImage} from '@/lib/provider-image-preflight'
it('permits the fixed Wan supplier asset host only with the provider-owned flag',async()=>{
 const url='https://mule-router-assets.muleusercontent.com/result.mp4'
 await expect(readProviderImage(url,100)).rejects.toThrow('Non-public')
 expect((await readProviderImage(url,100,{muleAsset:true})).toString()).toBe('video')
 await expect(readProviderImage('https://attacker.muleusercontent.com/result.mp4',100,{muleAsset:true})).rejects.toThrow('Non-public')
 await expect(readProviderImage('https://mule-router-assets.muleusercontent.com.attacker.com/result.mp4',100,{muleAsset:true})).rejects.toThrow('Non-public')
})
