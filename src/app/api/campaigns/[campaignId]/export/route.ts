import { z } from 'zod';
import { isErrorResponse, requireMember } from '@/lib/campaign-api';
import { buildStoryDocument, exportFilename } from '@/lib/export/story-document';
import { renderStoryHtml } from '@/lib/export/html';
import { renderStoryOdt } from '@/lib/export/odt';
import { renderStoryDocx } from '@/lib/export/docx';
import { domainErrorResponse } from '@/lib/spatial/domain-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const formatSchema = z.enum(['html','odt','docx']).catch('html');
const CONTENT_TYPES = { html:'text/html; charset=utf-8', odt:'application/vnd.oasis.opendocument.text', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as const;
export async function GET(request: Request,{ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if(isErrorResponse(context)) return context;
  try {
    const format = formatSchema.parse(new URL(request.url).searchParams.get('format') ?? 'html');
    const doc = buildStoryDocument(campaignId,context.user.id);
    if(!doc) return Response.json({error:'Campaign not found.'},{status:404});
    const body = format==='html' ? renderStoryHtml(doc) : format==='odt' ? await renderStoryOdt(doc) : await renderStoryDocx(doc);
    return new Response(body as BodyInit,{headers:{
      'Content-Type':CONTENT_TYPES[format],
      'Content-Disposition':`attachment; filename="${exportFilename(doc,format)}"`,
      'Cache-Control':'private, no-store', Vary:'Cookie',
    }});
  } catch(error) { return domainErrorResponse(error); }
}
