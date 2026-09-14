import { beginUploadGrant, failUploadGrant, finishUploadGrant } from "@/lib/db/asset-pipeline";
import { inspectImage } from "@/lib/assets/image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearer(request: Request) {
  const raw = request.headers.get("authorization") ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  const { uploadId } = await params;
  const token = bearer(request);
  if (!token) return json({ error: "Missing upload grant." }, 401);

  let grant: ReturnType<typeof beginUploadGrant>;
  try {
    grant = beginUploadGrant(uploadId, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid upload grant.";
    const status = /expired|already/i.test(message) ? 409 : 401;
    return json({ error: message }, status);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 0 && grant.maxBytes != null && declaredLength > grant.maxBytes) {
    failUploadGrant(uploadId);
    return json({ error: "Asset exceeds upload grant size limit." }, 413);
  }

  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length) throw new Error("Image is empty.");
    if (grant.maxBytes != null && bytes.length > grant.maxBytes) {
      failUploadGrant(uploadId);
      return json({ error: "Asset exceeds upload grant size limit." }, 413);
    }
    const inspected = inspectImage(bytes);
    if (grant.expectedMimeType && inspected.mimeType !== grant.expectedMimeType) {
      throw new Error("Uploaded image MIME does not match the upload grant.");
    }
    const completed = finishUploadGrant(uploadId, inspected, bytes);
    return json(
      {
        ok: true,
        uploadId,
        uploaded: {
          mimeType: completed.mimeType,
          byteSize: completed.byteSize,
          width: completed.width,
          height: completed.height,
          sha256: completed.sha256,
        },
      },
      201,
    );
  } catch (error) {
    failUploadGrant(uploadId);
    const message = error instanceof Error ? error.message : "Invalid image upload.";
    const status = /size limit/i.test(message) ? 413 : /format|PNG|JPEG|WebP|MIME|dimensions|corrupt/i.test(message) ? 415 : 400;
    return json({ error: message }, status);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ uploadId: string }> },
) {
  return PUT(request, context);
}
