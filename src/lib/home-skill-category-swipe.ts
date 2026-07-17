export type HomeSkillCategorySwipeDirection = 'previous' | 'next'

export const HOME_SKILL_CATEGORY_SWIPE_AXIS_LOCK_PX = 10
export const HOME_SKILL_CATEGORY_SWIPE_EDGE_GUTTER_PX = 36

interface ResolveHomeSkillCategorySwipeInput {
  deltaX: number
  deltaY: number
  durationMs: number
  regionWidth?: number
}

interface HomeSkillCategorySwipePresentationInput {
  deltaX: number
  regionWidth: number
  atBoundary: boolean
}

export interface HomeSkillCategorySwipePresentation {
  translateX: number
  opacity: number
}

export function canStartHomeSkillCategorySwipe(clientX: number, viewportWidth: number): boolean {
  return clientX > HOME_SKILL_CATEGORY_SWIPE_EDGE_GUTTER_PX
    && clientX < viewportWidth - HOME_SKILL_CATEGORY_SWIPE_EDGE_GUTTER_PX
}

export function resolveHomeSkillCategorySwipe({
  deltaX,
  deltaY,
  durationMs,
  regionWidth = 390,
}: ResolveHomeSkillCategorySwipeInput): HomeSkillCategorySwipeDirection | null {
  const horizontalDistance = Math.abs(deltaX)
  const verticalDistance = Math.abs(deltaY)
  if (horizontalDistance < HOME_SKILL_CATEGORY_SWIPE_AXIS_LOCK_PX) return null
  if (horizontalDistance <= verticalDistance * 1.2) return null

  const commitDistance = Math.max(52, Math.min(72, regionWidth * 0.16))
  const safeDurationMs = Math.max(durationMs, 1)
  const isQuickFlick = horizontalDistance >= 28
    && safeDurationMs <= 220
    && horizontalDistance / safeDurationMs >= 0.45
  if (horizontalDistance < commitDistance && !isQuickFlick) return null

  return deltaX < 0 ? 'next' : 'previous'
}

export function getHomeSkillCategorySwipePresentation({
  deltaX,
  regionWidth,
  atBoundary,
}: HomeSkillCategorySwipePresentationInput): HomeSkillCategorySwipePresentation {
  if (deltaX === 0) return { translateX: 0, opacity: 1 }

  const safeRegionWidth = Math.max(regionWidth, 1)
  const resistance = atBoundary ? 0.1 : 0.22
  const translateLimit = atBoundary ? 14 : Math.min(36, Math.max(28, safeRegionWidth * 0.1))
  const rawTranslateX = deltaX * resistance
  const translateX = Math.round(
    Math.max(-translateLimit, Math.min(translateLimit, rawTranslateX)) * 100,
  ) / 100
  const opacityFloor = atBoundary ? 0.97 : 0.86
  const opacityDistance = atBoundary ? safeRegionWidth * 4 : safeRegionWidth * 2.4
  const opacity = Math.round(
    Math.max(opacityFloor, 1 - Math.abs(deltaX) / opacityDistance) * 100,
  ) / 100

  return { translateX, opacity }
}

export function getAdjacentHomeSkillCategoryId(
  categoryIds: readonly string[],
  activeCategoryId: string,
  direction: HomeSkillCategorySwipeDirection,
): string | null {
  const activeIndex = categoryIds.indexOf(activeCategoryId)
  if (activeIndex < 0) return null
  const nextIndex = direction === 'next' ? activeIndex + 1 : activeIndex - 1
  return categoryIds[nextIndex] ?? null
}
