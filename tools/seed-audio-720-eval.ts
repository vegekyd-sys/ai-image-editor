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
    'unified-performance-mix-v1',
    'unified-performance-mix-v2',
    'unified-performance-mix-v3',
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
    id: 'unified-performance-mix-v3',
    claim: 'Compact one-pass performance score with audible music, line-level emotion, SFX, and real outro budget',
    input: {
      durationSeconds: 30,
      speechRate: 1.02,
      loudnessRate: 1.12,
      pitchRate: 0,
      format: 'wav',
      sampleRate: 48000,
      prompt: `成品目标：一次生成30秒可直接发布的中文完整混音。音乐、旁白、音效必须在同一次生成里共同表演，缺一不可；不要输出分轨。

[MUSIC — 全程骨架]
88 BPM温暖极简电子乐：玻璃合成器两小节主题、圆润贝斯、闷音底鼓、细碎电子打击、宽阔柔和pad。音乐从开头持续到最后，旁白时也要明显听得见旋律与节奏。开头完整演奏主题；中段逐步汇合、和声打开；最后至少3秒没有旁白，让音乐正常音量重奏主题并完整结束。无歌声，禁止提前淡出。

[VOICE — 逐句表演]
30岁左右女性，贴近麦克风，自然、有呼吸，不是播音腔。必须按下列情绪演，不要用同一种语气念完：
1｜好奇靠近，前半明亮肯定，后半转为困惑和轻微失望：“你发现了吗？每个声音都对，合起来却不像一个世界。”
2｜克制失望，列举时略分拍，重读“从没真正”，不控诉：“因为人声、音乐和音效，从没真正听见彼此。”
3｜句前轻吸气，像突然想通；“共享”放慢变暖，结尾有希望：“统一生成，让它们共享停顿、空间，也共享情绪。”
4｜平静笃定；“自然”后停顿，结尾温柔确信，不喊口号：“自然，不是轨道更多；是同一个世界，正在发生。”

[SFX — 按顺序穿插]
开头清亮启动音；第一句后左右错位click；第二句后碎片吸合加确认音；第三句后三个由近到远的UI blip；尾奏末尾温暖final button。每个音效短促、独立可辨、不盖字。

[MIX]
旁白居中前景；说话时音乐只轻降3 dB，句间立即恢复。音乐要像真正配乐，不能退化为近乎静音的氛围、单一低频或偶发脉冲。最后一句必须在尾奏开始前结束。`,
    },
    expectedSpeech: [
      '你发现了吗每个声音都对合起来却不像一个世界',
      '因为人声音乐和音效从没真正听见彼此',
      '统一生成让它们共享停顿空间也共享情绪',
      '自然不是轨道更多是同一个世界正在发生',
    ],
    asrLanguage: 'zh-CN',
  },
  {
    id: 'unified-performance-mix-v2',
    claim: 'One-pass mix with music treated as the continuous backbone, expressive narration, and timed SFX',
    input: {
      durationSeconds: 30,
      speechRate: 0.96,
      loudnessRate: 1.12,
      pitchRate: 0,
      format: 'wav',
      sampleRate: 48000,
      prompt: `标题：同一个世界正在发生
模式：一次生成可直接发布的完整混音，不要分轨，不要二次生成
语言：普通话
时长：30秒

音乐是全片骨架，绝不是可省略的背景：88 BPM温暖极简电子乐，玻璃合成器两小节主题、圆润合成贝斯、闷音底鼓、细碎电子打击、宽阔柔和pad。0-30秒持续清晰可闻；旁白时只降低3 dB，旋律和节奏仍能听清；句间恢复到与旁白相当的存在感。26.8秒后必须保持正常音量完成主题，禁止提前淡出或静音；29.2秒落final button，保留自然尾音到30秒。无歌声。

旁白：30岁左右女性，贴近麦克风，自然、有呼吸，不是播音腔。四句是四段不同表演：
1. 好奇地靠近听者；“声音都对”明亮肯定，到“却总像”转为困惑和轻微失望。
2. 克制失望；“人声、音乐和音效”略分拍，重读“从没真正”，不控诉。
3. 句前轻吸气，像突然想通；“共享”放慢变暖，“情绪的转折”带希望。
4. 平静笃定；“自然”后停顿，结尾温柔确信，不喊口号。

音效必须独立可辨且不盖字：0.7秒清亮启动音；7.3秒左右各一个左右错位click；14.5秒碎片吸合加确认音；21.4秒三个由近到远的UI blip；29.2秒温暖final button。

时间线：
[00:00-02.2] 仅音乐，完整主题和启动音。
[02.2-07.0] 旁白1：“你有没有发现？声音都对，合在一起，却总像拼出来的。”
[07.0-08.2] 仅音乐和左右click。
[08.2-13.3] 旁白2：“因为人声、音乐和音效，从没真正听见彼此。”
[13.3-15.2] 仅音乐；碎片吸合，确认音。
[15.2-20.8] 旁白3：“统一生成，让它们共享停顿、空间，也共享情绪的转折。”
[20.8-22.0] 仅音乐抬升，三个UI blip。
[22.0-26.8] 旁白4：“所以自然，不是轨道更多，而是同一个世界正在发生。”
[26.8-30.0] 仅音乐，正常音量完整收束，final button后留尾音。`,
    },
    expectedSpeech: [
      '你有没有发现声音都对合在一起却总像拼出来的',
      '因为人声音乐和音效从没真正听见彼此',
      '统一生成让它们共享停顿空间也共享情绪的转折',
      '所以自然不是轨道更多而是同一个世界正在发生',
    ],
    asrLanguage: 'zh-CN',
  },
  {
    id: 'unified-performance-mix-v1',
    claim: 'One prompt with clearly audible music, per-line emotional narration, and timed SFX',
    input: {
      durationSeconds: 30,
      speechRate: 0.96,
      loudnessRate: 1.12,
      pitchRate: 0,
      format: 'wav',
      sampleRate: 48000,
      prompt: `标题：同一个世界正在发生
模式：旁白、音乐、氛围和音效一次生成的完整成品
语言：普通话
目标时长：30秒

音乐（必须存在）：88 BPM温暖极简电子乐。玻璃质感合成器演奏两小节主题动机，圆润合成贝斯、闷音底鼓、细碎电子打击和宽阔柔和的pad。音乐从0秒连续到30秒，必须清晰可闻，不能退化成近乎静音的氛围或单一脉冲。前半段节奏略碎；14.5秒所有声部合流；21.5秒和声打开；27.8秒后音乐独立完成结尾。

旁白：30岁左右女性，贴近麦克风，自然、有呼吸感，不是播音腔。每句必须有不同表演：
1. 贴近听者、带好奇；“声音都对”先肯定，“却总像”转为困惑和轻微失望，尾句下沉。
2. 克制的失望；列举“人声、音乐和音效”时略分拍，重读“从没真正”，不控诉。
3. 像突然想明白，句前轻吸气；“共享”放慢并变暖，到“情绪的转折”出现希望。
4. 平静笃定；“自然”后停顿，结尾不是口号，而是温柔确信。

音效：0.7秒一次清亮启动音；6.8秒左右各一次左右错位click；14.5秒一次碎片吸合声加确认音；21.5秒三个由近到远的UI blip；29.4秒一次温暖final button。每个音效清楚、短促、不盖字。

混音：旁白居中前景。说话时音乐只轻降3-4 dB，主题动机、节奏与和声仍明显可听；句间音乐立即抬升。音乐、旁白、音效三者缺一不可，无歌声。

时间线：
[00:00-02.0] 仅音乐开场，完整展示一次主题动机和启动音。
[02.0-07.2] 旁白1：“你有没有发现？声音都对，合在一起，却总像拼出来的。”
[07.2-08.3] 仅音乐和左右错位click。
[08.3-13.4] 旁白2：“因为人声、音乐和音效，从没真正听见彼此。”
[13.4-15.0] 仅音乐转场；碎片吸合，确认音落下。
[15.0-20.8] 旁白3：“统一生成，让它们共享停顿、空间，也共享情绪的转折。”
[20.8-22.0] 仅音乐抬升，三个UI blip出现。
[22.0-27.8] 旁白4：“所以自然，不是轨道更多，而是同一个世界正在发生。”
[27.8-30.0] 仅音乐结尾，完整主题动机和final button收束。`,
    },
    expectedSpeech: [
      '你有没有发现声音都对合在一起却总像拼出来的',
      '因为人声音乐和音效从没真正听见彼此',
      '统一生成让它们共享停顿空间也共享情绪的转折',
      '所以自然不是轨道更多而是同一个世界正在发生',
    ],
    asrLanguage: 'zh-CN',
  },
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
  if (
    testCase.id === 'unified-performance-mix-v1'
    || testCase.id === 'unified-performance-mix-v2'
    || testCase.id === 'unified-performance-mix-v3'
  ) return [
    ...common,
    'Confirm the electronic motif remains clearly audible under every spoken line and becomes stronger in all four voice-free windows.',
    'Judge whether each of the four lines has the specified emotional turn instead of one uniform narrator delivery.',
    'Confirm the startup chime, offset clicks, convergence/confirmation, three UI blips, and final button are distinct and correctly ordered.',
  ]
  if (testCase.id === 'full-scene-zh') return [...common, 'Confirm narration, electronic music, startup chime, shutter, and final hit are all present and correctly mixed.']
  if (testCase.id === 'timeline-precision') return [...common, 'Compare the three spoken cues/effects against 1.0s, 5.0s, and 9.0s.']
  if (testCase.id === 'music-bed') return [...common, 'Confirm coherent motif, lift, no vocals, and a clean button ending; flag omitted or generic music.']
  if (testCase.id === 'image-guided') return [...common, 'Judge whether the voice and sound palette plausibly reflect the mascot image without becoming childish.']
  if (testCase.id === 'cross-language-reference') return [...common, 'A/B against exact-speech and judge speaker identity consistency across Japanese and French.']
  if (testCase.id === 'twenty-language-stress') return [...common, 'Count omitted languages and judge pronunciation/naturalness per language; Vietnamese is a known harder public benchmark case.']
  return [...common, 'Verify every required word, number, letter, and brand name; retry with a shorter Seed Audio voice-first prompt if any are wrong.']
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
    '- All voiceover generation stays on Seed Audio; failed speech verification requires a clearer Seed Audio retry.',
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
