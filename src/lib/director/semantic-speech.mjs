// Shared by standalone and embedded Director clients; the organizer is injected by the host.
// Each request owns an immutable draft revision. More speech invalidates it;
// model replies and Director acknowledgements never clear newer speech.
export class SemanticSpeech {
  constructor({organize,onDraft=()=>{},onStatus=()=>{},onCommit=()=>{},delay=650,schedule=(f,ms)=>setTimeout(f,ms),cancel=id=>clearTimeout(id),now=()=>performance.now()}={}){
    Object.assign(this,{organize,onDraft,onStatus,onCommit,delay,schedule,cancel,now});
    this.items=new Map();this.done=new Set();this.previous=[];this.metrics=[];this.revision=0;this.enabled=true;
  }
  get text(){return [...this.items.values()].map(i=>i.text).filter(Boolean).join(' ');}
  get waiting(){return [...this.items.values()].some(i=>!i.final);}
  invalidate(){this.revision++;if(this.timer!==undefined)this.cancel(this.timer);this.timer=undefined;this.controller?.abort();this.controller=null;}
  reset(){this.invalidate();this.items.clear();this.done.clear();this.previous=[];this.enabled=true;}
  pause(){this.invalidate();this.enabled=false;}
  finishInput(){
    // Only an explicit mic-off action seals the currently visible ASR tail.
    // It is still judged by the model; never send partial/raw text as a fallback.
    if(this.text.length>8000){this.pause();this.onStatus('error','草稿过长，请缩短后重试');return Promise.resolve();}
    this.enabled=true;
    for(const item of this.items.values())item.final=true;
    this.onDraft(this.text,false);
    return this.flush();
  }
  resume(){this.enabled=true;this.queue();}
  activity({id}){
    if(!this.enabled || !id || this.done.has(id))return;
    this.invalidate();if(!this.items.has(id))this.items.set(id,{text:'',final:false});
    this.onDraft(this.text,true);this.onStatus('listening');
  }
  accept({id,text,final}){
    if(!this.enabled || !id || this.done.has(id))return;
    if(this.items.get(id)?.final)return;
    this.invalidate();this.items.set(id,{text,final});this.lastInputAt=this.now();this.onDraft(this.text,this.waiting);
    if(this.text.length>8000){this.pause();this.onStatus('error','草稿过长，请缩短或清空后重试');return;}
    this.onStatus(this.waiting?'listening':'pending');this.queue();
  }
  queue(){
    // Start semantic work immediately after confirmed ASR, in parallel with the
    // correction window. Resumed speech still aborts this revision; raw partials
    // never reach the model or the video transport.
    if(this.enabled && this.text.trim() && !this.waiting)this.timer=this.schedule(()=>{this.timer=undefined;void this.flush({guardMs:this.delay});},0);
  }
  waitForGuard(ms,signal){
    if(ms<=0 || signal.aborted)return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{this.cancel(timer);signal.removeEventListener('abort',done);resolve();};
      const timer=this.schedule(done,ms);signal.addEventListener('abort',done,{once:true});
    });
  }
  async flush({guardMs=0}={}){
    if(!this.enabled || this.waiting || !this.text.trim())return;
    this.invalidate();const revision=this.revision,controller=new AbortController();this.controller=controller;
    const text=this.text,started=this.now(),inputAt=this.lastInputAt??started;this.onStatus('organizing');
    try{
      const result=await this.organize({text,previous:this.previous.slice(-3)},{signal:controller.signal});
      if(revision!==this.revision || !this.enabled)return;
      if(!['send','wait','discard','chat','end'].includes(result.action) || (result.action==='send' && !result.text?.trim()))throw new Error('整理结果格式无效');
      result.roundTripMs=Math.round(this.now()-started);
      if(['send','end','chat'].includes(result.action)){
        await this.waitForGuard(guardMs-(this.now()-inputAt),controller.signal);
        if(revision!==this.revision || !this.enabled)return;
      }
      result.finalToDecisionMs=Math.round(this.now()-inputAt);
      this.metrics.push({action:result.action,latencyMs:result.latencyMs,roundTripMs:result.roundTripMs,finalToDecisionMs:result.finalToDecisionMs,organizeStartDelayMs:Math.round(started-inputAt),model:result.model});if(this.metrics.length>100)this.metrics.shift();
      if(result.action==='wait'){this.onStatus('waiting');return;}
      if((result.action==='chat' || result.action==='end') && this.onCommit(text,result)===false)throw Error('宿主没有接收该轮输入');
      if(result.action==='send'){
        // Synchronous acceptance only. A failed delivery must preserve the draft.
        if(this.onCommit(result.text,result)===false)throw new Error('指令未被接收，草稿已保留');
        this.previous.push(result.text.slice(0,2000));if(this.previous.length>3)this.previous.shift();
      }
      for(const id of this.items.keys())this.done.add(id);
      this.items.clear();this.onStatus(result.action==='send'?'sent':result.action==='discard'?'discarded':result.action,result);
    }catch(error){if(revision===this.revision && this.enabled)this.onStatus('error',error.message);}
    finally{if(this.controller===controller)this.controller=null;}
  }
  // New recording IDs can be reused by ASR. Explicit restart abandons old tails,
  // while keeping the last sent instructions as reference context.
  newCapture(){this.invalidate();this.items.clear();this.done.clear();this.enabled=true;}
}
