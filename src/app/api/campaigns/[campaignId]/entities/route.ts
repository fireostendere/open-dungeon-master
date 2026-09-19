import { z } from 'zod';
import { isErrorResponse, requireMember } from '@/lib/campaign-api';
import { domainStore, DomainError } from '@/lib/spatial/domain';
import { spatialEnabled } from '@/lib/spatial/service';
import { domainErrorResponse } from '@/lib/spatial/domain-api';
import { registerUnversionedNotes } from '@/lib/db/notes';
import { registerUnversionedFacts } from '@/lib/db/facts';
import { listChaptersVisibleTo } from '@/lib/db/chapters';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const querySchema = z.object({ type: z.enum(['note','fact','chapter']), query: z.string().max(300).default(''), roomId: z.string().uuid().optional() });
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) return context;
  try {
    if (!spatialEnabled(campaignId)) throw new DomainError('Location mode is not enabled.',409);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new DomainError('Invalid entity search.');
    if (parsed.data.type === 'note') registerUnversionedNotes(campaignId);
    if (parsed.data.type === 'fact') registerUnversionedFacts(campaignId);
    if (parsed.data.type === 'chapter') listChaptersVisibleTo(campaignId,context.user.id);
    const entities = domainStore().list(campaignId,context.user.id,parsed.data.type,parsed.data);
    return Response.json({ entities }, { headers: { 'Cache-Control':'private, no-store', Vary:'Cookie' } });
  } catch(error) { return domainErrorResponse(error); }
}
