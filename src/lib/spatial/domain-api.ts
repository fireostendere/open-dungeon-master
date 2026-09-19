import { z } from 'zod';
import { isErrorResponse, requireMember } from '@/lib/campaign-api';
import { DomainError, authorizePublication, requireCurrentEntity } from '@/lib/spatial/domain';
import { spatialEnabled, SpatialError } from '@/lib/spatial/service';
import { withPublicationScope } from '@/lib/spatial/publication-scope.mjs';
import type { DomainType } from '@/lib/spatial/domain-store.mjs';

export const publicationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('dm') }).strict(),
  z.object({ kind: z.literal('room'), roomId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('users'), userIds: z.array(z.string().uuid()).max(20) }).strict(),
]);
export function domainErrorResponse(error: unknown) {
  if (error instanceof DomainError || error instanceof SpatialError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  }
  throw error;
}
export async function withEntityRequest(request: Request, campaignId: string, type: DomainType,
  work: () => Promise<Response>, entityId?: string) {
  if (!spatialEnabled(campaignId)) return work();
  try {
    // Read the body before rechecking identity and current observation.
    const body = request.method === 'DELETE' ? {} : await request.clone().json().catch(() => ({}));
    const context = await requireMember(campaignId);
    if (isErrorResponse(context)) return context;
    if (entityId) requireCurrentEntity(campaignId, context.user.id, type, entityId);
    if (body.scope === undefined) return await work();
    const parsed = publicationScopeSchema.safeParse(body.scope);
    if (!parsed.success) throw new DomainError('Invalid publication scope.');
    const scope = authorizePublication(campaignId, context.user.id, parsed.data);
    return await withPublicationScope(campaignId, scope, work);
  } catch (error) { return domainErrorResponse(error); }
}
