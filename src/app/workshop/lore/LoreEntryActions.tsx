"use client";

import { Copy, Pencil, Pin, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { LoreEntryView } from "@/app/workshop/lore/types";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// What the lead can do to one lore entry: edit it, pin it into every DM
// turn, copy it, delete it. Split out of LorePanel so the workshop's editor
// sheet can offer the same buttons; the campaign list still shows them under
// an expanded entry, unchanged.
//
// Edit is optional because inside the editor it would be a button that opens
// what is already open.

export function LoreEntryActions({
  entry,
  onEdit,
  onPin,
  onDuplicate,
  onDelete,
}: {
  entry: LoreEntryView;
  onEdit?: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { edit: "Edit", pin: "Pin", pinned: "Pinned", duplicate: "Duplicate", delete: "Delete" }, ru: { edit: "Изменить", pin: "Закрепить", pinned: "Закреплено", duplicate: "Дублировать", delete: "Удалить" }, pl: { edit: "Edytuj", pin: "Przypnij", pinned: "Przypięte", duplicate: "Duplikuj", delete: "Usuń" } });
  return (
    <div className="flex items-center gap-2.5">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
        >
          <Pencil className="size-3" /> {copy.edit}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onPin}
        title={
          entry.pinned ? "Unpin: retrieved only when relevant" : "Pin: included in every DM turn"
        }
        className={cn(
          "flex items-center gap-1 text-[11px]",
          entry.pinned ? "text-amber-300" : "text-stone-500 hover:text-stone-300",
        )}
      >
        <Pin className="size-3" /> {entry.pinned ? copy.pinned : copy.pin}
      </button>
      <button
        type="button"
        onClick={onDuplicate}
        aria-label={`${copy.duplicate} ${entry.title}`}
        className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-300"
      >
        <Copy className="size-3" /> {copy.duplicate}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-red-400"
      >
        <Trash2 className="size-3" /> {copy.delete}
      </button>
    </div>
  );
}
