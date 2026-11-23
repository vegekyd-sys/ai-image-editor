import WebSocket, { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

export function voiceEndpoint(region = 'intl') {
  if (!['intl', 'cn'].includes(region)) throw new Error('VOICE_ASR_REGION must be intl or cn');
  return `wss://dashscope${region === 'intl' ? '-intl' : ''}.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime`;
}
export const voiceSession = () => ({
  type: 'session.update',
  event_id: randomUUID(),
  session: {
    input_audio_format: 'pcm',
    sample_rate: 16000,
    turn_detection: { type: 'server_vad', threshold: 0.2, silence_duration_ms: 400 },
  },
});

// Only relay public transcription fields, never raw upstream errors or headers.
export function publicVoiceEvent(e) {
  const id = e.item_id;
  switch (e.type) {
    case 'session.updated':
      return { type: 'ready' };
    case 'input_audio_buffer.speech_started':
      return { type: 'speech_started', id, audioMs: e.audio_start_ms };
    case 'input_audio_buffer.speech_stopped':
      return { type: 'speech_stopped', id, audioMs: e.audio_end_ms };
    case 'conversation.item.input_audio_transcription.text':
      return { type: 'partial', id, text: (e.text || '') + (e.stash || '') };
    case 'conversation.item.input_audio_transcription.completed':
      return { type: 'final', id, text: e.transcript || '' };
    case 'conversation.item.input_audio_transcription.failed':
    case 'error':
      return { type: 'error', message: '语音识别服务返回错误，请停止后重试。' };
    default:
      return null;
  }
}
export function attachVoiceServer(
  server,
  { authorize, env = process.env, connect = (url, opts) => new WebSocket(url, opts) } = {},
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (
        url.pathname !== '/api/director/player/voice' ||
        !env.DASHSCOPE_API_KEY ||
        wss.clients.size >= 4
      )
        throw Error();
      if (![`https://${req.headers.host}`, `http://${req.headers.host}`].includes(req.headers.origin))
        throw Error();
      const ticket = req.headers['sec-websocket-protocol'];
      const alive = await authorize(url.searchParams.get('id'), ticket);
      if (!alive()) throw Error();
      wss.handleUpgrade(req, socket, head, (client) => {
        const timer = setInterval(() => {
          if (!alive()) client.close();
        }, 1000);
        client.once('close', () => clearInterval(timer));
        wss.emit('connection', client);
      });
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  wss.on('connection', (client) => {
    let upstream,
      ready = false,
      closed = false,
      lastAudio = Date.now(),
      totalBytes = 0,
      started = Date.now();
    const send = (e) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(e));
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearTimeout(deadline);
      clearInterval(watchdog);
      upstream?.terminate();
      client.close();
    };
    const fail = (message) => {
      send({ type: 'error', message });
      cleanup();
    };
    const deadline = setTimeout(() => fail('本次语音已达 3 分钟，请点击麦克风重新开启。'), 180000);
    const watchdog = setInterval(() => {
      if (!ready && Date.now() - started > 12000) fail('语音连接超时，请检查网络后重试。');
      else if (ready && Date.now() - lastAudio > 15000) fail('麦克风音频已中断，请重新开启。');
    }, 1000);
    client.on('close', cleanup);
    client.on('error', cleanup);
    try {
      upstream = connect(voiceEndpoint(env.VOICE_ASR_REGION || 'intl'), {
        headers: { Authorization: `Bearer ${env.DASHSCOPE_API_KEY}` },
        maxPayload: 256 * 1024,
        handshakeTimeout: 10000,
      });
    } catch {
      fail('语音服务配置无效。');
      return;
    }
    upstream.on('open', () => upstream.send(JSON.stringify(voiceSession())));
    upstream.on('message', (raw) => {
      let e;
      try {
        e = publicVoiceEvent(JSON.parse(raw));
      } catch {
        return;
      }
      if (!e) return;
      if (e.type === 'ready') {
        ready = true;
        lastAudio = Date.now();
      }
      if (client.bufferedAmount > 128 * 1024) {
        fail('语音回传拥堵，已停止以免发送过时指令。');
        return;
      }
      send(e);
      if (e.type === 'error') cleanup();
    });
    upstream.on('error', () => fail('语音服务连接失败，请检查网络、区域和服务凭证。'));
    upstream.on('close', () => {
      if (!closed) fail('语音连接已断开，请重新开启麦克风。');
    });
    client.on('message', (data, binary) => {
      if (!ready || !binary || !data.length || data.length % 2) {
        fail('语音音频格式错误。');
        return;
      }
      totalBytes += data.length;
      lastAudio = Date.now();
      if (
        totalBytes > 32000 * ((Date.now() - started) / 1000 + 3) ||
        upstream.bufferedAmount > 128 * 1024
      ) {
        fail('音频发送过快或网络拥堵，已停止语音。');
        return;
      }
      upstream.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          event_id: randomUUID(),
          audio: data.toString('base64'),
        }),
      );
    });
  });
  return wss;
}
