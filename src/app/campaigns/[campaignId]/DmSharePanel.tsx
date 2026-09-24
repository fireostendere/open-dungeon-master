"use client";

import { Download, Loader2, Package, Share2 } from "lucide-react";
import { useState } from "react";
import { ui } from "@/lib/ui";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { BUNDLE_KIND_LABELS, BUNDLE_KIND_LABELS_RU } from "@/lib/workshop/bundle";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// Handing a workshop to somebody else.
//
// The manifest form is the whole point of this panel. Exporting could have
// been one button that guessed a name from the title, and the reason it is
// not is that `inspiredBy` and `rightsHolder` are DECLARATIONS: only the
// person who built the thing knows whose setting it stands on, and a world
// pack has required those fields since docs/worlds.md. A workshop bundle
// carrying the same fields is what lets the same notice ride along with it.

type Counts = Record<string, number>;

function download(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileStem(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workshop"
  );
}

export function DmSharePanel({ campaignId }: { campaignId: string }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { failed: "That could not be built.", noPack: "Nothing in this workshop maps onto a world pack yet. Write some lore, places or hook cards first.", title: "Share this workshop", description: "A bundle is everything you prepared here as one file: lore, places, NPCs, fights, tables, map geometry, the board and your hand-built monsters. Pictures travel with it too, NPC faces and map backdrops alike, within the size caps. Nothing from any campaign does.", download: "Download bundle", compile: "Compile a world pack", refusalsTitle: "What did not fit in a world pack", required: "A name, a line about it and what it is inspired by are required before it can leave.", name: "Name", author: "Author", version: "Version", homepage: "Homepage (optional)", inspired: "Inspired by", rights: "Rights holder", blurb: "One line about it", nameExample: "The Sunken Vault", blurbExample: "A drowned dwarven city and the things that kept living in it.", inspiredExample: "Original work, or the setting this is a homage to", rightsExample: "Leave empty if this is your own world", rightsHint: "Fill this in if it is built on somebody else's setting. It is what turns the notice below into an explicit non-affiliation disclaimer." },
    ru: { failed: "Не удалось собрать пакет.", noPack: "В этой мастерской пока нет содержимого для пакета мира. Сначала добавьте лор, места или карточки зацепок.", title: "Поделиться мастерской", description: "Набор содержит всё подготовленное здесь в одном файле: лор, места, NPC, встречи, таблицы, геометрию карт, доску и созданных вручную монстров. В нём также передаются портреты NPC и фоны карт в пределах ограничений размера. Данные кампаний не включаются.", download: "Скачать набор", compile: "Собрать пакет мира", refusalsTitle: "Что не вошло в пакет мира", required: "Для экспорта нужны название, краткое описание и источник вдохновения.", name: "Название", author: "Автор", version: "Версия", homepage: "Сайт (необязательно)", inspired: "Вдохновлено", rights: "Правообладатель", blurb: "Краткое описание", nameExample: "Затонувшее хранилище", blurbExample: "Затопленный город дворфов и те, кто продолжал жить в нём.", inspiredExample: "Оригинальная работа или сеттинг, которому отдана дань", rightsExample: "Оставьте пустым, если это ваш собственный мир", rightsHint: "Заполните поле, если работа основана на чужом сеттинге. Так уведомление ниже явно укажет на отсутствие аффилиации." },
  });
  const kindLabels = locale === "ru" ? BUNDLE_KIND_LABELS_RU : BUNDLE_KIND_LABELS;
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [author, setAuthor] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [homepage, setHomepage] = useState("");
  const [inspiredBy, setInspiredBy] = useState("");
  const [rightsHolder, setRightsHolder] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refusals, setRefusals] = useState<Array<{ field: string; reason: string }>>([]);

  const manifest = {
    name: name.trim(),
    blurb: blurb.trim(),
    version: version.trim() || "1.0.0",
    author: author.trim(),
    homepage: homepage.trim(),
    inspiredBy: inspiredBy.trim(),
    rightsHolder: rightsHolder.trim(),
  };
  const ready = Boolean(manifest.name && manifest.blurb && manifest.inspiredBy);

  async function post(path: string) {
    const response = await fetch(`/api/campaigns/${campaignId}/dm/bundle${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? copy.failed);
    }
    return data;
  }

  async function exportBundle() {
    setBusy("bundle");
    setError("");
    setRefusals([]);
    try {
      const data = await post("");
      setCounts(data.counts);
      setWarnings(data.warnings ?? []);
      download(`${fileStem(manifest.name)}.odm-workshop.json`, data.bundle);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : copy.failed);
    } finally {
      setBusy("");
    }
  }

  async function exportPack() {
    setBusy("pack");
    setError("");
    try {
      const data = await post("/pack");
      setRefusals(data.refusals ?? []);
      setWarnings(data.warnings ?? []);
      setCounts(null);
      if (!data.filled) {
        setError(
          copy.noPack,
        );
        return;
      }
      download(`${fileStem(manifest.name)}.world-pack.json`, data.draft);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : copy.failed);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={ui.card + " p-4"}>
      <h2 className="mb-1 flex items-center gap-2 font-display text-lg text-amber-100">
        <Share2 className="size-4 text-amber-500/80" /> {copy.title}
      </h2>
      <p className="mb-4 text-sm text-stone-400">
        {copy.description}
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2" data-tour="share-manifest">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">{copy.name}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={70}
            placeholder={copy.nameExample}
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">
            {copy.blurb}
          </span>
          <input
            value={blurb}
            onChange={(event) => setBlurb(event.target.value)}
            maxLength={200}
            placeholder={copy.blurbExample}
            className={ui.input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">{copy.author}</span>
          <input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            maxLength={80}
            className={ui.input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">{copy.version}</span>
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            maxLength={20}
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">
            {copy.homepage}
          </span>
          <input
            value={homepage}
            onChange={(event) => setHomepage(event.target.value)}
            maxLength={300}
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">
            {copy.inspired}
          </span>
          <input
            value={inspiredBy}
            onChange={(event) => setInspiredBy(event.target.value)}
            maxLength={200}
            placeholder={copy.inspiredExample}
            className={ui.input}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-stone-500">
            {copy.rights}
          </span>
          <input
            value={rightsHolder}
            onChange={(event) => setRightsHolder(event.target.value)}
            maxLength={120}
            placeholder={copy.rightsExample}
            className={ui.input}
          />
          <span className="mt-1 block text-xs text-stone-500">
            {copy.rightsHint}
          </span>
        </label>
      </div>

      <UnofficialPackNotice
        rightsHolder={rightsHolder}
        inspiredBy={inspiredBy.trim() || undefined}
        className="mb-4"
      />

      <div className="flex flex-wrap gap-2" data-tour="share-export">
        <button
          type="button"
          onClick={() => void exportBundle()}
          disabled={!ready || Boolean(busy)}
          className={ui.btnSecondary}
        >
          {busy === "bundle" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {copy.download}
        </button>
        <button
          type="button"
          onClick={() => void exportPack()}
          disabled={!ready || Boolean(busy)}
          className={ui.btnSecondary}
        >
          {busy === "pack" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Package className="size-4" />
          )}
          {copy.compile}
        </button>
      </div>
      {!ready ? (
        <p className="mt-2 text-xs text-stone-500">
          {copy.required}
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

      {counts ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => (
              <li
                key={kind}
                className="rounded-full border border-stone-700 px-2.5 py-0.5 text-xs text-stone-400"
              >
                {count} {kindLabels[kind] ?? kind}
              </li>
            ))}
        </ul>
      ) : null}

      {refusals.length ? (
        <div className="mt-4 border-t border-stone-800 pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-stone-500">
            {copy.refusalsTitle}
          </p>
          <ul className="space-y-1.5">
            {refusals.map((refusal) => (
              <li key={refusal.field} className="text-xs text-stone-400">
                <span className="text-stone-300">{refusal.field}</span>
                <span className="block text-stone-500">{refusal.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length ? (
        <ul className="mt-3 space-y-1 border-t border-stone-800 pt-3">
          {warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-200/80">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
