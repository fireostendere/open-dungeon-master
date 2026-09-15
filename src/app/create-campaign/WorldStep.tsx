"use client";

import { ImageIcon } from "lucide-react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS } from "@/lib/genres";
import { useI18n } from "@/lib/i18n";
import type { Genre } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const COPY = {
  en: {
    setting: "Setting",
    settings: "Settings",
    settingInfo:
      "The setting decides how the world sounds, what the maps and portraits look like, and which classes and backgrounds the character builder floats to the top. It changes no rule: every setting plays 5e.",
    genres: {
      high_fantasy: { name: "High fantasy", blurb: "Classic swords, sorcery, and shining kingdoms." },
      dark_fantasy: { name: "Dark fantasy", blurb: "Grim lands where hope is scarce and victories cost." },
      mystery: { name: "Mystery", blurb: "Clues, suspects, and secrets behind every door." },
      horror: { name: "Horror", blurb: "Dread, isolation, and things best left unseen." },
      cyberpunk: { name: "Cyberpunk", blurb: "Neon streets, chrome bodies, corporate gods. 5e reskinned." },
      steampunk: { name: "Steampunk", blurb: "Brass, steam, airships, and impossible machines." },
      post_apocalyptic: { name: "Post-apocalyptic", blurb: "Scavenge, survive, and rebuild among the ruins." },
      custom: { name: "Custom", blurb: "Describe your own world and tone." },
    },
    customPlaceholder: "Describe the world and tone in your own words...",
    premise: "Premise (optional)",
    premiseAi: "Premise (optional; the AI fills this in if left blank)",
    theme: "World or theme notes",
    themePlaceholder: "Low-magic gritty, homebrew fey court, neon-drenched megacity...",
    cover: "Cover art",
    coverHelp: "You can add cover art from the campaign's details once it exists.",
  },
  ru: {
    setting: "Сеттинг",
    settings: "О сеттингах",
    settingInfo:
      "Сеттинг определяет тон мира, внешний вид карт и портретов, а также какие классы и предыстории мастер персонажа поднимает выше в списках. Правила он не меняет: любой сеттинг работает на 5e.",
    genres: {
      high_fantasy: { name: "Высокое фэнтези", blurb: "Классические мечи, магия и сияющие королевства." },
      dark_fantasy: { name: "Тёмное фэнтези", blurb: "Мрачные земли, где надежда редка, а за победы приходится платить." },
      mystery: { name: "Детектив", blurb: "Улики, подозреваемые и тайны за каждой дверью." },
      horror: { name: "Хоррор", blurb: "Страх, изоляция и вещи, которые лучше было не видеть." },
      cyberpunk: { name: "Киберпанк", blurb: "Неоновые улицы, хромированные тела и корпоративные боги. Правила 5e в новом оформлении." },
      steampunk: { name: "Стимпанк", blurb: "Латунь, пар, дирижабли и невозможные машины." },
      post_apocalyptic: { name: "Постапокалипсис", blurb: "Ищите ресурсы, выживайте и восстанавливайте мир среди руин." },
      custom: { name: "Свой мир", blurb: "Опишите собственный мир и его настроение." },
    },
    customPlaceholder: "Опишите мир и его тон своими словами...",
    premise: "Завязка (необязательно)",
    premiseAi: "Завязка (необязательно; если оставить пустой, её придумает ИИ)",
    theme: "Заметки о мире или теме",
    themePlaceholder: "Суровое низкое фэнтези, авторский двор фей, залитый неоном мегаполис...",
    cover: "Обложка",
    coverHelp: "После создания кампании обложку можно добавить в её сведениях.",
  },
  pl: {
    setting: "Setting",
    settings: "Informacje o settingach",
    settingInfo:
      "Setting określa ton świata, wygląd map i portretów oraz które klasy i pochodzenia kreator postaci pokazuje na początku list. Nie zmienia zasad: każdy setting działa na 5e.",
    genres: {
      high_fantasy: { name: "High fantasy", blurb: "Klasyczne miecze, magia i świetliste królestwa." },
      dark_fantasy: { name: "Dark fantasy", blurb: "Ponure krainy, gdzie nadzieja jest rzadka, a zwycięstwa mają cenę." },
      mystery: { name: "Tajemnica", blurb: "Tropy, podejrzani i sekrety za każdymi drzwiami." },
      horror: { name: "Horror", blurb: "Groza, izolacja i rzeczy, których lepiej nie oglądać." },
      cyberpunk: { name: "Cyberpunk", blurb: "Neonowe ulice, chromowane ciała i korporacyjni bogowie. Zasady 5e w nowej oprawie." },
      steampunk: { name: "Steampunk", blurb: "Mosiądz, para, sterowce i niemożliwe maszyny." },
      post_apocalyptic: { name: "Postapokalipsa", blurb: "Zdobywaj zasoby, przetrwaj i odbudowuj świat pośród ruin." },
      custom: { name: "Własny", blurb: "Opisz własny świat i jego ton." },
    },
    customPlaceholder: "Opisz świat i jego ton własnymi słowami...",
    premise: "Założenie fabularne (opcjonalnie)",
    premiseAi: "Założenie fabularne (opcjonalnie; AI uzupełni je, jeśli zostawisz puste)",
    theme: "Notatki o świecie lub motywie",
    themePlaceholder: "Surowe low fantasy, autorski dwór fae, zalana neonem megametropolia...",
    cover: "Okładka",
    coverHelp: "Po utworzeniu kampanii możesz dodać okładkę w jej szczegółach.",
  },
} as const;

// Step 2: the setting, its custom description, the premise and theme notes.
// Cover art is only pointed at from here: the upload and the AI painter live
// in the campaign's details dialog, because a cover needs a campaign row to
// hang off, and duplicating the picker here would mean two upload paths.
export function WorldStep({
  draft,
  patch,
  gates,
  onPickGenre,
}: StepProps & {
  // Picking a bare genre by hand leaves the pack, so the dialog owns the
  // handler that does both.
  onPickGenre: (genre: Genre) => void;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const showsAiFill = gates.aiNarrates && draft.aiStorySetup;
  const settingInfo = `${copy.settingInfo}\n\n${GENRE_PRESETS.map((preset) => {
    const localized = copy.genres[preset.id];
    return `**${localized.name}**: ${localized.blurb}`;
  }).join("\n\n")}`;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <FieldLabel className="mb-1.5">
          <span className="flex items-center gap-1">
            {copy.setting}
            <InfoButton label={copy.settings} text={settingInfo} />
          </span>
        </FieldLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GENRE_PRESETS.map((preset) => {
            const localized = copy.genres[preset.id];
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onPickGenre(preset.id)}
                title={localized.blurb}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                  draft.genre === preset.id
                    ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                    : "border-stone-800 text-stone-400 hover:border-stone-600",
                )}
              >
                {localized.name}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-stone-500">{copy.genres[draft.genre].blurb}</p>
        {draft.genre === "custom" ? (
          <textarea
            value={draft.customGenreText}
            onChange={(event) => patch({ customGenreText: event.target.value })}
            rows={2}
            maxLength={500}
            placeholder={copy.customPlaceholder}
            className={cn(inputClass, "mt-2")}
          />
        ) : null}
      </div>

      <label className="block">
        <FieldLabel>{showsAiFill ? copy.premiseAi : copy.premise}</FieldLabel>
        <textarea
          value={draft.description}
          onChange={(event) =>
            patch({ description: event.target.value, descriptionTouched: true })
          }
          rows={2}
          maxLength={500}
          className={inputClass}
        />
      </label>

      <label className="block">
        <FieldLabel>{copy.theme}</FieldLabel>
        <input
          value={draft.theme}
          onChange={(event) => patch({ theme: event.target.value, themeTouched: true })}
          maxLength={120}
          placeholder={copy.themePlaceholder}
          className={inputClass}
        />
      </label>

      <div className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <ImageIcon className="mt-0.5 size-4 shrink-0 text-amber-300/70" aria-hidden="true" />
        <div>
          <span className="block text-stone-300">{copy.cover}</span>
          <p className="mt-0.5 text-xs text-stone-500">{copy.coverHelp}</p>
        </div>
      </div>
    </div>
  );
}
