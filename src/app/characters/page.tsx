"use client";

import {
  Camera,
  Copy,
  FileUp,
  Hammer,
  Loader2,
  Plus,
  Swords,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { AppHeader } from "@/components/AppHeader";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { CharacterPortrait, IconChip, PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

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
  updatedAt: string;
  portraitStatus?: "queued" | "generating" | "failed" | null;
  campaigns?: CharacterAssignment[];
  sheet?: { portrait?: { url: string } | null; gender?: string };
};

function portraitPending(character: LibraryCharacter) {
  return character.portraitStatus === "queued" || character.portraitStatus === "generating";
}

const PORTRAIT_POLL_LIMIT = 240;

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function CharactersPage() {
  const { locale, t } = useI18n();
  const copy = localeText(locale, {
    en: {
      loginPrefix: "Log in",
      loginSuffix: "to see your character library.",
      title: "Your characters",
      subtitle: "Saved to your profile; bring them into any campaign.",
      importTitle: "Import a character file exported from this or another server",
      import: "Import character",
      newCharacter: "New character",
      notJson: "is not a JSON file.",
      importFailed: "Import failed.",
      deletePrefix: "Delete",
      deleteSuffix: "from your library? This cannot be undone.",
      emptyTitle: "No heroes in the roster yet.",
      emptyBody: "Create one here, or one is saved automatically when you join a campaign.",
      roster: "Roster",
      portraitFor: "Portrait for",
    },
    ru: {
      loginPrefix: "Войдите",
      loginSuffix: "чтобы увидеть свою библиотеку персонажей.",
      title: "Ваши персонажи",
      subtitle: "Они сохранены в профиле и доступны для любой кампании.",
      importTitle: "Импортировать файл персонажа, экспортированный с этого или другого сервера",
      import: "Импорт персонажа",
      newCharacter: "Новый персонаж",
      notJson: "не является JSON-файлом.",
      importFailed: "Не удалось импортировать персонажа.",
      deletePrefix: "Удалить",
      deleteSuffix: "из вашей библиотеки? Это действие нельзя отменить.",
      emptyTitle: "В списке пока нет героев.",
      emptyBody: "Создайте персонажа здесь или присоединитесь к кампании — тогда он сохранится автоматически.",
      roster: "Список",
      portraitFor: "Портрет для",
    },
    pl: {
      loginPrefix: "Zaloguj się",
      loginSuffix: "aby zobaczyć swoją bibliotekę postaci.",
      title: "Twoje postacie",
      subtitle: "Są zapisane w profilu i możesz zabrać je do dowolnej kampanii.",
      importTitle: "Zaimportuj plik postaci wyeksportowany z tego lub innego serwera",
      import: "Importuj postać",
      newCharacter: "Nowa postać",
      notJson: "nie jest plikiem JSON.",
      importFailed: "Import nie powiódł się.",
      deletePrefix: "Usuń",
      deleteSuffix: "z biblioteki? Tej operacji nie można cofnąć.",
      emptyTitle: "W spisie nie ma jeszcze bohaterów.",
      emptyBody: "Utwórz postać tutaj albo dołącz do kampanii — wtedy zostanie zapisana automatycznie.",
      roster: "Spis",
      portraitFor: "Portret dla",
    },
  });
  const [characters, setCharacters] = useState<LibraryCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [croppingId, setCroppingId] = useState("");
  const [cloningId, setCloningId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const cropping = characters.find((character) => character.id === croppingId);
  const pollCount = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/characters")
      .then((response) => {
        if (response.status === 401) {
          setAuthed(false);
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then((data) => {
        if (data?.characters) setCharacters(data.characters);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!characters.some(portraitPending) || pollCount.current >= PORTRAIT_POLL_LIMIT) return;
    const id = setTimeout(() => {
      pollCount.current += 1;
      fetch("/api/characters")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.characters) setCharacters(data.characters);
        });
    }, 2500);
    return () => clearTimeout(id);
  }, [characters]);

  async function setPortrait(id: string, url: string) {
    const response = await fetch(`/api/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait: { url } }),
    });
    if (response.ok) {
      setCharacters((current) =>
        current.map((character) =>
          character.id === id
            ? { ...character, sheet: { ...character.sheet, portrait: { url } } }
            : character,
        ),
      );
    }
  }

  async function duplicate(id: string) {
    setCloningId(id);
    try {
      const response = await fetch(`/api/characters/${id}/clone`, { method: "POST" });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      if (data.character) setCharacters((current) => [data.character, ...current]);
    } finally {
      setCloningId("");
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    setImportError("");
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setImportError(`${file.name} ${copy.notJson}`);
        return;
      }
      const response = await fetch("/api/characters/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setImportError(data.error || copy.importFailed);
        return;
      }
      if (data.character) setCharacters((current) => [data.character, ...current]);
    } catch {
      setImportError(copy.importFailed);
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`${copy.deletePrefix} ${name} ${copy.deleteSuffix}`)) return;
    const response = await fetch(`/api/characters/${id}`, { method: "DELETE" });
    if (response.ok) {
      setCharacters((current) => current.filter((character) => character.id !== id));
    }
  }

  if (!authed) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <p className={cn(ui.card, "p-6 text-center text-stone-400")}>
          <Link href="/" className="text-amber-200 hover:text-amber-400">{copy.loginPrefix}</Link>{" "}
          {copy.loginSuffix}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <AppHeader />
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="font-display text-xl tracking-wide text-amber-50">{copy.title}</h1>
            <p className="text-sm text-stone-500">{copy.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => importInput.current?.click()}
            disabled={importing}
            className={ui.btnSecondary}
            title={copy.importTitle}
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {copy.import}
          </button>
          <Link href="/characters/new" className={ui.btnPrimary}>
            <Plus className="size-4" /> {copy.newCharacter}
          </Link>
        </div>
      </header>
      {importError ? (
        <p className="mb-4 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {importError}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      ) : characters.length === 0 ? (
        <div className={cn(ui.tile, "px-6 py-10")}>
          <IconChip icon={UserRound} size="size-12" iconSize="size-5" />
          <div className="max-w-sm">
            <p className="text-balance font-serif text-2xl text-stone-200">{copy.emptyTitle}</p>
            <p className="mt-2 text-pretty text-sm text-stone-500">{copy.emptyBody}</p>
          </div>
        </div>
      ) : (
        <>
          <Ribbon className="mb-3">
            {copy.roster} · {characters.length}
          </Ribbon>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {characters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                cloning={cloningId === character.id}
                onDelete={() => remove(character.id, character.name)}
                onUploadPortrait={() => setCroppingId(character.id)}
                onDuplicate={() => duplicate(character.id)}
              />
            ))}
          </ul>
        </>
      )}
      {cropping ? (
        <AvatarCropDialog
          title={`${copy.portraitFor} ${cropping.name}`}
          onUploaded={(image) => {
            setCroppingId("");
            void setPortrait(cropping.id, image.url);
          }}
          onClose={() => setCroppingId("")}
        />
      ) : null}
    </main>
  );
}

function CharacterCard({
  character,
  cloning,
  onDelete,
  onUploadPortrait,
  onDuplicate,
}: {
  character: LibraryCharacter;
  cloning: boolean;
  onDelete: () => void;
  onUploadPortrait: () => void;
  onDuplicate: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      painting: "Painting portrait...",
      generationFailed: "Portrait generation failed",
      level: "Level",
      notInCampaign: "Not in a campaign yet.",
      delete: "Delete",
      upload: "Upload portrait",
      uploadFor: "Upload a portrait for",
      duplicate: "Duplicate",
    },
    ru: {
      painting: "Рисуем портрет...",
      generationFailed: "Не удалось сгенерировать портрет",
      level: "Уровень",
      notInCampaign: "Пока не участвует в кампании.",
      delete: "Удалить",
      upload: "Загрузить портрет",
      uploadFor: "Загрузить портрет для",
      duplicate: "Дублировать",
    },
    pl: {
      painting: "Tworzenie portretu...",
      generationFailed: "Nie udało się wygenerować portretu",
      level: "Poziom",
      notInCampaign: "Nie uczestniczy jeszcze w kampanii.",
      delete: "Usuń",
      upload: "Prześlij portret",
      uploadFor: "Prześlij portret dla",
      duplicate: "Duplikuj",
    },
  });
  return (
    <li className={cn("group relative", ui.cardHover, "p-4")}>
      <a href={`/characters/${character.id}`} className="block">
        <div className="flex items-center gap-3">
          {character.sheet?.portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={character.sheet.portrait.url}
              alt={character.name}
              className="size-12 shrink-0 rounded-lg border border-amber-500/30 object-cover shadow-glow-gold"
            />
          ) : portraitPending(character) ? (
            <span
              title={copy.painting}
              className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-stone-900"
            >
              <Loader2 className="size-4 animate-spin text-amber-200" />
            </span>
          ) : (
            <span title={character.portraitStatus === "failed" ? copy.generationFailed : undefined}>
              <CharacterPortrait
                look={{ race: character.race, class: character.class, gender: character.sheet?.gender }}
                alt={character.name}
                size="size-12"
                className="border-amber-500/30 shadow-glow-gold"
              />
            </span>
          )}
          <div className="min-w-0 pr-8">
            <span className="block truncate font-display text-base tracking-wide text-amber-50">
              {character.name}
            </span>
            <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
              {copy.level} {character.level} {titleCase(character.class)}
            </span>
          </div>
        </div>
        <p className="mt-2 text-sm text-stone-400">
          {titleCase(character.race)}
          {character.subclass ? ` (${character.subclass})` : ""}
        </p>
        {character.background ? <p className="text-xs text-stone-500">{titleCase(character.background)}</p> : null}
      </a>
      {character.campaigns?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-700/40 pt-2">
          {character.campaigns.map((assignment) => (
            <Link
              key={assignment.campaignId}
              href={assignment.kind === "workshop" ? `/workshop/${assignment.campaignId}` : `/campaigns/${assignment.campaignId}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-600/60 bg-stone-900/60 px-2 py-0.5 text-[11px] text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-100"
            >
              {assignment.kind === "workshop" ? (
                <Hammer className="size-3 shrink-0 text-amber-300/70" />
              ) : (
                <Swords className="size-3 shrink-0 text-amber-300/70" />
              )}
              <span className="truncate">{assignment.title}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-2 border-t border-stone-700/40 pt-2 text-xs text-stone-600">{copy.notInCampaign}</p>
      )}
      <button
        type="button"
        onClick={onDelete}
        className={cn("absolute right-2 top-2", ui.iconAction, "hover:text-red-400")}
        aria-label={`${copy.delete} ${character.name}`}
        title={copy.delete}
      >
        <Trash2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onUploadPortrait}
        className={cn("absolute right-2 top-10", ui.iconAction, "hover:text-amber-300")}
        aria-label={`${copy.uploadFor} ${character.name}`}
        title={copy.upload}
      >
        <Camera className="size-4" />
      </button>
      <button
        type="button"
        disabled={cloning}
        onClick={onDuplicate}
        className={cn("absolute right-2 top-[4.5rem]", ui.iconAction, "hover:text-amber-300")}
        aria-label={`${copy.duplicate} ${character.name}`}
        title={copy.duplicate}
      >
        {cloning ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
      </button>
    </li>
  );
}
