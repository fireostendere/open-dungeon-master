import { timingSafeEqual } from "node:crypto";
import { portalFromCookies, portalOrigin, type PortalTarget } from "@/lib/portal";

export type PortalConfiguration = {
  enabled?: string;
  origin?: string;
  token?: string;
};

/** Cookies are credentials, never configuration. Only a trusted local launcher
 * may opt into forwarding and pin the destination and bearer in server env.
 * Public server installs leave this disabled, even if cookies look valid.
 */
export function trustedPortalFromCookies(
  read: (name: string) => string | undefined,
  config: PortalConfiguration,
): PortalTarget | null {
  if (config.enabled !== "1") return null;
  const origin = portalOrigin(config.origin);
  const token = config.token ?? "";
  if (!origin || !/^[A-Za-z0-9_-]{16,512}$/.test(token)) return null;
  const supplied = portalFromCookies(read);
  if (!supplied || supplied.origin !== origin) return null;
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied.token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { origin, token };
}
