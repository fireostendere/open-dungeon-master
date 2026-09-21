export async function performProviderAction(_source: string, _input: unknown): Promise<never> {
  throw new Error("Server-side model control is disabled; use the external narrator.");
}
