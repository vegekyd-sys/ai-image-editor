import type { LiveServerMessage, Session } from '@google/genai'

const INPUT_SAMPLE_RATE = 16_000
const OUTPUT_SAMPLE_RATE = 24_000

export type KidsLivePhase = 'idle' | 'connecting' | 'listening' | 'recording' | 'thinking' | 'speaking' | 'parent' | 'error'

interface AudioCallbacks {
  onLevel: (level: number) => void
  onMessage: (message: LiveServerMessage) => void
  onPhase: (phase: KidsLivePhase) => void
  onTurnComplete?: (result: { hadOutput: boolean; recording: Promise<Blob | null> }) => void
}

function floatToPcm16Bytes(samples: Float32Array, sourceRate: number) {
  const ratio = sourceRate / INPUT_SAMPLE_RATE
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const pcm = new Int16Array(outputLength)

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio)
    const end = Math.min(samples.length, Math.floor((outputIndex + 1) * ratio))
    let total = 0
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) total += samples[inputIndex]
    const sample = Math.max(-1, Math.min(1, total / Math.max(1, end - start)))
    pcm[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  return new Uint8Array(pcm.buffer)
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary)
}

export function floatToPcm16(samples: Float32Array, sourceRate: number) {
  return bytesToBase64(floatToPcm16Bytes(samples, sourceRate))
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

export function pcm16ChunksToWav(chunks: Uint8Array[], sampleRate = INPUT_SAMPLE_RATE) {
  const dataLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  if (dataLength === 0) return null

  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  const output = new Uint8Array(buffer, 44)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export function base64ToPcm(base64: string) {
  const binary = atob(base64)
  const length = Math.floor(binary.length / 2)
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const low = binary.charCodeAt(index * 2)
    const high = binary.charCodeAt(index * 2 + 1)
    const value = (high << 8) | low
    const signed = value >= 0x8000 ? value - 0x10000 : value
    samples[index] = signed / 0x8000
  }
  return samples
}

export class KidsLiveAudio {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private session: Session | null = null
  private nextPlaybackTime = 0
  private playbackSources = new Set<AudioBufferSourceNode>()
  private generationComplete = false
  private inputEnded = false
  private pcmRecordingChunks: Uint8Array[] = []
  private recording: Promise<Blob | null> = Promise.resolve(null)
  private receivedOutput = false

  constructor(private readonly callbacks: AudioCallbacks) {}

  async start(session: Session) {
    this.session = session
    this.inputEnded = false
    this.receivedOutput = false
    this.pcmRecordingChunks = []
    this.recording = Promise.resolve(null)
    const AudioContextClass = window.AudioContext
    this.context = new AudioContextClass({ latencyHint: 'interactive' })
    await this.context.resume()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(2048, 1, 1)
    this.sink = this.context.createGain()
    this.sink.gain.value = 0

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      let energy = 0
      for (let index = 0; index < input.length; index += 1) energy += input[index] * input[index]
      this.callbacks.onLevel(Math.min(1, Math.sqrt(energy / input.length) * 5.2))
      const pcmBytes = floatToPcm16Bytes(input, event.inputBuffer.sampleRate)
      this.pcmRecordingChunks.push(pcmBytes)
      this.session?.sendRealtimeInput({
        audio: {
          data: bytesToBase64(pcmBytes),
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      })
    }

    this.source.connect(this.processor)
    this.processor.connect(this.sink)
    this.sink.connect(this.context.destination)
    this.callbacks.onPhase('listening')
  }

  finishInput() {
    if (this.inputEnded) return this.recording
    this.inputEnded = true
    this.processor?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.processor = null
    this.source = null
    this.sink = null
    this.recording = Promise.resolve(pcm16ChunksToWav(this.pcmRecordingChunks))
    this.pcmRecordingChunks = []
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.session?.sendRealtimeInput({ audioStreamEnd: true })
    this.callbacks.onLevel(0)
    this.callbacks.onPhase('thinking')
    return this.recording
  }

  handleMessage(message: LiveServerMessage) {
    this.callbacks.onMessage(message)
    if (message.serverContent?.interrupted) {
      this.clearPlayback()
      this.callbacks.onPhase('listening')
      return
    }
    const audioChunks = message.serverContent?.modelTurn?.parts
      ?.flatMap((part) => part.inlineData?.data ? [part.inlineData.data] : []) ?? []
    if (audioChunks.length === 0 && message.data) audioChunks.push(message.data)
    if (audioChunks.length > 0 || message.serverContent?.outputTranscription?.text) this.receivedOutput = true
    if (audioChunks.length > 0) this.finishInput()
    for (const audioChunk of audioChunks) {
      this.play(audioChunk)
      this.callbacks.onPhase('speaking')
    }
    if (message.serverContent?.generationComplete || message.serverContent?.turnComplete) {
      this.generationComplete = true
      if (this.playbackSources.size === 0) this.finishTurn()
    }
  }

  sendImage(data: string, mimeType: string) {
    this.session?.sendRealtimeInput({ video: { data, mimeType } })
  }

  private play(base64: string) {
    const context = this.context
    if (!context) return
    const samples = base64ToPcm(base64)
    const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE)
    buffer.copyToChannel(samples, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const startAt = Math.max(context.currentTime + 0.03, this.nextPlaybackTime)
    source.start(startAt)
    this.nextPlaybackTime = startAt + buffer.duration
    this.playbackSources.add(source)
    source.onended = () => {
      this.playbackSources.delete(source)
      if (this.generationComplete && this.playbackSources.size === 0) {
        this.finishTurn()
      }
    }
  }

  private finishTurn() {
    this.generationComplete = false
    if (this.callbacks.onTurnComplete) {
      this.callbacks.onTurnComplete({ hadOutput: this.receivedOutput, recording: this.finishInput() })
    }
    else this.callbacks.onPhase('listening')
  }

  private clearPlayback() {
    for (const source of this.playbackSources) {
      try { source.stop() } catch { /* already stopped */ }
    }
    this.playbackSources.clear()
    this.generationComplete = false
    this.nextPlaybackTime = this.context?.currentTime ?? 0
  }

  async stop() {
    if (!this.inputEnded) this.session?.sendRealtimeInput({ audioStreamEnd: true })
    this.inputEnded = true
    this.pcmRecordingChunks = []
    this.session = null
    this.clearPlayback()
    this.processor?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.processor = null
    this.source = null
    this.sink = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    await this.context?.close().catch(() => undefined)
    this.context = null
    this.callbacks.onLevel(0)
  }
}
