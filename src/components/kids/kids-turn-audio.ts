const RECORDER_MIME_TYPES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const

export function selectKidsRecorderMimeType(MediaRecorderClass: typeof MediaRecorder = MediaRecorder) {
  return RECORDER_MIME_TYPES.find((mimeType) => MediaRecorderClass.isTypeSupported?.(mimeType)) ?? ''
}

export class KidsTurnAudio {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private playback: HTMLAudioElement | null = null
  private playbackUrl = ''

  async startRecording() {
    if (this.recorder?.state === 'recording') return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording is not supported in this browser')
    }

    this.stopPlayback()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const mimeType = selectKidsRecorderMimeType()
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start(500)
  }

  async stopRecording() {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') throw new Error('No recording is active')
    return new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Audio recording failed'))
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0]?.type || 'audio/webm' })
        this.stopTracks()
        this.recorder = null
        this.chunks = []
        if (blob.size === 0) reject(new Error('The recording was empty'))
        else resolve(blob)
      }
      recorder.stop()
    })
  }

  async play(blob: Blob) {
    this.stopPlayback()
    this.playbackUrl = URL.createObjectURL(blob)
    const audio = new Audio(this.playbackUrl)
    this.playback = audio
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        if (this.playback === audio) this.playback = null
        if (this.playbackUrl) URL.revokeObjectURL(this.playbackUrl)
        this.playbackUrl = ''
        resolve()
      }
      audio.onended = finish
      audio.onerror = () => {
        finish()
        reject(new Error('Voice playback failed'))
      }
      audio.play().catch((error) => {
        finish()
        reject(error)
      })
    })
  }

  cancel() {
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.recorder = null
    this.chunks = []
    this.stopTracks()
    this.stopPlayback()
  }

  private stopTracks() {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }

  private stopPlayback() {
    if (this.playback) {
      this.playback.pause()
      this.playback.src = ''
      this.playback = null
    }
    if (this.playbackUrl) URL.revokeObjectURL(this.playbackUrl)
    this.playbackUrl = ''
  }
}
