"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Palette } from "lucide-react";
import { MAP_STYLES, type MapStyle } from "@/lib/battlemap/map-style";
import { useI18n } from "@/lib/i18n/context";
import { localeText } from "@/lib/i18n/locale-text";

// The picker for how the battle map is painted. The choice is this device's
// alone (src/lib/battlemap/map-style.ts): nobody else's board changes, and
// nothing about what is shown or what is allowed does either.

export function MapStyleMenu({ value, onChange }: { value: MapStyle; onChange: (style: MapStyle) => void }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Map style",
      only: "Only on this device",
      styles: {
        classic: ["Classic", "Flat tiles"],
        flagstone: ["Flagstone", "Textured stone, shadows"],
        torchlit: ["Torchlit", "Dark, with living fire"],
        parchment: ["Parchment", "Ink on old paper"],
        blueprint: ["Blueprint", "Flat, light, easy to read"],
      },
    },
    ru: {
      title: "Стиль карты",
      only: "Только на этом устройстве",
      styles: {
        classic: ["Классика", "Плоские плитки"],
        flagstone: ["Каменные плиты", "Текстуры и тени"],
        torchlit: ["Свет факелов", "Тёмный, с живым огнём"],
        parchment: ["Пергамент", "Чернила на старой бумаге"],
        blueprint: ["Чертёж", "Плоский, лёгкий, читаемый"],
      },
    },
  });
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={copy.title}
          title={copy.title}
          className="rounded p-1 text-stone-400 hover:bg-stone-900 hover:text-stone-200"
        >
          <Palette className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-stone-500">
            {copy.title} · {copy.only}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as MapStyle)}>
            {MAP_STYLES.map((style) => (
              <DropdownMenu.RadioItem
                key={style}
                value={style}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
              >
                <span className="flex size-4 items-center justify-center text-amber-300">
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-3.5" />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="flex flex-col">
                  <span>{copy.styles[style][0]}</span>
                  <span className="text-[11px] text-stone-500">{copy.styles[style][1]}</span>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
