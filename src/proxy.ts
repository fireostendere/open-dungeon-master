import { NextResponse, type NextRequest } from "next/server";
import { allowedAppOrigin, appCorsHeaders, extraAppOrigins, isPreflight } from "@/lib/app-cors";
import {
  PORTAL_LOGOUT_PATH,
  PORTAL_ORIGIN_COOKIE,
  PORTAL_TOKEN_COOKIE,
  forwardHeaders,
  isPortalPath,
  portalTargetUrl,
} from "@/lib/portal";
import { trustedPortalFromCookies } from "@/lib/portal-trust";

// Two doors for the desktop and Android apps, both on the data paths only:
//
// - App origins (src/lib/app-cors.ts): the apps' native screens call the
//   API directly with a bearer token from a foreign origin, so those
//   origins get CORS headers and their preflights an empty 204.
// - Portal mode: explicitly enabled by a trusted local launcher with a
//   server-pinned destination and bearer. Client cookies cannot enable it
//   or change the destination; public server installs leave it disabled.
//
// Without an app origin or the portal cookies nothing here changes.

const extra = extraAppOrigins(process.env.ODM_APP_ORIGINS);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const appOrigin = allowedAppOrigin(request.headers.get("origin"), extra);

  if (appOrigin && isPreflight(request.method, request.headers.get("access-control-request-method"))) {
    const preflight = new NextResponse(null, { status: 204 });
    for (const [name, value] of appCorsHeaders(appOrigin)) preflight.headers.set(name, value);
    return preflight;
  }

  let response: NextResponse;
  const target = trustedPortalFromCookies((name) => request.cookies.get(name)?.value, {
    enabled: process.env.ODM_LOCAL_PORTAL,
    origin: process.env.ODM_PORTAL_ORIGIN,
    token: process.env.ODM_PORTAL_TOKEN,
  });
  if (target && isPortalPath(pathname)) {
    const headers = new Headers();
    for (const [name, value] of forwardHeaders(request.headers, target.token)) {
      headers.set(name, value);
    }
    response = NextResponse.rewrite(portalTargetUrl(target.origin, pathname, search), {
      request: { headers },
    });
    // Logging out on the host ends the portal too: the app watches these
    // cookies and returns to its home screen when they go.
    if (pathname === PORTAL_LOGOUT_PATH && request.method === "POST") {
      for (const name of [PORTAL_ORIGIN_COOKIE, PORTAL_TOKEN_COOKIE]) {
        response.cookies.set(name, "", { path: "/", maxAge: 0 });
      }
    }
  } else {
    response = NextResponse.next();
  }

  if (appOrigin) {
    for (const [name, value] of appCorsHeaders(appOrigin)) response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/uploads/:path*",
    "/generated/:path*",
    "/generated-audio/:path*",
    "/ambience/:path*",
    "/assets/:path*",
    "/dice-box/:path*",
    "/sidebar-icons/:path*",
  ],
};
