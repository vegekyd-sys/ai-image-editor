import { isMakaronIOSApp } from './native-app'

// Enable only after the generated-media delivery paths have passed acceptance.
export const FREE_MEDIA_ENABLED = process.env.NEXT_PUBLIC_FREE_MEDIA_ENABLED === 'true'
  || process.env.NEXT_PUBLIC_FREE_MEDIA_ENABLED === '1'

export function isWatermarkSaveFlowEnabled(): boolean {
  return FREE_MEDIA_ENABLED && isMakaronIOSApp()
}
