"use client";

import {
  Brush,
  Download,
  Eraser,
  FileUp,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Move,
  PenLine,
  RefreshCw,
  Trash2,
  Type,
  Users,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";
import type { Locale } from "@/lib/i18n/translations";
import type { OverworldTile, TileSkin } from "@/lib/overworld/logic";
import {
  MAX_BRUSH_RADIUS,
  OVERWORLD_BRUSHES,
  OVERWORLD_BRUSH_TILES,
  type OverworldBrush,
} from "@/lib/overworld/paint";
import {
  FEATURE_LIMITS,
  OVERWORLD_SIZES,
  PATH_KINDS,
  type LabelSize,
  type OverworldSize,
  type PathKind,
} from "@/lib/overworld/features";

// The region map's toolbars (docs/workshop-parity-audit.md phase 15). Each
// is a small stateless strip; OverworldPanel holds the state and decides
// what a tap on the canvas means under the mode chosen here.

// What the panel's own dialog asks for, by what a tap meant.
export type OverworldAsk =
  | { kind: "pin"; at: { x: number; y: number } }
  | { kind: "rename"; locationId: string }
  | { kind: "label"; at: { x: number; y: number } };

export function askCopy(
  ask: OverworldAsk | null,
  labelSize: LabelSize,
  heldName: string,
  locale: Locale = "en",
): { title: string; label: string; defaultValue: string; maxLength: number; allowEmpty: boolean; submitLabel: string } {
  const copy = localeText(locale, {
    en: { renameTitle: "Rename this place", renameLabel: "What is this place called?", rename: "Rename", region: "Name the region", place: "Name the place", label: "The words written on the map here.", write: "Write it", pin: "Label the pin", plain: "Leave it empty for a plain marker.", placePin: "Place the pin" },
    ru: { renameTitle: "Переименовать это место", renameLabel: "Как называется это место?", rename: "Переименовать", region: "Назовите регион", place: "Назовите место", label: "Слова, написанные здесь на карте.", write: "Написать", pin: "Подпись к метке", plain: "Оставьте пустым для обычной метки.", placePin: "Поставить метку" },
  });
  if (ask?.kind === "rename") {
    return {
      title: copy.renameTitle,
      label: copy.renameLabel,
      defaultValue: heldName,
      maxLength: 80,
      allowEmpty: false,
      submitLabel: copy.rename,
    };
  }
  if (ask?.kind === "label") {
    return {
      title: labelSize === "large" ? copy.region : copy.place,
      label: copy.label,
      defaultValue: "",
      maxLength: FEATURE_LIMITS.labelLength,
      allowEmpty: false,
      submitLabel: copy.write,
    };
  }
  return {
    title: copy.pin,
    label: copy.plain,
    defaultValue: "",
    maxLength: 60,
    allowEmpty: true,
    submitLabel: copy.placePin,
  };
}

type ImportSummary = { cells: number; places: number; rivers: number; routes: number };

// Sends the GeoJSON texts to the import route and says what it read.
export async function importAzgaarFiles<Data extends { map: { width: number; height: number } }>(
  campaignId: string,
  files: string[],
  size: OverworldSize,
): Promise<{ data: Data; note: string } | { error: string }> {
  const response = await fetch(`/api/campaigns/${campaignId}/overworld/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, ...size }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: (payload as { error?: string }).error ?? "That map could not be read." };
  }
  const { summary, ...data } = payload as Data & { summary: ImportSummary };
  return {
    data: data as unknown as Data,
    note: `Read ${summary.cells} cells into a ${data.map.width} by ${data.map.height} map, with ${summary.places} places, ${summary.routes} roads and ${summary.rivers} rivers.`,
  };
}

export type OverworldMode =
  | "look"
  | "pin"
  | "party"
  | "place"
  | "paint"
  | "line"
  | "label"
  | "erase";

const chip = "flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]";
const idle = "border-stone-700 text-stone-400 hover:bg-stone-900";
const active = "border-amber-700 bg-amber-950/50 text-amber-200";

function useToolCopy() {
  const { locale } = useI18n();
  return localeText(locale, {
    en: { modes: { pin: "Add pin", party: "Place the party", place: "Move a place", paint: "Paint terrain", line: "Draw a line", label: "Write a label", erase: "Erase" }, brushName: (brush: string) => brush, tap: "Tap the map...", transit: "Party is in transit", clear: "Clear pins", regenerate: "Regenerate", reroll: "Reroll the terrain. Locations keep their spots where the new ground allows.", brush: "Brush size", oneTile: "one tile", across: (count: number) => `${count} across`, stranded: (names: string, count: number) => `${names} ${count === 1 ? "is" : "are"} now standing in sea or on a peak. The marker stays where you put it; move it with Move a place if that was not the idea.`, pathName: (kind: string) => kind, namePath: (kind: string) => `Name the ${kind} (optional)`, pathStart: "Tap where it starts, then along its course.", points: (count: number) => `${count} point${count === 1 ? "" : "s"} so far.`, finish: (kind: string) => `Finish the ${kind}`, undo: "Undo a point", cancel: "Cancel", labelHint: "Tap where the words go.", placeName: "Place name", regionName: "Region name", replace: "Replace the picture", usePicture: "Use a picture instead of tiles", back: "Back to the tiles", save: "Save as PNG", read: "Read an Azgaar map", grid: "Grid size for the imported map", current: (width: number, height: number) => `At this size (${width} by ${height})`, azgaar: "Fantasy Map Generator: export Cells as GeoJSON, plus Burgs, Rivers and Routes if you like.", imageError: "That image would not upload.", mapError: "That map could not be read.", importNote: (cells: number, width: number, height: number, places: number, routes: number, rivers: number) => `Read ${cells} cells into a ${width} by ${height} map, with ${places} places, ${routes} roads and ${rivers} rivers.` },
    ru: { modes: { pin: "Добавить метку", party: "Поставить группу", place: "Переместить место", paint: "Рисовать рельеф", line: "Нарисовать линию", label: "Написать подпись", erase: "Стереть" }, brushName: (brush: string) => ({ plains: "равнины", forest: "лес", hills: "холмы", mountains: "горы", water: "вода" }[brush] ?? brush), tap: "Нажмите на карту...", transit: "Группа в пути", clear: "Очистить метки", regenerate: "Создать заново", reroll: "Создать рельеф заново. Локации останутся там, где позволяет новая местность.", brush: "Размер кисти", oneTile: "одна клетка", across: (count: number) => `${count} в ширину`, stranded: (names: string) => `${names} теперь находятся в море или на вершине. Метка осталась там, куда вы её поставили; переместите её через «Переместить место», если это не было задумано.`, pathName: (kind: string) => ({ road: "дорога", river: "река", border: "граница" }[kind] ?? kind), namePath: (kind: string) => `Название: ${kind} (необязательно)`, pathStart: "Нажмите начало, затем точки вдоль линии.", points: (count: number) => `Точек: ${count}`, finish: (kind: string) => `Завершить: ${kind}`, undo: "Убрать точку", cancel: "Отмена", labelHint: "Нажмите там, где должна быть подпись.", placeName: "Название места", regionName: "Название региона", replace: "Заменить изображение", usePicture: "Использовать изображение вместо клеток", back: "Вернуться к клеткам", save: "Сохранить PNG", read: "Прочитать карту Azgaar", grid: "Размер сетки для импортируемой карты", current: (width: number, height: number) => `Текущий размер (${width} × ${height})`, azgaar: "Fantasy Map Generator: экспортируйте Cells как GeoJSON; при желании добавьте Burgs, Rivers и Routes.", imageError: "Не удалось загрузить изображение.", mapError: "Не удалось прочитать карту.", importNote: (cells: number, width: number, height: number, places: number, routes: number, rivers: number) => `Прочитано клеток: ${cells}; карта ${width} × ${height}, мест: ${places}, дорог: ${routes}, рек: ${rivers}.` },
  });
}

const MODES = [
  ["pin", "Add pin", MapPin],
  ["party", "Place the party", Users],
  ["place", "Move a place", Move],
  ["paint", "Paint terrain", Brush],
  ["line", "Draw a line", PenLine],
  ["label", "Write a label", Type],
  ["erase", "Erase", Eraser],
] as const;

export function ModeBar({
  mode,
  onMode,
  partyPlaced,
  onPartyTransit,
  pinsCount,
  onClearPins,
  regenBusy,
  onRegenerate,
}: {
  mode: OverworldMode;
  onMode: (mode: OverworldMode) => void;
  partyPlaced: boolean;
  onPartyTransit: () => void;
  pinsCount: number;
  onClearPins: () => void;
  regenBusy: boolean;
  onRegenerate: () => void;
}) {
  const copy = useToolCopy();
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-tour="region-modes">
      {MODES.map(([value, , Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onMode(mode === value ? "look" : value)}
          className={cn(chip, mode === value ? active : idle)}
        >
          <Icon className="size-3" /> {mode === value ? copy.tap : copy.modes[value]}
        </button>
      ))}
      {partyPlaced ? (
        <button type="button" onClick={onPartyTransit} className={cn(chip, idle)}>
          {copy.transit}
        </button>
      ) : null}
      {pinsCount ? (
        <button type="button" onClick={onClearPins} className={cn(chip, idle)}>
          <X className="size-3" /> {copy.clear}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenBusy}
        title={copy.reroll}
        className={cn(chip, idle, "disabled:opacity-50")}
      >
        {regenBusy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        {copy.regenerate}
      </button>
    </div>
  );
}

export function TileLegend({ skin }: { skin: Record<OverworldTile, TileSkin> }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {(Object.keys(skin) as OverworldTile[]).map((tile) => (
        <span key={tile} className="flex items-center gap-1 text-[10px] text-stone-500">
          <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: skin[tile].fill }} />
          {skin[tile].label}
        </span>
      ))}
    </div>
  );
}

export function PaintTools({
  skin,
  brush,
  onBrush,
  radius,
  onRadius,
  stranded,
}: {
  skin: Record<OverworldTile, TileSkin>;
  brush: OverworldBrush;
  onBrush: (brush: OverworldBrush) => void;
  radius: number;
  onRadius: (radius: number) => void;
  stranded: Array<{ id: string; name: string }>;
}) {
  const copy = useToolCopy();
  return (
    <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/50 p-2">
      <div className="flex flex-wrap items-center gap-1">
        {OVERWORLD_BRUSHES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onBrush(value)}
            className={cn(chip, brush === value ? active : idle)}
          >
            <span
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: skin[OVERWORLD_BRUSH_TILES[value]].fill }}
            />
            {copy.brushName(value)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-stone-400">
        {copy.brush}
        <input
          type="range"
          min={0}
          max={MAX_BRUSH_RADIUS}
          value={radius}
          onChange={(event) => onRadius(Number(event.target.value))}
          className="w-28 accent-amber-400"
        />
        <span className="text-stone-500">{radius === 0 ? copy.oneTile : copy.across(radius * 2 + 1)}</span>
      </label>
      {stranded.length ? (
        <p className="text-[11px] text-amber-300/90">
          {copy.stranded(stranded.map((place) => place.name).filter(Boolean).join(", "), stranded.length)}
        </p>
      ) : null}
    </div>
  );
}

// A road, river or border is drawn one tap at a time and finished on
// purpose, so a mis-tap is an undo rather than a stray line on the map.
export function LineTools({
  kind,
  onKind,
  pendingCount,
  label,
  onLabel,
  onFinish,
  onUndo,
  onCancel,
}: {
  kind: PathKind;
  onKind: (kind: PathKind) => void;
  pendingCount: number;
  label: string;
  onLabel: (label: string) => void;
  onFinish: () => void;
  onUndo: () => void;
  onCancel: () => void;
}) {
  const copy = useToolCopy();
  return (
    <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/50 p-2">
      <div className="flex flex-wrap items-center gap-1">
        {PATH_KINDS.map((value) => (
          <button
            key={value}
            type="button"
            disabled={pendingCount > 0 && value !== kind}
            onClick={() => onKind(value)}
            className={cn(chip, kind === value ? active : idle, "disabled:opacity-40")}
          >
            {copy.pathName(value)}
          </button>
        ))}
        <input
          value={label}
          maxLength={FEATURE_LIMITS.labelLength}
          onChange={(event) => onLabel(event.target.value)}
          placeholder={copy.namePath(copy.pathName(kind))}
          className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-0.5 text-[11px] text-stone-200"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
        <span>
          {pendingCount === 0
            ? copy.pathStart
            : copy.points(pendingCount)}
        </span>
        <button
          type="button"
          disabled={pendingCount < 2}
          onClick={onFinish}
          className={cn(chip, "border-amber-700 bg-amber-950/50 text-amber-100 disabled:opacity-40")}
        >
          {copy.finish(copy.pathName(kind))}
        </button>
        <button type="button" disabled={pendingCount === 0} onClick={onUndo} className={cn(chip, idle, "disabled:opacity-40")}>
          {copy.undo}
        </button>
        <button type="button" disabled={pendingCount === 0} onClick={onCancel} className={cn(chip, idle, "disabled:opacity-40")}>
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}

export function LabelTools({ size, onSize }: { size: LabelSize; onSize: (size: LabelSize) => void }) {
  const copy = useToolCopy();
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-stone-800 bg-stone-950/50 p-2 text-[11px] text-stone-500">
      <span>{copy.labelHint}</span>
      <button type="button" onClick={() => onSize("small")} className={cn(chip, size === "small" ? active : idle)}>
        {copy.placeName}
      </button>
      <button type="button" onClick={() => onSize("large")} className={cn(chip, size === "large" ? active : idle)}>
        {copy.regionName}
      </button>
    </div>
  );
}

async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// The map as a file, either way: a picture in place of the tiles, a map
// drawn in Fantasy Map Generator read into the grid, or the map saved out as
// a PNG to print or hand round.
export function FileTools({
  backdropPath,
  onBackdrop,
  onExport,
  exporting,
  onImport,
  importing,
  importNote,
  mapSize,
}: {
  backdropPath: string;
  onBackdrop: (path: string) => void;
  onExport: () => void;
  exporting: boolean;
  onImport: (files: string[], size: OverworldSize) => void;
  importing: boolean;
  importNote: string;
  mapSize: OverworldSize;
}) {
  const copy = useToolCopy();
  const imageRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [sizeId, setSizeId] = useState("current");

  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const dataUrl = await readAsDataUrl(file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || copy.imageError);
        return;
      }
      onBackdrop(payload.url);
    } catch {
      setError(copy.imageError);
    } finally {
      setUploading(false);
    }
  }

  async function pickGeo(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    setError("");
    const texts = await Promise.all([...files].map((file) => file.text()));
    const preset = OVERWORLD_SIZES.find((entry) => entry.id === sizeId);
    onImport(texts, preset ? { width: preset.width, height: preset.height } : mapSize);
  }

  return (
    <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/50 p-2">
      <input
        ref={imageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void upload(file);
          }
          event.target.value = "";
        }}
      />
      <input
        ref={geoRef}
        type="file"
        multiple
        accept=".geojson,.json,application/geo+json,application/json"
        className="hidden"
        onChange={(event) => {
          void pickGeo(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5" data-tour="region-files">
        <button
          type="button"
          disabled={uploading}
          onClick={() => imageRef.current?.click()}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
          {backdropPath ? copy.replace : copy.usePicture}
        </button>
        {backdropPath ? (
          <button type="button" onClick={() => onBackdrop("")} className={cn(chip, idle)}>
            <Trash2 className="size-3" /> {copy.back}
          </button>
        ) : null}
        <button
          type="button"
          disabled={exporting}
          onClick={onExport}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {exporting ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
          {copy.save}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={importing}
          onClick={() => geoRef.current?.click()}
          className={cn(chip, idle, "disabled:opacity-50")}
        >
          {importing ? <Loader2 className="size-3 animate-spin" /> : <FileUp className="size-3" />}
          {copy.read}
        </button>
        <select
          value={sizeId}
          onChange={(event) => setSizeId(event.target.value)}
          aria-label={copy.grid}
          className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-0.5 text-[11px] text-stone-300"
        >
          <option value="current">
            {copy.current(mapSize.width, mapSize.height)}
          </option>
          {OVERWORLD_SIZES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label} ({entry.width} by {entry.height})
            </option>
          ))}
        </select>
        <span className="text-[10px] text-stone-600">
          {copy.azgaar}
        </span>
      </div>
      {importNote ? <p className="text-[11px] text-emerald-300/90">{importNote}</p> : null}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
