import test from 'node:test';
import assert from 'node:assert/strict';
import {SemanticSpeech} from '../../src/lib/director/semantic-speech.mjs';
import {parseOrganization} from '../../src/lib/director/organizer.mjs';
import {createDirectorState,addDirectorPrompt,applyDirectorEvent} from '../../src/lib/director/director-state.mjs';

function speech(organize, commit) {
  return new SemanticSpeech({organize,onCommit:commit,schedule:()=>0,cancel:()=>{}});
}
const final=(session,id,text)=>session.accept({id,text,final:true});
test('a correction invalidates an older in-flight direction or stop',async()=>{
  let finish;
  const sent=[];
  const session=speech(()=>new Promise(resolve=>{finish=resolve;}),(...args)=>sent.push(args));
  final(session,'a','结束直播');const pending=session.flush();
  final(session,'b','不对，继续刚才的场景');finish({action:'end',text:''});
  await pending;
  assert.equal(sent.length,0);assert.equal(session.text,'结束直播 不对，继续刚才的场景');
});
test('host receives conversation and stop independently of Director prompt history',async()=>{
  const inputs=[],events=[];
  const decisions=[{action:'wait',text:''},{action:'send',text:'变成蓝色'},{action:'chat',text:''},{action:'end',text:''}];
  const session=speech(async input=>{inputs.push(input);return decisions.shift();},(text,e)=>events.push([text,e.action]));
  for(const [id,text] of ['把它变成','蓝色','它为什么是蓝的？','收播吧'].entries()){final(session,String(id),text);await session.flush();}
  assert.deepEqual(events,[['变成蓝色','send'],['它为什么是蓝的？','chat'],['收播吧','end']]);
  assert.equal(inputs[1].text,'把它变成 蓝色');assert.deepEqual(inputs[3].previous,['变成蓝色']);
});
test('host-only actions cannot close a standalone show through the direction organizer',()=>{
  const data={choices:[{finish_reason:'stop',message:{content:'{"action":"end","text":""}'}}]};
  assert.throws(()=>parseOrganization(data,'director'));
  assert.deepEqual(parseOrganization(data,'host'),{action:'end',text:''});
});
test('server acceptance and first rendered frame remain distinct',()=>{
  const state=createDirectorState({prompt:'工作室'},0);
  applyDirectorEvent(state,{type:'configured',prompt_version:1},5);
  const message=addDirectorPrompt(state,'窗外下雪了',8);
  assert.equal(message.replan,true);assert.equal(message.prompt_version,2);
  applyDirectorEvent(state,{type:'prompt_applied',prompt_version:2},13);
  assert.equal(state.appliedVersion,2);assert.equal(state.firstFrameMs,null);
});
