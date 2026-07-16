import { describe, expect, it } from 'vitest'
import {
  canStartHomeSkillCategorySwipe,
  getAdjacentHomeSkillCategoryId,
  resolveHomeSkillCategorySwipe,
} from '@/lib/home-skill-category-swipe'

describe('home skill card area category swipe', () => {
  it('maps a left swipe to the next tab and a right swipe to the previous tab', () => {
    expect(resolveHomeSkillCategorySwipe({ deltaX: -84, deltaY: 7, durationMs: 260 })).toBe('next')
    expect(resolveHomeSkillCategorySwipe({ deltaX: 84, deltaY: -5, durationMs: 260 })).toBe('previous')
  })

  it('ignores vertical scrolling, small drags, and slow incomplete gestures', () => {
    expect(resolveHomeSkillCategorySwipe({ deltaX: -30, deltaY: 96, durationMs: 240 })).toBeNull()
    expect(resolveHomeSkillCategorySwipe({ deltaX: -8, deltaY: 1, durationMs: 80 })).toBeNull()
    expect(resolveHomeSkillCategorySwipe({ deltaX: -34, deltaY: 3, durationMs: 600 })).toBeNull()
  })

  it('allows a deliberate short flick without making ordinary taps switch tabs', () => {
    expect(resolveHomeSkillCategorySwipe({ deltaX: -34, deltaY: 2, durationMs: 60 })).toBe('next')
    expect(resolveHomeSkillCategorySwipe({ deltaX: 12, deltaY: 1, durationMs: 60 })).toBeNull()
  })

  it('moves between adjacent tabs without wrapping at either end', () => {
    const tabs = ['all', 'motion', 'portrait']

    expect(getAdjacentHomeSkillCategoryId(tabs, 'all', 'next')).toBe('motion')
    expect(getAdjacentHomeSkillCategoryId(tabs, 'motion', 'next')).toBe('portrait')
    expect(getAdjacentHomeSkillCategoryId(tabs, 'motion', 'previous')).toBe('all')
    expect(getAdjacentHomeSkillCategoryId(tabs, 'all', 'previous')).toBeNull()
    expect(getAdjacentHomeSkillCategoryId(tabs, 'portrait', 'next')).toBeNull()
  })

  it('leaves the system edge gestures available on mobile Safari', () => {
    expect(canStartHomeSkillCategorySwipe(8, 390)).toBe(false)
    expect(canStartHomeSkillCategorySwipe(382, 390)).toBe(false)
    expect(canStartHomeSkillCategorySwipe(195, 390)).toBe(true)
  })
})
