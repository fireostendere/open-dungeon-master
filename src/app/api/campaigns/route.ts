import { GET as coreGET, POST as corePOST } from "./route-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CampaignLocale = "ru" | "en" | "pl";

export async function GET() {
  return coreGET();
}

function localeFromCookie(request: Request): CampaignLocale {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)odm_locale=(ru|en|pl)(?:;|$)/);
  return match?.[1] === "en" || match?.[1] === "pl" ? match[1] : "ru";
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const currentSettings =
    body.gameSettings && typeof body.gameSettings === "object"
      ? (body.gameSettings as Record<string, unknown>)
      : {};
  const language =
    currentSettings.language === "en" ||
    currentSettings.language === "ru" ||
    currentSettings.language === "pl"
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
