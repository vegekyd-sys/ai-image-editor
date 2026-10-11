// @vitest-environment node
import {execFileSync} from 'node:child_process'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe,it,expect} from 'vitest'
import {findFfmpeg} from '@/lib/ffmpeg-runtime'
import {planRetake} from '@/lib/video-retake-contract'
import {assembleRetake,RetakeDeliveryError} from '@/lib/video-retake-media'

describe('selected generated audio delivery',()=>{
  it.each([
    {model:'fal-h3-max',sourceSound:true,patchLength:6},
    {model:'seedance-2.5-eco',sourceSound:true,patchLength:4},
    {model:'fal-h3-max',sourceSound:false,patchLength:6},
  ])('retimes picture and sound together and keeps outside sound (%j)',async({model,sourceSound,patchLength})=>{
    const dir=mkdtempSync(join(tmpdir(),'retake-new-audio-')),ffmpeg=await findFfmpeg()
    const run=(args:string[])=>execFileSync(ffmpeg,['-v','error','-y',...args],{maxBuffer:8*1024*1024})
    try {
      const source=join(dir,'source.mp4'),patch=join(dir,'patch.mp4'),final=join(dir,'final.mp4')
      run(['-f','lavfi','-i','color=black:s=320x240:r=24:d=6',...(sourceSound?['-f','lavfi','-i','sine=frequency=440:duration=6']:[]),'-c:v','libx264',...(sourceSound?['-c:a','aac']:[]),source])
      run(['-f','lavfi','-i',`color=red:s=320x240:r=24:d=${patchLength/2}`,'-f','lavfi','-i',`color=blue:s=320x240:r=24:d=${patchLength/2}`,
        '-f','lavfi','-i',`sine=frequency=880:duration=${patchLength/2}`,'-f','lavfi','-i',`sine=frequency=1320:duration=${patchLength/2}`,
        '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]',
        '-map','[v]','-map','[a]','-c:v','libx264','-c:a','aac',patch])
      const result=await assembleRetake(readFileSync(source),readFileSync(patch),{...planRetake({start:2,end:4},6,model),audioMode:'generated'})
      writeFileSync(final,result.bytes)
      expect(result.meta.duration).toBeCloseTo(6,1)
      const frequency=(time:number)=>{
        const pcm=run(['-ss',String(time),'-i',final,'-t','0.15','-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'])
        const samples=Array.from({length:pcm.length/4},(_,i)=>pcm.readFloatLE(i*4))
        if(Math.max(...samples.map(Math.abs))<.005)return 0
        const crosses=samples.slice(1).filter((v,i)=>v>=0&&samples[i]<0||v<0&&samples[i]>=0).length
        return crosses/2/(samples.length/16000)
      }
      expect(frequency(.5)).toBeCloseTo(sourceSound?440:0,-2)
      expect(frequency(2.35)).toBeCloseTo(880,-2)
      expect(frequency(3.4)).toBeCloseTo(1320,-2)
      expect(frequency(5)).toBeCloseTo(sourceSound?440:0,-2)
      const pixel=(time:number)=>run(['-ss',String(time),'-i',final,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
      const early=pixel(2.4),late=pixel(3.4)
      expect(early[0]).toBeGreaterThan(early[2]+100)
      expect(late[2]).toBeGreaterThan(late[0]+100)
    } finally {rmSync(dir,{recursive:true,force:true})}
  },20000)
  it('rejects a silent provider result instead of reporting source audio as new sound',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'retake-no-audio-')),ffmpeg=await findFfmpeg()
    try {
      const file=join(dir,'silent.mp4')
      execFileSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=black:s=320x240:r=24:d=6','-c:v','libx264',file])
      await expect(assembleRetake(readFileSync(file),readFileSync(file),{...planRetake({start:2,end:4},6),audioMode:'generated'})).rejects.toBeInstanceOf(RetakeDeliveryError)
    } finally {rmSync(dir,{recursive:true,force:true})}
  })
})
