import { describe, expect, it } from 'vitest'
import { selectKidsRecorderMimeType } from '@/components/kids/kids-turn-audio'

describe('Makaron Kids compatible recorder', () => {
  it('prefers iPad audio/mp4 and falls back to Opus WebM', () => {
    const iPadRecorder = { isTypeSupported: (type: string) => type === 'audio/mp4' } as unknown as typeof MediaRecorder
    const chromeRecorder = { isTypeSupported: (type: string) => type === 'audio/webm;codecs=opus' } as unknown as typeof MediaRecorder
    expect(selectKidsRecorderMimeType(iPadRecorder)).toBe('audio/mp4')
    expect(selectKidsRecorderMimeType(chromeRecorder)).toBe('audio/webm;codecs=opus')
  })
})
