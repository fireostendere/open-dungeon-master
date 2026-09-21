export class ProviderError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "ProviderError";
    this.code = "provider_disabled";
    this.status = status;
  }
}

export function requireVerifiedProfile(_profile) {
  throw new ProviderError("Server-side model control is disabled; use the external narrator.");
}
