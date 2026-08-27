import { describe, expect, it } from 'vitest'
import { validateVideoScript } from '../src/lib/video-harness'

describe('video duration guards', () => {
  it('rejects a Seedance video script shorter than 4 seconds', () => {
    const error = validateVideoScript({
      prompt: [
        '快速眨眼',
        '',
        '主角是 <<<media_1>>>（人物）。',
        'Shot 1 (3s): Close-up, she blinks and smiles.',
        'Style: Soft portrait.',
      ].join('\n'),
      imageCount: 1,
      model: 'seedance',
    })

    expect(error).toContain('at least 4 seconds')
    expect(error).toContain('totals 3s')
    expect(error).toContain('duration=4')
  })

  it('allows a 4 second Seedance script', () => {
    const error = validateVideoScript({
      prompt: [
        '快速回眸',
        '',
        '主角是 <<<media_1>>>（人物）。',
        'Shot 1 (4s): Close-up, she turns back and smiles.',
        'Style: Soft portrait.',
      ].join('\n'),
      imageCount: 1,
      model: 'seedance',
      duration: 4,
    })

    expect(error).toBeNull()
  })

  it('rejects an explicit Seedance duration shorter than 4 seconds', () => {
    const error = validateVideoScript({
      prompt: [
        '人物回眸',
        '',
        '主角是 <<<media_1>>>（人物）。',
        'Shot 1 (5s): Close-up, she turns back and smiles.',
        'Style: Soft portrait.',
      ].join('\n'),
      imageCount: 1,
      model: 'seedance',
      duration: 3,
    })

    expect(error).toContain('duration must be at least 4 seconds')
    expect(error).toContain('duration=3')
    expect(error).toContain('duration=4')
  })

  it('still rejects a Kling duration shorter than 5 seconds', () => {
    const error = validateVideoScript({
      prompt: [
        '人物回眸',
        '',
        '主角是 <<<media_1>>>（人物）。',
        'Shot 1 (4s): Close-up, she turns back and smiles.',
        'Style: Soft portrait.',
      ].join('\n'),
      imageCount: 1,
      model: 'kling',
      duration: 4,
    })

    expect(error).toContain('Kling')
    expect(error).toContain('at least 5 seconds')
    expect(error).toContain('duration=5')
  })

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

  it('allows a native 30 second Seedance 2.5 script', () => {
    const error = validateVideoScript({
      prompt: [
        'Makaron 一人工作室',
        '',
        '主角是 <<<media_1>>>（Makaron mascot）。',
        'Shot 1 (6s): Mascot opens the Makaron home page.',
        'Shot 2 (6s): The editor turns one photo into several directions.',
        'Shot 3 (6s): Images, video, and music flow through one workspace.',
        'Shot 4 (6s): The mascot directs a cinematic video in chat.',
        'Shot 5 (6s): Makaron logo resolves on a clean fuchsia background.',
        'Style: Premium product film with synchronized sound.',
      ].join('\n'),
      imageCount: 1,
      model: 'seedance-2.5',
      duration: 30,
    })

    expect(error).toBeNull()
  })

  it('still rejects Seedance 2.5 scripts longer than 30 seconds', () => {
    const error = validateVideoScript({
      prompt: [
        'Too Long',
        'Shot 1 (16s): First half.',
        'Shot 2 (15s): Second half.',
      ].join('\n'),
      imageCount: 0,
      model: 'seedance-2.5',
      duration: 31,
    })

    expect(error).toContain('at most 30 seconds')
    expect(error).toContain('totals 31s')
  })

  it('allows provider-managed duration for Seedance 2.5 video edit', () => {
    const error = validateVideoScript({
      prompt: 'Edit <<<media_1>>>（源视频）to replace the background while preserving timing.',
      imageCount: 1,
      availableMediaIndices: [1],
      model: 'seedance-2.5',
      duration: -1,
      operation: 'edit',
    })

    expect(error).toBeNull()
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
