import * as legacy from './legacy-handlers';
import { withEntityRequest } from '@/lib/spatial/domain-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = legacy.GET;
export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await context.params;
  return withEntityRequest(request, campaignId, 'note', () => legacy.POST(request, context));
}
