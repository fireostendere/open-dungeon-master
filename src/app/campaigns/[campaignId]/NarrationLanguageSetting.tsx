"use client";

import { useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { isLocale, type Locale } from "@/lib/i18n/translations";
import { sessionText } from "@/lib/i18n/session-text";
import { sessionRequest } from "@/lib/i18n/session-request";
import { ui } from "@/lib/ui";

/** Render only for the story authority; the PATCH route enforces permission. */
export function NarrationLanguageSetting({ campaignId, language }: {
  campaignId: string;
  language?: Locale | "pl";
}) {
  const { locale } = useI18n();
  const [choice, setChoice] = useState<Locale | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ prior: Locale | "pl" | undefined; value: Locale } | null>(null);
  const pending = useRef(false);
  const acknowledged = receipt?.prior === language ? receipt?.value : null;
  const value = choice ?? acknowledged ?? (isLocale(language) ? language : "");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !isLocale(value)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await sessionRequest(locale, "narrationFailed", `/api/campaigns/${encodeURIComponent(campaignId)}/settings`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: value }),
      });
      const settings = result.gameSettings as { language?: unknown } | undefined;
      if (settings?.language !== value) throw new Error(sessionText(locale, "narrationFailed"));
      setReceipt({ prior: language, value });
      setChoice(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : sessionText(locale, "narrationFailed"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-1 border-t border-stone-800 px-3 py-2" aria-busy={busy}>
      <label className="flex flex-wrap items-center gap-2 text-xs text-stone-300">
        <span>{sessionText(locale, "narrationLanguage")}</span>
        <select value={value} disabled={busy} className="rounded border border-stone-700 bg-stone-950 p-1"
          onChange={(event) => { if (isLocale(event.target.value)) { setChoice(event.target.value); setError(""); } }}>
          {!value ? <option value="" disabled>—</option> : null}
          <option value="ru">{sessionText(locale, "russian")}</option>
          <option value="en">{sessionText(locale, "english")}</option>
        </select>
        <button type="submit" className={ui.btnSmall} disabled={busy || !choice || choice === language}>
          {sessionText(locale, "save")}
        </button>
      </label>
      <p className="text-[11px] text-stone-500">{sessionText(locale, "narrationHelp")}</p>
      {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
      {!error && receipt?.value === value && !choice ? <p role="status" className="text-xs text-stone-400">{sessionText(locale, "saved")}</p> : null}
    </form>
  );
}
