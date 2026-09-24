"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import {
  Camera,
  Copy,
  FileDown,
  FileJson,
  Hammer,
  ImageOff,
  Loader2,
  Pencil,
  Sparkles,
  Swords,
} from "lucide-react";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { AppHeader } from "@/components/AppHeader";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { cn } from "@/lib/cn";
import { downloadBlob, filenameSlug } from "@/lib/download";
import { downloadCharacterSheetPdf } from "@/lib/pdf/download";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { CharacterPortrait, ui } from "@/lib/ui";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { SheetSections, StorySoFar, type CharacterEvent } from "./SheetSections";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { characterDisplay } from "@/lib/i18n/character-display";

// Where this character is playing; see src/lib/db/characters.ts.
type CharacterAssignment = {
  campaignId: string;
  title: string;
  kind: "campaign" | "workshop";
  status: string;
};

type LibraryCharacter = {
  id: string;
  name: string;
  race: string;
  class: string;
  subclass: string;
  background: string;
  level: number;
  xp: number;
  portraitStatus?: "queued" | "generating" | "failed" | null;
  campaigns?: CharacterAssignment[];
  sheet: CreateSheetInput;
  updatedAt: string;
};

// Matches the ComfyUI generation timeout; polling stops even if the server
// never resolves the job.
const PORTRAIT_POLL_LIMIT = 240;

export default function CharacterDetailPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const uiText = useInlineText();
  const { characterId } = use(params);
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { back: "Back to your characters", level: "Level", notInCampaign: "Not in a campaign yet.", preparing: "Preparing...", download: "Download PDF", exporting: "Exporting...", export: "Export", exportFailed: "Export failed.", copying: "Copying...", duplicate: "Duplicate", edit: "Edit backstory", editTip: "Edit this character's backstory", replacePortrait: "Replace portrait", uploadPortrait: "Upload portrait", painting: "Painting...", paint: "Paint one", placeholder: "Use placeholder", portraitFailed: "Portrait couldn't be generated.", notFound: "Character not found.", library: "Back to your library" },
    ru: { back: "Назад к персонажам", level: "Уровень", notInCampaign: "Пока не участвует в кампании.", preparing: "Подготовка...", download: "Скачать PDF", exporting: "Экспорт...", export: "Экспорт", exportFailed: "Не удалось экспортировать персонажа.", copying: "Копирование...", duplicate: "Дублировать", edit: "Изменить предысторию", editTip: "Редактировать предысторию персонажа", replacePortrait: "Сменить портрет", uploadPortrait: "Загрузить портрет", painting: "Создание...", paint: "Создать", placeholder: "Стандартный портрет", portraitFailed: "Не удалось создать портрет.", notFound: "Персонаж не найден.", library: "Вернуться в библиотеку" },
  });
  const [character, setCharacter] = useState<LibraryCharacter | null>(null);
  const [events, setEvents] = useState<CharacterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [cropping, setCropping] = useState(false);
  const [painting, setPainting] = useState(false);
  const [portraitError, setPortraitError] = useState("");
  // "Paint one" only where the server has an image model to paint with.
  const canPaint = offersImages(useCapabilities());
  const pollCount = useRef(0);

  async function handleDownloadPdf() {
    if (!character) {
      return;
    }
    setPdfBusy(true);
    try {
      // The PDF builder (pdf-lib) loads on demand; see lib/pdf/download.
      const { libraryToPdfCharacter } = await import("@/lib/pdf/character-sheet-pdf");
      await downloadCharacterSheetPdf(libraryToPdfCharacter(character));
    } finally {
      setPdfBusy(false);
    }
  }

  // The whole character as one JSON file, portrait inlined, for carrying to
  // another device or server (see src/lib/character-bundle.ts).
  async function handleExport() {
    if (!character) {
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch(`/api/characters/${characterId}/export`);
      if (!response.ok) {
        setExportError(copy.exportFailed);
        return;
      }
      downloadBlob(`${filenameSlug(character.name)}.odm-character.json`, await response.blob());
    } catch {
      setExportError(copy.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  // Same portrait-only PATCH the library list uses; a manual upload is
  // authoritative and replaces whatever was painted.
  async function handlePortraitUploaded(portrait: {
    id: string;
    name: string;
    type: string;
    url: string;
  }) {
    setCropping(false);
    const response = await fetch(`/api/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait }),
    });
    if (response.ok) {
      setCharacter((current) =>
        current
          ? { ...current, portraitStatus: null, sheet: { ...current.sheet, portrait } }
          : current,
      );
    }
  }

  // The third choice beside upload and paint: no picture at all, which shows
  // the stand-in plate for the class or race (src/lib/placeholders.ts).
  async function clearToPlaceholder() {
    setPortraitError("");
    const response = await fetch(`/api/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait: null }),
    });
    if (response.ok) {
      setCharacter((current) =>
        current
          ? { ...current, portraitStatus: null, sheet: { ...current.sheet, portrait: null } }
          : current,
      );
    }
  }

  // Queues a fresh render; the poll that watches creation renders picks up
  // the result the same way.
  async function paintPortrait() {
    setPortraitError("");
    setPainting(true);
    try {
      const response = await fetch(`/api/characters/${characterId}/portrait`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setPortraitError(data.error ?? "Could not queue the portrait.");
        return;
      }
      setCharacter((current) =>
        current
          ? { ...current, portraitStatus: "queued", sheet: { ...current.sheet, portrait: null } }
          : current,
      );
    } finally {
      setPainting(false);
    }
  }

  // A second copy under a numbered name, sheet and portrait verbatim. The
  // roster is where copies live, so that is where this lands.
  async function handleDuplicate() {
    setCloning(true);
    try {
      const response = await fetch(`/api/characters/${characterId}/clone`, { method: "POST" });
      if (response.ok) {
        navigateTo("/characters");
      }
    } finally {
      setCloning(false);
    }
  }

  useEffect(() => {
    fetch(`/api/characters/${characterId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.character) {
          setCharacter(data.character);
          setEvents(data.events ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [characterId]);

  // While the portrait renders in the background, re-fetch until it lands.
  const portraitPending =
    character?.portraitStatus === "queued" || character?.portraitStatus === "generating";
  useEffect(() => {
    if (!portraitPending || pollCount.current >= PORTRAIT_POLL_LIMIT) {
      return;
    }
    const id = setTimeout(() => {
      pollCount.current += 1;
      fetch(`/api/characters/${characterId}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.character) {
            setCharacter(data.character);
          }
        });
    }, 2500);
    return () => clearTimeout(id);
  }, [portraitPending, character, characterId]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <AppHeader />
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  if (!character) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <AppHeader />
        <p className={cn(ui.card, "p-6 text-center text-stone-400")}>
           {copy.notFound}{" "}
          <Link href="/characters" className="text-amber-200 hover:text-amber-400">
             {copy.library}
          </Link>
        </p>
      </main>
    );
  }

  const sheet = character.sheet;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <AppHeader />
      <header className={cn(ui.card, "ornate mb-4 p-4 sm:p-5")}>
        <Link href="/characters" className="text-sm text-stone-500 hover:text-stone-300">
          &larr; {copy.back}
        </Link>
        <div className="mt-3 flex items-start gap-4">
          {sheet.portrait?.url ? (
            <ImageLightbox
              src={sheet.portrait.url}
              alt={character.name}
              caption={character.name}
              className="size-20 shrink-0 rounded-xl border border-amber-500/30 object-cover shadow-glow-gold sm:size-24"
            />
          ) : portraitPending ? (
            <span
              title={uiText("Painting portrait...")}
              className="flex size-20 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-stone-900 sm:size-24"
            >
              <Loader2 className="size-5 animate-spin text-amber-200" />
            </span>
          ) : (
            <CharacterPortrait
              look={{ race: character.race, class: character.class, gender: sheet.gender }}
              alt={character.name}
              size="size-20 sm:size-24"
              rounded="rounded-xl"
              className="border-amber-500/30 shadow-glow-gold"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl tracking-wide text-amber-50 sm:text-3xl">
              {character.name}
            </h1>
            <p className="mt-1 text-sm text-stone-400">
              <span className="mr-1.5 inline-flex rounded-full border border-amber-500/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                 {copy.level} {character.level}
              </span>
               {characterDisplay(character.race, locale)} {characterDisplay(character.class, locale)}
               {character.subclass ? ` (${characterDisplay(character.subclass, locale)})` : ""}
               {character.background ? ` · ${characterDisplay(character.background, locale)}` : ""}
            </p>
            {!sheet.portrait && character.portraitStatus === "failed" ? (
               <p className="mt-1 text-xs text-stone-500">{copy.portraitFailed}</p>
            ) : null}
            {/* Each campaign holds its own copy of this sheet, so one library
                entry can be at several tables at once. Naming them is what
                makes "which game is this one in?" answerable. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {character.campaigns?.length ? (
                character.campaigns.map((assignment) => (
                  <Link
                    key={assignment.campaignId}
                    href={
                      assignment.kind === "workshop"
                        ? `/workshop/${assignment.campaignId}`
                        : `/campaigns/${assignment.campaignId}`
                    }
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-600/60 bg-stone-900/60 px-2.5 py-1 text-xs text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-100"
                  >
                    {assignment.kind === "workshop" ? (
                      <Hammer className="size-3.5 shrink-0 text-amber-300/70" />
                    ) : (
                      <Swords className="size-3.5 shrink-0 text-amber-300/70" />
                    )}
                    <span className="truncate">{assignment.title}</span>
                  </Link>
                ))
              ) : (
                <span className="text-xs text-stone-600">{copy.notInCampaign}</span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-700/40 pt-3">
          <Link
            href={`/characters/${characterId}/edit`}
            className={cn(ui.btnSmall, "border-amber-500/40 text-amber-100")}
            title={copy.editTip}
          >
            <Pencil className="size-4 shrink-0" /> {copy.edit}
          </Link>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfBusy}
            className={ui.btnSmall}
            title={uiText("Download this character sheet as a fillable PDF")}
          >
            <FileDown className="size-4 shrink-0" /> {pdfBusy ? copy.preparing : copy.download}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className={ui.btnSmall}
            title={uiText("Save this character as a file you can import on another device or server")}
          >
            <FileJson className="size-4 shrink-0" /> {exporting ? copy.exporting : copy.export}
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={cloning}
            className={ui.btnSmall}
            title={uiText("Save a second copy of this character to your library")}
          >
            <Copy className="size-4 shrink-0" /> {cloning ? copy.copying : copy.duplicate}
          </button>
          <button
            type="button"
            onClick={() => setCropping(true)}
            className={ui.btnSmall}
            title={sheet.portrait ? uiText("Replace the portrait with a photo") : uiText("Upload a portrait")}
          >
            <Camera className="size-4 shrink-0" /> {sheet.portrait ? copy.replacePortrait : copy.uploadPortrait}
          </button>
          {canPaint ? (
            <button
              type="button"
              onClick={() => void paintPortrait()}
              disabled={painting || portraitPending}
              className={ui.btnSmall}
              title={uiText("Paint a new portrait on this server's image model")}
            >
              <Sparkles className="size-4 shrink-0" /> {portraitPending ? copy.painting : copy.paint}
            </button>
          ) : null}
          {sheet.portrait ? (
            <button
              type="button"
              onClick={() => void clearToPlaceholder()}
              className={ui.btnSmall}
              title={uiText("Take the picture away and show the stand-in for this class or race")}
            >
              <ImageOff className="size-4 shrink-0" /> {copy.placeholder}
            </button>
          ) : null}
        </div>
        {exportError ? <p className="mt-2 text-sm text-red-400">{exportError}</p> : null}
        {portraitError ? <p className="mt-2 text-sm text-red-400">{portraitError}</p> : null}
      </header>

      <SheetSections sheet={sheet} />
      <div className="mt-4">
        <StorySoFar events={events} />
      </div>

      {cropping ? (
        <AvatarCropDialog
          title={uiText("Portrait for {name}", { name: character.name })}
          onUploaded={(image) => void handlePortraitUploaded(image)}
          onClose={() => setCropping(false)}
        />
      ) : null}
    </main>
  );
}
