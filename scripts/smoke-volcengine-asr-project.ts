import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildNarrationCueSheet, type ExpectedNarrationSection } from '../src/lib/narration-cues'
import { transcribeWithVolcengineAsr } from '../src/lib/volcengine-asr'

config({ path: '.env.local' })

async function main() {
  const projectId = process.argv[2]?.trim()
  if (!projectId) {
    throw new Error('Usage: npx tsx scripts/smoke-volcengine-asr-project.ts <project-id>')
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
    fps?: number
  }
  if (!input.media_url || !/^https?:\/\//i.test(input.media_url)) {
    throw new Error('Latest transcribe_audio call does not contain a public media_url.')
  }

  const transcript = await transcribeWithVolcengineAsr({
    mediaUrl: input.media_url,
    language: input.language,
    requestId: `asr-smoke-${crypto.randomUUID()}`,
  })

  console.log(JSON.stringify({
    sourceCallCreatedAt: data.created_at,
    requestedLanguage: transcript.requestedLanguage,
    providerLogId: transcript.providerLogId,
    resourceId: transcript.resourceId,
    text: transcript.text,
    durationMs: transcript.durationMs,
    utteranceCount: transcript.utterances.length,
  }, null, 2))

  if (input.expected_sections?.length) {
    const cueSheet = buildNarrationCueSheet({
      transcript,
      sections: input.expected_sections,
      fps: input.fps,
    })
    console.log(JSON.stringify({
      verification: cueSheet.verification,
      cues: cueSheet.cues.map(cue => ({
        id: cue.scriptSectionId,
        matchScore: cue.matchScore,
        transcriptText: cue.transcriptText,
      })),
    }, null, 2))
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
