"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FileCode, FileDown, FileText, FileType, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// Story-export menu shared by the campaign Story tab and the homepage campaign
// tile. Each item downloads the player-safe story document in a format; the
// server sets Content-Disposition, so a bare anchor click saves the file.

type ExportFormat = "html" | "odt" | "docx";

function triggerDownload(campaignId: string, format: ExportFormat) {
  const anchor = document.createElement("a");
  anchor.href = `/api/campaigns/${campaignId}/export?format=${format}`;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ExportMenu({
  campaignId,
  variant = "button",
}: {
  campaignId: string;
  variant?: "button" | "tile-icon";
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, { en: { export: "Export story", aria: "Export this campaign's story", as: "Export story as", html: "HTML page", odt: "OpenDocument (.odt)", docx: "Word (.docx)" }, ru: { export: "Экспорт истории", aria: "Экспортировать историю этой кампании", as: "Экспортировать историю как", html: "Страница HTML", odt: "OpenDocument (.odt)", docx: "Word (.docx)" } });
  const options: { format: ExportFormat; label: string; icon: LucideIcon }[] = [{ format: "html", label: copy.html, icon: FileCode }, { format: "odt", label: copy.odt, icon: FileType }, { format: "docx", label: copy.docx, icon: FileText }];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {variant === "tile-icon" ? (
          <button
            type="button"
             aria-label={copy.aria}
            // The tile is a link; keep the click from navigating the card.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            className={cn(ui.iconAction, "hover:text-amber-300")}
          >
            <FileDown className="size-4" />
          </button>
        ) : (
          <button type="button" className={cn(ui.btnSmall, "w-full justify-center")}>
             <FileDown className="size-3.5" /> {copy.export} <ChevronDown className="size-3" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-stone-500">
             {copy.as}
          </DropdownMenu.Label>
           {options.map((option) => (
            <DropdownMenu.Item
              key={option.format}
              onSelect={() => triggerDownload(campaignId, option.format)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
            >
              <option.icon className="size-4" /> {option.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
