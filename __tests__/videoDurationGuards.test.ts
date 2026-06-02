import { describe, expect, it } from 'vitest'
import { validateVideoScript } from '../src/lib/video-harness'

describe('video duration guards', () => {
  it('rejects a single generated video script longer than 15 seconds', () => {
    const error = validateVideoScript({
      prompt: [
        '木雕小人觉醒记',
        '',
        '主角是 <<<media_1>>>（木雕小人）。',
        'Shot 1 (4s): Extreme close-up, slow push-in.',
        'Shot 2 (5s): Mid-shot, camera slowly circles right.',
        'Shot 3 (5s): Wide shot, pull-out reveal.',
        'Shot 4 (5s): Low angle close-up, push-in.',
        'Shot 5 (5s): Extreme close-up, slight handheld shake.',
        'Shot 6 (6s): Bird\'s-eye view, slowly pulling straight up.',
        'Style: Magical product demo.',
      ].join('\n'),
      imageCount: 1,
    })

    expect(error).toContain('at most 15 seconds')
    expect(error).toContain('totals 30s')
    expect(error).toContain('long-video-director')
  })

  it('allows a normal short script', () => {
    const error = validateVideoScript({
      prompt: [
        '木雕小人觉醒',
        '',
        '主角是 <<<media_1>>>（木雕小人）。',
        'Shot 1 (4s): Extreme close-up, slow push-in.',
        'Shot 2 (5s): Mid-shot, the figure raises its hand.',
        'Shot 3 (5s): Wide shot, the glow settles.',
        'Style: Magical product demo.',
      ].join('\n'),
      imageCount: 1,
    })

    expect(error).toBeNull()
  })

  it('allows one 15s script with multiple shots without forcing segment splitting', () => {
    const error = validateVideoScript({
      prompt: [
        '水槽功能秀',
        '',
        '主产品是 <<<media_1>>>（金色水槽）。',
        'Shot 1 (2s): Wide shot, slow push-in on the sink.',
        'Shot 2 (3s): Close-up, water drains into a fast vortex.',
        'Shot 3 (3s): Mid-shot, dark liquid pours and disappears.',
        'Shot 4 (4s): Close-up, cup washer sprays through a glass.',
        'Shot 5 (3s): Hero shot, faucet water slows and stops.',
        'Style: Luxury kitchen product ad.',
      ].join('\n'),
      imageCount: 1,
    })

    expect(error).toBeNull()
  })
})
