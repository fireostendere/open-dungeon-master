export type PublicationScope = { kind: 'global' } | { kind: 'dm' } | { kind: 'room'; roomId: string } | { kind: 'users'; userIds: string[] };
export function withPublicationScope<T>(campaignId: string, scope: PublicationScope, work: () => T): T;
export function currentPublicationScope(campaignId: string): PublicationScope | undefined;
