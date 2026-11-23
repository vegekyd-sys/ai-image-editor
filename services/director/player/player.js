import { openDirector } from './transport.mjs';
const $ = (selector) => document.querySelector(selector);
const [id, token] = location.hash.slice(1).split('.');
const embedded = new URLSearchParams(location.search).has('embed');
document.body.classList.toggle('embedded', embedded);
const video = $('video');
let handle,
  recorder,
  recognizer,
  ended = false,
  configured = false,
  frames = 0,
  applied = 0,
  sent = 1,
  timer;
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
  if (!response.ok) throw Error(data.error || '直播连接失败');
  return data;
}
function tell(action, extra = {}) {
  if (embedded && window.parent !== window)
    parent.postMessage({ source: 'makaron-director', id, action, ...extra }, location.origin);
}
function count() {
  if (ended) return;
  frames++;
  video.requestVideoFrameCallback?.(count);
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
    if (['ended', 'failed'].includes(data.phase)) return finish();
    if (configured)
      for (const direction of data.directions) {
        handle.send({
          type: 'prompt',
          prompt_version: direction.version,
          prompt: direction.text,
          replan: true,
        });
        sent = direction.version;
        setStatus('下一幕正在准备');
      }
    timer = setTimeout(poll, 600);
  } catch (error) {
    void finish(error.message);
  }
}
async function start() {
  if (!id || !token) throw Error('请从 Makaron CLI 打开本场播放器');
  const initial = await post('poll');
  if (initial.phase !== 'waiting')
    throw Error(initial.phase === 'ended' ? '直播已结束' : '本场已有播放器');
  handle = await openDirector(url('signal'), token, {
    onMedia(stream) {
      if (ended) return;
      video.srcObject = stream;
      video.play().catch(() => setStatus('点击画面开始播放'));
      try {
        record(stream);
      } catch {
        setStatus('当前浏览器无法录制');
      }
    },
    onData(raw) {
      const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (e.type === 'configured') {
        configured = true;
        applied = 1;
      }
      if (e.type === 'prompt_applied') {
        applied = Math.max(applied, e.prompt_version);
        setStatus('导演已采用新指令');
      }
      if (e.type === 'prompt_rejected') setStatus('这条指令未被采用');
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
  video.requestVideoFrameCallback?.(count);
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
function snapshot() {
  if (!video.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  if (embedded) {
    tell('still', { image: c.toDataURL('image/jpeg', 0.9) });
    return;
  }
  const a = document.createElement('a');
  a.download = id + '.jpg';
  a.href = c.toDataURL('image/jpeg', 0.9);
  a.click();
}
$('#still').onclick = snapshot;
window.addEventListener('message', (e) => {
  if (e.source !== parent || e.origin !== location.origin || e.data?.id !== id) return;
  if (e.data.action === 'keep') snapshot();
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
  tell('ended');
});
