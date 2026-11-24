import { createPlayoutCues } from './playout.mjs';
const $ = (selector) => document.querySelector(selector);
const [id, token] = location.hash.slice(1).split('.');
const embedded = new URLSearchParams(location.search).has('embed');
document.body.classList.toggle('embedded', embedded);
const video = $('video');
let preparedImageUrl,
  handle,
  recorder,
  recordingAttempted = false,
  recognizer,
  ended = false,
  configured = false,
  frames = 0,
  applied = 0,
  sent = 1,
  playing = 0,
  pollFailures = 0,
  failingSince = 0,
  endReason = '',
  timer;
const playout = createPlayoutCues();
// Short audience captions the showrunner wrote for its own directions.
const captions = new Map();
function acknowledge(version) {
  if (Number.isInteger(version)) applied = Math.max(applied, version);
}
const setStatus = (text) => ($('#status').textContent = text);
const url = (op) => {
  const u = new URL('../api/director/player/' + op, location.href);
  u.searchParams.set('id', id);
  return u.href;
};
async function post(op, body = {}, type = 'application/json', signal) {
  const response = await fetch(url(op), {
    method: 'POST',
    headers: { 'x-director-player': token, 'content-type': type },
    body: type === 'application/json' ? JSON.stringify(body) : body,
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(Error(data.error || '直播连接失败'), {status: response.status});
  }
  return response.json();
}
function tell(action, extra = {}) {
  if (embedded && window.parent !== window)
    parent.postMessage({ source: 'makaron-director', id, action, ...extra }, location.origin);
}
function count(_time, metadata) {
  if (ended) return;
  if (video.srcObject && video.videoWidth && !recordingAttempted) startRecording();
  const cue = playout.frame(metadata.mediaTime);
  if (cue) {
    playing = Math.max(playing, cue.version);
    const caption = captions.get(cue.version);
    tell('direction', {state: 'playing', ...cue, ...(caption ? {caption} : {}), rtpTimestamp: metadata.rtpTimestamp});
  }
  frames++;
  video.requestVideoFrameCallback?.(count);
}
function startRecording() {
  if (ended || recordingAttempted) return;
  recordingAttempted = true;
  try {
    record(video.srcObject);
  } catch {
    setStatus('当前浏览器无法录制');
  }
}
async function uploadRecording(blob) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await post('recording', blob, blob.type);
      return;
    } catch (error) {
      if (!(error instanceof TypeError || error.status >= 500)) throw error;
      // A relay timeout may arrive while the worker is still writing the last bytes.
      // Consult the durable receipt before retrying and before declaring failure.
      for (const delay of [0, 2000, 4000, 8000]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const show = await post('poll', {}, 'application/json', AbortSignal.timeout(3500)).catch(() => null);
        if (show?.recorded) return;
      }
      if (attempt === 1) throw error;
    }
  }
}
function record(stream) {
  if (recorder || !window.MediaRecorder) return;
  const mimeType = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = async () => {
    const type = recorder.mimeType.split(';')[0],
      blob = new Blob(chunks, { type });
    if (!blob.size) {
      tell('ended', {reason: endReason});
      return;
    }
    tell('recorded', {blob});
    const a = $('#save');
    a.href = URL.createObjectURL(blob);
    a.download = id + (type === 'video/mp4' ? '.mp4' : '.webm');
    a.hidden = false;
    try {
      await uploadRecording(blob);
      setStatus('已收播，录像已保存');
      tell('stage', {stage: 'recorded'});
    } catch (error) {
      setStatus('录像上传失败，可在这里保存本地副本');
      tell('stage', {stage: 'record-failed', status: error?.status});
    }
    tell('ended', {reason: endReason});
  };
  recorder.start(500);
}
async function finish(message = '直播已结束', reason = 'stopped') {
  if (ended) return;
  ended = true;
  endReason = reason;
  if (embedded && video.videoWidth) {
    const still = document.createElement('canvas');
    still.width=video.videoWidth; still.height=video.videoHeight;
    let poster;
    try { still.getContext('2d').drawImage(video,0,0); poster=still.toDataURL('image/jpeg',0.9); } catch {}
    tell('stopped',{poster});
  }
  clearTimeout(timer);
  recognizer?.stop();
  setStatus(message);
  $('#stop').disabled = true;
  $('form button').disabled = true;
  try {
    handle?.send({ type: 'stop' });
  } catch {}
  const saving = recorder?.state === 'recording';
  if (saving) recorder.stop();
  await Promise.allSettled([handle?.close(), post('stop')]);
  if (!saving) tell('ended', {reason, failed: reason === 'failed'});
}
async function poll() {
  if (ended) return;
  try {
    if (!video.requestVideoFrameCallback)
      frames = video.getVideoPlaybackQuality?.().totalVideoFrames || frames;
    const asked = performance.now();
    // While live, the service holds this poll open until there is a new direction.
    const data = await post('poll', { after: sent, applied, frames, playing, wait: configured ? 1500 : 0 });
    pollFailures = 0;
    failingSince = 0;
    if (['ended', 'failed'].includes(data.phase))
      return finish(data.reason === 'time' ? '本场已到时长上限' : '直播已结束', data.reason || 'stopped');
    if (data.preparedImageUrl) preparedImageUrl = data.preparedImageUrl;
    if (configured)
      for (const direction of data.directions) {
        playout.expect(direction.version, direction.text);
        if (typeof direction.caption === 'string') captions.set(direction.version, direction.caption.slice(0, 40));
        handle.send({
          type: 'prompt',
          prompt_version: direction.version,
          prompt: direction.text,
          replan: true,
        });
        sent = direction.version;
        setStatus('下一幕正在准备');
        tell('direction', {state:'sent'});
      }
    const held = configured && (data.directions.length || performance.now() - asked > 300);
    timer = setTimeout(poll, held ? 0 : 600);
  } catch (error) {
    // The picture arrives over WebRTC, not this poll. A slow or briefly unreachable
    // relay must not end a show that is still playing; only the service may end it.
    const transient = error instanceof TypeError || error.status >= 500 || error.name === 'TimeoutError';
    failingSince ||= Date.now();
    if (!ended && transient && Date.now() - failingSince < 45_000) {
      timer = setTimeout(poll, Math.min(3000, 600 * ++pollFailures));
      return;
    }
    void finish(error.message, 'failed');
  }
}
async function start() {
  if (!id || !token) throw Error('请从 Makaron CLI 打开本场播放器');
  const [initial, {openDirector}] = await Promise.all([
    post('poll', { prepare: true }),
    import('./transport.mjs'),
  ]);
  if (initial.phase !== 'waiting')
    throw Error(initial.phase === 'ended' ? '直播已结束' : '本场已有播放器');
  preparedImageUrl = initial.preparedImageUrl;
  playout.expect(1, initial.config.prompt);
  tell('stage', {stage: 'ice'});
  await connect(openDirector, initial);
}
let negotiating = false, attempts = 0;
async function connect(openDirector, initial, attempt = 0) {
  negotiating = true;
  // Events from a connection replaced by the retry are ignored.
  const mine = ++attempts, live = () => mine === attempts;
  handle = await openDirector(url('signal'), token, {
    iceServers: initial.iceServers,
    onMedia(stream) {
      if (ended || !live()) return;
      video.srcObject = stream;
      video.play().catch(() => setStatus('点击画面开始播放'));
      // Director can deliver audio several seconds before the first picture.
      // Start both recording tracks together on the first displayed frame.
      if (!video.requestVideoFrameCallback) video.addEventListener('playing',startRecording,{once:true});
    },
    onData(raw) {
      if (!live()) return;
      const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (e.type === 'chunk') playout.chunk(e);
      if (e.type === 'configured') {
        configured = true;
        tell('stage', {stage: 'configured'});
        acknowledge(1);
      }
      if (e.type === 'prompt_applied') {
        acknowledge(e.prompt_version);
        setStatus('导演已采用新指令');
      }
      if (e.type === 'prompt_rejected') {setStatus('这条指令未被采用');tell('direction',{state:'rejected'});}
      if (e.type === 'stream_exhausted' || e.type === 'error') void finish('直播已结束', 'provider');
    },
    onError() {
      if (live() && !negotiating) void finish('直播连接中断', 'failed');
    },
    onState(state) {
      if (state === 'closed' && live() && !negotiating) void finish('直播已结束', 'failed');
    },
  });
  if (ended) {
    await handle.close();
    return;
  }
  // Use the copy only if it is already available when negotiation completes.
  const own = handle;
  own.ready.then(() => {
    if (!live()) return;
    negotiating = false;
    if (ended) return;
    tell('stage', {stage: 'offer'});
    const config = initial.config;
    handle.send(preparedImageUrl ? { ...config, image_url: preparedImageUrl } : config);
  }).catch(async () => {
    // The service reopens the show once after a provider-side offer failure.
    const again = attempt === 0 && !ended && await post('poll', { prepare: true }).catch(() => null);
    if (again?.phase === 'waiting') {
      try { await own.close(); } catch {}
      tell('stage', {stage: 'offer', status: 424});
      return connect(openDirector, {...initial, iceServers: again.iceServers ?? initial.iceServers}, 1);
    }
    negotiating = false;
    void finish('直播连接失败', 'failed');
  });
  if (attempt) return;
  if(video.requestVideoFrameCallback) video.requestVideoFrameCallback(count);
  else video.addEventListener('timeupdate',()=>{if(video.readyState>=2 && video.videoWidth)count(0,{mediaTime:video.currentTime});});
  void poll();
}
async function direct(text) {
  try {
    const result = await post('input', { text, turnId: crypto.randomUUID() });
    setStatus(
      { send: '导演已收到', wait: '等你把这句话说完', discard: '已略过口头语' }[result.action] ||
        '已处理',
    );
  } catch (e) {
    setStatus(e.message);
  }
}
video.onclick = () => video.play().catch(() => {});
video.onplaying = () => {
  setStatus('直播中');
  tell('playing');
};
$('form').onsubmit = (e) => {
  e.preventDefault();
  const input = $('#direction');
  if (input.value.trim()) {
    void direct(input.value.trim());
    input.value = '';
  }
};
$('#stop').onclick = () => finish();
$('#sound').onclick = () => {
  video.muted = !video.muted;
  $('#sound').textContent = video.muted ? '开启声音' : '静音';
};
window.addEventListener('message', (e) => {
  if (e.source !== parent || e.origin !== location.origin || e.data?.id !== id) return;
  if (e.data.action === 'end') void finish('直播已结束', e.data.reason || 'stopped');
});
if (!embedded) {
  const { LiveVoice } = await import('./voice.js');
  const socketUrl = new URL(url('voice'));
  socketUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const mic = $('#mic');
  mic.hidden = false;
  const spoken = new Set();
  recognizer = new LiveVoice({
    socketUrl: socketUrl.href,
    protocol: token,
    onLevel() {},
    onActivity: () => {
      void post('activity').catch(() => {});
    },
    onState: (state, message) => {
      mic.textContent = state === 'off' ? '语音导演' : '关闭麦克风';
      setStatus(message);
    },
    onText: (event) => {
      setStatus(event.text);
      if (event.final && event.text.trim() && !spoken.has(event.id)) {
        spoken.add(event.id);
        void direct(event.text);
      }
    },
  });
  mic.onclick = () => {
    if (ended) return;
    if (recognizer.active) {
      recognizer.stop();
      return;
    }
    video.muted = true;
    spoken.clear();
    void recognizer.start();
  };
}
start().catch((error) => {
  setStatus(error.message);
  tell('ended', {failed: true});
});
