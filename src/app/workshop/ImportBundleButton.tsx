"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { ui } from "@/lib/ui";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { BUNDLE_KIND_LABELS, MAX_BUNDLE_BYTES } from "@/lib/workshop/bundle";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// Opening somebody else's workshop.
//
// Two steps on purpose. The preview reads the file and validates it without
// writing anything, so what a DM agrees to is a named thing with counts and
// a licensing notice rather than a filename. The second press is what
// creates the workshop.

type Preview = {
  manifest: { name: string; blurb: string; author: string; inspiredBy: string; rightsHolder: string };
  counts: Record<string, number>;
  houseRules?: boolean;
  warnings: string[];
};

// The kinds a preview offers, in the order the counts came: every kind with
// something in it, and the house rules when the bundle carries any.
function kindsOf(preview: Preview): string[] {
  const kinds = Object.entries(preview.counts)
    .filter(([, count]) => count > 0)
    .map(([kind]) => kind);
  return preview.houseRules ? [...kinds, "rules"] : kinds;
}

// `label` and `className` let the hub header show the same control as a
// small "Import a bundle" action; the shelf keeps the defaults.
export function ImportBundleButton({
  label,
  className = ui.btnSecondary,
}: {
  label?: string;
  className?: string;
} = {}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { open: "Open a bundle", unreadable: "That bundle could not be read.", importFailed: "That bundle could not be imported.", by: "by", note: "This creates a new workshop of your own. Nothing is written into any campaign you already have.", empty: "Import an empty workshop", import: "Import it", cancel: "Cancel" }, ru: { open: "Открыть набор", unreadable: "Не удалось прочитать этот набор.", importFailed: "Не удалось импортировать этот набор.", by: "автор: ", note: "Это создаст новую мастерскую. Ни одна из ваших существующих кампаний не будет изменена.", empty: "Импортировать пустую мастерскую", import: "Импортировать", cancel: "Отмена" } });
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  // Which kinds to take. Everything the bundle offers, until unticked.
  const [kinds, setKinds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/workshops/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error ?? copy.unreadable);
    }
    return data;
  }

  async function pick(file: File | undefined) {
    if (!file) {
      return;
    }
    setError("");
    setPreview(null);
    // Checked here as well as on the server: reading a gigabyte into memory
    // to be told no is a bad experience even when the answer is correct.
    if (file.size > MAX_BUNDLE_BYTES) {
      setError(`That file is larger than ${MAX_BUNDLE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setBusy(true);
    try {
      const contents = await file.text();
      const data = await post({ text: contents, preview: true });
      setText(contents);
      setPreview(data);
      setKinds(kindsOf(data));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : copy.unreadable);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const data = await post({ text, kinds });
      navigateTo(`/workshop/${data.workshopId}`);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : copy.importFailed);
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={className}
      >
        {busy && !preview ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        {label ?? copy.open}
      </button>

      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}

      {preview ? (
        <div className={`${ui.card} mt-3 p-4`}>
          <p className="font-display tracking-wide text-amber-50">{preview.manifest.name}</p>
          <p className="text-sm text-stone-400">{preview.manifest.blurb}</p>
          {preview.manifest.author ? (
            <p className="mt-0.5 text-xs text-stone-500">{copy.by}{preview.manifest.author}</p>
          ) : null}

          {/* Each kind is a tick: a DM who only wants the monsters takes the
              monsters. Unticking every one leaves an empty workshop, which
              the button below says out loud. */}
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {kindsOf(preview).map((kind) => {
              const ticked = kinds.includes(kind);
              return (
                <li key={kind}>
                  <label
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                      ticked
                        ? "border-amber-700 bg-amber-950/40 text-amber-100"
                        : "border-stone-700 text-stone-500"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={(event) =>
                        setKinds((current) =>
                          event.target.checked
                            ? [...current, kind]
                            : current.filter((entry) => entry !== kind),
                        )
                      }
                      className="accent-amber-500"
                    />
                    {kind === "rules" ? "" : `${preview.counts[kind]} `}
                    {BUNDLE_KIND_LABELS[kind] ?? kind}
                  </label>
                </li>
              );
            })}
          </ul>

          <UnofficialPackNotice
            rightsHolder={preview.manifest.rightsHolder}
            inspiredBy={preview.manifest.inspiredBy}
            className="mt-3"
          />

          {preview.warnings.length ? (
            <ul className="mt-3 space-y-1">
              {preview.warnings.map((warning) => (
                <li key={warning} className="text-xs text-amber-200/80">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 text-xs text-stone-500">
            {copy.note}
          </p>

          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void confirm()} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}{" "}
              {kinds.length === 0
                ? copy.empty
                : kinds.length === kindsOf(preview).length
                  ? copy.import
                  : `Import ${kinds.length} of ${kindsOf(preview).length} kinds`}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setText("");
              }}
              className={ui.btnSecondary}
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
