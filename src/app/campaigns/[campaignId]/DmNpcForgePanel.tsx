"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Image as ImageIcon,
  ImageOff,
  Loader2,  Trash2,
} from "lucide-react";
import {
  blankDraft,
  draftFrom,  type NpcDraft,
  type RelationGraph,
} from "@/lib/npcs/forge";
import { Sheet } from "@/components/ui/Sheet";
import { CastChips, CastRows, type Npc } from "@/app/workshop/cast/CastList";
import { useTourPrepare } from "@/lib/tours/prepare";
import { NpcEditorFields } from "@/app/workshop/cast/NpcEditorFields";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The NPC forge.
//
// Everything the agency model can hold has been reachable only by the AI
// DM's tools since it was built. This is the form over it, and the two
// things it does that a JSON editor would not are the reason it exists:
// every axis is shown as the word it means, and every relation is shown with
// whether the other person agrees.
//
// Generation is per field. A DM should be able to take the model's sense of
// what somebody wants and throw away its sense of who they are, so there is
// no button that fills the whole form.
//
// Every AI control here is optional equipment. A server with no text model
// shows no Suggest buttons and one with no image backend shows no Paint
// button; the form and the upload work the same either way.
//
// Two layouts over one set of requests. "chips" is the DM console's: a row
// of names with the editor inline underneath. "rows" is the workshop's:
// full-width rows with a search box, and the editor in a sheet.

export function DmNpcForgePanel({
  campaignId,
  layout = "chips",
}: {
  campaignId: string;
  layout?: "chips" | "rows";
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      failed: "That did not work.",
      someone: "Someone new", placeholder: "Use placeholder", restore: "Bring back", archive: "Set aside",
      duplicate: "Duplicate",
      forget: "Forget them",
      copied: "That could not be copied.", replaceFace: "Replace face", addFace: "Add a face", placeholderHint: "Take the picture away and show the stand-in for their role instead", restoreHint: "Put them back in the DM's prompt", archiveHint: "Keep them, but take them out of the DM's prompt", save: "Save them",
    },
    ru: {
      failed: "Не удалось выполнить действие.",
      someone: "Новый персонаж",
      placeholder: "Использовать заглушку",
      restore: "Вернуть",
      archive: "Отложить",
      duplicate: "Дублировать",
      forget: "Забыть",
      copied: "Не удалось скопировать.", replaceFace: "Заменить портрет", addFace: "Добавить портрет", placeholderHint: "Убрать изображение и показывать заглушку для роли", restoreHint: "Вернуть персонажа в запрос мастера", archiveHint: "Сохранить персонажа, но убрать из запроса мастера", save: "Сохранить",
    },
  });
  const [npcs, setNpcs] = useState<Npc[]>([]);
  const [graph, setGraph] = useState<RelationGraph>({ nodes: [], edges: [] });
  // The table's setting, for the role picker's ordering.
  const [genre, setGenre] = useState("");
  // The world's named places, for the location field's dropdown.
  const [places, setPlaces] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<NpcDraft>(blankDraft());
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = layout === "rows";

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/npcs`)
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            payload: {
              npcs: Npc[];
              graph: RelationGraph;
              genre?: string;
            } | null,
          ) => {
            if (payload) {
              setNpcs(payload.npcs);
              setGraph(payload.graph);
              setGenre(payload.genre ?? "");
            }
          },
        )
        .catch(() => {
          // transient; the next action reloads
        }),
    [campaignId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Places come from the overworld and the geography lore; both lists are
  // read once, and a world with neither simply offers no dropdown.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/campaigns/${campaignId}/overworld`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { locations?: Array<{ name: string }> } | null) =>
          (data?.locations ?? []).map((location) => location.name),
        )
        .catch(() => [] as string[]),
      fetch(`/api/campaigns/${campaignId}/lore`)
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            data: {
              entries?: Array<{ title: string; category: string }>;
            } | null,
          ) =>
            (data?.entries ?? [])
              .filter((entry) => entry.category === "geography")
              .map((entry) => entry.title),
        )
        .catch(() => [] as string[]),
    ]).then(([fromMap, fromLore]) => {
      if (!cancelled) {
        setPlaces(
          [...new Set([...fromMap, ...fromLore])].sort((a, b) =>
            a.localeCompare(b),
          ),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const selected = npcs.find((npc) => npc.id === selectedId) ?? null;

  // The tour's "open the editor" step, answered where the editor is a sheet.
  useTourPrepare((name) => {
    if (name === "open-npc-editor" && rows && !editorOpen) open(null);
  });

  function open(npc: Npc | null) {
    setError("");
    if (!npc) {
      setSelectedId("");
      setDraft(blankDraft());
    } else {
      setSelectedId(npc.id);
      setDraft(draftFrom(npc as Parameters<typeof draftFrom>[0]));
    }
    // In rows the editor lives in a sheet, so a tap on a row raises it.
    if (rows) {
      setEditorOpen(true);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const url = selected
        ? `/api/campaigns/${campaignId}/dm/npcs/${selected.id}`
        : `/api/campaigns/${campaignId}/dm/npcs`;
      const response = await fetch(url, {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not save.");
        return;
      }
      await load();
      if (!selected && payload.npc) {
        setSelectedId(payload.npc.id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/dm/npcs/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/dm/npcs/${selected.id}`, {
        method: "DELETE",
      });
      setError("");
      setSelectedId("");
      setDraft(blankDraft());
      setEditorOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // A second copy of the SAVED person, not of the edits on screen, so half a
  // rewrite in the form never leaks into the copy. The server refuses a name
  // clash, which is why the copy announces itself in its name.
  async function duplicate() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const base = draftFrom(selected as Parameters<typeof draftFrom>[0]);
      const response = await fetch(`/api/campaigns/${campaignId}/dm/npcs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: { ...base, name: `${base.name} (copy)`.slice(0, 80) },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          (payload as { error?: string }).error ?? copy.copied,
        );
        return;
      }
      await load();
      const created = (
        payload as { npc?: Parameters<typeof draftFrom>[0] & { id: string } }
      ).npc;
      if (created) {
        setSelectedId(created.id);
        setDraft(draftFrom(created));
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadPortrait(file: File) {
    setBusy(true);
    setError("");
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
        setError(payload.error || "That image would not upload.");
        return;
      }
      await patch({ portraitUrl: payload.url });
    } catch {
      setError("That image would not upload.");
    } finally {
      setBusy(false);
    }
  }

  const others = npcs
    .filter((npc) => npc.id !== selectedId)
    .map((npc) => npc.name);
  const editor = (
    <div className="space-y-3">
      <NpcEditorFields
        draft={draft}
        onChange={setDraft}
        graph={graph}
        others={others}
        suggest={() => null}
        genre={genre}
        places={places}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy || !draft.name.trim()}
          onClick={() => void save()}
          data-tour="cast-save"
          className="rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
        >
          {busy ? <Loader2 className="inline size-3 animate-spin" /> : null}{" "}
          {copy.save}
        </button>
        {selected ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadPortrait(file);
                }
                event.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              <ImageIcon className="size-3" />{" "}
              {selected.portraitUrl ? copy.replaceFace : copy.addFace}
            </button>
            {selected.portraitUrl ? (
              <button
                type="button"
                disabled={busy}
                title={copy.placeholderHint}
                onClick={() => void patch({ portraitUrl: "" })}
                className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900 disabled:opacity-50"
              >
                <ImageOff className="size-3" /> {copy.placeholder}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              title={
                selected.archived
                  ? copy.restoreHint
                  : copy.archiveHint
              }
              onClick={() => void patch({ archived: !selected.archived })}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900 disabled:opacity-50"
            >
              {selected.archived ? (
                <>
                  <ArchiveRestore className="size-3" /> {copy.restore}
                </>
              ) : (
                <>
                  <Archive className="size-3" /> {copy.archive}
                </>
              )}
            </button>
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
          </>
        ) : null}
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );

  if (rows) {
    return (
      <div className="space-y-3">
        <CastRows npcs={npcs} onOpen={open} />
        <Sheet
          open={editorOpen}
          onOpenChange={setEditorOpen}
          title={selected ? selected.name : copy.someone}
          className="lg:w-[min(92vw,40rem)]"
        >
          {editor}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CastChips npcs={npcs} selectedId={selectedId} onOpen={open} />
      {editor}
    </div>
  );
}
