import type { TranscriptWord, VolcengineAsrTranscript } from './volcengine-asr'

export interface InlineWordTimingGap {
  utterance: number
  inlineWordTimingStartMs: number | null
  inlineWordTimingEndMs: number | null
  utteranceStartMs: number | null
  utteranceEndMs: number | null
}

export interface FormattedInlineTranscript {
  text: string
  wordTimingTruncated: boolean
  truncatedUtterances: InlineWordTimingGap[]
  firstOmittedUtterance?: number
}

function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?'
  return (ms / 1000).toFixed(2).replace(/\.00$/, '')
}

function formatTranscriptWords(words: TranscriptWord[] | undefined, maxChars: number): {
  text: string
  truncated: boolean
  firstShownMs: number | null
  lastShownMs: number | null
} {
  if (!words?.length || maxChars <= 0) {
    return {
      text: words?.length ? '...' : '',
      truncated: Boolean(words?.length),
      firstShownMs: null,
      lastShownMs: null,
    }
  }

  let out = ''
  let firstShownMs: number | null = null
  let lastShownMs: number | null = null
  for (const word of words) {
    const next = `${out ? ' | ' : ''}${formatMs(word.startMs)}-${formatMs(word.endMs)} ${word.text}`
    if (out.length + next.length > maxChars) {
      return {
        text: `${out}${out ? ' | ' : ''}...`,
        truncated: true,
        firstShownMs,
        lastShownMs,
      }
    }
    out += next
    if (firstShownMs === null && typeof word.startMs === 'number') firstShownMs = word.startMs
    if (typeof word.endMs === 'number') lastShownMs = word.endMs
  }

  return { text: out, truncated: false, firstShownMs, lastShownMs }
}

export function formatTranscriptForModel(
  transcript: VolcengineAsrTranscript,
  includeWordTimings = true,
): FormattedInlineTranscript {
  const lines: string[] = [
    `Transcript (${transcript.provider}/${transcript.model}, ${transcript.durationMs ? `${formatMs(transcript.durationMs)}s` : 'duration unknown'}):`,
    transcript.text || '(empty transcript)',
    '',
    'Utterance timecodes:',
  ]
  const truncatedUtterances: InlineWordTimingGap[] = []
  let firstOmittedUtterance: number | undefined
  let charBudget = includeWordTimings ? 24_000 : 8_000

  for (const [idx, utterance] of transcript.utterances.entries()) {
    const line = `${idx + 1}. [${formatMs(utterance.startMs)}s-${formatMs(utterance.endMs)}s]${utterance.speaker ? ` speaker ${utterance.speaker}` : ''} ${utterance.text}`
    if (charBudget - line.length < 0) {
      lines.push('[inline transcript truncated]')
      firstOmittedUtterance = idx + 1
      break
    }
    lines.push(line)
    charBudget -= line.length

    const formattedWords = includeWordTimings
      ? formatTranscriptWords(utterance.words, Math.max(0, Math.min(1200, charBudget - 12)))
      : { text: '', truncated: false, firstShownMs: null, lastShownMs: null }
    if (formattedWords.text) {
      const wordLine = `   words: ${formattedWords.text}`
      lines.push(wordLine)
      charBudget -= wordLine.length
    }
    if (formattedWords.truncated) {
      truncatedUtterances.push({
        utterance: idx + 1,
        inlineWordTimingStartMs: formattedWords.firstShownMs,
        inlineWordTimingEndMs: formattedWords.lastShownMs,
        utteranceStartMs: utterance.startMs,
        utteranceEndMs: utterance.endMs,
      })
    }
  }

  const omittedHasWords = firstOmittedUtterance !== undefined
    && transcript.utterances.slice(firstOmittedUtterance - 1).some(utterance => utterance.words.length > 0)

  return {
    text: lines.join('\n'),
    wordTimingTruncated: truncatedUtterances.length > 0 || omittedHasWords,
    truncatedUtterances,
    firstOmittedUtterance,
  }
}

export function formatInlineWordTimingCoverageNotice(
  formatted: FormattedInlineTranscript,
  transcriptPath?: string,
): string {
  if (!formatted.wordTimingTruncated) return ''
  return `\n\nInline word timing coverage:\n${JSON.stringify({
    wordTimingTruncated: true,
    truncatedUtterances: formatted.truncatedUtterances,
    firstOmittedUtterance: formatted.firstOmittedUtterance,
    transcriptPath,
  })}\nBefore retaining, captioning, or synchronizing speech outside the printed word ranges, read transcriptPath with read_file. Utterance text and line timecodes are not word timing. This is the same saved ASR result; do not retranscribe.`
}
