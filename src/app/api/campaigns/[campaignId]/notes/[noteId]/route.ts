import * as legacy from './legacy-handlers';
import { withEntityRequest } from '@/lib/spatial/domain-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ campaignId: string; noteId: string }> };
export async function PATCH(request: Request, context: Context) {
  const { campaignId, noteId } = await context.params;
  return withEntityRequest(request, campaignId, 'note', () => legacy.PATCH(request, context), noteId);
}
export async function DELETE(request: Request, context: Context) {
  const { campaignId, noteId } = await context.params;
  return withEntityRequest(request, campaignId, 'note', () => legacy.DELETE(request, context), noteId);
}
