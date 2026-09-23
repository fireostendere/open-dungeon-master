"use client";

import { useCallback } from "react";
import { Copy, Play, Trash2, Upload } from "lucide-react";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { TERRAIN, tileAt } from "@/lib/battlemap/types";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import { collectTags } from "@/lib/workshop/pickers";
import { AddFromList } from "@/components/ui/AddFromList";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import { BackdropControls } from "@/app/campaigns/[campaignId]/MapTools";
import { AmbienceControls, OverlayControls } from "@/app/campaigns/[campaignId]/MapSceneTools";
import {
  LIBRARY_CAPS,
  MapToolbox,
  canvasToolFor,
  useMapHotkeys,
  type MapTools,
} from "@/app/campaigns/[campaignId]/MapToolbox";
import { usePainter } from "@/app/campaigns/[campaignId]/usePainter";
import type { LibraryState, PreparedMap } from "@/app/workshop/maps/types";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// One prepared map, open for editing: the canvas, its name and dials, the
// toolbox, the scene layer, the backdrop, and what can be done with it.
// Split out of DmMapLibraryPanel so the workshop gallery can show the same
// editor inside a sheet; the drawer still renders it inline, unchanged.
//
// The tool state stays with the caller on purpose: a DM who picks the water
// brush and then clicks through three maps expects to still be holding the
// water brush. The undo history is this map's own and starts fresh per map.

export type { MapTools } from "@/app/campaigns/[campaignId]/MapToolbox";

const CHAR_TO_BRUSH = Object.fromEntries(
  Object.entries(TERRAIN).map(([brush, char]) => [char, brush]),
) as Record<string, BrushName>;

export function MapEditor({
  selected,
  state,
  busy,
  tools,
  onTools,
  patch,
  act,
  duplicate,
  remove,
  npcNames,
}: {
  selected: PreparedMap;
  state: LibraryState;
  busy: boolean;
  tools: MapTools;
  onTools: (next: MapTools) => void;
  // Resolves true when the server took the edit.
  patch: (body: Record<string, unknown>) => Promise<boolean>;
  act: (action: "deploy" | "open-scene") => Promise<void>;
  duplicate: () => Promise<void>;
  remove: () => Promise<void>;
  // The cast, for the bystander token's name dropdown.
  npcNames?: readonly string[];
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { name: "Map name", theme: "Theme", ambient: "Ambient light", daylight: "Daylight", dim: "Dim", dark: "Dark", tags: "Tags", tagsHint: "Tags, comma separated: crypt, undead, act two", addTag: "Add a tag you already use", notes: "Notes", notesHint: "What lives here. Nobody but you reads this.", deploy: "Put it on the table", replace: "Replace the board's ground with this map", nothing: "Nothing is on the table to replace", nobody: "There is nobody to put on it yet", occupied: "Something is already on the table", openHint: "Put the party on this map with nobody to fight", open: "Open it as a scene", duplicate: "Duplicate", forget: "Forget it", seed: "Seed", themes: { cave: "Cave", forest: "Forest", swamp: "Swamp", riverside: "Water", interior: "Indoors", field: "Open ground" } }, ru: { name: "Название карты", theme: "Тема", ambient: "Освещение", daylight: "Дневной свет", dim: "Тусклый свет", dark: "Темнота", tags: "Метки", tagsHint: "Метки через запятую: склеп, нежить, второй акт", addTag: "Добавить уже используемую метку", notes: "Заметки", notesHint: "Кто здесь живёт. Это видите только вы.", deploy: "Поместить на стол", replace: "Заменить поле на столе этой картой", nothing: "На столе нечего заменять", nobody: "Некого разместить на карте", occupied: "На столе уже есть сцена", openHint: "Поместить группу на эту карту без противников", open: "Открыть как сцену", duplicate: "Дублировать", forget: "Удалить", seed: "Зерно", themes: { cave: "Пещера", forest: "Лес", swamp: "Болото", riverside: "Вода", interior: "Интерьер", field: "Открытая местность" } } });
  const canDeploy = state.board !== null;
  // Tags already used on the other maps, offered beside the tag field.
  const knownTags = collectTags(state.maps.filter((map) => map.id !== selected.id));
  const painter = usePainter({ key: selected.id, terrain: selected.terrain, send: patch });
  const undo = {
    canUndo: painter.canUndo,
    canRedo: painter.canRedo,
    onUndo: () => void painter.undo(),
    onRedo: () => void painter.redo(),
  };
  useMapHotkeys({ enabled: true, tools, onTools, caps: LIBRARY_CAPS, undo });

  const pick = useCallback(
    (x: number, y: number) => {
      const brush = CHAR_TO_BRUSH[tileAt(selected.terrain, selected.width, x, y)];
      if (brush) {
        onTools({ ...tools, brush, mode: "brush" });
      }
    },
    [selected, tools, onTools],
  );

  // A tap on a labelled tile takes the label away; anywhere else puts the
  // dial's text there. Props work the same way.
  function label(x: number, y: number) {
    const existing = selected.labels.find((entry) => entry.x === x && entry.y === y);
    const rest = selected.labels.filter((entry) => !(entry.x === x && entry.y === y));
    if (existing) {
      void patch({ labels: rest });
      return;
    }
    if (tools.label.text.trim()) {
      void patch({ labels: [...rest, { x, y, text: tools.label.text.trim(), dmOnly: tools.label.dmOnly }] });
    }
  }

  function prop(x: number, y: number) {
    const existing = selected.props.find((entry) => entry.x === x && entry.y === y);
    const rest = selected.props.filter((entry) => !(entry.x === x && entry.y === y));
    if (existing) {
      void patch({ props: rest });
      return;
    }
    if (tools.prop.name.trim()) {
      void patch({ props: [...rest, { x, y, name: tools.prop.name.trim(), kind: tools.prop.kind }] });
    }
  }

  return (
    <section className="space-y-2.5">
      <TerrainCanvas
        terrain={selected.terrain}
        width={selected.width}
        height={selected.height}
        backdrop={selected.backdrop}
        lights={selected.lights}
        labels={selected.labels}
        props={selected.props}
        doors={selected.doors}
        zones={selected.zones}
        overlayPath={selected.overlayPath}
        tool={canvasToolFor(tools, LIBRARY_CAPS)}
        zoomable
        onStroke={(x, y) => painter.stroke(x, y, tools.brush, tools.radius)}
        onStrokeEnd={painter.strokeEnd}
        onShape={(from, to) => void painter.shape(tools.mode, tools.brush, from, to)}
        onStamp={(x, y) => void painter.edit({ stamp: { kind: tools.stamp, x, y, ...tools.stampSize } })}
        onLight={(x, y) => void patch({ light: { x, y, ...tools.light } })}
        onLabel={label}
        onProp={prop}
        onDoor={(x, y) => void patch({ door: { x, y } })}
        onZone={(from, to) =>
          void patch({ zones: [...selected.zones, { x0: from.x, y0: from.y, x1: to.x, y1: to.y, ambient: tools.zone }] })
        }
        onPick={pick}
      />

      <MapToolbox
        tools={tools}
        onTools={onTools}
        caps={LIBRARY_CAPS}
        counts={{
          lights: selected.lights.length,
          labels: selected.labels.length,
          props: selected.props.length,
          zones: selected.zones.length,
        }}
        onClearLights={() => void patch({ lights: [] })}
        onClearLabels={() => void patch({ labels: [] })}
        onClearZones={() => void patch({ zones: [] })}
        undo={undo}
        npcNames={npcNames}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          defaultValue={selected.name}
          key={`name-${selected.id}`}
          aria-label={copy.name}
          onBlur={(event) =>
            event.target.value.trim() && event.target.value !== selected.name
              ? void patch({ name: event.target.value.trim() })
              : undefined
          }
          className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <select
          value={selected.theme}
          aria-label={copy.theme}
          onChange={(event) => void patch({ theme: event.target.value })}
          className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
        >
          {MAP_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {copy.themes[theme]}
            </option>
          ))}
        </select>
        <select
          value={selected.ambient}
          aria-label={copy.ambient}
          onChange={(event) => void patch({ ambient: event.target.value })}
          className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
        >
          <option value="bright">{copy.daylight}</option>
          <option value="dim">{copy.dim}</option>
          <option value="dark">{copy.dark}</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          defaultValue={selected.tags.join(", ")}
          key={`tags-${selected.id}-${selected.tags.join("|")}`}
          aria-label={copy.tags}
          placeholder={copy.tagsHint}
          onBlur={(event) => {
            const tags = event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean);
            if (tags.join("\n") !== selected.tags.join("\n")) {
              void patch({ tags });
            }
          }}
          className="min-w-40 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />
        <AddFromList
          prompt={copy.addTag}
          options={knownTags.filter((tag) => !selected.tags.includes(tag))}
          onPick={(tag) => void patch({ tags: [...selected.tags, tag] })}
        />
      </div>

      <textarea
        defaultValue={selected.notes}
        key={`notes-${selected.id}`}
        aria-label={copy.notes}
        onBlur={(event) =>
          event.target.value !== selected.notes ? void patch({ notes: event.target.value }) : undefined
        }
        rows={2}
        placeholder={copy.notesHint}
        className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
      />

      <AmbienceControls value={selected.ambience} onChange={(ambience) => void patch({ ambience })} />

      <BackdropControls
        backdrop={selected.backdrop}
        busy={busy}
        onChange={(next) => void patch({ backdropPath: next.path, backdropTransform: next.transform })}
      />
      <OverlayControls overlayPath={selected.overlayPath} busy={busy} onChange={(overlayPath) => void patch({ overlayPath })} />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy || !canDeploy}
          title={canDeploy ? copy.replace : copy.nothing}
          onClick={() => void act("deploy")}
          className="flex items-center gap-1 rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
        >
          <Upload className="size-3" /> {copy.deploy}
        </button>
        {state.workshop ? null : (
          <button
            type="button"
            disabled={busy || !state.hasParty || state.board !== null}
            title={
              !state.hasParty
                ? copy.nobody
                : state.board
                  ? copy.occupied
                  : copy.openHint
            }
            onClick={() => void act("open-scene")}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
          >
            <Play className="size-3" /> {copy.open}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          aria-label={`${copy.duplicate} ${selected.name}`}
          onClick={() => void duplicate()}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
        >
          <Copy className="size-3" /> {copy.duplicate}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="ml-auto flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-500 hover:text-red-300 disabled:opacity-50"
        >
          <Trash2 className="size-3" /> {copy.forget}
        </button>
      </div>
      {selected.seed ? <p className="text-[10px] text-stone-600">{copy.seed} {selected.seed}.</p> : null}
    </section>
  );
}
