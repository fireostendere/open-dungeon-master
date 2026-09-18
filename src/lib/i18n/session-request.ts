import { sessionRequestError, sessionText, type SessionTextKey } from "./session-text";
import type { Locale } from "./translations";

export class SessionRequestError extends Error {
  readonly status: number;
  readonly data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.name = "SessionRequestError";
    this.status = status;
    this.data = data;
  }
}

/** Locale applies only to the feedback; it never changes the request payload. */
export async function sessionRequest(
  locale: Locale, failure: SessionTextKey, url: string, init?: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new SessionRequestError(sessionText(locale, "networkFailed"), 0, {}); }
  const parsed: unknown = await response.json().catch(() => ({}));
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : {};
  if (!response.ok) {
    throw new SessionRequestError(sessionRequestError(locale, failure, response.status), response.status, data);
  }
  return data;
}
