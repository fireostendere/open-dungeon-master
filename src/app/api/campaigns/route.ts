import { GET as coreGET, POST as corePOST } from "./route-core";

export { dynamic, runtime } from "./route-core";

export const GET = coreGET;

function localeFromCookie(request: Request): "ru" | "en" {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)odm_locale=(ru|en)(?:;|$)/);
  return match?.[1] === "en" ? "en" : "ru";
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const currentSettings =
    body.gameSettings && typeof body.gameSettings === "object"
      ? (body.gameSettings as Record<string, unknown>)
      : {};
  const language =
    currentSettings.language === "en" || currentSettings.language === "ru"
      ? currentSettings.language
      : localeFromCookie(request);

  const forwarded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({
      ...body,
      gameSettings: { ...currentSettings, language },
    }),
  });
  return corePOST(forwarded);
}
