/** Paid product-path checks. Durable intent and receipts prevent duplicate submits. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
const exec = promisify(execFile)
const root = 'artifacts/h3max-integration'
const cli = 'packages/makaron-cli/bin/makaron.mjs'
const env = { ...process.env, MAKARON_URL: process.env.MAKARON_URL || 'http://localhost:4395' }
const asset = 'artifacts/h3max-reference/'
const cases = {
  'turbo-legacy': ['--video-model','minimax-h3-max','--image',asset+'person-1.jpg','--script','<<<image_1>>> smiles warmly and makes a small hand wave. Preserve his face and olive jacket. Static camera.'],
  'max-single': ['--video-model','fal-h3-max','--image',asset+'person-1.jpg','--script','Place the person in <<<image_1>>> inside a cozy bookstore. Preserve his face and olive jacket. He picks up a red book. Static camera.'],
  'max-multi': ['--video-model','fal-h3-max','--image',asset+'person-1.jpg','--image',asset+'person-2.jpg','--script','<<<image_1>>> is on the left and <<<image_2>>> is on the right inside a bookstore. Preserve both identities and original clothes. The younger man gives a red book to the older man. Static medium shot.'],
  'max-video': ['--video-model','fal-h3-max','--video',asset+'h3-double-1.mp4','--script','Edit <<<video_1>>>. Change only the red book cover to cobalt blue. Preserve both people, original clothes, bookstore, framing and the original handover motion.'],
  'max-mixed': ['--video-model','fal-h3-max','--image',asset+'person-1.jpg','--image',asset+'person-2.jpg','--video',asset+'h3-double-1.mp4','--audio',asset+'rhythm.wav','--script','Use <<<image_1>>> and <<<image_2>>> for the two people and their clothes. Keep the bookstore and handover motion in <<<video_1>>>. Make the book cobalt blue. Use <<<audio_1>>> as a gentle rhythmic soundtrack.'],
}
const sleep = ms => new Promise(r=>setTimeout(r,ms))
for (const [name,args] of Object.entries(cases)) {
  if (process.argv[2] && process.argv[2] !== name) continue
  const file = `${root}/${name}.json`
  let record = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : { name, host:env.MAKARON_URL, startedAt:new Date().toISOString(), status:'submitting' }
  const save = () => writeFileSync(file,JSON.stringify(record,null,2))
  const t0 = performance.now()
  try {
    if (!existsSync(file)) {
      save();console.log('START',name)
      const { stdout,stderr } = await exec('node',[cli,'video','create',...args,'--duration','5','--video-resolution','768p'],{env,timeout:240000,maxBuffer:2e6})
      record.receipt=stdout;record.uploadLog=stderr;record.submitSeconds=(performance.now()-t0)/1000
      record.taskId=stdout.match(/Task ID:\s*([a-z0-9-]+)/)?.[1]
      record.billingRequestId=stdout.match(/Billing request:\s*([a-z0-9-]+)/)?.[1]
      if (!record.taskId) throw new Error('No provider receipt; inspect before retrying')
      record.status='submitted';save()
    } else if (record.status==='completed' || !record.taskId) { console.log('SKIP',name,record.status);continue }
    while (performance.now()-t0<360000) {
      const {stdout}=await exec('node',[cli,'video','status',record.taskId],{env,timeout:60000,maxBuffer:2e6})
      const url=stdout.match(/Video URL:\s*(https:\/\/\S+)/)?.[1]
      if(url) {
        record.url=url;record.urlSeconds=(performance.now()-t0)/1000;record.status='completed';save()
        const r=await fetch(url,{headers:{Range:'bytes=0-1023'}})
        record.urlCheck={status:r.status,type:r.headers.get('content-type')};await r.body?.cancel()
        save();console.log('DONE',name,record.urlSeconds.toFixed(1),url);break
      }
      if(/failed|error:/i.test(stdout)) throw new Error(stdout)
      await sleep(1500)
    }
    if(record.status!=='completed')throw new Error('Polling timeout; resume this receipt, do not resubmit')
  } catch(error) {
    record.error=String(error.stderr||error.message||error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,1500);save();console.log('FAILED',name,record.error)
  }
}
