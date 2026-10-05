export type PublicationScope = { kind: 'global' } | { kind: 'dm' } | { kind: 'room'; roomId: string } | { kind: 'users'; userIds: string[] };
export function withPublicationScope<T>(campaignId: string, scope: PublicationScope, work: () => T): T;
export function currentPublicationScope(campaignId: string): PublicationScope | undefined;

export function withEncounterRoom<T>(campaignId: string, roomId: string | undefined, work: () => T): T;
export function currentEncounterRoom(campaignId: string): string | undefined;

export function withFight<T>(campaignId: string, encounterId: string | null, work: () => T): T;
export function currentFight(campaignId: string): string | null | undefined;
