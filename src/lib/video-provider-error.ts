/** A provider explicitly rejected the request before accepting a generation. */
export class VideoProviderRejection extends Error {
  readonly code = 'PROVIDER_REJECTED'
  constructor(message: string) { super(message); this.name = 'VideoProviderRejection' }
}

/** A status lookup explicitly rejected the task ID, not the generation itself. */
export class VideoTaskLookupUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'VideoTaskLookupUnavailable' }
}
