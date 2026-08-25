import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')
const skill = readFileSync(path.join(root, 'src/skills/talking-head/SKILL.md'), 'utf8')
const speechClock = readFileSync(path.join(root, 'src/skills/_shared/speech-clock.md'), 'utf8')
const spokenCaption = readFileSync(path.join(root, 'src/skills/_shared/spoken-caption.md'), 'utf8')
const normalized = skill.replace(/\s+/g, ' ')
const normalizedCaption = spokenCaption.replace(/\s+/g, ' ')

describe('talking-head editing skill', () => {
  it('stays concise while preserving editorial autonomy', () => {
    expect(skill.length).toBeLessThan(6_500)
    expect(normalized).toContain('Use your editorial judgment')
    expect(normalized).toContain('both valid')
    expect(skill).not.toContain('exactly one `run_code`')
    expect(skill).not.toContain('three B-roll')
    expect(skill).not.toContain('zIndex')
  })

  it('edits once from measured source speech', () => {
    expect(skill).toContain('transcribe_audio({ media_index })')
    expect(skill).toContain('skills/_shared/speech-clock.md')
    expect(skill).toContain('skills/_shared/spoken-caption.md')
    expect(speechClock).toContain('audio derivative to ASR')
    expect(normalized).toContain('omit `expected_sections`')
    expect(normalized).toContain('one coherent keep-range timeline')
    expect(normalized).toContain('false starts, retakes, accidental repetition, filler, hesitation')
    expect(normalized).toContain('short breaths that make speech sound human')
    expect(normalized).toContain('small audio handle')
    expect(normalized).toContain('shortest coherent argument that preserves the hook, core proof, and close')
    expect(normalized).toContain('Do not keep every intelligible example')
  })

  it('grounds short native captions in the retained words', () => {
    expect(normalized).toContain('Build every caption from retained ASR words')
    expect(normalized).toContain('Speech Clock keep-range map')
    expect(normalized).toContain('shared Spoken Caption micro-cue contract')
    expect(normalized).toContain('never by summarizing or deleting words that remain audible')
    expect(normalized).toContain('different units')
    expect(normalizedCaption).toContain('shortest natural phrase')
    expect(normalizedCaption).toContain('one complete semantic beat')
    expect(normalizedCaption).toContain('one clear idea and one or two comfortable lines')
    expect(normalizedCaption).toContain('Keep wording and order faithful')
    expect(normalizedCaption).toContain('exact substring of that cue')
    expect(speechClock).toContain('A spoken caption begins at its first retained word')
    expect(skill).toContain('skills/tiktok-video/SKILL.md')
    expect(normalized).toContain('with sound at 1x')
  })

  it('honors explicit visual-support requests without imposing a fixed quota', () => {
    expect(normalized).toContain('When the user explicitly asks for B-roll or information graphics')
    expect(normalized).toContain('selected by editorial judgment')
    expect(skill).not.toContain('exactly three')
  })

  it('keeps renderer mechanics minimal and complete', () => {
    expect(skill).toContain('`trimBefore`')
    expect(skill).toContain('`trimAfter`')
    expect(skill).toContain('`data-editable-ignore`')
    expect(normalized).toContain('Derive its duration, cumulative output start, every caption position, and the composition total')
    expect(normalized).toContain('never hand-enter a separate `d`')
    expect(normalized).toContain('final retained range')
    expect(normalized).toContain('final spoken line and its caption are present')
    expect(normalized).toContain('If frame preview is unavailable, export first')
  })
})
