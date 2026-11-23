import {createVoiceState,acceptTranscript,observeVoiceItem} from './voice-state.js';

export class LiveVoice {
  constructor({socketUrl,protocol,onState,onText,onLevel,onActivity=()=>{}}){Object.assign(this,{socketUrl,protocol,onState,onText,onLevel,onActivity});this.epoch=0;this.active=false;this.metrics=[];this.sessions=[];this.closing=Promise.resolve();}
  stop(message='麦克风已关闭'){
    this.epoch++;this.active=false;clearTimeout(this.timeout);clearInterval(this.captureWatchdog);clearTimeout(this.drainTimer);this.drainTimer=null;
    if(this.pendingAudio)this.pendingAudio.length=0;this.pendingAudio=null;
    if(this.session && this.session.stoppedAt===undefined){this.session.stoppedAt=performance.now();this.session.stopReason=message;}
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
    if(this.node){this.node.port.onmessage=null;this.node.onprocessorerror=null;this.node.disconnect();this.node.port.close?.();}this.node=null;
    this.source?.disconnect();this.source=null;
    if(this.context)this.closing=this.context.close().catch(()=>{});this.context=null;
    this.socket?.close();this.socket=null;this.onLevel(0);this.onState('off',message);
  }
  async start(){
    if(this.active)return;
    const epoch=++this.epoch;this.active=true;this.state=createVoiceState();this.timings=new Map();
    const session={id:epoch,startedAt:performance.now(),packets:0,audiblePackets:0,zeroPackets:0,peakLevel:0,partials:0,finals:0,trackEvents:[]};
    this.session=session;this.sessions.push(session);if(this.sessions.length>20)this.sessions.shift();
    this.onState('connecting','正在连接实时语音…');
    try{
      if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)throw new Error('当前浏览器不支持实时语音，请使用 HTTPS 或本地 Chrome。');
      const context=new AudioContext({sampleRate:16000,latencyHint:'interactive'});this.context=context;
      if(context.sampleRate!==16000)throw new Error('浏览器不支持 16 kHz 采集，请使用 Chrome。');
      await context.resume();
      // Keep resume in the user's gesture, but never reacquire the microphone
      // while the previous audio device is still asynchronously closing.
      await this.closing;
      // Cancelling during resume must not open a permission prompt afterwards.
      if(epoch!==this.epoch)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;
      const track=stream.getAudioTracks()[0],settings=track.getSettings?.() || {};
      session.inputLabel=track.label || '';session.inputSettings=Object.fromEntries(['sampleRate','channelCount','echoCancellation','noiseSuppression','autoGainControl'].filter(k=>settings[k]!==undefined).map(k=>[k,settings[k]]));
      for(const type of ['mute','unmute'])track[`on${type}`]=()=>{if(epoch===this.epoch && session.trackEvents.length<40)session.trackEvents.push({type,at:performance.now()-session.startedAt});};
      track.onended=()=>{if(epoch===this.epoch)this.stop('麦克风已断开，请重新开启。');};
      await context.audioWorklet.addModule(new URL('./voice-worklet.js',import.meta.url));if(epoch!==this.epoch)return;
      const socket=new WebSocket(this.socketUrl,this.protocol);this.socket=socket;
      socket.onopen=()=>{if(epoch===this.epoch)session.socketOpenedAt=performance.now();};
      // Capture while the WebSocket/provider is connecting, not only after ready.
      // PCM stays in this microphone session's memory and is discarded on stop.
      const pending=[];this.pendingAudio=pending;
      let ready=false,pendingBytes=0,lastPacket=performance.now(),lastAudible=lastPacket,receiving=false,quiet=false;
      session.bufferedPackets=0;session.sentPackets=0;session.sentBytes=0;session.maxBufferedMs=0;
      const flush=()=>{
        if(epoch!==this.epoch || !ready || this.drainTimer || socket.readyState!==WebSocket.OPEN)return;
        if(socket.bufferedAmount>128*1024){this.stop('网络拥堵，已停止语音，避免积压旧指令。');return;}
        try{
          // Small bursts avoid overflowing either WebSocket while catching up.
          // Count from OPEN, not construction: a slow handshake is not included
          // in the server's elapsed-time rate limit. Keep 1s of its 3s grace spare.
          const allowance=32000*(2+Math.max(0,performance.now()-(session.socketOpenedAt??session.readyAt))/1000)-session.sentBytes;
          let bytes=0;
          while(pending.length && bytes+pending[0].byteLength<=Math.min(64*1024,allowance) && socket.bufferedAmount<64*1024){
            const buffer=pending.shift();pendingBytes-=buffer.byteLength;bytes+=buffer.byteLength;
            socket.send(buffer);session.sentPackets++;session.sentBytes+=buffer.byteLength;
          }
          if(pending.length)this.drainTimer=setTimeout(()=>{this.drainTimer=null;flush();},40);
        }catch{this.stop('语音音频发送失败，请重新开启麦克风。');}
      };
      const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'voice-capture');this.node=node;this.source=source;
      node.port.onmessage=({data})=>{
        if(epoch!==this.epoch)return;
        lastPacket=performance.now();session.packets++;
        if(!receiving){
          receiving=true;session.firstPacketAt=lastPacket;
          this.captureStart=lastPacket-data.buffer.byteLength/32;session.captureStart=this.captureStart;
          this.onState(ready?'listening':'connecting',ready?'正在听 · 停顿后发送':'正在收音 · 识别连接中，开头会保留');
        }
        if(data.level>0.001){session.audiblePackets++;lastAudible=lastPacket;if(quiet){quiet=false;if(ready)this.onState('listening','已收到声音 · 正在识别');}}
        if(data.level===0)session.zeroPackets++;session.peakLevel=Math.max(session.peakLevel,data.level);
        this.onLevel(data.level);
        // Never silently drop the opening words when a connection is stuck.
        if(pendingBytes+data.buffer.byteLength>32000*16){this.stop('语音连接积压过久，已停止收音，请重新开启后重说。');return;}
        pending.push(data.buffer);pendingBytes+=data.buffer.byteLength;
        if(!ready)session.bufferedPackets++;
        session.maxBufferedMs=Math.max(session.maxBufferedMs,pendingBytes/32);
        flush();
      };
      node.onprocessorerror=()=>{if(epoch===this.epoch)this.stop('麦克风音频处理已中断，请重新开启。');};
      this.captureWatchdog=setInterval(()=>{
        if(epoch!==this.epoch)return;
        session.contextState=context.state;session.trackState=track.readyState;
        session.trackMuted=track.muted;session.trackEnabled=track.enabled;
        if(performance.now()-lastPacket>4000)this.stop('麦克风未传入音频，请重新开启；若仍无声音，请检查输入设备。');
        else if(ready && receiving && !quiet && performance.now()-lastAudible>4000){quiet=true;this.onState('listening','音频连接正常，暂未检测到声音 · 请说话或检查麦克风');}
      },1000);
      // Worklet output is silent. Never monitor the microphone through speakers.
      source.connect(node);node.connect(context.destination);
      this.timeout=setTimeout(()=>{if(epoch===this.epoch)this.stop('语音连接超时，请重试。');},14000);
      socket.onmessage=({data})=>{
        if(epoch!==this.epoch)return;
        try{
        const event=JSON.parse(data),time=performance.now();
        if(event.type==='error'){this.stop(event.message);return;}
        if(event.type==='ready'){
          if(ready)return;
          ready=true;clearTimeout(this.timeout);session.readyAt=time;
          this.onState(receiving?'listening':'connecting',receiving?'正在听 · 开头语音已接续识别':'识别已连接 · 正在等待麦克风音频…');
          flush();return;
        }
        if(event.type==='speech_started'){
          this.timings.set(event.id,{start:this.captureStart+event.audioMs});
          if(observeVoiceItem(this.state,event.id))this.onActivity(event);
        }
        if(event.type==='speech_stopped'){const t=this.timings.get(event.id);if(t)t.end=this.captureStart+event.audioMs;}
        const text=acceptTranscript(this.state,event);
        if(text){
          session[text.final?'finals':'partials']++;
          const t=this.timings.get(event.id)||{};
          if(!t.first){t.first=time;this.timings.set(event.id,t);}
          this.onText(text);
          if(text.final){this.metrics.push({firstTextMs:Math.round(t.first-t.start),finalAfterSpeechMs:Math.round(time-t.end),displayDispatchMs:Math.round(performance.now()-time)});this.timings.delete(event.id);if(this.metrics.length>100)this.metrics.shift();}
        }
        }catch{this.stop('语音数据处理失败，麦克风已关闭，请重新开启。');}
      };
      socket.onerror=()=>{if(epoch===this.epoch)this.stop('语音连接失败，请检查网络或服务器语音配置。');};
      socket.onclose=()=>{if(epoch===this.epoch)this.stop('语音连接已断开，点击麦克风重试。');};
    }catch(error){if(epoch===this.epoch)this.stop(error.name==='NotAllowedError'?'麦克风权限未开启，请在地址栏允许麦克风。':error.message);}
  }
}
