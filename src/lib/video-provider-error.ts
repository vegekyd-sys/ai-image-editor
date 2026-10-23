/** A provider explicitly rejected the request before accepting a generation. */
export class VideoProviderRejection extends Error {
  readonly code = 'PROVIDER_REJECTED'
  constructor(message: string) { super(message); this.name = 'VideoProviderRejection' }
}
