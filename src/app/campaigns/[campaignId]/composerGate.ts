import { globalTurnSubmitted, isFloorExempt } from "@/lib/campaign-types";
import type { InputKind } from "@/app/campaigns/[campaignId]/Composer";
import type { Floor } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { Locale } from "@/lib/i18n";
import type { GlobalTurnState } from "@/lib/campaign-types";

// Whether this player may send right now, and what the box should say while
// they wait. Four things can hold the composer: the opening narration is
// still playing for this user, the lead has the floor held, it is somebody
// else's turn in combat, or the spotlight is on other players. Table talk
// (OOC), Ask and lead directions never wait on the floor.
//
// Pure so the reading is easy to follow in one place; SessionView memoizes
// the lists it hands in.
export function composerGate({
  floor,
  sheets,
  meUserId,
  kind,
  myName,
  leadPrivate,
  openingNarrationPlaying,
  globalTurnEnabled,
  globalTurnState,
  locale = "en",
}: {
  floor: Floor;
  sheets: CharacterSheet[];
  meUserId: string;
  kind: InputKind;
  myName: string;
  leadPrivate: boolean;
  // The campaign's first DM passage is being read aloud to this user.
  openingNarrationPlaying: boolean;
  globalTurnEnabled?: boolean;
  globalTurnState?: GlobalTurnState | null;
  locale?: Locale;
}) {
  const combat = floor.mode === "initiative" || (floor.mode === "hold" && (floor.next.mode === "initiative" || !!floor.combat));
  const exempt = isFloorExempt(kind) && !(combat && kind === "lead");
  const spotlighted =
    floor.mode === "spotlight"
      ? sheets.filter((sheet) => floor.userIds.includes(sheet.userId))
      : [];
  const floorBlocked = floor.mode === "spotlight" && (!floor.userIds.includes(meUserId) || floor.respondedUserIds.includes(meUserId)) && !exempt;
  // Held responses: the lead has not opened the floor after the last DM
  // narration.
  const holdBlocked = floor.mode === "hold" && !exempt;
  // Combat: only the current-turn player acts; everyone else waits.
  const initiativeBlocked =
    floor.mode === "initiative" && !floor.userIds.includes(meUserId) && !exempt;
  const heldSpotlightNames =
    floor.mode === "hold" && floor.next.mode === "spotlight"
      ? sheets
          .filter(
            (sheet) =>
              floor.mode === "hold" &&
              floor.next.mode === "spotlight" &&
              floor.next.userIds.includes(sheet.userId),
          )
          .map((sheet) => sheet.name)
      : [];
  // The opening narration gets the table's attention. A question about it is
  // exactly the kind of thing someone wants to ask while it plays.
  const narrationBlocked = openingNarrationPlaying && kind !== "ooc" && kind !== "ask";

  // Global-turn gate: a player has no composer at all before the round
  // start trigger or while MCP is resolving a sealed round. This includes OOC
  // in the shared composer: while locked, Ask stays available because it is
  // outside the turn. Once active, the first Do locks this character.
  let turnActionBlocked = false;
  let turnActionReason = "";
  if (kind !== "ask" && !combat && globalTurnEnabled && globalTurnState) {
    const mySheet = sheets.find((s) => s.userId === meUserId && !s.isCompanion);
    if (mySheet && globalTurnState.phase === "waiting") {
      turnActionBlocked = true;
      turnActionReason =
        locale === "ru"
          ? "Ход ещё не открыт. MCP-Мастер завершает сцену и сам откроет следующий раунд."
          : "The turn is not open yet. The MCP DM will unlock the next round after finishing the scene.";
    } else if (
      mySheet &&
      (globalTurnState.phase === "ready" || globalTurnState.phase === "resolving")
    ) {
      turnActionBlocked = true;
      turnActionReason =
        locale === "ru"
          ? "Раунд уже передан MCP-Мастеру. Дождитесь завершения его хода."
          : "The round is with the MCP Dungeon Master. Wait until its turn is complete.";
    } else if (mySheet && kind === "do") {
      const usage = globalTurnState.actionsByCharacter[mySheet.id];
      if (globalTurnSubmitted(usage)) {
        turnActionBlocked = true;
        turnActionReason =
          locale === "ru"
            ? "Ход уже отправлен. Дождитесь, пока Мастер передаст управление игрокам. OOC и «Спросить Мастера» доступны."
            : "Turn already submitted. Wait for the DM to return control to the players. OOC and Ask remain available.";
      }
    }
  }

  const inputBlocked = floorBlocked || holdBlocked || initiativeBlocked || narrationBlocked || turnActionBlocked;
  const copy = locale === "ru"
    ? { narrating: "Мастер задаёт сцену... (OOC доступен)", resolving: "Ход {name} у Мастера — сейчас ничей ход. Следующий откроется, когда Мастер допишет. (OOC доступен)", held: "Лидер отряда удерживает право слова... (OOC доступен)", turn: "Ход {name} в бою... (OOC доступен)", waiting: "Ожидание: {names}... (OOC доступен)", action: "Что делает или говорит {name}?", ask: "Спросите Мастера; вопрос не тратит ход", narrate: "Опишите сцену. Сервер всё равно бросает кости.", ooc: "Внеигровая заметка для стола", private: "Лично сообщите Мастеру, что делать в следующем ходу", lead: "Направьте сюжет: Мастер должен учесть это" }
    : { narrating: "The Dungeon Master is setting the scene... (OOC still open)", resolving: "The DM is resolving {name}'s turn — it is nobody's turn until they finish. (OOC still open)", held: "The party lead has the floor held for discussion... (OOC still open)", turn: "{name}'s turn in combat... (OOC still open)", waiting: "Waiting on {names}... (OOC still open)", action: "What does {name} do or say?", ask: "Ask the DM; it does not use your turn", narrate: "Narrate the scene. The server still rolls every die.", ooc: "Out-of-character note to the table", private: "Tell the DM privately what to do with the next turn", lead: "Steer the story: a direction the DM must weave in" };
  const placeholder = turnActionBlocked
    ? turnActionReason
    : narrationBlocked
      ? copy.narrating
      : holdBlocked
        ? floor.mode === "hold" && floor.combat
          ? copy.resolving.replace("{name}", () => sheets.find((sheet) => floor.mode === "hold" && sheet.id === floor.combat?.characterId)?.name ?? "…")
          : copy.held
        : initiativeBlocked
          ? copy.turn.replace("{name}", () => floor.mode === "initiative" ? floor.currentName : "Another hero")
        : floorBlocked
            ? copy.waiting.replace("{names}", () => spotlighted.map((sheet) => sheet.name).join(", "))
            : kind === "do"
              ? copy.action.replace("{name}", () => myName)
              : kind === "narrate"
                  ? copy.narrate
                  : kind === "ask"
                    ? copy.ask
                  : kind === "ooc"
                    ? copy.ooc
                    : leadPrivate
                      ? copy.private
                      : copy.lead;
  return { inputBlocked, placeholder, spotlighted, heldSpotlightNames, turnActionBlocked };
}
