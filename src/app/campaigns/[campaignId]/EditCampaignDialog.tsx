"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  CAMPAIGN_DIFFICULTIES,
  type CampaignCover as CampaignCoverRef,
  type CampaignDifficulty,
} from "@/lib/campaign-types";
import type { Campaign } from "@/lib/db/campaigns";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { CampaignCover, type CoverStatus } from "@/components/CampaignCover";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// Matches the characters page: polls every 2.5 s while a render is queued
// or generating, and gives up after the image backend's own timeout so a
// job the server never resolves cannot poll forever.
const COVER_POLL_MS = 2500;
const COVER_POLL_LIMIT = 240;

// A labelled field. The label sits on its own line above the control, with an
// optional counter on the right, so every control in the dialog lines up the
// same way whatever the label length.
function Field({ label, hint, className, children }: { label: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-stone-300">{label}</span>
        {hint ? <span className="text-[11px] tabular-nums text-stone-500">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

// A textarea that grows to fit what is typed, so no line of the premise is
// ever hidden behind an inner scrollbar (the text is larger on a phone).
function AutoTextarea({ value, onChange, minRows, maxLength }: { value: string; onChange: (value: string) => void; minRows: number; maxLength: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={minRows}
      maxLength={maxLength}
      className={cn(ui.input, "resize-none overflow-hidden leading-relaxed")}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 py-5 first:pt-0 last:pb-0">
      <h3 className={ui.sectionEyebrow}>{title}</h3>
      {children}
    </section>
  );
}

// Party-lead edit of the campaign's core settings, available in the lobby
// and mid-game (the DM prompt reads them fresh each turn); game settings
// (genre, dice, narration) live in GameSettingsPanel.
export function EditCampaignDialog({
  campaign,
  onClose,
}: {
  campaign: Pick<
    Campaign,
    "id" | "title" | "description" | "theme" | "maxPlayers" | "startingLevel" | "difficulty"
  > & {
    // Optional because the in-game settings panel hands over a narrower
    // shape than the lobby; the dialog fetches the live cover on open anyway.
    cover?: CampaignCoverRef | null;
    // Same reason: the preview falls back to the generic plate without it.
    genre?: string;
    status?: "lobby" | "active" | "ended";
    outcome?: "victory" | "defeat" | null;
  };
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { title: "Edit campaign", close: "Close", subtitle: "Title, premise, setting and the rules of the table", basics: "Basics", table: "Table", difficulties: { easy: "Easy", normal: "Normal", hard: "Hard", deadly: "Deadly" }, name: "Title", description: "Premise", setting: "Setting", players: "Player slots", level: "Starting level", difficulty: "Difficulty", cover: "Cover art", upload: "Upload", painting: "Painting", paint: "Paint one", remove: "Remove", coverFailed: "The cover did not paint. Try again, or upload one.", save: "Save changes", status: "Campaign status", active: "Active", ended: "Ended (concluded)", outcome: "How did it end?", victory: "Victory", defeat: "Defeat", endNote: "Ending closes any running fight, unrolled dice and open questions." },
    ru: { title: "Изменить кампанию", close: "Закрыть", subtitle: "Название, завязка, сеттинг и правила стола", basics: "Основное", table: "Стол", difficulties: { easy: "Лёгкая", normal: "Обычная", hard: "Высокая", deadly: "Смертельная" }, name: "Название", description: "Завязка", setting: "Сеттинг", players: "Места для игроков", level: "Стартовый уровень", difficulty: "Сложность", cover: "Обложка", upload: "Загрузить", painting: "Рисуем", paint: "Создать", remove: "Удалить", coverFailed: "Не удалось создать обложку. Повторите попытку или загрузите свою.", save: "Сохранить изменения", status: "Статус кампании", active: "В процессе", ended: "Завершена (финал)", outcome: "Чем всё закончилось?", victory: "Победа", defeat: "Поражение", endNote: "Завершение закроет идущий бой, неброшенные кубики и открытые вопросы." },
  });
  const [title, setTitle] = useState(campaign.title);
  const [description, setDescription] = useState(campaign.description);
  const [theme, setTheme] = useState(campaign.theme);
  const [maxPlayers, setMaxPlayers] = useState(campaign.maxPlayers);
  const [startingLevel, setStartingLevel] = useState(campaign.startingLevel);
  const [difficulty, setDifficulty] = useState<CampaignDifficulty>(campaign.difficulty);
  const [status, setStatus] = useState<"lobby" | "active" | "ended" | undefined>(campaign.status);
  const [outcome, setOutcome] = useState<"victory" | "defeat">(campaign.outcome ?? "victory");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Cover art. The dialog owns its own copy so a change shows here at once;
  // the table's snapshot catches up through campaign_updated.
  const [cover, setCover] = useState<CampaignCoverRef | null>(campaign.cover ?? null);
  const [coverStatus, setCoverStatus] = useState<CoverStatus>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState("");
  const pollCount = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const capabilities = useCapabilities();
  const coverPending = coverStatus === "queued" || coverStatus === "generating";

  // Opening the dialog mid-render (say, after a reload) should still show
  // the spinner, so the first thing it does is ask.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaign.id}/cover`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setCover(data.cover ?? null);
          setCoverStatus(data.status ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaign.id]);

  useEffect(() => {
    if (!coverPending || pollCount.current >= COVER_POLL_LIMIT) {
      return;
    }
    const id = setTimeout(() => {
      pollCount.current += 1;
      fetch(`/api/campaigns/${campaign.id}/cover`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) {
            setCover(data.cover ?? null);
            setCoverStatus(data.status ?? null);
          }
        })
        .catch(() => {});
    }, COVER_POLL_MS);
    return () => clearTimeout(id);
  }, [campaign.id, coverPending, coverStatus, cover]);

  async function coverRequest(method: "PATCH" | "POST" | "DELETE", body?: unknown) {
    setCoverBusy(true);
    setCoverError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/cover`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCoverError(data.error || "Could not change the cover.");
        return;
      }
      pollCount.current = 0;
      setCover(data.cover ?? null);
      setCoverStatus(data.status ?? null);
    } catch {
      setCoverError("Could not reach the server.");
    } finally {
      setCoverBusy(false);
    }
  }

  async function uploadCover(file: File) {
    setCoverBusy(true);
    setCoverError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const upload = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
      });
      const payload = await upload.json().catch(() => ({}));
      if (!upload.ok) {
        setCoverError(payload.error || "That image would not upload.");
        return;
      }
      await coverRequest("PATCH", { imageUrl: payload.url });
    } catch {
      setCoverError("That image would not upload.");
    } finally {
      setCoverBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // An ended campaign takes no info edits, only a corrected outcome.
        body: JSON.stringify(campaign.status === "ended"
          ? { status: "ended", outcome }
          : {
              title: title.trim(),
              description: description.trim(),
              theme: theme.trim(),
              maxPlayers,
              startingLevel,
              difficulty,
              ...(status && status !== campaign.status ? { status } : {}),
              ...(status === "ended" ? { outcome } : {}),
            }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not save the campaign settings.");
        return;
      }
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = ui.input;
  const segment = (on: boolean, tone: "amber" | "emerald" | "red" = "amber") =>
    cn(
      "min-h-10 flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition",
      on
        ? tone === "emerald"
          ? "border-emerald-500 bg-emerald-950/50 text-emerald-200"
          : tone === "red"
            ? "border-red-500 bg-red-950/50 text-red-200"
            : "border-amber-500 bg-amber-950/60 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
        : "border-stone-800 bg-stone-900/40 text-stone-400 hover:text-stone-200",
    );

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="panel fixed left-1/2 top-1/2 z-50 flex max-h-[92dvh] w-[min(94vw,36rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl">
          {/* The header and the save bar stay put; only the fields scroll. */}
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-800/70 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-lg tracking-wide text-amber-50">{copy.title}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-stone-400">{copy.subtitle}</Dialog.Description>
            </div>
            <Dialog.Close className="-mr-1.5 -mt-0.5 rounded-lg p-2 text-stone-400 transition hover:bg-stone-900 hover:text-stone-200" aria-label={copy.close}>
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col text-sm">
            <div className="min-h-0 flex-1 divide-y divide-stone-800/60 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
              <Section title={copy.basics}>
                <Field label={copy.name} hint={`${title.length}/80`}>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={80} className={inputClass} />
                </Field>
                <Field label={copy.description} hint={`${description.length}/500`}>
                  <AutoTextarea value={description} onChange={setDescription} minRows={4} maxLength={500} />
                </Field>
                <Field label={copy.setting} hint={`${theme.length}/120`}>
                  <AutoTextarea value={theme} onChange={setTheme} minRows={1} maxLength={120} />
                </Field>
              </Section>

              <Section title={copy.table}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={copy.players}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={8}
                      value={maxPlayers}
                      onChange={(event) => setMaxPlayers(Number(event.target.value))}
                      className={cn(inputClass, "h-10")}
                    />
                  </Field>
                  <Field label={copy.level}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={20}
                      value={startingLevel}
                      onChange={(event) => setStartingLevel(Number(event.target.value))}
                      className={cn(inputClass, "h-10")}
                    />
                  </Field>
                  <Field label={copy.difficulty} className="col-span-2 sm:col-span-1">
                    <select
                      value={difficulty}
                      onChange={(event) => setDifficulty(event.target.value as CampaignDifficulty)}
                      className={cn(inputClass, "h-10")}
                    >
                      {CAMPAIGN_DIFFICULTIES.map((value) => (
                        <option key={value} value={value}>
                          {copy.difficulties[value]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Section>

              <Section title={copy.cover}>
                <CampaignCover cover={cover} title={title || campaign.title} genre={campaign.genre} seed={campaign.id} status={coverStatus} />
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                      void uploadCover(file);
                    }
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={coverBusy || coverPending} onClick={() => fileInput.current?.click()} className={ui.btnSmall}>
                    {copy.upload}
                  </button>
                  {offersImages(capabilities) ? (
                    <button type="button" disabled={coverBusy || coverPending} onClick={() => void coverRequest("POST")} className={ui.btnSmall}>
                      {coverPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {coverPending ? copy.painting : copy.paint}
                    </button>
                  ) : null}
                  {cover ? (
                    <button type="button" disabled={coverBusy || coverPending} onClick={() => void coverRequest("DELETE")} className={ui.btnSmall}>
                      {copy.remove}
                    </button>
                  ) : null}
                </div>
                {coverStatus === "failed" ? <p className="text-xs text-red-400">{copy.coverFailed}</p> : null}
                {coverError ? <p className="text-xs text-red-400">{coverError}</p> : null}
              </Section>

              {campaign.status === "active" || campaign.status === "ended" ? (
                <Section title={copy.status}>
                  <div className="flex gap-2">
                    <button type="button" aria-pressed={status === "active"} onClick={() => setStatus("active")} className={segment(status === "active")}>
                      {copy.active}
                    </button>
                    <button type="button" aria-pressed={status === "ended"} onClick={() => setStatus("ended")} className={segment(status === "ended")}>
                      {copy.ended}
                    </button>
                  </div>
                  {status === "ended" ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-stone-300">{copy.outcome}</p>
                      <div className="flex gap-2">
                        {(["victory", "defeat"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setOutcome(value)}
                            aria-pressed={outcome === value}
                            className={segment(outcome === value, value === "victory" ? "emerald" : "red")}
                          >
                            {value === "victory" ? copy.victory : copy.defeat}
                          </button>
                        ))}
                      </div>
                      {campaign.status !== "ended" ? <p className="text-[11px] text-stone-500">{copy.endNote}</p> : null}
                    </div>
                  ) : null}
                </Section>
              ) : null}
            </div>

            <div className="shrink-0 space-y-2 border-t border-stone-800/70 bg-stone-950/40 px-5 py-4 sm:px-6">
              {error ? <p className="text-red-400">{error}</p> : null}
              <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "w-full")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {copy.save}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
