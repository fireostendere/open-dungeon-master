"use client";

import {
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { JOIN_NOTE_PREFIX, latestUnintroducedJoin } from "@/lib/campaign-types";
import { markTourSeen, tourSeen } from "@/lib/tours/logic";
import { DM_TOUR_ID, PLAYER_TOUR_ID, tableTour } from "@/lib/tours/table";
import { localeText } from "@/lib/i18n/locale-text";
import { HelpDialog } from "@/components/HelpDialog";
import { GuidedTour } from "@/components/ui/GuidedTour";
import { CharacterGate } from "@/app/campaigns/[campaignId]/CharacterGate";
import { Composer, type InputKind } from "@/app/campaigns/[campaignId]/Composer";
import { composerGate } from "@/app/campaigns/[campaignId]/composerGate";
import { DiceOverlay } from "@/app/campaigns/[campaignId]/DiceOverlay";
import { EndingCelebration } from "@/app/campaigns/[campaignId]/EndingCelebration";
import { ClosingMessageModal } from "@/app/campaigns/[campaignId]/ClosingMessageModal";
import { LoreCheckDialog } from "@/app/campaigns/[campaignId]/LoreCheckDialog";
import { RenarrateDialog } from "@/app/campaigns/[campaignId]/RenarrateDialog";
import type { CampaignMessage } from "@/lib/db/messages";
import {
  beatCadence,
  DEFAULT_BEAT_CADENCE,
  QUIET_BEAT_CADENCE,
  snoozeUntil,
} from "@/lib/dm/beat-cadence";
import {
  BottomTabBar,
  buildPanelTabs,
  useSessionTabs,
  type PanelTab,
} from "@/app/campaigns/[campaignId]/SessionTabs";
import { SessionChatColumn } from "@/app/campaigns/[campaignId]/SessionChatColumn";
import { SessionHeader } from "@/app/campaigns/[campaignId]/SessionHeader";
import { SidePanel } from "@/app/campaigns/[campaignId]/SidePanel";
import { useI18n } from "@/lib/i18n";
import { useChatChime } from "@/app/campaigns/[campaignId]/useChatChime";
import { useTableAudio } from "@/app/campaigns/[campaignId]/useTableAudio";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CombatChoice, CombatTurnIntent } from "@/lib/dm/combat-turn-intent";

// The level-up dialog carries the class feature and resource tables of the
// whole SRD; it loads the first time a character actually levels rather
// than with the table.
const LevelUpDialog = lazy(() =>
  import("@/app/campaigns/[campaignId]/LevelUpDialog").then((module) => ({
    default: module.LevelUpDialog,
  })),
);

function subscribeDicePref(callback: () => void) {
  window.addEventListener("odm-dice3d-pref", callback);
  return () => window.removeEventListener("odm-dice3d-pref", callback);
}

// The once-only flag of each table tour, read the way the dice preference
// is: from localStorage as an external store, so finishing a tour in one
// tab is known to every other.
const TOUR_SEEN_EVENT = "odm-tour-seen";

function subscribeTourSeen(callback: () => void) {
  window.addEventListener(TOUR_SEEN_EVENT, callback);
  return () => window.removeEventListener(TOUR_SEEN_EVENT, callback);
}

const FINALE_SEEN_EVENT = "odm-finale-seen";
const EMPTY_COMBAT_CHOICES: CombatChoice[] = [];

function subscribeFinaleSeen(callback: () => void) {
  window.addEventListener(FINALE_SEEN_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(FINALE_SEEN_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// The play table. Header, the story column, the docked context column and
// the dialogs that float over all three. What lives here is the state the
// columns share: which tab is open, what the composer holds, who is blocked
// from sending and why, and the seat flags every panel reads.
export function SessionView({
  state,
  loadOlderMessages,
  refreshNotes,
  refreshFacts,
  refreshSideChat,
  refreshWhispers,
  refreshAsks,
  refreshBattleMap,
}: {
  state: CampaignState;
  loadOlderMessages: () => Promise<boolean>;
  refreshNotes: () => Promise<void>;
  refreshFacts: () => Promise<void>;
  refreshSideChat: () => Promise<void>;
  refreshWhispers: () => Promise<void>;
  refreshAsks: () => Promise<void>;
  refreshBattleMap: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const tourCopy = localeText(locale, {
    en: { table: "Tour the table", tableDetail: "How a player takes a turn, asks the DM, and finds the party, the story and the maps.", dm: "Tour the DM console", dmDetail: "The floor, story beats, hand-over switches, the queue and the tools.", mutedPlaceholder: "The party lead has muted you at this table." },
    ru: { table: "Экскурсия по столу", tableDetail: "Ход игрока, вопросы ведущему, отряд, история и карты.", dm: "Экскурсия по панели ведущего", dmDetail: "Управление ходом, сюжетные записи, очередь действий и инструменты.", mutedPlaceholder: "Лидер отряда заглушил вас за этим столом." },
  });
  const { campaign, me, sheets, messages, pendingRolls, auditLog, levelUps, locations, dmStatus, caps } =
    state;
  const campaignId = campaign?.id;
  const [input, setInput] = useState("");
  const [kind, setKind] = useState<InputKind>("do");
  // The DM has no character, so "do" would be a mode they can never use.
  const [seenDmSeat, setSeenDmSeat] = useState(false);
  // Whether a lead direction is spoken to the table or only to the DM.
  // Defaults to off, so Direct keeps behaving as it always has unless the
  // lead deliberately hides one.
  const [leadPrivate, setLeadPrivate] = useState(false);
  // The Ask strip sits in the chat column and starts closed. It owns the rest
  // of the feature itself; all this view keeps is whether it is expanded.
  const [askOpen, setAskOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [dismissedLevelUp, setDismissedLevelUp] = useState("");
  const [dismissedJoinNotice, setDismissedJoinNotice] = useState("");
  // "Message" on a party card: SidePanel switches to the chat tab and opens
  // the 1:1 thread with this user.
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  // Lore check: the flagged message plus whatever text was selected when
  // the flag was raised.
  const [loreCheck, setLoreCheck] = useState<{ message: CampaignMessage; selection: string } | null>(
    null,
  );
  // Narration reroll: the DM message whose prose the lead is rerolling.
  const [renarrate, setRenarrate] = useState<CampaignMessage | null>(null);
  // Bumped on pin/unpin so the pins panel refetches without a stream event.
  const [pinsVersion, setPinsVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [closingModalOpen, setClosingModalOpen] = useState(false);
  const [celebrationActive, setCelebrationActive] = useState(false);
  const hasOpenedFinale = useSyncExternalStore(
    subscribeFinaleSeen,
    () => campaignId ? window.localStorage.getItem(`odm:seen_finale_${campaignId}`) === "true" : false,
    () => false,
  );

  const openClosingMessage = useCallback(() => {
    setCelebrationActive(false);
    setClosingModalOpen(true);
    if (campaignId) {
      window.localStorage.setItem(`odm:seen_finale_${campaignId}`, "true");
      window.dispatchEvent(new Event(FINALE_SEEN_EVENT));
    }
  }, [campaignId]);

  const closingDmMessage = useMemo(() => {
    if (campaign?.status !== "ended") return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].authorType === "dm") {
        return messages[i];
      }
    }
    return null;
  }, [campaign?.status, messages]);

  // The guided tour on screen, if any: the player's or the DM's.
  const [tour, setTour] = useState<"player" | "dm" | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dice3d = useSyncExternalStore(
    subscribeDicePref,
    () => window.localStorage.getItem("odm:dice3d") !== "off",
    () => true,
  );
  const toggleDice3d = useCallback(() => {
    window.localStorage.setItem("odm:dice3d", dice3d ? "off" : "on");
    window.dispatchEvent(new Event("odm-dice3d-pref"));
  }, [dice3d]);

  const { ambience } = useTableAudio(state);
  // Chime on new private messages (side chats + DM whispers). The loaded
  // flags keep the page-load backlog silent.
  const chatUnreadTotal =
    state.sideThreads.reduce((sum, thread) => sum + thread.unread, 0) + state.whisperUnread;
  useChatChime(chatUnreadTotal, state.sideChatLoaded && state.whispersLoaded);
  const pendingNoteCount = state.notes.filter((note) => note.status === "pending").length;
  // Two different authorities, deliberately separate. `isLead` owns the
  // table (campaign info, invites, who holds which seat). `caps` says who
  // owns the story, which is the lead in an AI campaign and the DM in a
  // human-run one; the server decided it, this only reads it. Computed up
  // here because the tab hook needs it to fall off the lead tab when the
  // seat moves.
  const isLead = Boolean(campaign && me && campaign.leadUserId === me.id);
  const { panelTab, setPanelTab, mobileView, setMobileView } = useSessionTabs({
    chatTarget,
    battleMap: state.battleMap,
    isLead,
  });

  // Everything below runs on every dm_delta while the DM narrates, so the
  // values handed to the memoized panels are stabilized with useMemo and
  // useCallback. All hooks must stay above the null guard further down.
  const mySheet = useMemo(() => sheets.find((sheet) => sheet.userId === me?.id), [sheets, me?.id]);
  const myLevelUp = mySheet ? levelUps.find((notice) => notice.characterId === mySheet.id) : undefined;
  // Memoized so the open-floor fallback object keeps a stable identity and
  // does not invalidate the memos below on every render.
  const floor = useMemo(() => campaign?.floor ?? { mode: "open" as const }, [campaign?.floor]);
  const isDm = caps.role === "dm";
  const steersStory = caps.steersStory;
  if (isDm && !seenDmSeat) {
    setSeenDmSeat(true);
    setKind("narrate");
  }

  // The tour for this seat runs once, the first time the table is sat at,
  // after the layout has had a moment to settle. Help replays it.
  const tourId = isDm ? DM_TOUR_ID : PLAYER_TOUR_ID;
  const tourAlreadySeen = useSyncExternalStore(
    subscribeTourSeen,
    () => tourSeen(window.localStorage, tourId),
    () => true,
  );
  useEffect(() => {
    if (tourAlreadySeen) return;
    const timer = window.setTimeout(() => setTour(isDm ? "dm" : "player"), 1200);
    return () => clearTimeout(timer);
  }, [tourAlreadySeen, isDm]);
  const closeTour = useCallback(() => {
    markTourSeen(window.localStorage, tourId);
    window.dispatchEvent(new Event(TOUR_SEEN_EVENT));
    setTour(null);
  }, [tourId]);
  // Hosted narration audio was retired; there is no server-side playback to gate.
  const openingNarrationPlaying = false;
  const myName = mySheet?.name ?? "your character";
  const meId = me?.id ?? "";
  // Muted by the party lead: the server refuses the send, so the box says
  // so instead of letting the player type into a wall.
  const muted = Boolean(state.members.find((member) => member.userId === meId)?.muted);
  const globalTurnEnabled = Boolean(campaign?.gameSettings?.globalTurn?.enabled);
  const globalTurnState = campaign?.globalTurnState ?? null;
  const gate = useMemo(
    () =>
      composerGate({
        floor,
        sheets,
        meUserId: meId,
        kind,
        myName,
        leadPrivate,
        openingNarrationPlaying,
        globalTurnEnabled,
        globalTurnState,
        locale,
      }),
    [floor, sheets, meId, kind, myName, leadPrivate, openingNarrationPlaying, globalTurnEnabled, globalTurnState, locale],
  );
  // A mid-game joiner without a character is gated to creation first. The DM
  // runs no character, so the gate must never catch them.
  const needsCharacter = caps.needsCharacter && !mySheet && campaign?.status === "active";
  // Lead prompt: a newcomer's join note the DM has not narrated past yet.
  const joinNotice = latestUnintroducedJoin(messages);
  const showJoinBanner = steersStory && joinNotice !== null && dismissedJoinNotice !== joinNotice.id;
  const combatFloor = floor.mode === "hold" ? floor.next : floor;
  const initiativeFloor = combatFloor.mode === "initiative" ? combatFloor : null;
  const ownCombatTurn = Boolean(
    initiativeFloor &&
      mySheet &&
      state.encounter?.currentActorId === mySheet.id &&
      initiativeFloor.userIds.includes(me?.id ?? ""),
  );
  const combatLocked = floor.mode === "hold" && Boolean(floor.combat);

  const prevOwnCombatTurn = useRef(false);
  useEffect(() => {
    if (ownCombatTurn && !prevOwnCombatTurn.current) {
      setPanelTab("battle");
    }
    prevOwnCombatTurn.current = ownCombatTurn;
  }, [ownCombatTurn, setPanelTab]);

  const encounterTurnKey = `${state.encounter?.id}:${state.encounter?.round}:${state.encounter?.turnIndex}:${state.encounter?.currentActorId}`;
  const [combatChoiceState, setCombatChoiceState] = useState({
    key: encounterTurnKey,
    choices: [] as CombatChoice[],
  });
  if (combatChoiceState.key !== encounterTurnKey) {
    setCombatChoiceState({ key: encounterTurnKey, choices: [] });
  }
  const combatChoices = combatChoiceState.key === encounterTurnKey ? combatChoiceState.choices : EMPTY_COMBAT_CHOICES;
  const setCombatChoices = useCallback((choices: CombatChoice[]) => {
    setCombatChoiceState({ key: encounterTurnKey, choices });
  }, [encounterTurnKey]);

  const inCombat = Boolean(state.encounter && state.encounter.status === "active");

  const panelTabs = useMemo(
    () =>
      buildPanelTabs(
        {
          hasBattleMap: Boolean(state.battleMap),
          inCombat,
          mapsEnabled: campaign?.gameSettings?.mapsEnabled ?? true,
          hasSettings: Boolean(campaign),
          secretStory: caps.secretStory,
          adjudicates: caps.adjudicates,
          isLead,
        },
        locale,
      ),
    [state.battleMap, inCombat, campaign, caps.secretStory, caps.adjudicates, isLead, locale],
  );
  // Gates the Bonds sub-tab inside the Party panel.
  const relationshipsEnabled = campaign?.gameSettings?.relationships !== "off";

  const releaseFloor = useCallback(async () => {
    await fetch(`/api/campaigns/${campaignId}/floor`, { method: "POST" });
  }, [campaignId]);

  const submit = useCallback(
    async (event: FormEvent | null, combatTurn?: CombatTurnIntent) => {
      event?.preventDefault();
      const content = input.trim();
      const resolvedCombatTurn = combatTurn ?? (
        ownCombatTurn && state.encounter && mySheet && combatChoices.length > 0
          ? {
              encounterId: state.encounter.id,
              round: state.encounter.round,
              turnIndex: state.encounter.turnIndex,
              choices: combatChoices,
              prose: content || undefined,
            }
          : undefined
      );
      if ((!content && !resolvedCombatTurn) || sending || gate.inputBlocked || muted) {
        return;
      }
      setSending(true);
      setError("");
      try {
        // A lead direction goes one of two ways. Public is a visible note the
        // table can read and the DM answers now; private arms the same
        // one-turn steer the event presets use, so no character hears it and
        // it never enters the transcript.
        const [route, body] =
          kind === "narrate"
            ? ["dm/narrate", { content }]
            : kind === "lead"
              ? leadPrivate
                ? ["director", { oneShot: null, absoluteCommand: content }]
                : ["lead-note", { content }]
              : ["actions", resolvedCombatTurn ? { kind: "do", combatTurn: resolvedCombatTurn } : { content, kind }];
        const response = await fetch(`/api/campaigns/${campaignId}/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error || "Could not send your action.");
          return;
        }
        setInput("");
        setCombatChoices([]);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setSending(false);
      }
    },
    [campaignId, input, sending, gate.inputBlocked, muted, kind, leadPrivate, ownCombatTurn, state.encounter, mySheet, combatChoices, setCombatChoices],
  );

  const clearChatTarget = useCallback(() => setChatTarget(null), []);
  const selectChatView = useCallback(() => setMobileView("chat"), [setMobileView]);
  const selectPanelView = useCallback(
    (tab: PanelTab) => {
      setPanelTab(tab);
      setMobileView("panel");
    },
    [setPanelTab, setMobileView],
  );
  const bumpPins = useCallback(() => setPinsVersion((count) => count + 1), []);
  const openLoreCheck = useCallback(
    (message: CampaignMessage, selection: string) => setLoreCheck({ message, selection }),
    [],
  );

  // Story capture: how long the DM has been running the table without any of
  // it reaching the log. Recomputed from state the client already holds, so
  // it follows every message and every roll with no extra request
  // (src/lib/dm/beat-cadence.ts).
  const [beatSnoozedUntil, setBeatSnoozedUntil] = useState<string | null>(null);
  const beatThreshold = campaign?.gameSettings?.beatReminder ?? DEFAULT_BEAT_CADENCE;
  const storyCadence = useMemo(
    () =>
      caps.adjudicates
        ? beatCadence({
            messages: state.messages,
            rolls: state.rolls,
            threshold: beatThreshold,
            snoozedUntil: beatSnoozedUntil,
            now: new Date().toISOString(),
          })
        : QUIET_BEAT_CADENCE,
    [caps.adjudicates, state.messages, state.rolls, beatThreshold, beatSnoozedUntil],
  );
  const openStoryCapture = useCallback(() => selectPanelView("dm"), [selectPanelView]);
  // What a tour step needs on screen before it can point at anything: the
  // right side-panel tab, or on a phone the chat column.
  const hasBattleMap = Boolean(state.battleMap);
  const prepareTourStep = useCallback(
    (name: string) => {
      switch (name) {
        case "show-chat":
          setMobileView("chat");
          break;
        case "open-dm":
          selectPanelView("dm");
          break;
        case "open-party":
          selectPanelView("party");
          break;
        case "open-story":
          selectPanelView("story");
          break;
        case "open-map":
          selectPanelView(hasBattleMap ? "battle" : "map");
          break;
        case "open-chat":
          selectPanelView("chat");
          break;
      }
    },
    [selectPanelView, setMobileView, hasBattleMap],
  );
  const snoozeStory = useCallback(() => setBeatSnoozedUntil(snoozeUntil(Date.now())), []);

  const joinNoticeId = joinNotice?.id;
  const joinNoticeText = joinNotice?.content.slice(JOIN_NOTE_PREFIX.length);
  const joinBanner = useMemo(
    () =>
      showJoinBanner && joinNoticeId
        ? {
            text: joinNoticeText ?? "",
            onWriteIntro: () => {
              setKind("lead");
              composerRef.current?.focus();
            },
            onDismiss: () => setDismissedJoinNotice(joinNoticeId),
          }
        : null,
    [showJoinBanner, joinNoticeId, joinNoticeText],
  );

  if (!campaign || !me) {
    return null;
  }

  const storyDue = storyCadence.level !== "quiet";

  return (
    <main className="flex h-dvh flex-col">
      <SessionHeader
        title={campaign.title}
        scene={campaign.scene}
        user={me}
        voice={{
          campaignId: campaign.id,
          meUserId: me.id,
          roster: state.voiceRoster,
          speaking: state.voiceSpeaking,
          floorMode: floor.mode,
          floorUserIds:
            floor.mode === "spotlight" || floor.mode === "initiative" ? floor.userIds : [],
          turnEnforcement: campaign.gameSettings?.voice?.turnEnforcement ?? "soft",
          adjudicates: caps.adjudicates,
          steersStory,
          sayRangeRule: Boolean(campaign.gameSettings?.voice?.rules?.sayRange),
          audibilityVersion: state.voiceAudibilityVersion,
          meshSignal: state.voiceMeshSignal,
        }}
        dice3d={dice3d}
        onToggleDice3d={toggleDice3d}
        ambienceEnabled={Boolean(campaign.gameSettings?.ambienceEnabled)}
        ambience={ambience}
        onHelp={() => setHelpOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <SessionChatColumn
          state={state}
          loadOlderMessages={loadOlderMessages}
          campaignId={campaign.id}
          meUserId={me.id}
          steersStory={steersStory}
          visible={mobileView === "chat"}
          askOpen={askOpen}
          onAskOpenChange={setAskOpen}
          refreshAsks={refreshAsks}
          refreshFacts={refreshFacts}
          onError={setError}
          onLoreCheck={openLoreCheck}
          onRenarrate={setRenarrate}
          onPinned={bumpPins}
          onOpenClosingMessage={openClosingMessage}
          hasOpenedFinale={hasOpenedFinale}
        >
          {needsCharacter ? (
            <CharacterGate campaignId={campaign.id} />
          ) : (
            <Composer
              campaignId={campaign.id}
              sheets={sheets}
              meUserId={me.id}
              steersStory={steersStory || isLead}
              isDm={isDm}
              members={state.members}
              globalTurnEnabled={globalTurnEnabled}
              globalTurnState={globalTurnState}
              kind={kind}
              onKindChange={setKind}
              input={input}
              setInput={setInput}
              sending={sending}
              error={error}
              inputBlocked={gate.inputBlocked || muted}
               placeholder={muted ? tourCopy.mutedPlaceholder : gate.placeholder}
              dmStatus={dmStatus}
              pendingRolls={pendingRolls}
              floor={floor}
              spotlighted={gate.spotlighted}
              heldSpotlightNames={gate.heldSpotlightNames}
              encounter={state.encounter}
              onReleaseFloor={releaseFloor}
              joinBanner={joinBanner}
              composerRef={composerRef}
              directorArm={state.directorArm}
              leadPrivate={leadPrivate}
              onLeadPrivateChange={setLeadPrivate}
              storyCadence={storyCadence}
              onCaptureStory={openStoryCapture}
              onSnoozeStory={snoozeStory}
              combatInputMode={campaign.gameSettings?.combatInputMode ?? "hybrid"}
              combatChoices={combatChoices}
              onSubmit={submit}
              onCombatSubmit={(combatTurn) => void submit(null, combatTurn)}
              onOpenBattleTab={() => selectPanelView("battle")}
            />
          )}
        </SessionChatColumn>

        <SidePanel
          pinsVersion={pinsVersion}
          campaignId={campaign.id}
          sheets={sheets}
          members={state.members}
          meUserId={me.id}
          steersStory={steersStory}
          adjudicates={caps.adjudicates}
          messages={state.messages}
          dmIntents={state.dmIntents}
          floor={floor}
          directorArm={state.directorArm}
          isLead={isLead}
          leadUserId={campaign.leadUserId}
          canTransferLead={isLead || campaign.ownerUserId === me.id}
          spotlightUserIds={floor.mode === "spotlight" ? floor.userIds : []}
          onlineUserIds={state.online}
          auditLog={auditLog}
          locations={locations}
          chapters={state.chapters}
          notes={state.notes}
          facts={state.facts}
          characterEvents={state.characterEvents}
          refreshNotes={refreshNotes}
          refreshFacts={refreshFacts}
          sideThreads={state.sideThreads}
          refreshSideChat={refreshSideChat}
          whispers={state.whispers}
          whisperUnread={state.whisperUnread}
          refreshWhispers={refreshWhispers}
          chatTarget={chatTarget}
          onChatTargetHandled={clearChatTarget}
          onMessageUser={setChatTarget}
          mediaStatus={state.mediaStatus}
          inviteCode={campaign.inviteCode}
          midGameJoinOpen={campaign.gameSettings?.midGameJoinOpen ?? false}
          campaign={campaign}
          encounter={state.encounter}
          battleMap={state.battleMap}
          mapPing={state.mapPing}
          refreshBattleMap={refreshBattleMap}
          tabs={panelTabs}
          tab={panelTab}
          onTabChange={setPanelTab}
          pendingCount={pendingNoteCount}
          chatUnread={chatUnreadTotal}
          mobileVisible={mobileView === "panel"}
          relationshipsVersion={state.relationshipsVersion}
          relationshipsEnabled={relationshipsEnabled}
          beats={state.beats}
          storyDue={storyDue}
          rolls={state.rolls}
          ownCombatTurn={ownCombatTurn}
          mySheet={mySheet}
          combatLocked={combatLocked}
          sending={sending}
          onCombatSubmit={(combatTurn) => void submit(null, combatTurn)}
          combatChoices={combatChoices}
          onCombatChoicesChange={setCombatChoices}
          combatProse={input}
          onCombatProseChange={setInput}
        />
      </div>

      <BottomTabBar
        tabs={panelTabs}
        mobileView={mobileView}
        panelTab={panelTab}
        onSelectChat={selectChatView}
        onSelectPanel={selectPanelView}
        chatUnread={chatUnreadTotal}
        pendingCount={pendingNoteCount}
        storyDue={storyDue}
        steersStory={steersStory}
      />

      {dice3d ? (
        <DiceOverlay
          campaignId={campaignId}
          pendingRolls={pendingRolls}
          meUserId={me?.id ?? ""}
          latestRoll={state.latestRoll}
          sheets={state.sheets}
          enabled
        />
      ) : null}

      <HelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        tours={[
          {
            label: tourCopy.table,
            detail: tourCopy.tableDetail,
            onStart: () => setTour("player"),
          },
          ...(caps.adjudicates
            ? [
                {
                  label: tourCopy.dm,
                  detail: tourCopy.dmDetail,
                  onStart: () => setTour("dm"),
                },
              ]
            : []),
        ]}
      />

      <GuidedTour
        open={tour !== null}
        steps={tableTour(locale, tour === "dm" ? "dm" : "player")}
        onPrepare={prepareTourStep}
        onClose={closeTour}
      />

      {loreCheck ? (
        <LoreCheckDialog
          campaignId={campaign.id}
          message={loreCheck.message}
          selection={loreCheck.selection}
          steersStory={steersStory}
          onClose={() => setLoreCheck(null)}
        />
      ) : null}

      {renarrate ? (
        <RenarrateDialog
          campaignId={campaign.id}
          message={
            // Track the live message so the take counter in the dialog
            // follows the variant the reroll just added.
            messages.find((entry) => entry.id === renarrate.id) ?? renarrate
          }
          onClose={() => setRenarrate(null)}
        />
      ) : null}

      {myLevelUp && mySheet && dismissedLevelUp !== `${myLevelUp.characterId}:${myLevelUp.level}` ? (
        <Suspense fallback={null}>
          <LevelUpDialog
            campaignId={campaign.id}
            sheet={mySheet}
            targetLevel={myLevelUp.level}
            multiclassAllowed={campaign.gameSettings?.multiclassingEnabled ?? true}
            onDone={() => setDismissedLevelUp(`${myLevelUp.characterId}:${myLevelUp.level}`)}
          />
        </Suspense>
      ) : null}

      <ClosingMessageModal
        open={closingModalOpen}
        onOpenChange={setClosingModalOpen}
        campaignTitle={campaign.title}
        message={closingDmMessage}
        sheets={sheets}
        onTriggerCelebration={() => {
          setCelebrationActive(false);
          setTimeout(() => setCelebrationActive(true), 20);
        }}
      />

      <EndingCelebration
        active={celebrationActive}
        onClose={() => setCelebrationActive(false)}
        campaignTitle={campaign.title}
      />
    </main>
  );
}
