export interface MetaAppEventsInitializeResult {
  initialized: boolean;
  appId?: string;
  anonymousId?: string;
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
  trackEvent(options: MetaAppEventsTrackEventOptions): Promise<{
    tracked: boolean;
    managedAutomatically?: boolean;
  }>;
  flush(): Promise<void>;
}

export declare const MetaAppEvents: MetaAppEventsPlugin;
