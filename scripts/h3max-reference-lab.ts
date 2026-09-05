/** Local paid acceptance; credentials are read from an explicit env file, never written to artifacts. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { execFileSync } from 'node:child_process'
import { createFalH3MaxReferenceVideoTask, estimateH3MaxReferenceCost, type H3MaxReferenceInput } from '../src/lib/fal-h3-max-reference-video'
import { getFalH3MaxVideoTask } from '../src/lib/fal-h3-max-video'
import { createVideo } from '../src/lib/skills/create-video'
import { getVideoStatus } from '../src/lib/skills/get-video-status'

const dir = resolve('artifacts/h3max-reference')
const env = parse(readFileSync(process.env.LAB_ENV_FILE || '/Users/tianyicai/ai-image-editor/.env.local'))
for (const key of ['FAL_KEY', 'MULEROUTER_API_KEY']) if (!process.env[key] && env[key]) process.env[key] = env[key].trim()
const imageUrls = ['https://v3b.fal.media/files/b/0aa84f02/bTd9qCmyLexG3xUYK1QbU_yubGxlAJ.jpg','https://v3b.fal.media/files/b/0aa84f18/B5MRRsOv259EL-RQ3x5Gf_ITIsghPc.jpg']
const images = [1,2].map(n => `data:image/jpeg;base64,${readFileSync(`${dir}/person-${n}.jpg`).toString('base64')}`)
const basePrompt = '<<<media_1>>> is the young curly-haired man in the olive green jacket. <<<media_2>>> is the older mustached man in the tan jacket. Preserve both identities and clothing. A single wide two-shot inside a warm, wood-paneled bookstore, completely different from the reference backgrounds. The young man stands on the left and passes a small red book to the older man on the right, who accepts it and smiles. Natural body motion, cinematic realistic lighting, static camera. Quiet bookstore ambience and soft footsteps, no dialogue, no music, no captions.'
async function run(name: string, input: H3MaxReferenceInput, wan = false) {
  const file = `${dir}/${name}.json`
  if (existsSync(file)) { console.log(`${name}: existing result; not submitting again`); return }
  const start = performance.now()
  const record: Record<string, any> = { name, host: 'Mac', startedAt: new Date().toISOString(), endpoint: wan ? 'existing createVideo / wan-3.0-prime' : 'minimax/h3-max/reference-to-video', prompt: input.prompt, imageUrls: imageUrls.slice(0,input.images.length), duration: input.duration ?? 5, resolution: wan ? '720p' : input.resolution ?? '768p' }
  try {
    let taskId: string
    if (wan) {
      const result = await createVideo({ script: input.prompt, images: imageUrls, duration: 5, aspectRatio:'16:9', videoModel: 'wan-3.0-prime', videoResolution: '720p' })
      if (!result.success || !result.taskId) throw new Error(result.message)
      taskId = result.taskId
    } else taskId = await createFalH3MaxReferenceVideoTask(input)
    Object.assign(record, { taskId, submitSeconds: (performance.now()-start)/1000 })
    writeFileSync(file, JSON.stringify(record,null,2))
    console.log(`${name}: submitted ${taskId} in ${record.submitSeconds.toFixed(2)}s`)
    while (performance.now()-start < 600_000) {
      const status = wan ? await getVideoStatus({ taskId }) : await getFalH3MaxVideoTask(taskId)
      if (status.status === 'failed') throw new Error(status.error || 'Provider task failed')
      if (status.status === 'completed' && status.videoUrl) {
        Object.assign(record, { status: 'completed', videoUrl: status.videoUrl, readySeconds: (performance.now()-start)/1000 })
        writeFileSync(file, JSON.stringify(record,null,2))
        if (!wan) {
          const raw = await fetch(`https://queue.fal.run/minimax/h3-max/requests/${taskId.replace('fal-h3max-reference-','')}`, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } }).then(r=>r.json())
          record.timings = raw.timings
          record.expandedPrompt = raw.expanded_prompt
          record.costEstimate = estimateH3MaxReferenceCost({ duration: input.duration ?? 5, resolution: input.resolution ?? '768p', images: input.images.map(()=>({width:1024,height:576})), videoSeconds: input.videos?.reduce((s,v)=>s+v.durationSec,0) ?? 0, audioSeconds: input.audios?.reduce((s,v)=>s+v.durationSec,0) ?? 0 })
        }
        try { execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','90',status.videoUrl,'-o',`${dir}/${name}.mp4`]) }
        catch { record.downloadError = 'Direct download failed; inspect TLS/network before retrying download only.' }
        writeFileSync(file,JSON.stringify(record,null,2))
        console.log(`${name}: completed ${record.readySeconds.toFixed(2)}s ${JSON.stringify(record.timings || {})}`)
        return
      }
      await new Promise(r=>setTimeout(r,3000))
    }
    throw new Error('Polling deadline reached; resume existing task, do not submit again')
  } catch(error) {
    record.error = error instanceof Error ? error.message : String(error)
    writeFileSync(file,JSON.stringify(record,null,2)); console.log(`${name}: ${record.error}`)
  }
}
async function main() {
  if (process.argv.includes('--multimodal')) {
    const source = JSON.parse(readFileSync(`${dir}/h3-double-1.json`,'utf8'))
    const sourceDuration = Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',`${dir}/h3-double-1.mp4`],{encoding:'utf8'}).trim())
    const { fal } = await import('@fal-ai/client')
    fal.config({ credentials: process.env.FAL_KEY })
    const audio = await fal.storage.upload(new File([readFileSync(`${dir}/rhythm.wav`)], 'rhythm.wav', { type: 'audio/wav' }))
    await run('h3-multimodal-url', { prompt: basePrompt + ' Use <<<video_1>>> as the handover motion reference. Use the pulse rhythm from <<<audio_1>>> in the soundtrack.', images, videos:[{url:source.videoUrl,durationSec:sourceDuration}], audios:[{url:audio,durationSec:3}],duration:5,aspectRatio:'16:9',seed:23 })
    return
  }
  await Promise.allSettled([
    run('h3-single', {prompt:'<<<media_1>>> is the young man in the olive green jacket. Preserve his face and clothes. Wide full-body shot of him browsing books in a warm wood-paneled bookstore, a new environment unlike the reference parking lot. He takes a red book off a shelf and smiles. Natural cinematic lighting, no captions, no speech.',images:[images[0]],duration:5,aspectRatio:'16:9',seed:21}),
    run('h3-double-1',{prompt:basePrompt,images,duration:5,aspectRatio:'16:9',seed:22}),
    run('h3-double-2',{prompt:basePrompt,images,duration:5,aspectRatio:'16:9',seed:23}),
    run('wan-double',{prompt:basePrompt,images,duration:5,aspectRatio:'16:9'},true),
  ])
}
main().catch(error=>{ console.error(error.message); process.exitCode=1 })
