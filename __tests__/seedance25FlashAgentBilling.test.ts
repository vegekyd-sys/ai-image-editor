import {describe,it,expect} from 'vitest'
import {generateAnimationHarness} from './helpers/generateAnimationHarness'
const input={model:'seedance-2.5-flash',story_prompt:'<<<media_1>>> A paper boat flies',duration:4,video_resolution:'480p',aspect_ratio:'16:9'}
describe('Flash Agent billing admission',()=>{
 it('does not debit when provider input validation rejects before admission',async()=>{
  const h=generateAnimationHarness();h.ctx.videoModel='seedance-2.5-flash'
  h.createVideo.mockImplementationOnce(async()=>{expect(h.deductFixedCredits).not.toHaveBeenCalled();return {success:false,message:'Invalid reference audio'}})
  const r=await h.tool.execute(input,{messages:[]})
  expect(h.createVideo).toHaveBeenCalledTimes(1)
  expect(r.success).toBe(false);expect(h.deductFixedCredits).not.toHaveBeenCalled();expect(h.refundCredits).not.toHaveBeenCalled()
 })
 it('reserves the fully resolved Flash quote once and persists its cost',async()=>{
  const h=generateAnimationHarness();h.ctx.videoModel='seedance-2.5-flash'
  const r=await h.tool.execute(input,{messages:[]})
  expect(r.success,JSON.stringify(r)).toBe(true);expect(h.deductFixedCredits).toHaveBeenCalledTimes(1)
  expect(h.deductFixedCredits.mock.calls[0][1]).toBe(96)
  expect(h.ctx.pendingVideoSnapshot.videoMeta).toMatchObject({model:'seedance-2.5-flash',creditsCharged:96})
 })
 it('refunds once after explicit provider rejection following admission',async()=>{
  const h=generateAnimationHarness();h.ctx.videoModel='seedance-2.5-flash'
  h.createVideo.mockImplementationOnce(async i=>{await i.onBeforeProviderSubmit({model:i.videoModel,resolution:'480p',durationSec:4});return {success:false,submissionUncertain:false,message:'Provider rejected HTTP400'}})
  expect((await h.tool.execute(input,{messages:[]})).success).toBe(false)
  expect(h.deductFixedCredits).toHaveBeenCalledTimes(1);expect(h.refundCredits).toHaveBeenCalledTimes(1);expect(h.refundCredits.mock.calls[0][1]).toBe(96)
 })
 it('retains the debit and stops retries when the POST outcome is unknown',async()=>{
  const h=generateAnimationHarness();h.ctx.videoModel='seedance-2.5-flash'
  h.createVideo.mockImplementationOnce(async i=>{await i.onBeforeProviderSubmit({model:i.videoModel,resolution:'480p',durationSec:4});return {success:false,submissionUncertain:true,message:'Timeout'}})
  expect(await h.tool.execute(input,{messages:[]})).toMatchObject({success:false,retryable:false,errorCode:'SUBMISSION_UNCERTAIN'})
  expect(h.deductFixedCredits).toHaveBeenCalledTimes(1);expect(h.refundCredits).not.toHaveBeenCalled();expect(h.createVideo).toHaveBeenCalledTimes(1)
 })
 it('retains the accepted task receipt if project persistence fails',async()=>{
  const h=generateAnimationHarness();h.ctx.videoModel='seedance-2.5-flash';h.insert.mockResolvedValueOnce({error:{message:'Storage unavailable'}})
  expect(await h.tool.execute(input,{messages:[]})).toMatchObject({success:false,retryable:false,taskId:'fal-h3max-turbo-test',errorCode:'PERSISTENCE_RECONCILIATION_REQUIRED'})
  expect(h.deductFixedCredits).toHaveBeenCalledTimes(1);expect(h.refundCredits).not.toHaveBeenCalled();expect(h.createVideo).toHaveBeenCalledTimes(1)
 })

})
