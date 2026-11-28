import { validateVideoAudioReferences } from './video-audio-reference-preflight'

export async function validateFlashAudioReferences(urls: string[]): Promise<void> {
  await validateVideoAudioReferences(urls, { model: 'Seedance 2.5 Flash', maxBytes: 55 * 1024 * 1024 })
}
