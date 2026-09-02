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
        replacementIdentity: 'muscular black-haired fighter in a white tank top, blue trousers, black shoes, and gold gauntlets',
      },
      {
        replacementMediaIndex: 2,
        sourceActorAnchor: 'hooded brown-robed fighter; blocks the opening kick and executes the final throw',
        replacementIdentity: 'silver-haired fighter in a purple shirt, black trousers, black boots, and dark metal armor',
      },
    ],
    objects: [
      {
        replacementMediaIndex: 5,
        sourceObjectAnchor: 'white cake on the carried tray, then airborne and flattened on the floor',
        replacementObject: 'three-layer chocolate cake with chocolate glaze and one red cherry',
      },
    ],
    environment: {
      replacementMediaIndex: 3,
      sourceEnvironmentAnchor: 'sunlit hall with red lanterns, wooden floor, training equipment, and a rear altar',
      replacementEnvironment: 'empty traditional Japanese tatami dojo with shoji windows and dark timber columns',
    },
    styleDirection: 'Photorealistic cinematic martial-arts film with coherent anatomy and grounded impacts.',
  }

  it('keeps semantic mappings while expanding structural invariants', () => {
    const prompt = compileVideoReplicationPrompt(
      '道场格斗复刻\nShot 1 (2s): 开场高踢并格挡。\n声音要有清晰的动作冲击，并跟随参考视频的节奏。',
      contract,
    )

    expect(prompt).toContain('<<<media_4>>> as the sole and exact temporal performance')
    expect(prompt).toContain('white karate gi with a red belt')
    expect(prompt).toContain('exact identity, face, hair, body, clothing, colors, footwear, and accessories')
    expect(prompt).toContain('source occupation or story role does not preserve the source costume')
    expect(prompt).toContain('<<<media_1>>>')
    expect(prompt).toContain('<<<media_2>>>')
    expect(prompt).toContain('<<<media_3>>>')
    expect(prompt).toContain('OBJECT 1')
    expect(prompt).toContain('<<<media_5>>>')
    expect(prompt).toContain('three-layer chocolate cake')
    expect(prompt).toContain('Never identify or remap this role only by left/right screen position')
    expect(prompt).toContain('no new shots or extra cuts')
    expect(prompt).toContain('no different opening or ending')
    expect(prompt).toContain('reference-sheet, contact-sheet, multi-view board')
    expect(prompt).toContain('MEASURED SHOTS, SOUND, AND REQUEST DIRECTION')
    expect(prompt).toContain('Shot 1 (2s)')
    expect(prompt).toContain('声音要有清晰的动作冲击，并跟随参考视频的节奏。')
    expect(prompt).not.toContain('Preserve the reference video audio exactly')
    expect(prompt.length).toBeGreaterThan(3500)
  })

  it('does not invent exact source-track reuse when sound is unspecified', () => {
    const prompt = compileVideoReplicationPrompt('Video Replica', contract)

    expect(prompt).toContain('generate model-native synchronized sound')
    expect(prompt).toContain('Do not infer exact source-track reuse')
    expect(prompt).not.toContain('Preserve the reference video audio exactly')
  })

  it('normalizes a source-video self-reference to environment preservation', () => {
    const prompt = compileVideoReplicationPrompt('Video Replica', {
      ...contract,
      environment: {
        replacementMediaIndex: 4,
        sourceEnvironmentAnchor: 'the source ballroom',
        replacementEnvironment: 'preserve the same source ballroom',
      },
    })

    expect(prompt).toContain('ENVIRONMENT: Preserve the environment visible in <<<media_4>>>')
    expect(prompt).not.toContain('Replace the entire visible environment with <<<media_4>>>')
  })
})
