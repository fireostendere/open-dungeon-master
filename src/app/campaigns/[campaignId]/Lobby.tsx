"use client";

import Link from "next/link";
import { ArrowLeft, Dices, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useShellShare } from "@/lib/use-shell-share";
import { CampaignCover } from "@/components/CampaignCover";
import { AccountMenu, AppHomeLogo } from "@/components/AccountMenu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ScheduleSection } from "@/components/ScheduleSection";
import { Tooltip } from "@/components/ui/Tooltip";
import { ui } from "@/lib/ui";
import { CompanionBuilderDialog } from "@/app/campaigns/[campaignId]/CompanionBuilderDialog";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { GameSettingsPanel } from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { LobbyActions } from "@/app/campaigns/[campaignId]/LobbyActions";
import { LobbyParty } from "@/app/campaigns/[campaignId]/LobbyParty";
import { LobbyRoomCode } from "@/app/campaigns/[campaignId]/LobbyRoomCode";
import { LorePanel } from "@/app/campaigns/[campaignId]/LorePanel";
import { RulesPanel } from "@/app/campaigns/[campaignId]/RulesPanel";
import { VoicePanel } from "@/app/campaigns/[campaignId]/VoicePanel";
import { resolveCompanionMode } from "@/lib/schemas/game-settings";
import { isPrimaryDm, lobbyBlocker, partySlotCount, viewerCaps } from "@/lib/dm/viewer";
import {
  ContentImportPicker,
  EMPTY_SELECTION,
  type ImportSelection,
} from "@/app/workshop/ContentImportPicker";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import { navigateTo } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

// The lobby starts with the viewer's hero/seat and party. Preparation and
// configuration stay available without burying the steps needed to play.
export function Lobby({ state, refresh }: { state: CampaignState; refresh: () => void }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { readyError: "Could not change your ready state.", server: "Could not reach the server.", startError: "Could not start the adventure.", seatError: "Could not move that seat.", removeError: "Could not remove the character.", companionError: "Could not remove the companion.", deleteError: "Could not delete the campaign.", waiting: "Waiting in the lobby", settings: "Edit campaign settings", realDice: "Real dice", digital: "Digital" },
    ru: { readyError: "Не удалось изменить статус готовности.", server: "Не удалось связаться с сервером.", startError: "Не удалось начать приключение.", seatError: "Не удалось переместить это место.", removeError: "Не удалось удалить персонажа.", companionError: "Не удалось удалить спутника.", deleteError: "Не удалось удалить кампанию.", waiting: "Ожидание в лобби", settings: "Настройки кампании", realDice: "Живые кости", digital: "Цифровые" },
  });
  const { campaign, me, members, sheets } = state;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [buildingCompanion, setBuildingCompanion] = useState(false);
  const [contentImport, setContentImport] = useState<ImportSelection>(EMPTY_SELECTION);
  const [error, setError] = useState("");
  const [canAssignSeats, setCanAssignSeats] = useState(false);
  // Bumped after a seat move so the canAssign answer is re-asked: handing the
  // DM seat away can revoke the mover's own right to move it again.
  const [seatVersion, setSeatVersion] = useState(0);
  const [seatError, setSeatError] = useState("");

  // Inside the desktop or Android app, on the app's own world: the state of
  // the tunnel, watched but never started here. Opening a lobby is not
  // asking to be online; the host says when, from the invite dialog or the
  // app's own share screen. Elsewhere this is inert.
  const share = useShellShare(false);
  const shareUrl = share.status?.url ?? "";

  // Whether this viewer may move the DM seats is the seat route's call
  // (primary DM or owner), asked of the server rather than re-derived from
  // ids here, so a button it would refuse is never rendered.
  const seatCampaignId =
    campaign && campaign.gameSettings.dmMode !== "ai" ? campaign.id : "";
  useEffect(() => {
    // No reset on the way out: the buttons are also gated on the campaign
    // being human-run, so a stale yes renders nothing.
    if (!seatCampaignId) {
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns/${seatCampaignId}/dm/seat`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { canAssign?: boolean } | null) => {
        if (!cancelled && data) {
          setCanAssignSeats(Boolean(data.canAssign));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [seatCampaignId, seatVersion]);

  if (!campaign || !me) {
    return null;
  }

  const difficulty = campaignWizardCopy(locale).difficulty[`${campaign.difficulty}Label`];
  const myMember = members.find((member) => member.userId === me.id);
  const mySheet = sheets.find((sheet) => sheet.userId === me.id);
  // The DM runs no character, so every "create your character" prompt below
  // has to know that. The seat is on the campaign row; the mode alone is not
  // enough, because an assisted campaign can still be AI-narrated.
  const isOwner = campaign.ownerUserId === me.id;
  const isLead = campaign.leadUserId === me.id;
  // A human sits in the DM seat ("human" and "assisted" alike), so the party
  // list shows who holds it and, for whoever may reassign it, the controls.
  const humanDmTable = campaign.gameSettings.dmMode !== "ai";
  // The campaign's seats, in the shape every rule in src/lib/dm/viewer.ts
  // takes. Built once here so the caps, the party count and the start gate
  // below cannot drift apart.
  const seats = {
    ownerUserId: campaign.ownerUserId,
    leadUserId: campaign.leadUserId,
    humanDmUserId: campaign.dmUserId,
    assistantDmUserId: campaign.assistantDmUserId,
    dmMode: campaign.gameSettings.dmMode,
  };
  // Who holds the story's secrets and steers it: the lead in an AI-run
  // campaign, the DM once a person runs it. Decided by src/lib/dm/viewer.ts
  // rather than by comparing ids here, which is the rule that module exists
  // to enforce.
  const { steersStory, needsCharacter } = viewerCaps(seats, me.id);
  const isDm = !needsCharacter;
  // One-player campaigns skip the invite/party ceremony entirely. A table with
  // a person in the DM seat is never solo, however small: the DM holds no
  // party slot, so maxPlayers 1 there still means two people who need the room
  // code, the call and the ordinary ready-then-begin flow between them.
  const isSolo = campaign.maxPlayers === 1 && !humanDmTable;
  // Players, not seats: the DM occupies neither a party slot nor a character.
  const partySize = partySlotCount(seats, members.map((member) => member.userId));

  // Whoever steers the story can prepare lasting party companions here: the
  // lead in an AI-run campaign, the DM once a person runs it. The DM's is the
  // case that matters most, because an ally the DM plays is the only way for
  // someone running a human table to hold a character sheet at all, and the
  // /companions/create route has always allowed it (requireStoryAuthority).
  // Only party companions are built by hand, so the option shows only where
  // the table allows them.
  const partyCompanions = sheets.filter(
    (sheet) => sheet.isCompanion && sheet.companionKind !== "guest",
  );
  const canBuildCompanion =
    steersStory &&
    resolveCompanionMode(campaign.gameSettings, partySize, humanDmTable) === "full" &&
    partyCompanions.length < campaign.gameSettings.maxCompanions;
  const showCompanions = canBuildCompanion || (steersStory && partyCompanions.length > 0);
  // Why the adventure cannot open yet, or "" when it can. The server's PATCH
  // asks the same function of the same seats, so the Begin button is enabled
  // exactly when the route would accept it.
  const startBlocker = lobbyBlocker(
    seats,
    members.map((member) => ({
      userId: member.userId,
      ready: member.ready,
      hasSheet: sheets.some((sheet) => sheet.userId === member.userId),
    })),
  );

  // Returns whether the server took it, so the solo flow can stop before
  // trying to start a game whose only player is not ready.
  async function setReady(ready: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.readyError);
        return false;
      }
      return true;
    } catch {
      setError(copy.server);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // PATCHes the campaign live. Shared by the owner's Begin button and the
  // solo one-stroke start.
  async function activate(failure: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || failure);
        return;
      }
      refresh();
    } catch {
      setError(copy.server);
    } finally {
      setBusy(false);
    }
  }

  // Solo flow: one button readies up and starts in a single stroke.
  async function beginSolo() {
    if (!myMember?.ready && !(await setReady(true))) {
      return;
    }
    await activate(copy.startError);
  }

  async function makeLead(userId: string) {
    await fetch(`/api/campaigns/${campaign!.id}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
  }

  async function muteMember(userId: string, muted: boolean) {
    await fetch(`/api/campaigns/${campaign!.id}/mute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, muted }),
    });
  }

  // Moves a DM seat; userId null empties it (the server allows that only for
  // the co-DM seat, since a human-run game always needs a DM). The seat
  // change event is not one the stream applies, so the mover reloads the
  // snapshot to see the new seats.
  async function assignSeat(seat: "dm" | "assistant", userId: string | null) {
    setSeatError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/dm/seat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seat, userId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSeatError(data.error || copy.seatError);
        return false;
      }
      setSeatVersion((version) => version + 1);
      refresh();
      return true;
    } catch {
      setSeatError(copy.server);
      return false;
    }
  }

  async function playAsCharacter(userId: string) {
    setBusy(true);
    try {
      if (await assignSeat("dm", userId)) {
        if (await setReady(false)) navigateTo(`/campaigns/${campaign!.id}/character`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleRealDice() {
    await fetch(`/api/campaigns/${campaign!.id}/members/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useRealDice: !myMember?.useRealDice }),
    });
  }

  // Lobby-only: drop your character so you can create or pick another. The
  // sheet_deleted stream event flips the UI back to "Create your character".
  async function removeCharacter() {
    const confirmPrompt =
      locale === "ru"
        ? `Удалить персонажа "${mySheet?.name ?? "вашего персонажа"}" из этой кампании? Вы сможете создать или выбрать другого.`
        : `Remove ${mySheet?.name ?? "your character"} from this campaign? You can create or pick another afterwards.`;
    if (!window.confirm(confirmPrompt)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/sheet`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.removeError);
      }
    } catch {
      setError(copy.server);
    } finally {
      setBusy(false);
    }
  }

  // Lead removes a prepared companion (same path the in-session dismiss uses).
  async function dismissCompanion(characterId: string) {
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaign!.id}/companions/${characterId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.companionError);
      }
    } catch {
      setError(copy.server);
    }
  }

  async function deleteCampaign() {
    const confirmDelete =
      locale === "ru"
        ? `Удалить "${campaign!.title}" для всех? Все персонажи, сообщения и прогресс будут потеряны безвозвратно.`
        : `Delete "${campaign!.title}" for everyone? All characters, messages, and story progress are lost. This cannot be undone.`;
    if (!window.confirm(confirmDelete)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.deleteError);
        return;
      }
      navigateTo("/");
    } catch {
      setError(copy.server);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <AppHomeLogo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-stone-500 transition-colors hover:text-amber-200"
          >
            <ArrowLeft className="size-4 shrink-0" /> {localeText(locale, { en: "All campaigns", ru: "Все кампании" })}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <AccountMenu user={me} />
          </div>
        </div>
        <div className={cn(ui.card, "texture-noise flex items-start gap-3 p-3 sm:gap-4 sm:p-4")}>
          <CampaignCover
            cover={campaign.cover}
            title={campaign.title}
            genre={campaign.gameSettings.genre}
            seed={campaign.id}
            className="w-20 shrink-0 sm:w-28"
          />
          <div className="min-w-0 flex-1">
            <p className={ui.sectionEyebrow}>{copy.waiting}</p>
            <h1 className="mt-1 flex items-start gap-2 font-display text-xl tracking-wide text-amber-50 sm:text-2xl">
              <span className="min-w-0 break-words">{campaign.title}</span>
              {isLead ? (
                <Tooltip content={copy.settings}>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label={copy.settings}
                    className="shrink-0 rounded-md border border-stone-700/70 p-1.5 text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-100"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </Tooltip>
              ) : null}
            </h1>
            <p className="mt-1 text-sm text-stone-400">
              {localeText(locale, { en: `Level ${campaign.startingLevel} start · ${difficulty}`, ru: `Уровень: ${campaign.startingLevel} · ${difficulty}` })}
            </p>
            {campaign.description ? (
              <p className="mt-2 line-clamp-3 text-sm text-stone-300">{campaign.description}</p>
            ) : null}
          </div>
        </div>
      </header>

      <LobbyActions
        campaign={campaign}
        myMember={myMember}
        mySheet={mySheet}
        isDm={isDm}
        isSolo={isSolo}
        isOwner={isOwner}
        canStart={isOwner || isPrimaryDm(seats, me.id)}
        busy={busy}
        error={error || seatError}
        startBlocker={startBlocker}
        onToggleReady={() => void setReady(!myMember?.ready)}
        onStart={() => void activate(copy.startError)}
        onBeginSolo={() => void beginSolo()}
        onRemoveCharacter={() => void removeCharacter()}
        onDelete={() => void deleteCampaign()}
        dmCandidates={members.filter(member => member.userId !== me.id && !sheets.some(sheet => sheet.userId === member.userId))}
        onPlayAsCharacter={canAssignSeats && isPrimaryDm(seats, me.id) ? userId => void playAsCharacter(userId) : undefined}
      />

      {!isSolo || showCompanions ? (
        <LobbyParty
          campaign={campaign}
          seats={seats}
          meUserId={me.id}
          members={members}
          partySize={partySize}
          sheets={sheets}
          canMakeLead={isLead || isOwner}
          humanDmTable={humanDmTable}
          canAssignSeats={canAssignSeats}
          seatError={seatError}
          onMakeLead={makeLead}
          onAssignSeat={assignSeat}
          canMute={isLead || isOwner}
          onMute={muteMember}
          showParty={!isSolo}
          showCompanions={showCompanions}
          partyCompanions={partyCompanions}
          canBuildCompanion={canBuildCompanion}
          onBuildCompanion={() => setBuildingCompanion(true)}
          onDismissCompanion={dismissCompanion}
        />
      ) : null}

      {campaign.description || campaign.scene || campaign.theme ? (
        <details className={cn(ui.card, "mb-3 p-4")}>
          <summary className="cursor-pointer text-sm font-medium text-stone-300">{localeText(locale, { en: "Adventure brief", ru: "Описание и вводная" })}</summary>
          <div className="mt-3 space-y-3 text-sm text-stone-400">
            {campaign.theme ? <p>{campaign.theme}</p> : null}
            {campaign.description ? <p className="whitespace-pre-wrap">{campaign.description}</p> : null}
            {campaign.scene ? <p className="whitespace-pre-wrap">{campaign.scene}</p> : null}
          </div>
        </details>
      ) : null}

      {!isSolo ? (
        <details className={cn(ui.card, "mb-3 p-4")}>
          <summary className="cursor-pointer text-sm font-medium text-stone-300">{localeText(locale, { en: "Invite players", ru: "Пригласить игроков" })}</summary>
          <div className="mt-3">
            <LobbyRoomCode
              campaignId={campaign.id}
              campaignTitle={campaign.title}
              inviteCode={campaign.inviteCode}
              canRegenerate={isLead}
              shareUrl={shareUrl}
            />
          </div>
        </details>
      ) : null}

      {/* Settings, rules and lore are story authority (the lead at an AI table,
          the DM once a person runs it), which is what their routes check.
          Handing them to the lead alone drew editable panels for a player-lead
          the server would refuse and read-only ones for the DM it allows. */}
      <details className={cn(ui.card, "mb-3 p-4")}>
        <summary className="cursor-pointer text-sm font-medium text-stone-300">{localeText(locale, { en: "Game settings and rules", ru: "Настройки игры и правила" })}</summary>
        <div className="mt-3">
          <GameSettingsPanel
            campaignId={campaign.id}
            settings={campaign.gameSettings}
            steersStory={steersStory}
          />
          <RulesPanel
            campaignId={campaign.id}
            settings={campaign.gameSettings}
            steersStory={steersStory}
          />
        </div>
      </details>

      <details className={cn(ui.card, "mb-3 p-4")}>
        <summary className="cursor-pointer text-sm font-medium text-stone-300">{localeText(locale, { en: "World lore and preparation", ru: "Лор мира и материалы" })}</summary>
        <div className="mt-3 space-y-3">
          <LorePanel campaignId={campaign.id} steersStory={steersStory} />
          {/* Prep keeps happening after session one, so the import is not only
              a creation-time step. Gated on story authority rather than on the
              lead, because in a human-DM campaign the lead is a player and the
              lore, places and prepared fights are the DM's to bring in. */}
          {steersStory ? (
            <div className={cn(ui.card, "p-3")}>
              <h2 className={cn(ui.sectionEyebrow, "mb-2")}>
                {locale === "ru" ? "Материалы подготовки" : "Bring in prep"}
              </h2>
              <ContentImportPicker
                campaignId={campaign.id}
                selection={contentImport}
                onChange={setContentImport}
                onImported={refresh}
              />
            </div>
          ) : null}
        </div>
      </details>

      {campaign.gameSettings.dicePolicy === "real_allowed" && mySheet ? (
        <section className={cn(ui.card, "mb-6 flex items-center justify-between gap-3 px-4 py-3")}>
          <div>
            <p className="text-sm text-stone-200">
              {locale === "ru" ? "Я бросаю настоящие кости" : "I roll physical dice"}
            </p>
            <p className="text-xs text-stone-500">
              {locale === "ru"
                ? "Игра будет делать паузу, чтобы вы ввели выпавшие значения вместо цифрового броска."
                : "The game pauses for you to enter your real rolls instead of rolling digitally."}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleRealDice}
            className={cn(
              ui.btnSmall,
              myMember?.useRealDice && "border-amber-500/40 bg-amber-400/10 text-amber-200",
            )}
          >
            <Dices className="size-4" />
            {myMember?.useRealDice
              ? copy.realDice
              : copy.digital}
          </button>
        </section>
      ) : null}

      {/* The call is open in the lobby, so the table can talk while people
          are still building characters. Pointless in a solo campaign, which
          is the same reason the party list is hidden there. No floor to
          show: the game has not started, so everyone can talk. */}
      {!isSolo ? (
        <details className={cn(ui.card, "mb-3 p-4")}>
          <summary className="cursor-pointer text-sm font-medium text-stone-300">{localeText(locale, { en: "Voice chat", ru: "Голосовой чат" })}</summary>
          <div className="mt-3">
            <VoicePanel
              campaignId={campaign.id}
              meUserId={me.id}
              roster={state.voiceRoster}
              speaking={state.voiceSpeaking}
              audibilityVersion={state.voiceAudibilityVersion}
              meshSignal={state.voiceMeshSignal}
              adjudicates={steersStory}
            />
          </div>
        </details>
      ) : null}

      {/* When the humans actually meet. Solo campaigns schedule nothing. */}
      {!isSolo ? (
        <details className={cn(ui.card, "mb-3 p-4")}>
          <summary className="cursor-pointer text-sm font-medium text-stone-300">{localeText(locale, { en: "Session schedule", ru: "Расписание сессий" })}</summary>
          <div className="mt-3">
            <ScheduleSection
              campaignId={campaign.id}
              meUserId={me.id}
              isLead={isLead}
              usernames={Object.fromEntries(members.map((member) => [member.userId, member.username]))}
              version={state.scheduleVersion}
            />
          </div>
        </details>
      ) : null}

      {editing ? (
        <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} />
      ) : null}

      {buildingCompanion ? (
        <CompanionBuilderDialog
          campaignId={campaign.id}
          genre={campaign.gameSettings.genre}
          level={campaign.startingLevel}
          humanDm={humanDmTable}
          onClose={() => setBuildingCompanion(false)}
        />
      ) : null}
    </main>
  );
}
