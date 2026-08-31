import { describe, expect, it, vi } from 'vitest'
import type { LiveServerMessage } from '@google/genai'
import { base64ToPcm, floatToPcm16, KidsLiveAudio, pcm16ChunksToWav } from '@/components/kids/kids-audio'

function pcmBase64(values: number[]) {
  const pcm = new Int16Array(values)
  const bytes = new Uint8Array(pcm.buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

describe('Makaron Kids audio conversion and interruption', () => {
  it('downsamples browser float audio to 16 kHz signed PCM and decodes 24 kHz chunks', () => {
    const input = new Float32Array(480).fill(0.5)
    const encoded = floatToPcm16(input, 48_000)
    expect(atob(encoded)).toHaveLength(320)

    const decoded = base64ToPcm(pcmBase64([-32768, 0, 32767]))
    expect(Array.from(decoded)).toEqual([-1, 0, 32767 / 32768])
  })

  it('wraps the exact Live PCM input in a mono 16 kHz WAV backup', async () => {
    const wav = pcm16ChunksToWav([
      new Uint8Array([0, 0, 255, 127]),
      new Uint8Array([0, 128]),
    ])
    expect(wav?.type).toBe('audio/wav')
    expect(wav?.size).toBe(50)

    const bytes = new Uint8Array(await wav!.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(16_000)
    expect(Array.from(bytes.slice(44))).toEqual([0, 0, 255, 127, 0, 128])
  })

  it('uses official inlineData audio, waits for queue drain, and clears queued playback on VAD interruption', () => {
    const phases: string[] = []
    const sources: Array<{ stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = []
    const context = {
      currentTime: 4,
      destination: {},
      createBuffer: vi.fn(() => ({ duration: 0.1, copyToChannel: vi.fn() })),
      createBufferSource: vi.fn(() => {
        const source = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
        sources.push(source)
        return source
      }),
    }
    const audio = new KidsLiveAudio({
      onLevel: vi.fn(), onMessage: vi.fn(), onPhase: (phase) => phases.push(phase),
    })
    ;(audio as unknown as { context: typeof context }).context = context
    const chunk = pcmBase64([0, 1000, -1000])

    audio.handleMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: chunk, mimeType: 'audio/pcm;rate=24000' } }] } },
    } as LiveServerMessage)
    audio.handleMessage({ serverContent: { turnComplete: true } } as LiveServerMessage)
    expect(phases).toEqual(['thinking', 'speaking'])
    sources[0].onended?.()
    expect(phases).toEqual(['thinking', 'speaking', 'listening'])

    audio.handleMessage({ data: chunk } as LiveServerMessage)
    audio.handleMessage({ serverContent: { interrupted: true } } as LiveServerMessage)
    expect(sources[1].stop).toHaveBeenCalledOnce()
    expect(phases.at(-1)).toBe('listening')
  })

  it('ends microphone input without closing the Live session before the reply arrives', () => {
    const phases: string[] = []
    const session = { sendRealtimeInput: vi.fn() }
    const track = { stop: vi.fn() }
    const audio = new KidsLiveAudio({
      onLevel: vi.fn(), onMessage: vi.fn(), onPhase: (phase) => phases.push(phase),
    })
    ;(audio as unknown as { session: typeof session }).session = session
    ;(audio as unknown as {
      stream: { getTracks: () => typeof track[] }
      pcmRecordingChunks: Uint8Array[]
    }).stream = { getTracks: () => [track] }
    ;(audio as unknown as { pcmRecordingChunks: Uint8Array[] }).pcmRecordingChunks = [new Uint8Array([0, 0])]

    const recording = audio.finishInput()

    expect(session.sendRealtimeInput).toHaveBeenCalledWith({ audioStreamEnd: true })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(phases).toEqual(['thinking'])
    return expect(recording).resolves.toMatchObject({ type: 'audio/wav', size: 46 })
  })
})
