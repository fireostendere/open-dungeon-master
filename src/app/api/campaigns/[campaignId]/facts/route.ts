import * as legacy from './legacy-handlers';
import { withEntityRequest } from '@/lib/spatial/domain-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = legacy.GET;
type Context = { params: Promise<{ campaignId: string }> };
export async function POST(request: Request, context: Context) {
  const { campaignId } = await context.params;
  return withEntityRequest(request, campaignId, 'fact', () => legacy.POST(request, context));
}
export async function PATCH(request: Request, context: Context) {
  const { campaignId } = await context.params;
  const body = await request.clone().json().catch(() => ({}));
  return withEntityRequest(request, campaignId, 'fact', () => legacy.PATCH(request, context), typeof body.factId === 'string' ? body.factId : undefined);
}
