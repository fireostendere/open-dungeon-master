"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Loader2 } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { CampaignCover } from "@/components/CampaignCover";
import AuthForm from "@/app/AuthForm";
import { navigateTo } from "@/lib/navigation";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AppHomeLogo } from "@/components/AccountMenu";
import { useI18n } from "@/lib/i18n";

// Invite-link landing: /join/CODE. Logged-in users are joined and forwarded
// to the campaign; everyone else logs in or registers first, with the
// campaign they are joining shown above the form.
//
// The join endpoint only answers once the user has a session, so the
// campaign shown above the form comes from the code-scoped preview route,
// which reveals the table's shape (title, seats, level, cover) and nothing
// a stranger who guessed a code could use (src/lib/join-preview.ts).
type Preview = {
  title: string;
  status: "lobby" | "active" | "ended";
  playerCount: number;
  maxPlayers: number;
  startingLevel: number;
  genre: string;
  cover: { url: string } | null;
  seatOpen: boolean;
};

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const uiText = useInlineText();
  const { code } = use(params);
  const roomCode = code.toUpperCase();
  const { t } = useI18n();
  const [state, setState] = useState<"checking" | "auth" | "joining" | "error">("checking");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/join/preview?code=${encodeURIComponent(roomCode)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { preview?: Preview } | null) => {
        if (!cancelled && data?.preview) {
          setPreview(data.preview);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  const join = useCallback(async () => {
    setState("joining");
    try {
      const response = await fetch("/api/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: roomCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not join the campaign.");
        setState("error");
        return;
      }
      navigateTo(`/campaigns/${data.campaign.id}`);
    } catch {
      setError("Could not reach the server.");
      setState("error");
    }
  }, [roomCode]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => {
        if (data.user) {
          join();
        } else {
          setState("auth");
        }
      })
      .catch(() => setState("auth"));
  }, [join]);

  return (
    <main className="bg-starfield relative flex flex-1 items-center justify-center p-4 sm:p-6">
      <AppHomeLogo className="absolute left-4 top-4 z-20" />
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm animate-fade-up-slow">
        <section className="mb-5" aria-label={uiText("campaignInvite")}>
          <CampaignCover
            cover={preview?.cover ? { id: "", url: preview.cover.url } : null}
            title={preview?.title ?? uiText("roomCode", { code: roomCode })}
            genre={preview?.genre}
            seed={roomCode}
          />
          <div className="mt-4 text-center">
            <p className="eyebrow text-[10px] text-amber-400/80">
              {t("campaign.joinCampaign")}
            </p>
            <h1 className="mt-1 text-balance font-display text-2xl tracking-wide text-amber-50">
              {preview?.title ?? t("campaign.takeYourSeat")}
            </h1>
            {preview ? (
              <p className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-stone-400">
                <span className="inline-flex items-center gap-1">
                  <GameIcon icon={{ kind: "glyph", key: "tab-party" }} size="size-5" />
                  {preview.playerCount}/{preview.maxPlayers} {t("campaign.players")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <GameIcon icon={{ kind: "glyph", key: "tab-campaigns" }} size="size-5" />
                  {preview.genre}
                </span>
                <span className="inline-flex items-center gap-1">
                  <GameIcon icon={{ kind: "glyph", key: "rest-level-up" }} size="size-5" />
                  {t("campaign.level")} {preview.startingLevel}
                </span>
                {preview.seatOpen ? null : <span>{uiText("notTakingNewPlayersRightNow")}</span>}
              </p>
            ) : null}
            <p className="mt-2 text-sm text-stone-500">
              {t("campaign.roomCode")}{" "}
              <span className="rounded-md border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[13px] tracking-wider text-amber-200">
                {roomCode}
              </span>
            </p>
          </div>
        </section>

        <div className="glass texture-noise rounded-xl p-6 shadow-elev-2">
          {state === "checking" || state === "joining" ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="size-5 animate-spin text-stone-500" />
              <p className="text-sm text-stone-500">
                {state === "joining" ? t("campaign.takeYourSeat") : t("common.loading")}
              </p>
            </div>
          ) : state === "error" ? (
            <div className="space-y-4 text-center">
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </p>
              <Link href="/" className="text-sm text-amber-200 hover:text-amber-100">
                {t("common.back")}
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-4 text-center text-sm text-stone-400">{t("auth.signInToTakeSeat")}</p>
              <AuthForm joinCode={roomCode} onAuthed={() => join()} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
