import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import type { DesignPayload } from '../src/types'
import {
  buildNarrationCueSheet,
  type ExpectedNarrationSection,
} from '../src/lib/narration-cues'
import { renderDesignVideoLocal } from '../src/lib/remotion-local-renderer'
import { transcribeWithVolcengineAsr } from '../src/lib/volcengine-asr'

config({ path: '.env.local' })

const DESIGN_CODE = `
function Scene({cue, index, duration, headline}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const palette = [
    ['#FF4F87', '#FF9A62'],
    ['#6A5CFF', '#45C9FF'],
    ['#FFB43A', '#FF6B6B'],
    ['#3DD6A5', '#43A6FF'],
    ['#EC66FF', '#795CFF'],
    ['#FF5E7D', '#FFC857'],
  ][index % 6];
  const enter = spring({frame, fps, config: {damping: 16, stiffness: 110}});
  const leave = interpolate(
    frame,
    [Math.max(0, duration - 14), duration],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const opacity = enter * leave;
  const lift = interpolate(enter, [0, 1], [70, 0]);
  const ringTurn = interpolate(frame, [0, duration], [-18, 22]);
  const pulse = 1 + Math.sin(frame / 9) * 0.035;

  return (
    <AbsoluteFill style={{opacity}}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: \`radial-gradient(circle at 72% 24%, \${palette[0]}44 0%, transparent 34%),
          radial-gradient(circle at 18% 78%, \${palette[1]}38 0%, transparent 38%)\`,
      }} />

      <div style={{
        position: 'absolute',
        width: 510,
        height: 510,
        borderRadius: '50%',
        left: 105,
        top: 238,
        border: \`2px solid \${palette[0]}99\`,
        transform: \`rotate(\${ringTurn}deg) scale(\${pulse})\`,
        boxShadow: \`0 0 90px \${palette[1]}24, inset 0 0 80px \${palette[0]}18\`,
      }}>
        <div style={{
          position: 'absolute',
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: palette[1],
          left: 68,
          top: 55,
          boxShadow: \`0 0 28px \${palette[1]}\`,
        }} />
      </div>

      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 332,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: \`translateY(\${lift}px)\`,
      }}>
        <div style={{
          fontSize: 168,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: -10,
          color: 'rgba(255,255,255,0.08)',
        }}>
          {String(index + 1).padStart(2, '0')}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        left: 58,
        right: 58,
        top: 690,
        transform: \`translateY(\${lift * 0.55}px)\`,
      }}>
        <div style={{
          fontSize: 20,
          fontWeight: 750,
          letterSpacing: 4,
          color: palette[1],
          marginBottom: 18,
        }}>
          ASR CUE {String(index + 1).padStart(2, '0')} · {cue.startSeconds.toFixed(2)}–{cue.endSeconds.toFixed(2)}s
        </div>
        <div style={{
          fontSize: 67,
          lineHeight: 1.16,
          letterSpacing: -3,
          fontWeight: 860,
          color: '#F8F7FF',
          textShadow: '0 12px 42px rgba(0,0,0,0.38)',
        }}>
          {headline}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        left: 40,
        right: 40,
        bottom: 76,
        padding: '25px 30px 28px',
        borderRadius: 28,
        background: 'rgba(7,8,18,0.76)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.34)',
      }}>
        <div style={{
          fontSize: 34,
          lineHeight: 1.48,
          fontWeight: 680,
          letterSpacing: -0.7,
          textAlign: 'center',
          color: '#FFFFFF',
        }}>
          {cue.expectedText}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Design(props) {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );

  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(155deg, #111329 0%, #080914 55%, #141027 100%)',
      fontFamily: '"Noto Sans JP", "Hiragino Sans", sans-serif',
      overflow: 'hidden',
    }}>
      <Audio src={props.audioUrl} />

      <div style={{
        position: 'absolute',
        left: 42,
        right: 42,
        top: 38,
        height: 4,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.12)',
        overflow: 'hidden',
        zIndex: 20,
      }}>
        <div style={{
          width: \`\${progress * 100}%\`,
          height: '100%',
          background: 'linear-gradient(90deg, #FF5C8A, #8D6CFF, #4DD7FF)',
        }} />
      </div>

      {props.cues.map((cue, index) => {
        const from = Math.max(0, cue.startFrame);
        const end = Math.min(durationInFrames, Math.max(from + 1, cue.endFrame));
        return (
          <Sequence key={cue.scriptSectionId} from={from} durationInFrames={end - from}>
            <Scene
              cue={cue}
              index={index}
              duration={end - from}
              headline={props.headlines[index] || cue.expectedText}
            />
          </Sequence>
        );
      })}

      <div style={{
        position: 'absolute',
        right: 38,
        top: 58,
        fontSize: 17,
        fontWeight: 700,
        letterSpacing: 2,
        color: 'rgba(255,255,255,0.42)',
        zIndex: 20,
      }}>
        JAPANESE · REMOTION · 30 FPS
      </div>
    </AbsoluteFill>
  );
}
`

async function main() {
  const projectId = process.argv[2]?.trim()
  if (!projectId) {
    throw new Error('Usage: npx tsx e2e/japanese-asr-remotion.ts <project-id>')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase
    .from('agent_tool_history')
    .select('created_at, input')
    .eq('project_id', projectId)
    .eq('tool_name', 'transcribe_audio')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(`No transcribe_audio call found for project ${projectId}.`)

  const input = data.input as {
    media_url?: string
    language?: string
    expected_sections?: ExpectedNarrationSection[]
  }
  if (!input.media_url || !input.expected_sections?.length) {
    throw new Error('Latest transcribe_audio call must contain media_url and expected_sections.')
  }

  const transcript = await transcribeWithVolcengineAsr({
    mediaUrl: input.media_url,
    language: input.language,
    requestId: `ja-remotion-e2e-${crypto.randomUUID()}`,
  })
  const cueSheet = buildNarrationCueSheet({
    transcript,
    sections: input.expected_sections,
    fps: 30,
  })
  const durationInSeconds = Math.min(30, Math.max(20, cueSheet.durationSeconds))
  const durationInFrames = Math.round(durationInSeconds * 30)
  const cues = cueSheet.cues.map(cue => ({
    ...cue,
    startFrame: Math.max(0, Math.min(durationInFrames - 1, cue.startFrame)),
    endFrame: Math.max(1, Math.min(durationInFrames, cue.endFrame)),
  }))

  const design: DesignPayload = {
    code: DESIGN_CODE,
    width: 720,
    height: 1280,
    animation: {
      fps: 30,
      durationInSeconds,
      format: 'mp4',
    },
    props: {
      audioUrl: input.media_url,
      cues,
      headlines: [
        '夜を、取り戻す',
        '入れて、選んで、スタート',
        '温かさは、すぐそこ',
        '片づけまで、軽やかに',
        '夜の時間を、自分らしく',
        '今夜、チェックしてみて',
      ],
    },
  }

  const outputDir = path.resolve('outputs', `ja-asr-remotion-${Date.now()}`)
  await mkdir(outputDir, { recursive: true })
  await writeFile(path.join(outputDir, 'transcript.json'), JSON.stringify(transcript, null, 2))
  await writeFile(path.join(outputDir, 'narration-cues.json'), JSON.stringify(cueSheet, null, 2))
  await writeFile(path.join(outputDir, 'design.json'), JSON.stringify(design, null, 2))

  console.log(JSON.stringify({
    phase: 'asr_verified',
    requestedLanguage: transcript.requestedLanguage,
    providerLogId: transcript.providerLogId,
    transcriptText: transcript.text,
    verification: cueSheet.verification,
    durationInSeconds,
    durationInFrames,
    outputDir,
  }, null, 2))

  const video = await renderDesignVideoLocal(design, {
    scale: 1,
    concurrency: 4,
  })
  const videoPath = path.join(outputDir, 'japanese-asr-remotion.mp4')
  await writeFile(videoPath, video)

  console.log(JSON.stringify({
    phase: 'rendered',
    videoPath,
    bytes: video.length,
  }, null, 2))

  const renderedTranscript = await transcribeWithVolcengineAsr({
    mediaUrl: 'https://local.invalid/japanese-asr-remotion.mp4',
    localMediaPath: videoPath,
    language: input.language,
    requestId: `ja-remotion-rendered-${crypto.randomUUID()}`,
  })
  const renderedCueSheet = buildNarrationCueSheet({
    transcript: renderedTranscript,
    sections: input.expected_sections,
    fps: 30,
  })
  await writeFile(
    path.join(outputDir, 'rendered-video-transcript.json'),
    JSON.stringify(renderedTranscript, null, 2),
  )
  await writeFile(
    path.join(outputDir, 'rendered-video-cues.json'),
    JSON.stringify(renderedCueSheet, null, 2),
  )

  console.log(JSON.stringify({
    phase: 'rendered_video_asr_verified',
    requestedLanguage: renderedTranscript.requestedLanguage,
    providerLogId: renderedTranscript.providerLogId,
    transcriptText: renderedTranscript.text,
    verification: renderedCueSheet.verification,
    durationSeconds: renderedCueSheet.durationSeconds,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
