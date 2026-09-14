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

async function readBoundedBody(request: Request, maxBytes: number) {
  if (!request.body) throw new Error("Image is empty.");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("asset upload exceeds scoped size limit").catch(() => undefined);
        throw new Error("Asset exceeds upload grant size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("Image is empty.");
  return Buffer.concat(chunks, total);
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

  const maxBytes = grant.maxBytes ?? 0;
  if (maxBytes < 1) {
    failUploadGrant(uploadId);
    return json({ error: "Upload grant has no usable size allowance." }, 409);
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    failUploadGrant(uploadId);
    return json({ error: "Asset exceeds upload grant size limit." }, 413);
  }

  try {
    const bytes = await readBoundedBody(request, maxBytes);
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
    const status = /size limit/i.test(message)
      ? 413
      : /format|PNG|JPEG|WebP|MIME|dimensions|corrupt/i.test(message)
        ? 415
        : 400;
    return json({ error: message }, status);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ uploadId: string }> },
) {
  return PUT(request, context);
}
