"use client";

import {
  Check,
  Copy,
  Globe,
  Link as LinkIcon,
  Loader2,
  QrCode,
  RefreshCw,
  Share2,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { useI18n, type Locale } from "@/lib/i18n";
import { buildShareLinks } from "@/lib/share-link";
import { shareSheet } from "@/lib/shell-host";
import { ui } from "@/lib/ui";
import { useShellShare } from "@/lib/use-shell-share";
import { Dialog } from "@/components/ui/Dialog";

const COPY = {
  en: {
    copyFailed: "Copying failed. Select the text and copy it by hand.",
    myCampaign: "my campaign",
    joinTitle: (title: string) => `Join ${title}`,
    shareText: (title?: string) =>
      `Join ${title ? `\"${title}\"` : "my campaign"} on Open Dungeon Master`,
    regenerateConfirm:
      "Generate a new invite code? Every link and QR shared so far stops working.",
    regenerateFailed: "Could not regenerate the invite code.",
    serverFailed: "Could not reach the server.",
    title: "Invite players",
    qrAlt: (url: string) => `QR code for invite link ${url}`,
    roomCode: "Room code",
    roomHelp:
      "While you are sharing, a friend can type this code into the app and land here.",
    copied: "Copied",
    copyLink: "Copy link",
    copyCode: "Copy code",
    share: "Share",
    rotateTitle: "Invalidate every shared link and QR by rotating the code",
    newCode: "New code (kills old links)",
    openingPublic: "Opening a public address so friends anywhere can join...",
    sharedOnline: "Shared online",
    stopSharing: "Stop sharing",
    sharedHelp: "Friends anywhere can join with the link below while the app runs.",
    shareFailed: "Sharing online failed",
    notShared: "Not shared online",
    tryAgain: "Try again",
    shareOnline: "Share online",
    lanOnly: (url: string) =>
      `Only friends on your Wi-Fi can reach ${url} until you share online.`,
    shareAnywhere: "Share online and friends anywhere can join with the link below.",
  },
  ru: {
    copyFailed: "Не удалось скопировать. Выделите текст и скопируйте его вручную.",
    myCampaign: "мою кампанию",
    joinTitle: (title: string) => `Присоединиться: ${title}`,
    shareText: (title?: string) =>
      `Присоединяйся к ${title ? `кампании «${title}»` : "моей кампании"} в Open Dungeon Master`,
    regenerateConfirm:
      "Создать новый код приглашения? Все ранее отправленные ссылки и QR-коды перестанут работать.",
    regenerateFailed: "Не удалось создать новый код приглашения.",
    serverFailed: "Не удалось связаться с сервером.",
    title: "Пригласить игроков",
    qrAlt: (url: string) => `QR-код ссылки-приглашения ${url}`,
    roomCode: "Код комнаты",
    roomHelp:
      "Пока доступ открыт, друг может ввести этот код в приложении и сразу попасть сюда.",
    copied: "Скопировано",
    copyLink: "Копировать ссылку",
    copyCode: "Копировать код",
    share: "Поделиться",
    rotateTitle: "Сменить код и отключить все ранее отправленные ссылки и QR-коды",
    newCode: "Новый код (старые ссылки отключатся)",
    openingPublic: "Открываем публичный адрес, чтобы друзья могли подключиться откуда угодно...",
    sharedOnline: "Доступ открыт через интернет",
    stopSharing: "Закрыть доступ",
    sharedHelp: "Пока приложение запущено, друзья могут подключаться по ссылке ниже из любой сети.",
    shareFailed: "Не удалось открыть доступ через интернет",
    notShared: "Доступ через интернет закрыт",
    tryAgain: "Повторить",
    shareOnline: "Открыть доступ",
    lanOnly: (url: string) =>
      `Пока вы не откроете доступ через интернет, подключиться к ${url} смогут только друзья в вашей Wi-Fi сети.`,
    shareAnywhere: "Откройте доступ через интернет — и друзья смогут подключиться по ссылке ниже откуда угодно.",
  },
} as const;

type InviteCopy = (typeof COPY)[Locale];

// One place to hand an invite to someone: QR for a phone camera, the link
// for chat apps, the bare code for typing, and the OS share sheet where the
// browser has one (that covers "share to social media" on every phone).
// The QR, the copy button, and the share sheet all carry the /j
// interstitial link (buildShareLinks), which knows both the server and the
// campaign and works whether or not the recipient has the app. The direct
// /join link stays visible as text so people can read where it leads.
export function InviteShareDialog({
  open,
  onOpenChange,
  campaignId,
  campaignTitle,
  inviteCode,
  canRegenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  campaignTitle?: string;
  inviteCode: string;
  canRegenerate: boolean;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");
  // Inside the desktop or Android app, on the app's own world: the tunnel
  // that lets friends anywhere join. Nothing here starts it. The row below
  // is the switch, and the host decides when to be online.
  const hosting = useShellShare(false);
  const shareState = hosting.status?.state ?? "stopped";
  const shareUrl = hosting.status?.url ?? "";

  // A host sharing their world through a tunnel plays on 127.0.0.1, an
  // address guests cannot reach. The server's publicUrl (set by the apps
  // while a tunnel runs, or by an admin behind a reverse proxy) is the one
  // that belongs in links and QR codes; it is re-read whenever the tunnel
  // comes or goes.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => response.json())
      .then((data: { publicUrl?: string }) => {
        if (!cancelled && typeof data.publicUrl === "string") {
          setPublicOrigin(data.publicUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, shareState, shareUrl]);

  const { joinUrl, appUrl } = buildShareLinks({ publicOrigin, inviteCode });

  useEffect(() => {
    if (!open || !appUrl) {
      return;
    }
    // Dark-on-light keeps the code scannable; a stone border comes from the
    // wrapper, not the image. The QR carries the /j interstitial so a phone
    // camera lands on a page that can open the app or fall back to the
    // browser.
    QRCode.toDataURL(appUrl, { width: 480, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [open, appUrl]);

  async function copyValue(kind: "link" | "code") {
    const worked = await copyText(kind === "link" ? appUrl : inviteCode);
    setError(worked ? "" : copy.copyFailed);
    if (worked) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    }
  }

  // The browser's share sheet where it has one; inside the Android app,
  // the app's (its webview has no Web Share API). Nothing on desktop.
  const sheet = shareSheet();

  async function share() {
    if (!sheet) return;
    const title = campaignTitle || copy.myCampaign;
    await sheet({
      title: copy.joinTitle(title),
      text: copy.shareText(campaignTitle),
      url: appUrl,
    });
  }

  async function regenerate() {
    if (!window.confirm(copy.regenerateConfirm)) {
      return;
    }
    setRegenerating(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/invite`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.regenerateFailed);
      }
      // The campaign_updated stream event delivers the new code; the
      // inviteCode prop re-renders this dialog with it.
    } catch {
      setError(copy.serverFailed);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      icon={<QrCode className="size-4 text-amber-300" />}
      width="w-[min(92vw,26rem)]"
    >
      <div className="flex flex-col items-center gap-4">
        {hosting.supported && hosting.status ? (
          <ShareOnlineRow
            status={hosting.status}
            onStart={hosting.start}
            onStop={hosting.stop}
            copy={copy}
          />
        ) : null}
        {qrDataUrl ? (
          <div className="rounded-xl border border-stone-700/60 bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={copy.qrAlt(appUrl)} className="size-48" />
          </div>
        ) : null}
        <div className="w-full text-center">
          <p className="eyebrow text-[10px] text-amber-200/70">{copy.roomCode}</p>
          <p className="font-mono text-2xl tracking-[0.3em] text-amber-100">{inviteCode}</p>
          <p className="mt-1 text-xs text-stone-400">{copy.roomHelp}</p>
          <p className="mt-1 break-all font-mono text-xs text-stone-500">{joinUrl}</p>
        </div>
        <div className="flex w-full flex-wrap justify-center gap-2">
          <button type="button" onClick={() => void copyValue("link")} className={ui.btnSmall}>
            {copied === "link" ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            {copied === "link" ? copy.copied : copy.copyLink}
          </button>
          <button type="button" onClick={() => void copyValue("code")} className={ui.btnSmall}>
            {copied === "code" ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied === "code" ? copy.copied : copy.copyCode}
          </button>
          {sheet ? (
            <button type="button" onClick={() => void share()} className={ui.btnSmall}>
              <Share2 className="size-4" /> {copy.share}
            </button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {canRegenerate ? (
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerating}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-red-400 disabled:opacity-50",
            )}
            title={copy.rotateTitle}
          >
            <RefreshCw className={cn("size-3.5", regenerating && "animate-spin")} />
            {copy.newCode}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}

// The app's tunnel, as seen from the invite dialog: opening, open at an
// address, failed, or off. Links and the QR above follow the address.
function ShareOnlineRow({
  status,
  onStart,
  onStop,
  copy,
}: {
  status: { state: "stopped" | "starting" | "running" | "error"; url: string; error: string; lanUrl: string };
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  copy: InviteCopy;
}) {
  if (status.state === "starting") {
    return (
      <div className="flex w-full items-center gap-2 rounded-lg border border-stone-700/60 bg-stone-900/60 px-3 py-2 text-sm text-stone-300">
        <Loader2 className="size-4 shrink-0 animate-spin text-amber-300" />
        <span>{copy.openingPublic}</span>
      </div>
    );
  }
  if (status.state === "running") {
    return (
      <div className="flex w-full flex-col gap-1.5 rounded-lg border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-emerald-200">
          <Globe className="size-4 shrink-0" />
          <span className="font-medium">{copy.sharedOnline}</span>
          <button
            type="button"
            onClick={() => void onStop()}
            className="ml-auto text-xs text-stone-400 transition-colors hover:text-red-400"
          >
            {copy.stopSharing}
          </button>
        </div>
        <p className="break-all font-mono text-xs text-stone-300">{status.url}</p>
        <p className="text-xs text-stone-500">{copy.sharedHelp}</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-stone-700/60 bg-stone-900/60 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-stone-300">
        <Globe className="size-4 shrink-0 text-stone-500" />
        <span>{status.state === "error" ? copy.shareFailed : copy.notShared}</span>
        <button type="button" onClick={() => void onStart()} className={cn(ui.btnSmall, "ml-auto")}>
          {status.state === "error" ? copy.tryAgain : copy.shareOnline}
        </button>
      </div>
      <p className="text-xs text-stone-500">
        {status.state === "error"
          ? status.error
          : status.lanUrl
            ? copy.lanOnly(status.lanUrl)
            : copy.shareAnywhere}
      </p>
    </div>
  );
}
