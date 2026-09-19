import { z } from 'zod';
import { isErrorResponse, requireMember, requireStoryAuthority } from '@/lib/campaign-api';
import { domainStore, DomainError, publishEntity } from '@/lib/spatial/domain';
import { publicationScopeSchema, domainErrorResponse } from '@/lib/spatial/domain-api';
import { getNoteById } from '@/lib/db/notes';
import { getFactById } from '@/lib/db/facts';
import { getChapter } from '@/lib/db/chapters';
import { spatialEnabled } from '@/lib/spatial/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ campaignId: string; entityType: string; entityId: string }> };
const typeSchema = z.enum(['note','fact','chapter']);
const publication = z.object({ scope: publicationScopeSchema, expectedVersion: z.number().int().min(0) }).strict();
export async function GET(_request: Request,{ params }: Context) {
  const { campaignId,entityType,entityId } = await params;
  const context = await requireMember(campaignId);
  if(isErrorResponse(context)) return context;
  try {
    const type = typeSchema.safeParse(entityType);
    if(!type.success || !spatialEnabled(campaignId)) throw new DomainError('Entity not found.',404);
    const entity = domainStore().read(campaignId,context.user.id,type.data,entityId);
    if(!entity || entity.deleted) throw new DomainError('Entity not found.',404);
    return Response.json({ entity },{ headers:{'Cache-Control':'private, no-store',Vary:'Cookie'} });
  } catch(error) { return domainErrorResponse(error); }
}
// Publish a real canonical entity under an explicit scope. This does not
// accept arbitrary replacement payloads, and cannot disclose personal notes.
export async function POST(request: Request,{ params }: Context) {
  const { campaignId,entityType,entityId } = await params;
  const input = publication.safeParse(await request.json().catch(()=>null));
  const context = await requireStoryAuthority(campaignId);
  if(isErrorResponse(context)) return context;
  try {
    const type=typeSchema.safeParse(entityType);
    if(!type.success || !spatialEnabled(campaignId)) throw new DomainError('Entity not found.',404);
    if(!input.success) throw new DomainError('Invalid entity publication.');
    const value = type.data==='note' ? getNoteById(entityId) : type.data==='fact' ? getFactById(entityId) : getChapter(entityId);
    if(!value || value.campaignId!==campaignId || ('visibility' in value && value.visibility==='private' && value.authorUserId!==context.user.id)) {
      throw new DomainError('Entity not found.',404);
    }
    publishEntity(type.data,value,{scope:input.data.scope,expectedVersion:input.data.expectedVersion});
    return Response.json({ entity:domainStore().read(campaignId,context.user.id,type.data,entityId) },{ headers:{'Cache-Control':'private, no-store',Vary:'Cookie'} });
  } catch(error) { return domainErrorResponse(error); }
}
