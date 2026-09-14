import { assetStorage } from "@/lib/assets/storage";
import { consumeDownloadGrant } from "@/lib/db/asset-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(request: Request) {
  const raw = request.headers.get("authorization") ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ downloadId: string }> },
) {
  const token = bearer(request);
  if (!token) return Response.json({ error: "Missing download grant." }, { status: 401 });
  const { downloadId } = await params;
  try {
    const asset = consumeDownloadGrant(downloadId, token);
    const bytes = assetStorage().read(asset.storageKey);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename=\"${asset.filename.replace(/[\"\\]/g, "_")}\"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download unavailable.";
    const status = /expired|already/i.test(message) ? 409 : /not found|unavailable/i.test(message) ? 404 : 401;
    return Response.json({ error: message }, { status });
  }
}
