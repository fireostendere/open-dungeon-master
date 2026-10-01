"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useInlineText } from "@/lib/i18n/inline-text";
import { RulebookReader } from "./RulebookReader";

// The rulebook laid open over the table, so a rule can be checked mid-fight
// without leaving the session. The same book as /rulebook, sized to the
// overlay; it keeps the page and the bookmarks the reader left there.
export function RulebookDialog({
  open,
  onOpenChange,
  startAt,
  startAnchor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startAt?: string;
  startAnchor?: string;
}) {
  const uiText = useInlineText();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay fixed inset-0 z-[60] bg-[#05030d]/80 backdrop-blur-sm" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="rb-dialog"
          // On a touch screen the first focusable is the search line, and
          // focusing it would throw the keyboard over the book: hold the
          // dialog itself instead.
          onOpenAutoFocus={(event) => {
            if (!window.matchMedia("(pointer: coarse)").matches) return;
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <RadixDialog.Title className="sr-only">{uiText("The Rulebook")}</RadixDialog.Title>
          <RulebookReader embedded startAt={startAt} startAnchor={startAnchor} />
          <RadixDialog.Close aria-label={uiText("Close the rulebook")} className="rb-dialog-close">
            <X className="size-5" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
