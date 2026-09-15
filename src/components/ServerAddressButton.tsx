"use client";

import { Check, Copy, QrCode, Share2, X } from "lucide-react";
import { usePathname } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { shareableAddresses } from "@/lib/server-address";
import { shareSheet } from "@/lib/shell-host";
import { ui } from "@/lib/ui";
import { pageOrigin } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";

const COPY = {
  en: {
    dialog: "This server's address",
    thisServer: "This server",
    close: "Close",
    qrAlt: "QR code for {address}",
    preparing: "Preparing the code...",
    choose: "Which address to share",
    copied: "Copied",
    copy: "Copy",
    share: "Share",
    help: "Scan with the Open Dungeon Master app to add this server, or with a phone camera to open it in a browser.",
    hide: "Hide this server's address",
    show: "Show this server's address",
    title: "This server's address and QR code",
    shareText: "Join me on {server}: {address}",
  },
  ru: {
    dialog: "Адрес этого сервера",
    thisServer: "Этот сервер",
    close: "Закрыть",
    qrAlt: "QR-код для {address}",
    preparing: "Подготовка QR-кода...",
    choose: "Какой адрес показать",
    copied: "Скопировано",
    copy: "Копировать",
    share: "Поделиться",
    help: "Отсканируйте код приложением Open Dungeon Master, чтобы добавить сервер, или камерой телефона, чтобы открыть его в браузере.",
    hide: "Скрыть адрес сервера",
    show: "Показать адрес сервера",
    title: "Адрес сервера и QR-код",
    shareText: "Присоединяйся ко мне на {server}: {address}",
  },
  pl: {
    dialog: "Adres tego serwera",
    thisServer: "Ten serwer",
    close: "Zamknij",
    qrAlt: "Kod QR dla {address}",
    preparing: "Przygotowywanie kodu QR...",
    choose: "Który adres udostępnić",
    copied: "Skopiowano",
    copy: "Kopiuj",
    share: "Udostępnij",
    help: "Zeskanuj kod aplikacją Open Dungeon Master, aby dodać serwer, albo aparatem telefonu, aby otworzyć go w przeglądarce.",
    hide: "Ukryj adres serwera",
    show: "Pokaż adres serwera",
    title: "Adres serwera i kod QR",
    shareText: "Dołącz do mnie na {server}: {address}",
  },
} as const;

export function ServerAddressButton() {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [picked, setPicked] = useState("");
  const [qr, setQr] = useState<{ address: string; dataUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverName, setServerName] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const current = pageOrigin();
    fetch("/api/server/addresses")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { serverName?: string; publicUrl?: string; lanUrls?: string[] } | null) => {
        if (cancelled) return;
        const list = shareableAddresses({ publicUrl: data?.publicUrl, lanUrls: data?.lanUrls, current });
        setAddresses(list);
        setPicked((previous) => (list.includes(previous) ? previous : (list[0] ?? "")));
        setServerName(data?.serverName ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setAddresses([current]);
          setPicked(current);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    QRCode.toDataURL(picked, {
      margin: 1,
      width: 224,
      color: { dark: "#1c1917", light: "#fef3c7" },
    })
      .then((dataUrl) => {
        if (!cancelled) setQr({ address: picked, dataUrl });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const qrDataUrl = qr && qr.address === picked ? qr.dataUrl : "";

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function copyAddress() {
    if (await copyText(picked)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const sheet = shareSheet();

  async function share() {
    if (!sheet || !picked) return;
    const name = serverName || "Open Dungeon Master";
    await sheet({
      title: name,
      text: copy.shareText.replace("{server}", name).replace("{address}", picked),
      url: picked,
    });
  }

  if (pathname?.startsWith("/campaigns/")) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end px-4 pb-4"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {open ? (
          <div
            role="dialog"
            aria-label={copy.dialog}
            className={cn(ui.card, "ornate w-72 border-amber-400/30 p-4 shadow-glow-gold")}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={ui.sectionEyebrow}>{copy.thisServer}</p>
                <p className="truncate font-display text-sm tracking-wide text-amber-50">
                  {serverName || "Open Dungeon Master"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={copy.close}
                className="rounded p-1 text-stone-400 hover:bg-stone-900"
              >
                <X className="size-4" />
              </button>
            </div>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={copy.qrAlt.replace("{address}", picked)}
                className="mx-auto size-56 rounded-lg border border-amber-400/20"
              />
            ) : (
              <div className="mx-auto flex size-56 items-center justify-center rounded-lg border border-dashed border-stone-700 text-xs text-stone-500">
                {copy.preparing}
              </div>
            )}
            {addresses.length > 1 ? (
              <select
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                aria-label={copy.choose}
                className="mt-3 w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200"
              >
                {addresses.map((address) => (
                  <option key={address} value={address}>{address}</option>
                ))}
              </select>
            ) : null}
            <p className="mt-3 break-all font-mono text-xs text-amber-100">{picked}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void copyAddress()}
                disabled={!picked}
                className={cn(ui.btnSmall, "flex-1 justify-center")}
              >
                {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
                {copied ? copy.copied : copy.copy}
              </button>
              {sheet ? (
                <button
                  type="button"
                  onClick={() => void share()}
                  disabled={!picked}
                  className={cn(ui.btnSmall, "flex-1 justify-center")}
                >
                  <Share2 className="size-4" /> {copy.share}
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-stone-500">{copy.help}</p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? copy.hide : copy.show}
          title={copy.title}
          className="flex size-10 items-center justify-center rounded-full border border-amber-500/30 bg-stone-950/90 text-amber-200 shadow-glow-gold backdrop-blur transition-colors hover:border-amber-400/60 hover:text-amber-100"
        >
          <QrCode className="size-5" />
        </button>
      </div>
    </div>
  );
}
