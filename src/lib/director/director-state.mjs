// Shared Director protocol from Makaron TV e29b9e9.
export const DIRECTOR_ENDPOINT = 'minimax/h3-max/director';
export function buildDirectorConfigure({prompt, resolution='480p', aspectRatio='16:9', memory=12, seed='', imageUrl=null}) {
  if (!prompt?.trim() || prompt.length > 50000) throw new Error('开场指令需要 1–50000 个字符');
  if (!['480p','768p'].includes(resolution) || !['16:9','9:16','1:1'].includes(aspectRatio)) throw new Error('分辨率或画幅无效');
  if (!Number.isInteger(Number(memory)) || memory < 1 || memory > 50) throw new Error('记忆范围为 1–50 段');
  if (seed !== '' && !Number.isSafeInteger(Number(seed))) throw new Error('Seed 必须是整数');
  return {type:'configure', protocol_version:1, prompt_version:1, prompt:prompt.trim(), resolution,
    aspect_ratio:aspectRatio, memory:Number(memory), ...(seed !== '' ? {seed:Number(seed)} : {}), ...(imageUrl ? {image_url:imageUrl} : {})};
}
export function createDirectorState(config, now=0) {
  return {config, startedAt:now, firstFrameMs:null, version:1, appliedVersion:0, terminal:false,
    status:'connecting', prompts:[{version:1,text:config.prompt,sentAt:now,status:'sent'}], events:[], chunks:[], deadlines:0, lateSeconds:0};
}
export function addDirectorPrompt(state, text, now) {
  if (!state || state.terminal || state.status !== 'live') throw new Error('请先连接 Director，结束后需新开一场');
  if (!text.trim() || text.length>50000) throw new Error('指令需要 1–50000 个字符');
  const version=++state.version;
  state.prompts.push({version,text:text.trim(),sentAt:now,status:'sent'});
  // Pin the provider default for both Director and girlfriend conversation.
  // Replans undispatched chunks; it does not cancel in-flight video or playback.
  return {type:'prompt',prompt_version:version,prompt:text.trim(),replan:true};
}
export function applyDirectorEvent(state, event, now) {
  if (state.terminal) return;
  // Keep scalar telemetry only: provider error detail can echo uploaded images or SDP.
  const safeEvent=Object.fromEntries(Object.entries(event).filter(([key,value])=>
    !/image|sdp|ice|token|key|url|detail|prompt$/.test(key) &&
    ['string','number','boolean'].includes(typeof value)));
  state.events.push({at:now-state.startedAt,...safeEvent});
  if (state.events.length>500) state.events.shift();
  const prompt=state.prompts.find(p=>p.version===event.prompt_version);
  if (event.type==='configured') { state.status='live'; state.appliedVersion=event.prompt_version;if(prompt)prompt.status='applied'; }
  if (event.type==='prompt_pending' && prompt && prompt.status!=='applied') {prompt.status='pending';prompt.pendingMs??=now-prompt.sentAt;}
  if (event.type==='prompt_applied') {
    state.appliedVersion=Math.max(state.appliedVersion,event.prompt_version);
    if (prompt) {prompt.status='applied';prompt.appliedMs??=now-prompt.sentAt;}
  }
  if (event.type==='prompt_rejected' && prompt) prompt.status='rejected';
  if (event.type==='chunk' && !state.chunks.some(c=>c.chunk_index===event.chunk_index)) {
    state.chunks.push({...safeEvent,receivedAtMs:now-state.startedAt});
    if(prompt && prompt.firstChunkMs===undefined)Object.assign(prompt,{firstChunkMs:now-prompt.sentAt,firstChunkIndex:event.chunk_index,generationSeconds:event.generation_seconds,bufferSeconds:event.buffer_depth_seconds});
  }
  if (event.type==='deadline_missed') { state.deadlines++; state.lateSeconds+=event.late_by_seconds || 0; }
  if (event.type==='error') {state.status='error';state.error=`${event.code}: ${event.error}`;state.terminal=true;}
  if (event.type==='stream_exhausted') {state.status='ended';state.terminal=true;}
}
export function directorReport(state) {
  const {image_url, ...config}=state.config;
  return {route:'native-director-webrtc',endpoint:DIRECTOR_ENDPOINT,config,hasInitialImage:Boolean(image_url),
    firstFrameMs:state.firstFrameMs,status:state.status,error:state.error,deadlineMisses:state.deadlines,
    lateSeconds:state.lateSeconds,prompts:state.prompts,chunks:state.chunks,events:state.events,
    note:'prompt_applied 是生成侧确认，不代表画面已播放；本报告不包含首图、密钥、SDP 或 ICE 地址。'};
}
