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

export interface MetaDeferredAppLinkResult {
  status?: 'resolved' | 'empty' | 'error';
  url?: string | null;
  errorDomain?: string;
  errorCode?: number;
  errorDescription?: string;
  nativeFetchStartedAt?: string;
  nativeFetchLatencyMs?: number;
  appVersion?: string;
  appBuild?: string;
  advertiserTrackingStatus?: string;
  advertiserIDCollectionEnabled?: boolean;
}

export interface MetaAppEventsPlugin {
  initialize(): Promise<MetaAppEventsInitializeResult>;
  fetchDeferredAppLink(): Promise<MetaDeferredAppLinkResult>;
  trackEvent(options: MetaAppEventsTrackEventOptions): Promise<{
    tracked: boolean;
    managedAutomatically?: boolean;
  }>;
  flush(): Promise<void>;
}

export declare const MetaAppEvents: MetaAppEventsPlugin;
