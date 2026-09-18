export class LocationCommandClient {
  readonly identity: string;
  readonly userId: string;
  readonly endpoint: string;
  pending: { key: string; input: Record<string, unknown>; requestId: string } | null;
  busy: boolean;
  closed: boolean;
  constructor(options: { campaignId: string; userId: string; fetchImpl?: typeof fetch; uuid?: () => string });
  dispose(): void;
  command(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  retry(): Promise<Record<string, unknown>>;
}
