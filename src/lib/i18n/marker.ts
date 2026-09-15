const MARKER_START = "\uE000i18n:";
const MARKER_END = "\uE001";

export type I18nParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Emits a stable marker that is identical during SSR and hydration.
 * I18nMarkerBoundary resolves the marker through the locale catalogs once the
 * document is mounted. This keeps key-based UI copy usable from both server
 * and client components without turning every component into a client hook.
 */
export function i18nText(key: string, params?: I18nParams): string {
  if (!params || Object.keys(params).length === 0) {
    return `${MARKER_START}${key}${MARKER_END}`;
  }
  const payload = encodeURIComponent(JSON.stringify(params));
  return `${MARKER_START}${key}|${payload}${MARKER_END}`;
}

export function parseI18nMarker(value: string): { key: string; params?: I18nParams } | null {
  if (!value.startsWith(MARKER_START) || !value.endsWith(MARKER_END)) {
    return null;
  }
  const payload = value.slice(MARKER_START.length, -MARKER_END.length);
  const separator = payload.indexOf("|");
  const key = separator === -1 ? payload : payload.slice(0, separator);
  if (!key || !/^[a-z0-9_.-]+$/i.test(key)) {
    return null;
  }
  if (separator === -1) {
    return { key };
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(payload.slice(separator + 1))) as I18nParams;
    return { key, params: parsed };
  } catch {
    return { key };
  }
}
