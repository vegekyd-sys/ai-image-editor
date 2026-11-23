import { createPlayoutCues } from './playout.mjs';
import { openDirector } from './transport.mjs';
const $ = (selector) => document.querySelector(selector);
const [id, token] = location.hash.slice(1).split('.');
const embedded = new URLSearchParams(location.search).has('embed');
document.body.classList.toggle('embedded', embedded);
const video = $('video');
let handle,
  recorder,
  recordingAttempted = false,
  recognizer,
  ended = false,
  configured = false,
  frames = 0,
  applied = 0,
  sent = 1,
  pollFailures = 0,
  timer;
const playout = createPlayoutCues();
function acknowledge(version) {
  if (Number.isInteger(version)) applied = Math.max(applied, version);
}
const setStatus = (text) => ($('#status').textContent = text);
const url = (op) => {
  const u = new URL('../api/director/player/' + op, location.href);
  u.searchParams.set('id', id);
  return u.href;
};
async function post(op, body = {}, type = 'application/json') {
  const response = await fetch(url(op), {
    method: 'POST',
    headers: { 'x-director-player': token, 'content-type': type },
    body: type === 'application/json' ? JSON.stringify(body) : body,
    redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.error || '直播连接失败'), {status: response.status});
  return data;
}
function tell(action, extra = {}) {
  if (embedded && window.parent !== window)
    parent.postMessage({ source: 'makaron-director', id, action, ...extra }, location.origin);
}
function count(_time, metadata) {
  if (ended) return;
  if (video.srcObject && video.videoWidth && !recordingAttempted) startRecording();
  const cue = playout.frame(metadata.mediaTime);
  if (cue) tell('direction', {state: 'playing', ...cue, rtpTimestamp: metadata.rtpTimestamp});
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
      tell('ended');
      return;
    }
    const a = $('#save');
    a.href = URL.createObjectURL(blob);
    a.download = id + (type === 'video/mp4' ? '.mp4' : '.webm');
    a.hidden = false;
    try {
      await post('recording', blob, type);
      setStatus('已收播，录像已保存');
    } catch {
      setStatus('录像上传失败，可在这里保存本地副本');
    }
    tell('ended');
  };
  recorder.start(500);
}
async function finish(message = '直播已结束') {
  if (ended) return;
  ended = true;
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
  if (!saving) tell('ended');
}
async function poll() {
  if (ended) return;
  try {
    if (!video.requestVideoFrameCallback)
      frames = video.getVideoPlaybackQuality?.().totalVideoFrames || frames;
    const data = await post('poll', { after: sent, applied, frames });
    pollFailures = 0;
    if (['ended', 'failed'].includes(data.phase)) return finish();
    if (configured)
      for (const direction of data.directions) {
        playout.expect(direction.version, direction.text);
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
    timer = setTimeout(poll, 600);
  } catch (error) {
    if (!ended && (error instanceof TypeError || error.status >= 500) && ++pollFailures <= 3) {
      timer = setTimeout(poll, 600 * pollFailures);
      return;
    }
    void finish(error.message);
  }
}
async function start() {
  if (!id || !token) throw Error('请从 Makaron CLI 打开本场播放器');
  const initial = await post('poll');
  if (initial.phase !== 'waiting')
    throw Error(initial.phase === 'ended' ? '直播已结束' : '本场已有播放器');
  playout.expect(1, initial.config.prompt);
  handle = await openDirector(url('signal'), token, {
    onMedia(stream) {
      if (ended) return;
      video.srcObject = stream;
      video.play().catch(() => setStatus('点击画面开始播放'));
      // Director can deliver audio several seconds before the first picture.
      // Start both recording tracks together on the first displayed frame.
      if (!video.requestVideoFrameCallback) video.addEventListener('playing',startRecording,{once:true});
    },
    onData(raw) {
      const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (e.type === 'chunk') playout.chunk(e);
      if (e.type === 'configured') {
        configured = true;
        acknowledge(1);
      }
      if (e.type === 'prompt_applied') {
        acknowledge(e.prompt_version);
        setStatus('导演已采用新指令');
      }
      if (e.type === 'prompt_rejected') {setStatus('这条指令未被采用');tell('direction',{state:'rejected'});}
      if (e.type === 'stream_exhausted' || e.type === 'error') void finish();
    },
    onError() {
      void finish('直播连接中断');
    },
    onState(state) {
      if (state === 'closed') void finish();
    },
  });
  if (ended) {
    await handle.close();
    return;
  }
  handle.ready.catch(() => finish('直播连接失败'));
  handle.send(initial.config);
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
  if (e.data.action === 'end') void finish();
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
