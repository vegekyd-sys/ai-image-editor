/** Paid local speed benchmark. Sequential jobs avoid our own queue contention.
 * Main metric: adapter invocation -> parsed provider video URL (no download time).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parse } from 'dotenv'
import { createFalH3MaxVideoTask } from '../src/lib/fal-h3-max-video'
import { createFalH3MaxReferenceVideoTask } from '../src/lib/fal-h3-max-reference-video'

type Mode = 'i2v' | 'r2v-image' | 'r2v-video'
const dir = resolve('artifacts/h3max-speed')
const env = parse(readFileSync(process.env.LAB_ENV_FILE || '/Users/tianyicai/ai-image-editor/.env.local'))
process.env.FAL_KEY ||= env.FAL_KEY?.trim()
if (!process.env.FAL_KEY) throw new Error('FAL_KEY unavailable')
const image = `data:image/jpeg;base64,${readFileSync('artifacts/h3max-reference/person-1.jpg').toString('base64')}`
const imagePrompt = 'The young curly-haired man wears an olive-green jacket over a white T-shirt, standing in a sunlit empty parking lot. Preserve his identity and clothes from the supplied image. Static medium shot, he looks toward the camera, smiles warmly, raises his right hand in a small friendly wave, then lowers it. Natural breathing, subtle movement, realistic cinematic lighting. No cuts, no text, no music, quiet outdoor ambience.'
const editPrompt = 'Edit <<<video_1>>> as the source footage. Make exactly one change: the red book cover becomes saturated cobalt blue. Preserve both men, their original jackets, faces, the bookstore background, framing, lighting, handover motion and its timing. Keep the full source sequence and its duration. No cuts added, no new objects, no captions.'
const manifestPath = `${dir}/sources.json`
const manifest: Record<string, {url:string;durationSec:number}> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath,'utf8')) : {}
const safeError = (error:unknown) => String(error instanceof Error ? error.message : error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,400)
const sleep = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms))
async function run(mode:Mode,duration:number,round:number,suffix='') {
  const name = `${mode}-${duration}s-r${round}${suffix}`, path = `${dir}/${name}.json`
  if (existsSync(path)) {console.log(`SKIP ${name}: existing state, no resubmission`);return}
  const record:Record<string,unknown> = { name,mode,duration,round,host:'Mac',startedAt:new Date().toISOString(),resolution:'768p',promptExpansion:'balanced',ownConcurrency:1,pollIntervalMs:500,source:mode==='r2v-video'?manifest[duration]:{localFile:'person-1.jpg',width:1024,height:576},prompt:mode==='r2v-video'?editPrompt:imagePrompt,status:'submitting' }
  // Persist intent before making the paid call, preventing duplicate reruns on uncertainty.
  writeFileSync(path,JSON.stringify(record,null,2))
  const start = performance.now()
  const now = () => (performance.now()-start)/1000
  try {
    console.log(`START ${name}`)
    const taskId = mode==='i2v'
      ? await createFalH3MaxVideoTask({prompt:imagePrompt,images:[image],duration,resolution:'768p'})
      : await createFalH3MaxReferenceVideoTask({prompt:mode==='r2v-video'?editPrompt:imagePrompt,images:mode==='r2v-image'?[image]:[],videos:mode==='r2v-video'?[manifest[duration]]:[],duration,resolution:'768p',aspectRatio:'16:9'})
    Object.assign(record,{taskId,submitSeconds:now(),status:'pending'})
    writeFileSync(path,JSON.stringify(record,null,2))
    const turbo=mode==='i2v',prefix=turbo?'fal-h3max-turbo-':'fal-h3max-reference-'
    const base=`https://queue.fal.run/minimax/${turbo?'h3-max-turbo':'h3-max'}/requests/${taskId.slice(prefix.length)}`
    const headers={Authorization:`Key ${process.env.FAL_KEY}`}
    const observed:Array<{state:string;seconds:number}>=[]
    record.observedStates=observed
    let last='',pollErrors=0
    while(now()<360) {
      const s=await fetch(`${base}/status`,{headers,signal:AbortSignal.timeout(20000)})
      if(!s.ok){pollErrors++;record.pollErrors=pollErrors;if(pollErrors>3||![429,500,502,503,504].includes(s.status))throw new Error(`Status HTTP ${s.status}`);await sleep(1000);continue}
      const state=await s.json()
      if(state.status!==last){last=state.status;observed.push({state:last,seconds:now()})}
      if(state.status==='FAILED')throw new Error('Provider FAILED')
      if(state.status==='COMPLETED') {
        const response=await fetch(base,{headers,signal:AbortSignal.timeout(20000)})
        if(!response.ok)throw new Error(`Result HTTP ${response.status}`)
        const body=await response.json()
        if(typeof body.video?.url!=='string'||!body.video.url.startsWith('https://'))throw new Error('Completed without a valid video URL')
        Object.assign(record,{status:'completed',urlSeconds:now(),videoUrl:body.video.url,timings:body.timings,seed:body.seed})
        writeFileSync(path,JSON.stringify(record,null,2))
        const checkStart=performance.now()
        try {
          const check=await fetch(body.video.url,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(20000)})
          record.urlCheck={httpStatus:check.status,contentType:check.headers.get('content-type'),seconds:(performance.now()-checkStart)/1000}
          await check.body?.cancel()
        } catch(error){record.urlCheckError=safeError(error)}
        writeFileSync(path,JSON.stringify(record,null,2))
        console.log(`DONE ${name}: URL=${Number(record.urlSeconds).toFixed(2)}s inference=${body.timings?.inference?.toFixed(2) ?? 'n/a'}s`)
        return
      }
      await sleep(500)
    }
    throw new Error('Polling deadline; resume existing task rather than resubmitting')
  } catch(error) {Object.assign(record,{status:record.status==='submitting'?'submission-uncertain':'not-completed',error:safeError(error),elapsedSeconds:now()});writeFileSync(path,JSON.stringify(record,null,2));console.log(`ERROR ${name}: ${record.error}`)}
}
async function main(){
  const {fal}=await import('@fal-ai/client');fal.config({credentials:process.env.FAL_KEY})
  if(process.argv.includes('--repair-15-cfr')) {
    const file=`${dir}/source-15s-cfr30.mp4`
    const actual=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8'}).trim())
    if(actual>15||actual<2)throw new Error(`Invalid corrected source duration: ${actual}`)
    const url=await fal.storage.upload(new File([readFileSync(file)],'source-15s-cfr30.mp4',{type:'video/mp4'}))
    manifest[15]={url,durationSec:actual}
    writeFileSync(`${dir}/sources-cfr30.json`,JSON.stringify({15:manifest[15]},null,2))
    for(const round of [1,2])await run('r2v-video',15,round,'-cfr30')
    return
  }
  for(const duration of [5,10,15])if(!manifest[duration]){
    const file=`${dir}/source-${duration}s.mp4`
    const actual=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',file],{encoding:'utf8'}).trim())
    if(actual>15||actual<2)throw new Error(`Invalid prepared source duration: ${actual}`)
    const url=await fal.storage.upload(new File([readFileSync(file)],`source-${duration}s.mp4`,{type:'video/mp4'}))
    manifest[duration]={url,durationSec:actual};writeFileSync(manifestPath,JSON.stringify(manifest,null,2));console.log(`Prepared ${duration}s source`)
  }
  for(const round of [1,2])for(const duration of (round===1?[5,10,15]:[15,10,5])){
    const order:Mode[]=round===1?['i2v','r2v-image','r2v-video']:['r2v-video','r2v-image','i2v']
    for(const mode of order)await run(mode,duration,round)
  }
  console.log('BENCHMARK FINISHED')
}
main().catch(error=>{console.error(safeError(error));process.exitCode=1})
