"use client";

import {
  Check,
  Coffee,
  Crown,
  Link as LinkIcon,
  Moon,
  Pencil,
  QrCode,
  StickyNote,
  Tent,
  UserPlus,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { buildShareLinks } from "@/lib/share-link";
import { InviteShareDialog } from "@/components/InviteShareDialog";
import { Ribbon } from "@/components/ui/Ribbon";
import { EditCampaignDialog } from "@/app/campaigns/[campaignId]/EditCampaignDialog";
import { LeadFloorControl } from "@/app/campaigns/[campaignId]/LeadFloorControl";
import { GlobalTurnCard } from "@/app/campaigns/[campaignId]/GlobalTurnCard";
import {
  DirectorArmedBanner,
  DirectorPresets,
} from "@/app/campaigns/[campaignId]/DirectorPanel";
import {
  PendingNotesList,
  pendingCampaignNotes,
} from "@/app/campaigns/[campaignId]/NotesPanel";
import type { CampaignMember } from "@/lib/campaign-types";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { Note } from "@/lib/db/notes";
import type { GameSettings } from "@/lib/schemas/game-settings";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { canKickPlayer } from "@/lib/dm/viewer";
import { KickPlayerButton } from "./KickPlayerButton";

// The lead's desk. Everything the party lead can do to the table, in one
// tab, rather than an invite block on Party, an approval queue on Notes,
// floor buttons in the DM console and a transfer item in a character menu.
//
// The lead owns table pacing and admission even when a technical human-DM
// seat hosts the external narrator. Mechanical adjudication still belongs
// to that DM seat and the server rules engine.

export type LeadCampaign = Parameters<typeof EditCampaignDialog>[0]["campaign"] & {
  dmUserId?: string | null;
  assistantDmUserId?: string | null;
  gameSettings?: GameSettings;
};

function Card({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-400">
          <Icon className="size-3.5" /> {title}
        </p>
        {aside}
      </div>
      {children}
    </div>
  );
}

function RestCard({ campaignId, active, inCombat }: { campaignId: string; active: boolean; inCombat: boolean }) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      title: "Party rest", short: "Short rest", long: "Long rest",
      hint: "Ask the DM to arrange a rest for the whole party.", combat: "Rest is unavailable during combat.", inactive: "Rest is available in an active campaign.",
      shortRequest: "The party wants to take a short rest at the current location.", longRequest: "The party wants to take a long rest at the current location.",
      shortSent: "Short rest requested.", longSent: "Long rest requested.", failed: "Could not request a rest.", unreachable: "Could not reach the table.",
    },
    ru: {
      title: "Привал отряда", short: "Короткий привал", long: "Долгий привал",
      hint: "Отправить мастеру запрос на отдых всего отряда.", combat: "Во время боя привал недоступен.", inactive: "Привал доступен в активной кампании.",
      shortRequest: "Отряд хочет устроить короткий привал в текущем месте.", longRequest: "Отряд хочет устроить долгий привал в текущем месте.",
      shortSent: "Запрос на короткий привал отправлен.", longSent: "Запрос на долгий привал отправлен.", failed: "Не удалось запросить привал.", unreachable: "Не удалось связаться со столом.",
    },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const disabled = busy || !active || inCombat;

  async function requestRest(kind: "short" | "long") {
    if (disabled) return;
    setBusy(true);
    setError("");
    setSent("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/lead-note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: kind === "short" ? copy.shortRequest : copy.longRequest }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || copy.failed);
      } else {
        setSent(kind === "short" ? copy.shortSent : copy.longSent);
      }
    } catch {
      setError(copy.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card icon={Tent} title={copy.title}>
      <p className="mb-2 text-[11px] text-stone-500">{!active ? copy.inactive : inCombat ? copy.combat : copy.hint}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => void requestRest("short")} className="flex min-h-11 items-center gap-1.5 rounded-md border border-stone-700 px-3 py-2 text-xs text-stone-300 hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-50">
          <Coffee className="size-4" aria-hidden="true" /> {copy.short}
        </button>
        <button type="button" disabled={disabled} onClick={() => void requestRest("long")} className="flex min-h-11 items-center gap-1.5 rounded-md border border-stone-700 px-3 py-2 text-xs text-stone-300 hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-50">
          <Moon className="size-4" aria-hidden="true" /> {copy.long}
        </button>
      </div>
      {error ? <p role="alert" className="mt-1.5 text-xs text-red-400">{error}</p> : null}
      {sent ? <p role="status" className="mt-1.5 text-xs text-emerald-400">{sent}</p> : null}
    </Card>
  );
}

// Mid-game invites. The toggle PATCHes game settings, so it follows story
// authority; the invite link itself stays with the lead, who owns who sits
// at the table.
function InvitesCard({
  campaignId,
  inviteCode,
  midGameJoinOpen,
  steersStory,
}: {
  campaignId: string;
  inviteCode: string;
  midGameJoinOpen: boolean;
  steersStory: boolean;
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { saveFailed: "That change was not saved.", reachFailed: "Could not reach the table.", invites: "Invites", joining: "Joining", open: "open", closed: "closed", joinTitle: "Allow new players to join with the invite code mid-game", copy: "Copy the invite link", share: "Show the invite QR code and share options" },
    ru: { saveFailed: "Изменение не сохранено.", reachFailed: "Не удалось связаться со столом.", invites: "Приглашения", joining: "Присоединение", open: "открыто", closed: "закрыто", joinTitle: "Разрешить новым игрокам присоединяться по коду приглашения во время игры", copy: "Скопировать ссылку-приглашение", share: "Показать QR-код приглашения и варианты отправки" },
  });
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteSharing, setInviteSharing] = useState(false);
  // The joining toggle has no optimistic state (midGameJoinOpen rides the
  // stream), so a refused PATCH changes nothing on screen; this is the only
  // trace it leaves.
  const [joinToggleError, setJoinToggleError] = useState("");
  // For the copied invite link: a tunnel host plays on 127.0.0.1, an address
  // guests cannot reach, so prefer the server's publicUrl.
  const [publicOrigin, setPublicOrigin] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { publicUrl?: string }) => {
        if (!cancelled && typeof data.publicUrl === "string") {
          setPublicOrigin(data.publicUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleMidGameJoin() {
    setJoinToggleError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ midGameJoinOpen: !midGameJoinOpen }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setJoinToggleError(data.error ?? copy.saveFailed);
      }
    } catch {
      setJoinToggleError(copy.reachFailed);
    }
  }

  async function copyInviteLink() {
    // Use the same invite address as the lobby, dialog and QR.
    const links = buildShareLinks({ publicOrigin, inviteCode });
    if (await copyText(links.appUrl || links.joinUrl)) {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    }
  }

  return (
    <Card icon={UserPlus} title={copy.invites}>
      <div className="flex items-center gap-1.5">
        {steersStory ? (
          <button
            type="button"
            onClick={toggleMidGameJoin}
            title={copy.joinTitle}
            className={cn(
              "rounded-md border px-2 py-1 text-xs",
              midGameJoinOpen
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            {copy.joining} {midGameJoinOpen ? copy.open : copy.closed}
          </button>
        ) : (
          // A lead at a human-DM table shares the code but the setting is
          // the DM's, so the state shows without a control the server would
          // refuse.
          <span className="rounded-md border border-stone-800 px-2 py-1 text-xs text-stone-500">
            {copy.joining} {midGameJoinOpen ? copy.open : copy.closed}
          </span>
        )}
        {midGameJoinOpen ? (
          <>
            <button
              type="button"
              onClick={copyInviteLink}
              title={copy.copy}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
            >
              {inviteCopied ? (
                <Check className="size-3.5 text-emerald-400" />
              ) : (
                <LinkIcon className="size-3.5" />
              )}
              {inviteCode}
            </button>
            <button
              type="button"
              onClick={() => setInviteSharing(true)}
              title={copy.share}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
            >
              <QrCode className="size-3.5" />
            </button>
          </>
        ) : null}
      </div>
      {joinToggleError ? <p className="mt-1.5 text-xs text-red-400">{joinToggleError}</p> : null}
      <InviteShareDialog
        open={inviteSharing}
        onOpenChange={setInviteSharing}
        campaignId={campaignId}
        inviteCode={inviteCode}
        canRegenerate
      />
    </Card>
  );
}

// Handing the seat over. The route lets the lead or the owner do this; the
// list leaves out the current lead (nothing to hand) and the DM seats (the
// DM runs the story, not a character, and the lead seat is a player's).
function LeadSeatCard({
  campaignId,
  members,
  sheets,
  leadUserId,
  dmUserIds,
}: {
  campaignId: string;
  members: CampaignMember[];
  sheets: CharacterSheet[];
  leadUserId: string;
  dmUserIds: string[];
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { confirm: "Make {name} the party lead? You will lose this tab.", failed: "The lead did not change.", reachFailed: "Could not reach the table.", title: "The lead seat", as: "as", make: "Make lead", nobody: "Nobody else at the table to hand it to." },
    ru: { confirm: "Сделать {name} лидером группы? Вы потеряете доступ к этой вкладке.", failed: "Лидер группы не изменился.", reachFailed: "Не удалось связаться со столом.", title: "Место лидера", as: "как", make: "Сделать лидером", nobody: "За столом больше некому передать эту роль." },
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const candidates = members.filter(
    (member) => member.userId !== leadUserId && !dmUserIds.includes(member.userId),
  );
  const characterFor = (userId: string) =>
    sheets.find((sheet) => sheet.userId === userId && !sheet.isCompanion)?.name;

  async function makeLead(member: CampaignMember) {
    if (!window.confirm(copy.confirm.replace("{name}", member.username))) {
      return;
    }
    setBusy(member.userId);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? copy.failed);
      }
    } catch {
      setError(copy.reachFailed);
    } finally {
      setBusy("");
    }
  }

  return (
    <Card icon={Crown} title={copy.title}>
      {candidates.length ? (
        <ul className="space-y-1">
          {candidates.map((member) => {
            const character = characterFor(member.userId);
            return (
              <li key={member.userId} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-stone-300">
                  {member.username}
                  {character ? (
                    <span className="text-stone-500"> {copy.as} {character}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={busy !== ""}
                  onClick={() => makeLead(member)}
                  className="shrink-0 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-stone-200 disabled:opacity-40"
                >
                  {copy.make}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] text-stone-600">{copy.nobody}</p>
      )}
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </Card>
  );
}

export function LeadPanel({
  campaignId,
  campaign,
  floor,
  sheets,
  members,
  notes,
  refreshNotes,
  meUserId,
  inviteCode,
  midGameJoinOpen,
  canTransferLead,
  leadUserId,
  steersStory,
  isLead,
  encounter,
  directorArm,
}: {
  campaignId: string;
  campaign: LeadCampaign;
  floor: Floor;
  sheets: CharacterSheet[];
  members: CampaignMember[];
  notes: Note[];
  refreshNotes: () => Promise<void>;
  meUserId: string;
  inviteCode?: string;
  midGameJoinOpen: boolean;
  canTransferLead: boolean;
  leadUserId: string;
  steersStory: boolean;
  isLead: boolean;
  encounter?: PublicEncounter | null;
  // The stream's armed flag, so the banner here refetches the directive on
  // the same beat as the one above the composer.
  directorArm?: Parameters<typeof DirectorArmedBanner>[0]["armed"];
}) {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: { only: "Lead only", steer: "You steer this table.", notes: "Notes to approve", waiting: "Nothing waiting for you.", direct: "Direct the story", directHint: "Pick Direct in the composer, then Private for a note only the DM sees.", details: "Campaign details", editTitle: "Edit title, premise, setting, difficulty, and player slots", edit: "Edit details", difficulty: "Difficulty", level: "Level", start: "start", upTo: "Up to", players: "players" },
    ru: { only: "Только для лидера", steer: "Вы ведёте этот стол.", notes: "Заметки на одобрение", waiting: "Ничего не ожидает вашего решения.", direct: "Направить историю", directHint: "Выберите «Направить» в редакторе, затем «Личное» для заметки, которую видит только мастер.", details: "Данные кампании", editTitle: "Изменить название, завязку, сеттинг, сложность и места для игроков", edit: "Изменить данные", difficulty: "Сложность", level: "Уровень", start: "начало", upTo: "До", players: "игроков" },
  });
  const [editing, setEditing] = useState(false);
  const pending = pendingCampaignNotes(notes);
  // The external narrator can occupy a technical human-DM seat; the lead's
  // Direct control remains available there.
  const directsAi = isLead;
  const dmUserIds = [campaign.dmUserId, campaign.assistantDmUserId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const seats = { ownerUserId: members.find(member => member.role === "owner")?.userId ?? "", leadUserId, humanDmUserId: campaign.dmUserId ?? null,
    assistantDmUserId: campaign.assistantDmUserId ?? null, dmMode: campaign.gameSettings?.dmMode ?? "ai" };
  const kickablePlayers = members.filter(member => canKickPlayer(seats, meUserId, member.userId));

  return (
    <div className="text-sm">
      {/* Ember rather than the DM console's gold: the two seats are not the
          same thing, and the composer's Direct pill already wears this. */}
      <div className="mb-3">
        <Ribbon tone="ember">
          <Crown className="mr-1 inline size-3" aria-hidden="true" />
          {copy.only}
        </Ribbon>
        <p className="mt-1.5 text-xs text-stone-400">{copy.steer}</p>
      </div>

      <GlobalTurnCard
        campaignId={campaignId}
        campaign={campaign}
        members={members}
        sheets={sheets}
        isLead={isLead}
        meUserId={meUserId}
      />

      {(isLead || steersStory) && (!campaign.gameSettings?.globalTurn?.enabled || encounter) ? (
        <LeadFloorControl
          campaignId={campaignId}
          floor={floor}
          sheets={sheets}
          encounter={encounter}
        />
      ) : null}

      {isLead ? (
        <RestCard
          campaignId={campaignId}
          active={campaign.status === "active"}
          inCombat={encounter?.status === "active" || floor.mode === "initiative" || (floor.mode === "hold" && Boolean(floor.combat))}
        />
      ) : null}

      {steersStory ? (
        <Card
          icon={StickyNote}
          title={copy.notes}
          aside={
            pending.length ? (
              <span className="rounded-full bg-amber-900/60 px-1.5 text-[10px] text-amber-200">
                {pending.length}
              </span>
            ) : null
          }
        >
          {pending.length ? (
            <PendingNotesList
              campaignId={campaignId}
              notes={pending}
              members={members}
              meUserId={meUserId}
              refreshNotes={refreshNotes}
            />
          ) : (
            <p className="text-[11px] text-stone-600">{copy.waiting}</p>
          )}
        </Card>
      ) : null}

      {directsAi ? (
        <Card icon={Wand2} title={copy.direct}>
          <p className="mb-2 text-[11px] text-stone-500">
            {copy.directHint}
          </p>
          <DirectorArmedBanner campaignId={campaignId} steersStory armed={directorArm} />
          <div className="flex flex-wrap gap-1.5">
            <DirectorPresets campaignId={campaignId} />
          </div>
        </Card>
      ) : null}

      {isLead && inviteCode && campaign.maxPlayers > 1 ? (
        <InvitesCard
          campaignId={campaignId}
          inviteCode={inviteCode}
          midGameJoinOpen={midGameJoinOpen}
          steersStory={isLead || steersStory}
        />
      ) : null}

      {canTransferLead ? (
        <LeadSeatCard
          campaignId={campaignId}
          members={members}
          sheets={sheets}
          leadUserId={leadUserId}
          dmUserIds={dmUserIds}
        />
      ) : null}

      {kickablePlayers.length ? (
        <Card icon={UserPlus} title={localeText(locale, { en: "Players", ru: "Игроки" })}>
          <ul className="space-y-2">
            {kickablePlayers.map(member => (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-stone-300">{member.username}</span>
                <KickPlayerButton campaignId={campaignId} member={member} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {isLead ? (
        <Card
          icon={Pencil}
          title={copy.details}
          aside={
            <button
              type="button"
              onClick={() => setEditing(true)}
              title={copy.editTitle}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
            >
              <Pencil className="size-3" /> {copy.edit}
            </button>
          }
        >
          <p className="truncate text-stone-200">{campaign.title}</p>
          <p className="mt-1 text-xs text-stone-500">
            {copy.difficulty} {campaign.difficulty} · {copy.level} {campaign.startingLevel} {copy.start} · {copy.upTo}{" "}
            {campaign.maxPlayers} {copy.players}
          </p>
        </Card>
      ) : null}

      {editing ? (
        <EditCampaignDialog campaign={campaign} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}
