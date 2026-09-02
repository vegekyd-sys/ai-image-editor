// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { compileVideoReplicationPrompt } from '@/lib/video-replication-prompt'

describe('video replication provider prompt compiler', () => {
  const contract = {
    referenceVideoMediaIndex: 4,
    sourceDurationSeconds: 10.08,
    characters: [
      {
        replacementMediaIndex: 1,
        sourceActorAnchor: 'white karate gi with a red belt; opens with the high kick and is thrown at the end',
        replacementIdentity: 'muscular black-haired fighter in a white tank top, blue trousers, and gold gauntlets',
      },
      {
        replacementMediaIndex: 2,
        sourceActorAnchor: 'hooded brown-robed fighter; blocks the opening kick and executes the final shoulder throw',
        replacementIdentity: 'silver-haired fighter in a purple shirt, black trousers, and dark metal armor',
      },
    ],
    environment: {
      replacementMediaIndex: 3,
      sourceEnvironmentAnchor: 'sunlit hall with red lanterns, wooden floor, training equipment, and a rear altar',
      replacementEnvironment: 'empty traditional Japanese tatami dojo with shoji windows and dark timber columns',
    },
    audioPolicy: 'preserve_source' as const,
    styleDirection: 'Photorealistic cinematic martial-arts film with coherent anatomy and grounded impacts.',
  }

  it('keeps measured semantic mappings while expanding structural invariants', () => {
    const prompt = compileVideoReplicationPrompt('道场格斗复刻', contract)

    expect(prompt).toContain('<<<media_4>>> as the sole and exact temporal performance')
    expect(prompt).toContain('white karate gi with a red belt')
    expect(prompt).toContain('opens with the high kick')
    expect(prompt).toContain('<<<media_1>>>')
    expect(prompt).toContain('blocks the opening kick and executes the final shoulder throw')
    expect(prompt).toContain('<<<media_2>>>')
    expect(prompt).toContain('<<<media_3>>>')
    expect(prompt).toContain('Never identify or remap this role only by left/right screen position')
    expect(prompt).toContain('no new shots or extra cuts')
    expect(prompt).toContain('no different opening or ending')
    expect(prompt).toContain('Preserve which source performer initiates and receives every action')
    expect(prompt).toContain('Preserve the reference video audio exactly')
    expect(prompt.length).toBeGreaterThan(2500)
  })

  it('makes audio policy explicit instead of leaving it to provider defaults', () => {
    const silent = compileVideoReplicationPrompt('Silent Replica', {
      ...contract,
      audioPolicy: 'silent',
    })
    const regenerated = compileVideoReplicationPrompt('Audio Replica', {
      ...contract,
      audioPolicy: 'regenerate',
    })

    expect(silent).toContain('Return a silent video')
    expect(regenerated).toContain('Regenerate synchronized audio')
    expect(regenerated).toContain('impact timing')
  })
})
