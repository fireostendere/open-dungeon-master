const SEAT_PREFIX = "odm-seat:";
const SEAT_SECRET = /^[0-9a-f]{48}$/;

function storageKey(name: string): string {
  return `${SEAT_PREFIX}${name.trim().toLowerCase()}`;
}

export function normalizeSeatSecret(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SEAT_SECRET.test(normalized) ? normalized : "";
}

export function readSeatSecret(name: string): string {
  if (typeof window === "undefined") return "";
  try {
    return normalizeSeatSecret(window.localStorage.getItem(storageKey(name)) ?? "");
  } catch {
    return "";
  }
}

export function rememberSeatSecret(name: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  const secret = normalizeSeatSecret(value);
  if (!secret) return false;
  try {
    window.localStorage.setItem(storageKey(name), secret);
    return true;
  } catch {
    return false;
  }
}

export function mintSeatSecret(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
