"use client";

import { Loader2, Plus, UserRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { IconChip, PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import CharacterBuilder, {
  type BuilderResult,
} from "@/app/characters/builder/CharacterBuilder";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

type LibraryCharacter = {
  id: string;
  name: string;
  race: string;
  class: string;
  subclass: string;
  level: number;
  sheet?: CreateSheetInput;
};

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Join a campaign with a character: pick one from your library (adapted to
// the campaign's starting level) or build a new one (also saved to your
// library). ?mode=edit reopens the builder prefilled with the current
// character; ?mode=replace swaps it for another (both lobby-only, both
// clearing the ready flag; an edit keeps the existing portrait unless the
// builder's regenerate control cleared it).
function CampaignCharacterPageInner({ campaignId }: { campaignId: string }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { saveError: "Could not save the character.", server: "Could not reach the server.", back: "← Back to the lobby", edit: "Edit your character", switch: "Switch your character", choose: "Choose your character", create: "Create your character", starts: "This campaign starts at level {level}.", clears: " Changing your character clears your ready status.", library: "From your library", current: "current", level: "Level {level}", adapted: "Will be adapted to level {level}", createInstead: "Create a new character instead", pick: "← Or pick one from your library", save: "Save changes", replace: "Replace your character", join: "Join the party" },
    ru: { saveError: "Не удалось сохранить персонажа.", server: "Не удалось связаться с сервером.", back: "← В лобби", edit: "Изменить персонажа", switch: "Сменить персонажа", choose: "Выбрать персонажа", create: "Создать персонажа", starts: "Кампания начинается с {level}-го уровня.", clears: " Смена персонажа сбросит статус готовности.", library: "Из вашей библиотеки", current: "текущий", level: "Уровень {level}", adapted: "Будет адаптирован к {level}-му уровню", createInstead: "Создать нового персонажа", pick: "← Или выбрать из библиотеки", save: "Сохранить изменения", replace: "Заменить персонажа", join: "Вступить в отряд" },
  });
  // join = first character; edit = rebuild the current one in place;
  // replace = switch to another or a brand-new one.
  const requested = useSearchParams().get("mode");
  const flow: "join" | "edit" | "replace" =
    requested === "edit" || requested === "replace" ? requested : "join";
  const [level, setLevel] = useState<number | null>(null);
  const [genre, setGenre] = useState<Genre | undefined>(undefined);
  const [worldPackId, setWorldPackId] = useState("");
  const [library, setLibrary] = useState<LibraryCharacter[]>([]);
  const [mode, setMode] = useState<"choose" | "create">(
    flow === "edit" ? "create" : "choose",
  );
  const [currentLibraryId, setCurrentLibraryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/campaigns/${campaignId}`).then((response) =>
        response.ok ? response.json() : null,
      ),
      fetch("/api/characters").then((response) => (response.ok ? response.json() : null)),
      fetch(`/api/campaigns/${campaignId}/sheet`).then((response) =>
        response.ok ? response.json() : null,
      ),
    ])
      .then(([campaignData, charactersData, sheetData]) => {
        if (cancelled) {
          return;
        }
        setLevel(campaignData?.campaign?.startingLevel ?? 1);
        setGenre(campaignData?.campaign?.gameSettings?.genre ?? undefined);
        setWorldPackId(campaignData?.campaign?.gameSettings?.worldPack ?? "");
        const characters = charactersData?.characters ?? [];
        setLibrary(characters);
        setCurrentLibraryId(sheetData?.sheet?.libraryCharacterId ?? null);
        if (!characters.length) {
          setMode("create");
        }
      })
      .catch(() => setLevel(1));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const editCharacter =
    flow === "edit" && currentLibraryId
      ? (library.find((character) => character.id === currentLibraryId) ?? null)
      : null;

  async function send(body: unknown, method: "POST" | "PUT") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.saveError);
        return;
      }
      navigateTo(`/campaigns/${campaignId}`);
    } catch {
      setError(copy.server);
    } finally {
      setBusy(false);
    }
  }

  function pickFromLibrary(characterId: string) {
    send({ libraryCharacterId: characterId }, flow === "join" ? "POST" : "PUT");
  }

  function submitNew(result: BuilderResult) {
    if (flow === "edit" && editCharacter) {
      send({ editLibraryCharacterId: editCharacter.id, sheet: result.sheet }, "PUT");
      return;
    }
    send(result.sheet, flow === "join" ? "POST" : "PUT");
  }

  if (level === null) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-5">
        <a href={`/campaigns/${campaignId}`} className="text-sm text-stone-500 hover:text-stone-300">
          {copy.back}
        </a>
        <div className="mt-2 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.characters} />
          <div>
            <h1 className="font-display text-2xl tracking-wide text-amber-50">
              {flow === "edit"
                ? copy.edit
                : flow === "replace"
                  ? copy.switch
                  : mode === "choose"
                    ? copy.choose
                    : copy.create}
            </h1>
            <p className="text-sm text-stone-400">
              {copy.starts.replace("{level}", String(level))}
              {flow !== "join" ? copy.clears : ""}
            </p>
          </div>
        </div>
      </header>

      {mode === "choose" ? (
        <section className="space-y-4">
          <Ribbon>{copy.library}</Ribbon>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {library.map((character) => (
              <li key={character.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pickFromLibrary(character.id)}
                  className={cn(ui.cardHover, "w-full p-4 text-left disabled:opacity-50")}
                >
                  <div className="flex items-center gap-2">
                    {character.sheet?.portrait?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={character.sheet.portrait.url}
                        alt={character.name}
                        className="size-8 shrink-0 rounded-lg border border-amber-500/30 object-cover"
                      />
                    ) : (
                      <IconChip icon={UserRound} size="size-8" iconSize="size-4" />
                    )}
                    <span className="font-medium text-stone-100">{character.name}</span>
                    {character.id === currentLibraryId ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                        {copy.current}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-stone-400">
                    {copy.level.replace("{level}", String(character.level))} {titleCase(character.race)}{" "}
                    {titleCase(character.class)}
                    {character.subclass ? ` (${character.subclass})` : ""}
                  </p>
                  {character.level !== level ? (
                    <p className="mt-1 text-xs text-amber-200">
                      {copy.adapted.replace("{level}", String(level))}
                    </p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setMode("create")}
            className={cn(ui.btnSecondary, "w-full border-dashed")}
          >
            <Plus className="size-4" /> {copy.createInstead}
          </button>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </section>
      ) : (
        <>
          {library.length ? (
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="mb-4 text-sm text-amber-200 hover:text-amber-400"
            >
              {copy.pick}
            </button>
          ) : null}
          <CharacterBuilder
            fixedLevel={level}
            genre={genre}
            worldPackId={worldPackId}
            initial={flow === "edit" ? editCharacter?.sheet : undefined}
            submitLabel={
              flow === "edit"
                ? copy.save
                : flow === "replace"
                  ? copy.replace
                  : copy.join
            }
            onSubmit={submitNew}
            busy={busy}
            error={error}
          />
        </>
      )}
    </main>
  );
}

// useSearchParams needs a Suspense boundary during prerender in Next 16.
export default function CampaignCharacterPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-stone-500" />
          </div>
        </main>
      }
    >
      <CampaignCharacterPageInner campaignId={campaignId} />
    </Suspense>
  );
}
