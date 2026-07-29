import type {
  TranscriptUtterance,
  TranscriptWord,
  VolcengineAsrTranscript,
} from './volcengine-asr'

export interface ExpectedNarrationSection {
  id: string
  text: string
}

export interface NarrationCue {
  scriptSectionId: string
  expectedText: string
  transcriptText: string
  startSeconds: number
  endSeconds: number
  startFrame: number
  endFrame: number
  matchScore: number
}

export interface NarrationCueSheet {
  version: '1.0'
  timingSource: 'transcribe_audio'
  fps: number
  durationSeconds: number
  transcriptText: string
  verification: {
    passed: true
    overallMatchScore: number
    averageSectionMatchScore: number
    matchedSectionRatio: number
  }
  cues: NarrationCue[]
}

interface TimedTextUnit {
  text: string
  startMs: number
  endMs: number
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function timedWords(utterances: TranscriptUtterance[]): TimedTextUnit[] {
  return utterances
    .flatMap(utterance => utterance.words)
    .filter((word): word is TranscriptWord & { startMs: number; endMs: number } => (
      typeof word.startMs === 'number'
      && Number.isFinite(word.startMs)
      && typeof word.endMs === 'number'
      && Number.isFinite(word.endMs)
      && word.endMs > word.startMs
      && normalizeText(word.text).length > 0
    ))
    .map(word => ({ text: word.text, startMs: word.startMs, endMs: word.endMs }))
}

function timedUtterances(utterances: TranscriptUtterance[]): TimedTextUnit[] {
  return utterances
    .filter((utterance): utterance is TranscriptUtterance & { startMs: number; endMs: number } => (
      typeof utterance.startMs === 'number'
      && Number.isFinite(utterance.startMs)
      && typeof utterance.endMs === 'number'
      && Number.isFinite(utterance.endMs)
      && utterance.endMs > utterance.startMs
      && normalizeText(utterance.text).length > 0
    ))
    .map(utterance => ({
      text: utterance.text,
      startMs: utterance.startMs,
      endMs: utterance.endMs,
    }))
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0
  return Math.max(0, 1 - editDistance(left, right) / Math.max(left.length, right.length))
}

const MIN_OVERALL_MATCH_SCORE = 0.5
const MIN_SECTION_MATCH_SCORE = 0.35
const MIN_MATCHED_SECTION_RATIO = 0.6

function chooseSectionEnd(input: {
  units: TimedTextUnit[]
  startIndex: number
  latestEndExclusive: number
  expectedText: string
  remainingExpectedChars: number
}): { endExclusive: number; score: number } {
  const {
    units,
    startIndex,
    latestEndExclusive,
    expectedText,
    remainingExpectedChars,
  } = input
  const target = normalizeText(expectedText)
  const remainingUnitChars = normalizeText(
    units.slice(startIndex, latestEndExclusive).map(unit => unit.text).join(''),
  ).length
  const proportionalChars = remainingExpectedChars > 0
    ? Math.max(1, Math.round(remainingUnitChars * target.length / remainingExpectedChars))
    : target.length

  let candidateText = ''
  let bestEnd = startIndex + 1
  let bestScore = Number.NEGATIVE_INFINITY
  let bestTextScore = 0
  for (let endExclusive = startIndex + 1; endExclusive <= latestEndExclusive; endExclusive++) {
    candidateText += units[endExclusive - 1].text
    const normalizedCandidate = normalizeText(candidateText)
    const textScore = similarity(target, normalizedCandidate)
    const lengthPenalty = Math.abs(normalizedCandidate.length - proportionalChars)
      / Math.max(proportionalChars, normalizedCandidate.length, 1)
    const combinedScore = textScore - lengthPenalty * 0.12
    if (combinedScore > bestScore) {
      bestScore = combinedScore
      bestTextScore = textScore
      bestEnd = endExclusive
    }
  }
  return { endExclusive: bestEnd, score: bestTextScore }
}

export function buildNarrationCueSheet(input: {
  transcript: VolcengineAsrTranscript
  sections: ExpectedNarrationSection[]
  fps?: number
}): NarrationCueSheet {
  const fps = input.fps ?? 30
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
    throw new Error('Narration cue FPS must be between 0 and 120.')
  }

  const sections = input.sections
    .map(section => ({ id: section.id.trim(), text: section.text.trim() }))
    .filter(section => section.id && section.text)
  if (sections.length === 0) {
    throw new Error('At least one non-empty narration section is required.')
  }

  const words = timedWords(input.transcript.utterances)
  const utterances = timedUtterances(input.transcript.utterances)
  const units = words.length >= sections.length ? words : utterances
  if (units.length < sections.length) {
    throw new Error(
      `Transcript has ${units.length} timed speech unit(s), fewer than ${sections.length} narration section(s).`,
    )
  }

  const totalExpectedChars = sections.reduce(
    (sum, section) => sum + normalizeText(section.text).length,
    0,
  )
  let remainingExpectedChars = totalExpectedChars
  let cursor = 0
  const cues: NarrationCue[] = []

  sections.forEach((section, sectionIndex) => {
    const remainingSections = sections.length - sectionIndex - 1
    const latestEndExclusive = units.length - remainingSections
    const selection = sectionIndex === sections.length - 1
      ? {
          endExclusive: units.length,
          score: similarity(
            normalizeText(section.text),
            normalizeText(units.slice(cursor).map(unit => unit.text).join('')),
          ),
        }
      : chooseSectionEnd({
          units,
          startIndex: cursor,
          latestEndExclusive,
          expectedText: section.text,
          remainingExpectedChars,
        })
    const selectedUnits = units.slice(cursor, selection.endExclusive)
    const first = selectedUnits[0]
    const last = selectedUnits[selectedUnits.length - 1]
    const startSeconds = first.startMs / 1000
    const endSeconds = last.endMs / 1000
    cues.push({
      scriptSectionId: section.id,
      expectedText: section.text,
      transcriptText: selectedUnits.map(unit => unit.text).join(''),
      startSeconds,
      endSeconds,
      startFrame: Math.floor(startSeconds * fps),
      endFrame: Math.ceil(endSeconds * fps),
      matchScore: Number(selection.score.toFixed(4)),
    })
    cursor = selection.endExclusive
    remainingExpectedChars -= normalizeText(section.text).length
  })

  const overallMatchScore = similarity(
    normalizeText(sections.map(section => section.text).join('')),
    normalizeText(input.transcript.text || units.map(unit => unit.text).join('')),
  )
  const averageSectionMatchScore = cues.reduce((sum, cue) => sum + cue.matchScore, 0) / cues.length
  const matchedSectionRatio = cues.filter(cue => cue.matchScore >= MIN_SECTION_MATCH_SCORE).length / cues.length
  if (
    overallMatchScore < MIN_OVERALL_MATCH_SCORE
    || matchedSectionRatio < MIN_MATCHED_SECTION_RATIO
  ) {
    throw new Error(
      'Narration verification failed: transcript does not sufficiently match the approved script '
      + `(overall=${overallMatchScore.toFixed(4)}, averageSection=${averageSectionMatchScore.toFixed(4)}, `
      + `matchedSections=${Math.round(matchedSectionRatio * 100)}%).`,
    )
  }

  const measuredDurationSeconds = (input.transcript.durationMs ?? units[units.length - 1].endMs) / 1000
  return {
    version: '1.0',
    timingSource: 'transcribe_audio',
    fps,
    durationSeconds: measuredDurationSeconds,
    transcriptText: input.transcript.text,
    verification: {
      passed: true,
      overallMatchScore: Number(overallMatchScore.toFixed(4)),
      averageSectionMatchScore: Number(averageSectionMatchScore.toFixed(4)),
      matchedSectionRatio: Number(matchedSectionRatio.toFixed(4)),
    },
    cues,
  }
}
