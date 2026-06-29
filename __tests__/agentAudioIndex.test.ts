import { describe, expect, it } from 'vitest'
import { buildPromptContext } from '@/lib/agent-context'

class FakeQuery {
  constructor(private readonly data: unknown[]) {}
  select() { return this }
  eq() { return this }
  in() { return this }
  order() { return this }
  limit() { return this }
  then(resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: this.data, error: null }).then(resolve, reject)
  }
}

function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      return new FakeQuery(tables[table] || [])
    },
  }
}

describe('agent audio index', () => {
  it('restores project_music rows as audio refs without adding them to Timeline Media Index', async () => {
    const ctx = await buildPromptContext(
      'project-1',
      fakeSupabase({
        snapshots: [{
          id: 'snap-1',
          image_url: 'https://example.com/image.jpg',
          description: 'Original image',
          type: 'image',
          design_path: null,
          tips: [],
          sort_order: 0,
          video_meta: null,
          metadata: null,
        }],
        messages: [],
        agent_tool_history: [],
        project_music: [{
          audio_url: 'https://example.com/beat.mp3',
          suno_audio_url: null,
          stream_audio_url: null,
          duration: 15.046531,
          title: 'beat.mp3',
          track_index: 0,
          status: 'completed',
          tags: 'reference,audio,cli',
        }],
      }) as never,
      'user-1',
      {
        userMessage: 'use the uploaded music',
        audioAttachments: [{
          audioUrl: 'https://example.com/beat.mp3',
          title: 'beat.mp3',
          duration: 15.046531,
          trackIndex: 0,
        }],
      },
    )

    expect(ctx.fullPrompt).toContain('[Media Index — 1 items]')
    expect(ctx.fullPrompt).toContain('<<<media_1>>> [image]')
    expect(ctx.fullPrompt).not.toContain('<<<media_2>>>')
    expect(ctx.fullPrompt).toContain('[Audio Index - not Timeline Media]')
    expect(ctx.fullPrompt).toContain('<<<audio_1>>> [audio] — beat.mp3, 15s, project_music track_index=0, https://example.com/beat.mp3')
    expect(ctx.fullPrompt).toContain('story_prompt includes <<<audio_1>>> and audio_refs is ["audio_1"]')
    expect(ctx.audioAttachments).toEqual([{
      audioUrl: 'https://example.com/beat.mp3',
      title: 'beat.mp3',
      duration: 15.046531,
      trackIndex: 0,
    }])
  })
})
