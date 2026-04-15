import { describe, it, expect } from 'vitest'
import { ReplayEngine } from '@/lib/replayEngine'
import type { AgentEventRow } from '@/hooks/useAgentRun'

function makeEvent(seq: number, type: string, data: Record<string, unknown> = {}, created_at?: string): AgentEventRow {
  return {
    id: `evt-${seq}`,
    run_id: 'run-1',
    type,
    data,
    seq,
    created_at: created_at || new Date(Date.now() + seq * 100).toISOString(),
  }
}

describe('ReplayEngine.buildState', () => {
  it('builds empty state from no events', () => {
    const state = ReplayEngine.buildState([])
    expect(state.messages).toHaveLength(0)
    expect(state.snapshots).toHaveLength(0)
    expect(state.title).toBe('Untitled')
    expect(state.animations).toHaveLength(0)
  })

  it('builds messages from content + new_turn events', () => {
    const events = [
      makeEvent(0, 'new_turn', { messageId: 'msg-1' }),
      makeEvent(1, 'content', { text: 'Hello ' }),
      makeEvent(2, 'content', { text: 'world!' }),
      makeEvent(3, 'new_turn', { messageId: 'msg-2' }),
      makeEvent(4, 'content', { text: 'Second turn' }),
      makeEvent(5, 'done'),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0].id).toBe('msg-1')
    expect(state.messages[0].content).toBe('Hello world!')
    expect(state.messages[0].role).toBe('assistant')
    expect(state.messages[1].id).toBe('msg-2')
    expect(state.messages[1].content).toBe('Second turn')
  })

  it('builds snapshots from image events', () => {
    const events = [
      makeEvent(0, 'new_turn', { messageId: 'msg-1' }),
      makeEvent(1, 'content', { text: 'Generating...' }),
      makeEvent(2, 'image', { snapshotId: 'snap-1', imageUrl: 'https://storage/img1.jpg', usedModel: 'gemini' }),
      makeEvent(3, 'done'),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].id).toBe('snap-1')
    expect(state.snapshots[0].imageUrl).toBe('https://storage/img1.jpg')
    expect(state.snapshots[0].messageId).toBe('msg-1')
    // Inline image set on message
    expect(state.messages[0].image).toBe('https://storage/img1.jpg')
  })

  it('deduplicates snapshots with same ID', () => {
    const events = [
      makeEvent(0, 'new_turn', { messageId: 'msg-1' }),
      makeEvent(1, 'image', { snapshotId: 'snap-1', imageUrl: 'https://url1' }),
      makeEvent(2, 'image', { snapshotId: 'snap-1', imageUrl: 'https://url1' }), // duplicate
      makeEvent(3, 'done'),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots).toHaveLength(1)
  })

  it('handles user_message events', () => {
    const events = [
      makeEvent(0, 'user_message', { messageId: 'user-1', content: 'make it blue' }),
      makeEvent(1, 'new_turn', { messageId: 'msg-1' }),
      makeEvent(2, 'content', { text: 'Sure!' }),
      makeEvent(3, 'done'),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0].role).toBe('user')
    expect(state.messages[0].content).toBe('make it blue')
    expect(state.messages[1].role).toBe('assistant')
    expect(state.messages[1].content).toBe('Sure!')
  })

  it('handles project_named events', () => {
    const events = [
      makeEvent(0, 'project_named', { title: 'My Cool Project' }),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.title).toBe('My Cool Project')
  })

  it('handles image_upload events (original photo)', () => {
    const events = [
      makeEvent(0, 'image_upload', { snapshotId: 'original-1', imageUrl: 'https://storage/original.jpg', isOriginal: true }),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].id).toBe('original-1')
    expect(state.snapshots[0].imageUrl).toBe('https://storage/original.jpg')
  })

  it('handles tip_committed events', () => {
    const events = [
      makeEvent(0, 'image_upload', { snapshotId: 'snap-0', imageUrl: 'https://original.jpg' }),
      makeEvent(1, 'tip_committed', { snapshotId: 'snap-0', tipIndex: 2, newSnapshotId: 'snap-1', imageUrl: 'https://tip-result.jpg' }),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots).toHaveLength(2)
    expect(state.snapshots[1].id).toBe('snap-1')
    expect(state.snapshots[1].imageUrl).toBe('https://tip-result.jpg')
  })

  it('handles tips_generated events', () => {
    const events = [
      makeEvent(0, 'image_upload', { snapshotId: 'snap-0', imageUrl: 'https://img.jpg' }),
      makeEvent(1, 'tips_generated', { snapshotId: 'snap-0', tips: [{ emoji: '🎨', label: 'Paint', desc: 'test', editPrompt: 'paint it', category: 'creative' }] }),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots[0].tips).toHaveLength(1)
    expect(state.snapshots[0].tips[0].label).toBe('Paint')
  })

  it('handles render/design events (published)', () => {
    const events = [
      makeEvent(0, 'new_turn', { messageId: 'msg-1' }),
      makeEvent(1, 'render', { code: 'function D(){}', width: 1080, height: 1350, snapshotId: 'design-1', published: true }),
      makeEvent(2, 'done'),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].id).toBe('design-1')
    expect(state.snapshots[0].design?.code).toBe('function D(){}')
  })

  it('skips unpublished draft renders', () => {
    const events = [
      makeEvent(0, 'new_turn', { messageId: 'msg-1' }),
      makeEvent(1, 'render', { code: 'draft code', width: 1080, height: 1350, published: false }),
      makeEvent(2, 'done'),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots).toHaveLength(0)
  })

  it('handles code_stream events (code block in message)', () => {
    const events = [
      makeEvent(0, 'new_turn', { messageId: 'msg-1' }),
      makeEvent(1, 'content', { text: 'Let me write code:' }),
      makeEvent(2, 'code_stream', { text: 'const x = 1;', done: false }),
      makeEvent(3, 'code_stream', { text: '\nconst y = 2;', done: false }),
      makeEvent(4, 'code_stream', { text: '', done: true }),
      makeEvent(5, 'done'),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.messages[0].content).toContain('```javascript')
    expect(state.messages[0].content).toContain('const x = 1;')
    expect(state.messages[0].content).toContain('const y = 2;')
    expect(state.messages[0].content).toContain('```\n')
  })

  it('handles animation_task + video_completed', () => {
    const events = [
      makeEvent(0, 'animation_task', { taskId: 'anim-1', prompt: 'make video' }),
      makeEvent(1, 'video_completed', { animationId: 'anim-1', videoUrl: 'https://video.mp4', prompt: 'make video' }),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.animations).toHaveLength(1)
    expect(state.animations[0].videoUrl).toBe('https://video.mp4')
    expect(state.animations[0].status).toBe('completed')
  })

  it('handles description_set events', () => {
    const events = [
      makeEvent(0, 'image_upload', { snapshotId: 'snap-0', imageUrl: 'https://img.jpg' }),
      makeEvent(1, 'description_set', { snapshotId: 'snap-0', description: 'A cute cat photo' }),
    ]
    const state = ReplayEngine.buildState(events)
    expect(state.snapshots[0].description).toBe('A cute cat photo')
  })

  it('handles full session with multiple runs', () => {
    const events = [
      // User uploads photo
      makeEvent(0, 'image_upload', { snapshotId: 'original', imageUrl: 'https://original.jpg' }),
      makeEvent(1, 'project_named', { title: 'Beach Photo' }),
      // First agent run
      makeEvent(2, 'user_message', { messageId: 'user-1', content: 'make it sunset' }),
      makeEvent(3, 'new_turn', { messageId: 'agent-1' }),
      makeEvent(4, 'content', { text: 'Adding sunset...' }),
      makeEvent(5, 'image', { snapshotId: 'snap-1', imageUrl: 'https://sunset.jpg' }),
      makeEvent(6, 'new_turn', { messageId: 'agent-2' }),
      makeEvent(7, 'content', { text: 'Done! How do you like it?' }),
      makeEvent(8, 'done'),
      // Tip commit
      makeEvent(9, 'tips_generated', { snapshotId: 'snap-1', tips: [{ emoji: '🌅', label: 'Golden', desc: 'golden hour', editPrompt: 'golden', category: 'enhance' }] }),
      makeEvent(10, 'tip_committed', { snapshotId: 'snap-1', tipIndex: 0, newSnapshotId: 'snap-2', imageUrl: 'https://golden.jpg' }),
      // Second agent run
      makeEvent(11, 'user_message', { messageId: 'user-2', content: 'add a bird' }),
      makeEvent(12, 'new_turn', { messageId: 'agent-3' }),
      makeEvent(13, 'content', { text: 'Adding bird...' }),
      makeEvent(14, 'image', { snapshotId: 'snap-3', imageUrl: 'https://bird.jpg' }),
      makeEvent(15, 'done'),
    ]
    const state = ReplayEngine.buildState(events)

    expect(state.title).toBe('Beach Photo')
    expect(state.snapshots).toHaveLength(4) // original + sunset + golden tip + bird
    expect(state.messages).toHaveLength(5) // 2 user + 3 assistant
    expect(state.messages[0].role).toBe('user')
    expect(state.messages[0].content).toBe('make it sunset')
    expect(state.messages[4].content).toBe('Adding bird...')
    expect(state.snapshots[3].imageUrl).toBe('https://bird.jpg')
    expect(state.snapshots[1].tips).toHaveLength(1)
  })
})
