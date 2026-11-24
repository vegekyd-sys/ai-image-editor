export function createVoiceState(){return {done:new Set(),text:'',item:null,order:new Map()};}
// Speech activity claims display ownership before the first text arrives.
// A late final is still delivered for command handling, never for old captions.
export function observeVoiceItem(state,id){
  if(!id || state.done.has(id))return false;
  if(!state.order.has(id))state.order.set(id,state.order.size);
  if(state.item===null || state.order.get(id)>=state.order.get(state.item))state.item=id;
  return state.item===id;
}
export function createVoiceDirection(){return {parts:[],version:null};}
export function appendVoiceDirection(state,text){state.parts.push(text);return state.parts.join(' ');}
export function settleVoiceDirection(state,version){if(version===state.version){state.parts=[];state.version=null;}}
export function composerAction(run){
  if(!run)return 'start';
  if(run.terminal)return 'reject';
  if(run.status==='connecting')return 'queue';
  if(run.status==='live')return 'send';
  return 'reject';
}
export function acceptTranscript(state,event){
  if(!['partial','final'].includes(event.type)||!event.id||state.done.has(event.id))return null;
  const current=observeVoiceItem(state,event.id);
  const text=String(event.text || '').trim();
  if(event.type==='final')state.done.add(event.id);
  if(current)state.text=text;
  if(!current && event.type==='partial')return null;
  // Empty finals still settle a VAD item; otherwise a noise-only item leaves
  // semantic buffering waiting forever and blocks all subsequent utterances.
  return text || event.type==='final' ? {text,final:event.type==='final',id:event.id,current}:null;
}
