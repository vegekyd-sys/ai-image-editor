/** A terminal supplier refusal, not evidence of copyright, NSFW, or a safe retry. */
export class ImageProviderRefusalError extends Error {
  readonly code = 'IMAGE_PROVIDER_REFUSAL';
  constructor(
    public readonly provider: 'openai' | 'fal',
    public readonly providerCode: string,
    public readonly requestId?: string,
  ) {
    super('The provider content checker rejected this request. Do not retry automatically; only the bounded benign-character recovery policy may select another compatible model.');
    this.name = 'ImageProviderRefusalError';
  }
}
