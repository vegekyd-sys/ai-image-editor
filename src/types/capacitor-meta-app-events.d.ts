import '@makaron/capacitor-meta-app-events'

declare module '@makaron/capacitor-meta-app-events' {
  interface MetaAppEventsInitializeResult {
    appVersion?: string
    appBuild?: string
    advertiserTrackingStatus?: string
    advertiserIDCollectionEnabled?: boolean
  }
}
