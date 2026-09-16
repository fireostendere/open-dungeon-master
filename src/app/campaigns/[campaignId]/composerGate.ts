import { isFloorExempt } from "@/lib/campaign-types";
import type { InputKind } from "@/app/campaigns/[campaignId]/Composer";
import type { Floor } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { Locale } from "@/lib/i18n";

// Whether this player may send right now, and what the box should say while
// they wait. Four things can hold the composer: the opening narration is
// still playing for this user, the lead has the floor held, it is somebody
// else's turn in combat, or the spotlight is on other players. Table talk
// (OOC) and lead directions never wait on the floor, and neither does the
// Ask strip, which does not come through this composer at all.
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
  locale?: Locale;
}) {
  const exempt = isFloorExempt(kind);
  const spotlighted =
    floor.mode === "spotlight"
      ? sheets.filter((sheet) => floor.userIds.includes(sheet.userId))
      : [];
  const floorBlocked = floor.mode === "spotlight" && !floor.userIds.includes(meUserId) && !exempt;
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
  // exactly the kind of thing someone wants to ask while it plays, and the
  // Ask strip is never blocked, so this only has to spare OOC.
  const narrationBlocked = openingNarrationPlaying && kind !== "ooc";
  const inputBlocked = floorBlocked || holdBlocked || initiativeBlocked || narrationBlocked;
  const copy = locale === "ru"
    ? { narrating: "Мастер задаёт сцену... (OOC доступен)", held: "Лидер отряда удерживает право слова... (OOC доступен)", turn: "Ход {name} в бою... (OOC доступен)", waiting: "Ожидание: {names}... (OOC доступен)", action: "Что делает {name}?", say: "Что говорит {name}?", narrate: "Опишите сцену. Сервер всё равно бросает кости.", ooc: "Внеигровая заметка для стола", private: "Лично сообщите Мастеру, что делать в следующем ходу", lead: "Направьте сюжет: Мастер должен учесть это" }
    : locale === "pl"
      ? { narrating: "Mistrz Gry opisuje scenę... (OOC nadal dostępne)", held: "Lider drużyny zatrzymał kolejkę na rozmowę... (OOC nadal dostępne)", turn: "Tura {name} w walce... (OOC nadal dostępne)", waiting: "Czekanie na: {names}... (OOC nadal dostępne)", action: "Co robi {name}?", say: "Co mówi {name}?", narrate: "Opisz scenę. Serwer nadal rzuca wszystkimi kośćmi.", ooc: "Notatka poza postacią dla stołu", private: "Prywatnie powiedz MG, co ma zrobić w następnej turze", lead: "Nadaj kierunek historii: MG musi go uwzględnić" }
      : { narrating: "The Dungeon Master is setting the scene... (OOC still open)", held: "The party lead has the floor held for discussion... (OOC still open)", turn: "{name}'s turn in combat... (OOC still open)", waiting: "Waiting on {names}... (OOC still open)", action: "What does {name} do?", say: "What does {name} say?", narrate: "Narrate the scene. The server still rolls every die.", ooc: "Out-of-character note to the table", private: "Tell the DM privately what to do with the next turn", lead: "Steer the story: a direction the DM must weave in" };
  const placeholder = narrationBlocked
    ? copy.narrating
    : holdBlocked
      ? copy.held
      : initiativeBlocked
        ? copy.turn.replace("{name}", () => floor.mode === "initiative" ? floor.currentName : "Another hero")
      : floorBlocked
          ? copy.waiting.replace("{names}", () => spotlighted.map((sheet) => sheet.name).join(", "))
          : kind === "do"
            ? copy.action.replace("{name}", () => myName)
            : kind === "say"
              ? copy.say.replace("{name}", () => myName)
              : kind === "narrate"
                ? copy.narrate
                : kind === "ooc"
                  ? copy.ooc
                  : leadPrivate
                    ? copy.private
                    : copy.lead;
  return { inputBlocked, placeholder, spotlighted, heldSpotlightNames };
}
