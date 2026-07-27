export interface MetaAppEventsInitializeResult {
  initialized: boolean;
  appId?: string;
  anonymousId?: string;
  appVersion?: string;
  appBuild?: string;
  advertiserTrackingStatus?: string;
  advertiserIDCollectionEnabled?: boolean;
}

export interface MetaAppEventsTrackEventOptions {
  eventName: string;
  eventId: string;
  params?: Record<string, string | number | boolean | undefined>;
  value?: number;
  currency?: string;
}

export interface MetaAppEventsPlugin {
  initialize(): Promise<MetaAppEventsInitializeResult>;
  fetchDeferredAppLink(): Promise<{ url?: string | null }>;
  trackEvent(options: MetaAppEventsTrackEventOptions): Promise<{
    tracked: boolean;
    managedAutomatically?: boolean;
  }>;
  flush(): Promise<void>;
}

export declare const MetaAppEvents: MetaAppEventsPlugin;
