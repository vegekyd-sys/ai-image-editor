import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { generateWithEvolinkSeedAudio, type EvolinkSeedAudioInput } from '../src/lib/evolink-seed-audio'
import { findFfprobe, measureAudioLoudness } from '../src/lib/ffmpeg-runtime'
import { transcribeWithVolcengineAsr, type VolcengineAsrTranscript } from '../src/lib/volcengine-asr'

const execFileAsync = promisify(execFile)

type EvalCase = {
  id: string
  claim: string
  input: EvolinkSeedAudioInput
  expectedSpeech?: string[]
  expectedCues?: Array<{ text: string; targetSeconds: number; toleranceSeconds: number }>
  asrLanguage?: string
  dependsOn?: string
  buildInput?: (results: CaseResult[]) => EvolinkSeedAudioInput
}

type CaseResult = {
  id: string
  claim: string
  status: 'passed' | 'failed'
  startedAt: string
  completedAt: string
  input: EvolinkSeedAudioInput
  taskId?: string
  audioUrl?: string
  localPath?: string
  duration?: number
  format?: string
  creditsUsed?: number
  generationSeconds?: number
  technical?: {
    codec?: string
    sampleRate?: number
    channels?: number
    duration?: number
    integratedLufs?: number
    truePeakDbfs?: number
  }
  transcript?: VolcengineAsrTranscript
  expectedSpeech?: string[]
  speechCoverage?: number
  cueTiming?: Array<{
    text: string
    targetSeconds: number
    actualSeconds?: number
    errorSeconds?: number
    passed: boolean
  }>
  automatedGate?: {
    verdict: 'pass' | 'fail' | 'manual'
    reasons: string[]
  }
  error?: string
  manualReview: string[]
}

const DEFAULT_OUT_DIR = path.resolve('artifacts/seed-audio-720-eval')
const IMAGE_REFERENCE = 'https://www.makaron.app/brand/makaron-app-icon-512.png'

function parseArgs(): { outDir: string; only?: Set<string>; reportFrom?: string } {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const casesIndex = args.indexOf('--cases')
  const reportIndex = args.indexOf('--report-from')
  return {
    outDir: outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : DEFAULT_OUT_DIR,
    only: casesIndex >= 0 && args[casesIndex + 1]
      ? new Set(args[casesIndex + 1].split(',').map(value => value.trim()).filter(Boolean))
      : undefined,
    reportFrom: reportIndex >= 0 && args[reportIndex + 1] ? path.resolve(args[reportIndex + 1]) : undefined,
  }
}

function normalizeSpeech(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/macaron/g, 'makaron')
    .replace(/七月二十日/g, '7月20日')
    .replace(/二十多/g, '20多')
    .replace(/九十九/g, '99')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function speechCoverage(expected: string[] | undefined, actual: string | undefined): number | undefined {
  if (!expected?.length || !actual) return undefined
  const normalizedActual = normalizeSpeech(actual)
  const hits = expected.filter(segment => normalizedActual.includes(normalizeSpeech(segment))).length
  return Number((hits / expected.length).toFixed(3))
}

function cueTiming(testCase: EvalCase, transcript?: VolcengineAsrTranscript): CaseResult['cueTiming'] {
  if (!testCase.expectedCues?.length) return undefined
  return testCase.expectedCues.map((cue) => {
    const utterance = transcript?.utterances.find(item => normalizeSpeech(item.text).includes(normalizeSpeech(cue.text)))
    const actualSeconds = utterance?.startMs == null ? undefined : utterance.startMs / 1000
    const errorSeconds = actualSeconds == null ? undefined : Number((actualSeconds - cue.targetSeconds).toFixed(3))
    return {
      ...cue,
      actualSeconds,
      errorSeconds,
      passed: errorSeconds != null && Math.abs(errorSeconds) <= cue.toleranceSeconds,
    }
  })
}

function automatedGate(testCase: EvalCase, result: CaseResult): NonNullable<CaseResult['automatedGate']> {
  if (result.status === 'failed') return { verdict: 'fail', reasons: [result.error || 'Provider did not return audio.'] }
  const failures: string[] = []
  const targetDuration = result.input.durationSeconds
  const actualDuration = result.technical?.duration ?? result.duration
  if (targetDuration && actualDuration && Math.abs(actualDuration - targetDuration) / targetDuration > 0.2) {
    failures.push(`Duration ${actualDuration.toFixed(2)}s missed the ${targetDuration}s target by more than 20%.`)
  }
  if (testCase.expectedSpeech?.length && (result.speechCoverage ?? 0) < 0.9) {
    failures.push(`Strict normalized ASR phrase coverage was ${Math.round((result.speechCoverage ?? 0) * 100)}%, below 90%.`)
  }
  const failedCues = result.cueTiming?.filter(cue => !cue.passed) || []
  if (failedCues.length) {
    failures.push(`Timeline cue gate failed: ${failedCues.map(cue => (
      `${cue.text}=${cue.actualSeconds == null ? 'missing' : `${cue.actualSeconds}s`} (target ${cue.targetSeconds}s)`
    )).join(', ')}.`)
  }
  if (result.input.sampleRate && result.technical?.sampleRate && result.input.sampleRate !== result.technical.sampleRate) {
    failures.push(`Output sample rate ${result.technical.sampleRate}Hz did not match ${result.input.sampleRate}Hz.`)
  }
  if (failures.length) return { verdict: 'fail', reasons: failures }

  const manualSemanticCases = new Set([
    'full-scene-zh',
    'music-bed',
    'image-guided',
    'cross-language-reference',
    'twenty-language-stress',
  ])
  if (manualSemanticCases.has(testCase.id)) {
    return { verdict: 'manual', reasons: ['Automated gates passed; semantic mix, voice identity, pronunciation, or music quality still needs listening.'] }
  }
  return { verdict: 'pass', reasons: ['Provider, duration, output format, speech coverage, and applicable cue checks passed.'] }
}

function finalizeResult(testCase: EvalCase, result: CaseResult): CaseResult {
  const finalized = {
    ...result,
    cueTiming: cueTiming(testCase, result.transcript),
  }
  finalized.automatedGate = automatedGate(testCase, finalized)
  return finalized
}

function extensionFor(format?: string): string {
  if (format === 'ogg_opus') return 'ogg'
  if (format && ['mp3', 'wav', 'pcm', 'ogg'].includes(format)) return format
  return 'wav'
}

async function download(url: string, target: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Audio download failed (${res.status})`)
  await writeFile(target, Buffer.from(await res.arrayBuffer()))
}

async function inspectAudio(target: string): Promise<CaseResult['technical']> {
  try {
    const ffprobe = await findFfprobe()
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      target,
    ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
    const parsed = JSON.parse(stdout)
    const audio = Array.isArray(parsed.streams)
      ? parsed.streams.find((stream: Record<string, unknown>) => stream.codec_type === 'audio')
      : undefined
    const loudness = await measureAudioLoudness(target).catch(() => undefined)
    return {
      codec: typeof audio?.codec_name === 'string' ? audio.codec_name : undefined,
      sampleRate: Number.isFinite(Number(audio?.sample_rate)) ? Number(audio.sample_rate) : undefined,
      channels: typeof audio?.channels === 'number' ? audio.channels : undefined,
      duration: Number.isFinite(Number(parsed.format?.duration)) ? Number(parsed.format.duration) : undefined,
      integratedLufs: loudness?.integratedLufs,
      truePeakDbfs: loudness?.truePeakDbfs,
    }
  } catch {
    return undefined
  }
}

const cases: EvalCase[] = [
  {
    id: 'full-scene-zh',
    claim: 'Unified narration + music + ambience + SFX in one pass',
    input: {
      durationSeconds: 15,
      speechRate: 0.96,
      loudnessRate: 1.05,
      pitchRate: 0,
      format: 'wav',
      sampleRate: 48000,
      prompt: `Title: 一人工作室
Mode: Full scene
Language: Mandarin Chinese
Target duration: 15 seconds
Mix: warm female narration foreground; restrained electronic music underneath; soft studio ambience lower.
Timeline:
[00:00.0-00:02.0] One clean startup chime, then a soft synth pulse.
[00:02.0-00:08.0] Narrator, warm and confident: "一个人，也能拥有一间完整的创意工作室。"
[00:08.0-00:12.5] Narrator: "从灵感，到成片，声音也一次完成。"
[00:12.5-00:15.0] One camera shutter, music lifts and ends with a clean hit.
Constraints: narration must remain clear; no sung vocals; do not omit music.`,
    },
    expectedSpeech: ['一个人也能拥有一间完整的创意工作室', '从灵感到成片声音也一次完成'],
    asrLanguage: 'zh-CN',
  },
  {
    id: 'exact-speech',
    claim: 'Exact scripted speech candidate for replacing routine TTS',
    input: {
      durationSeconds: 13,
      speechRate: 0.92,
      loudnessRate: 1,
      pitchRate: -1,
      format: 'wav',
      sampleRate: 48000,
      prompt: `Title: 精确口播
Mode: Voice first
Language: Mandarin Chinese
Target duration: 13 seconds
Characters: female narrator, clear, natural, calm, medium pace.
Mix: dry voice in the foreground; no music; no ambience; no sound effects.
Timeline:
[00:00.5-00:12.5] Narrator: "Makaron 七月二十日更新，支持二十多种语言。套餐价格是九十九元，版本号是 V 7.20。"
Constraints: read every word, number, English letter, and brand name exactly once; no paraphrase.`,
    },
    expectedSpeech: ['Makaron', '七月二十日更新', '支持二十多种语言', '九十九元', 'V7.20'],
    asrLanguage: 'zh-CN',
  },
  {
    id: 'timeline-precision',
    claim: 'Fine-grained timeline and ordered audible events',
    input: {
      durationSeconds: 12,
      speechRate: 1,
      loudnessRate: 1,
      pitchRate: 0,
      format: 'mp3',
      sampleRate: 24000,
      prompt: `Title: 三点时间轴
Mode: Sound design
Language: Mandarin Chinese
Target duration: 12 seconds
Mix: dry neutral male cue voice foreground; effects brief and distinct; no music.
Timeline:
[00:01.0] Voice says "开始", then one keyboard click.
[00:05.0] Voice says "转场", then one short whoosh.
[00:09.0] Voice says "完成", then one soft bell.
[00:10.0-00:12.0] Silence.
Constraints: preserve order; each cue spoken once; no extra words.`,
    },
    expectedSpeech: ['开始', '转场', '完成'],
    expectedCues: [
      { text: '开始', targetSeconds: 1, toleranceSeconds: 1 },
      { text: '转场', targetSeconds: 5, toleranceSeconds: 1 },
      { text: '完成', targetSeconds: 9, toleranceSeconds: 1 },
    ],
    asrLanguage: 'zh-CN',
  },
  {
    id: 'music-bed',
    claim: 'Music generation with an explicit arc and intentional ending',
    input: {
      durationSeconds: 18,
      loudnessRate: 1.08,
      pitchRate: 0,
      format: 'wav',
      sampleRate: 48000,
      prompt: `Title: Bright Momentum
Mode: Music bed
Target duration: 18 seconds
Mix: polished instrumental bed for product narration; restrained midrange; clean dynamics.
Timeline:
[00:00.0-00:03.0] Memorable soft synth motif over light percussion.
[00:03.0-00:13.0] Rounded bass and airy electronic rhythm build steady momentum.
[00:13.0-00:18.0] Energy lifts slightly and resolves with a clean button ending.
Constraints: no vocals; no whistling; no abrupt key change; do not omit the music.`,
    },
  },
  {
    id: 'image-guided',
    claim: 'Reference-image-conditioned voice and sound-scene direction',
    input: {
      durationSeconds: 12,
      imageUrls: [IMAGE_REFERENCE],
      speechRate: 1.02,
      loudnessRate: 1,
      pitchRate: 1,
      format: 'wav',
      sampleRate: 48000,
      prompt: `Title: Mascot Spark
Mode: Full scene
Language: English
Target duration: 12 seconds
Use the reference image to inspire a playful, precise, magical-tech character voice and scene tone.
Timeline:
[00:00.0-00:02.0] Three tiny pixel sparkle sounds.
[00:02.0-00:08.5] Bright friendly character: "A little spark can build an entire creative studio."
[00:08.5-00:12.0] Soft digital flourish and a clean logo hit.
Constraints: no singing; dialogue foreground; keep the character charming, not childish.`,
    },
    expectedSpeech: ['A little spark can build an entire creative studio'],
    asrLanguage: 'en-US',
  },
  {
    id: 'cross-language-reference',
    claim: 'Same reference voice across languages',
    dependsOn: 'exact-speech',
    input: { prompt: '' },
    buildInput: (results) => {
      const reference = results.find(result => result.id === 'exact-speech' && result.audioUrl)
      if (!reference?.audioUrl) throw new Error('exact-speech reference audio is unavailable')
      return {
        durationSeconds: 18,
        audioReferences: [reference.audioUrl],
        speechRate: 0.95,
        loudnessRate: 1,
        pitchRate: 0,
        format: 'wav',
        sampleRate: 48000,
        prompt: `Title: Same Voice Across Languages
Mode: Multilingual voice first
Language: Japanese, French
Target duration: 18 seconds
Characters: @audio1 = preserve the same speaker identity, texture, age, and calm delivery across both languages.
Mix: dry voice foreground; very light neutral room tone; no music.
Timeline:
[00:01.0-00:08.0] @audio1 in Japanese: "ひとりでも、完全なクリエイティブスタジオを持てます。"
[00:09.0-00:16.0] @audio1 in French: "Une seule personne peut créer un studio complet."
Constraints: same voice identity in both lines; no translation narration; no extra speech.`,
      }
    },
    expectedSpeech: ['ひとりでも', 'クリエイティブスタジオ', 'Une seule personne', 'studio complet'],
  },
  {
    id: 'twenty-language-stress',
    claim: '20-language single-generation stress test',
    input: {
      durationSeconds: 70,
      speechRate: 0.98,
      loudnessRate: 1,
      pitchRate: 0,
      format: 'wav',
      sampleRate: 48000,
      prompt: `Title: Twenty Languages
Mode: Multilingual
Target duration: 70 seconds
Characters: one warm female narrator; keep the same identity and natural pace in every language.
Mix: dry voice only; 0.3-second pause between lines; no music or effects.
Timeline, speak each quoted line once in order:
English "Hello, creative world."
Chinese "你好，创意世界。"
Japanese "こんにちは、クリエイティブな世界。"
Korean "안녕하세요, 창의적인 세상."
Mexican Spanish "Qué onda, mundo creativo."
Indonesian "Halo, dunia kreatif."
German "Hallo, kreative Welt."
Portuguese "Olá, mundo criativo."
French "Bonjour, monde créatif."
Thai "สวัสดี โลกแห่งความคิดสร้างสรรค์"
Vietnamese "Xin chào thế giới sáng tạo."
Malay "Helo, dunia kreatif."
Filipino "Kumusta, malikhaing mundo."
Italian "Ciao, mondo creativo."
Russian "Привет, творческий мир."
Dutch "Hallo, creatieve wereld."
Polish "Witaj, kreatywny świecie."
Turkish "Merhaba, yaratıcı dünya."
Swedish "Hej, kreativa värld."
Castilian Spanish "Hola, mundo creativo."
Constraints: no skipped language; no translation; no extra speech.`,
    },
    expectedSpeech: [
      'Hello creative world', '你好创意世界', 'こんにちは', '안녕하세요', 'Qué onda mundo creativo',
      'Halo dunia kreatif', 'Hallo kreative Welt', 'Olá mundo criativo', 'Bonjour monde créatif',
      'สวัสดี', 'Xin chào', 'Helo dunia kreatif', 'Kumusta', 'Ciao mondo creativo', 'Привет',
      'Hallo creatieve wereld', 'Witaj', 'Merhaba', 'Hej', 'Hola mundo creativo',
    ],
  },
]

function manualReviewFor(testCase: EvalCase): string[] {
  const common = ['Listen for clipping, artifacts, naturalness, and whether the result is production-usable.']
  if (testCase.id === 'full-scene-zh') return [...common, 'Confirm narration, electronic music, startup chime, shutter, and final hit are all present and correctly mixed.']
  if (testCase.id === 'timeline-precision') return [...common, 'Compare the three spoken cues/effects against 1.0s, 5.0s, and 9.0s.']
  if (testCase.id === 'music-bed') return [...common, 'Confirm coherent motif, lift, no vocals, and a clean button ending; flag omitted or generic music.']
  if (testCase.id === 'image-guided') return [...common, 'Judge whether the voice and sound palette plausibly reflect the mascot image without becoming childish.']
  if (testCase.id === 'cross-language-reference') return [...common, 'A/B against exact-speech and judge speaker identity consistency across Japanese and French.']
  if (testCase.id === 'twenty-language-stress') return [...common, 'Count omitted languages and judge pronunciation/naturalness per language; Vietnamese is a known harder public benchmark case.']
  return [...common, 'Verify every required word, number, letter, and brand name; use TTS fallback if any are wrong.']
}

async function runCase(testCase: EvalCase, outDir: string, results: CaseResult[]): Promise<CaseResult> {
  const startedAt = new Date().toISOString()
  let input = testCase.input
  try {
    if (testCase.dependsOn && !results.some(result => result.id === testCase.dependsOn && result.status === 'passed')) {
      throw new Error(`Dependency ${testCase.dependsOn} did not pass`)
    }
    if (testCase.buildInput) input = testCase.buildInput(results)
    console.log(`\n[seed-audio-720] ${testCase.id}: submitting`)
    const generated = await generateWithEvolinkSeedAudio(input)
    const localPath = path.join(outDir, `${testCase.id}.${extensionFor(generated.format)}`)
    await download(generated.audioUrl, localPath)
    const technical = await inspectAudio(localPath)

    let transcript: VolcengineAsrTranscript | undefined
    if (testCase.expectedSpeech?.length) {
      try {
        transcript = await transcribeWithVolcengineAsr({
          mediaUrl: generated.audioUrl,
          localMediaPath: localPath,
          language: testCase.asrLanguage,
          uid: 'makaron-seed-audio-720-eval',
        })
      } catch (error) {
        console.warn(`[seed-audio-720] ${testCase.id}: ASR failed:`, error)
      }
    }

    const result = finalizeResult(testCase, {
      id: testCase.id,
      claim: testCase.claim,
      status: 'passed',
      startedAt,
      completedAt: new Date().toISOString(),
      input,
      taskId: generated.taskId,
      audioUrl: generated.audioUrl,
      localPath,
      duration: generated.duration,
      format: generated.format,
      creditsUsed: generated.creditsUsed,
      generationSeconds: generated.generationSeconds,
      technical,
      transcript,
      expectedSpeech: testCase.expectedSpeech,
      speechCoverage: speechCoverage(testCase.expectedSpeech, transcript?.text),
      manualReview: manualReviewFor(testCase),
    })
    console.log(`[seed-audio-720] ${testCase.id}: completed in ${generated.generationSeconds.toFixed(1)}s, coverage=${result.speechCoverage ?? 'n/a'}`)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[seed-audio-720] ${testCase.id}: failed: ${message}`)
    return finalizeResult(testCase, {
      id: testCase.id,
      claim: testCase.claim,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      input,
      expectedSpeech: testCase.expectedSpeech,
      error: message,
      manualReview: manualReviewFor(testCase),
    })
  }
}

function markdownReport(results: CaseResult[]): string {
  const lines = [
    '# Seed Audio 1.0 — 2026-07-20 evaluation',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Case | Claim | Provider | ASR coverage | Output | Duration | 7/20 gate |',
    '|---|---|---:|---:|---:|---:|---|',
    ...results.map(result => (
      `| ${result.id} | ${result.claim} | ${result.generationSeconds?.toFixed(1) ?? '—'}s | ${result.speechCoverage == null ? 'manual' : `${Math.round(result.speechCoverage * 100)}%`} | ${result.technical?.codec ?? result.format ?? '—'}/${result.technical?.sampleRate ?? '—'}Hz | ${result.technical?.duration?.toFixed(2) ?? result.duration ?? '—'}s | ${result.automatedGate?.verdict ?? '—'} |`
    )),
    '',
    '## Interpretation',
    '',
    '- `passed` means the provider accepted the case and returned a downloadable audio artifact; it is not a subjective MOS pass.',
    '- ASR coverage is exact normalized phrase containment and is intentionally strict. Review transcript errors before blaming generation.',
    '- Voice identity, mix completeness, music quality, pronunciation, and production usability still require listening.',
    '- Keep `generate_voiceover` as the precision fallback when exact speech verification fails.',
    '',
    ...results.flatMap(result => [
      `## ${result.id}`,
      '',
      `- Status: ${result.status}${result.error ? ` — ${result.error}` : ''}`,
      `- Task: ${result.taskId ?? '—'}`,
      `- Artifact: ${result.localPath ?? '—'}`,
      `- Technical: ${result.technical ? JSON.stringify(result.technical) : '—'}`,
      `- Transcript: ${result.transcript?.text || '—'}`,
      `- Cue timing: ${result.cueTiming?.length ? JSON.stringify(result.cueTiming) : '—'}`,
      `- Automated gate: ${result.automatedGate?.verdict ?? '—'} — ${result.automatedGate?.reasons.join(' ') ?? '—'}`,
      `- Manual review: ${result.manualReview.join(' ')}`,
      '',
    ]),
  ]
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { outDir, only, reportFrom } = parseArgs()
  await mkdir(outDir, { recursive: true })
  if (reportFrom) {
    const payload = JSON.parse(await readFile(reportFrom, 'utf8')) as { results: CaseResult[] }
    const results = payload.results.map((result) => {
      const testCase = cases.find(candidate => candidate.id === result.id)
      return testCase ? finalizeResult(testCase, result) : result
    })
    await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ version: '2026-07-20', results }, null, 2))
    await writeFile(path.join(outDir, 'report.md'), markdownReport(results))
    console.log(`[seed-audio-720] report refreshed for ${results.length} cases`)
    return
  }
  const selected = only ? cases.filter(testCase => only.has(testCase.id)) : cases
  const results: CaseResult[] = []
  for (const testCase of selected) {
    results.push(await runCase(testCase, outDir, results))
    await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ version: '2026-07-20', results }, null, 2))
    await writeFile(path.join(outDir, 'report.md'), markdownReport(results))
  }
  const failed = results.filter(result => result.status === 'failed')
  console.log(`\n[seed-audio-720] complete: ${results.length - failed.length}/${results.length} provider cases returned audio`)
  if (failed.length) process.exitCode = 1
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
