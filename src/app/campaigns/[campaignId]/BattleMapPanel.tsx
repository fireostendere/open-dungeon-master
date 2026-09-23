"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Footprints, Maximize2, MapPin, Swords, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BattleMapGrid, type MapOverlay } from "@/app/campaigns/[campaignId]/BattleMapGrid";
import {
  BoardToolRail,
  MeasureControls,
  PlaceTokenForm,
  TokenCard,
  type BoardTool,
  type CaughtToken,
} from "@/app/campaigns/[campaignId]/DmBoardControls";
import { findPath } from "@/lib/battlemap/movement";
import { moveCost, tileAt, TILE_FEET } from "@/lib/battlemap/types";
import type { TemplateShape } from "@/lib/battlemap/template";
import type { AdhocTokenKind } from "@/lib/battlemap/types";
import type { MapPing } from "@/lib/dm/board-logic";
import type { PlayerMapView } from "@/lib/battlemap/view";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

// The tactical battle map tab.
//
// For a player it is their fogged grid with click-to-move on their own turn,
// plus a ruler that measures the walk before they commit to it and a way to
// point at a tile. For a DM it is the same board with the fog off and hands
// on it: pick any piece up, put people and furniture down, hide a combatant
// the party has not met, and drop a measured area to see who is caught.
//
// Every rule is still enforced on the server. The ruler below runs the same
// pathfinder the move route runs, so what it promises and what the server
// allows cannot drift, and the DM's tools all POST to routes that check the
// board themselves (src/lib/dm/board.ts).

// A ping is a moment, not a state: it fades on its own.
const PING_MS = 2600;

export function BattleMapPanel({
  campaignId,
  view,
  encounter,
  sheets,
  refreshBattleMap,
  canDirect = false,
  canFocusPing = false,
  ping = null,
}: {
  campaignId: string;
  view: PlayerMapView;
  encounter: PublicEncounter | null;
  sheets: CharacterSheet[];
  refreshBattleMap: () => Promise<void>;
  // The DM seat. Deliberately not derived from view.fullVision: that flag
  // says what the projection withheld, not what this person may do.
  canDirect?: boolean;
  // Story authority, which is what the ping route accepts the focus flag
  // for; the DM seat alone is not what makes a ping open everyone's board.
  canFocusPing?: boolean;
  ping?: MapPing | null;
}) {
  const { locale, formatDistance } = useI18n();
  const copy = localeText(locale, { en: { denied: "That was not allowed.", reach: "Could not reach the table.", name: "Name it first.", measure: "That area could not be measured.", point: "Point at a tile", enlarge: "Enlarge battle map", directHeld: "Tap where it should stand. The round's movement is not charged for this.", measurePoint: "Now tap where it points.", measureStart: "Tap where the area starts.", pointTile: "Tap a tile and everyone looks at it.", place: "Name it, then tap a tile.", edit: "Tap a piece to pick it up or change it. Nothing here is charged against the round.", playerPoint: "Tap a tile to point at it.", sceneMove: "Tap anywhere you can walk. Nothing is being counted out here.", move: "Tap a highlighted tile to move", left: "left this round", turn: "You can move on your turn. The shroud shows what your character cannot see.", none: "You have no token on this field.", hidden: "hidden", ground: "The ground here", map: "Battle map, round" }, ru: { denied: "Это не разрешено.", reach: "Не удалось связаться со столом.", name: "Сначала укажите имя.", measure: "Не удалось измерить область.", point: "Указать на клетку", enlarge: "Развернуть карту боя", directHeld: "Нажмите, где он должен стоять. Перемещение в раунде не расходуется.", measurePoint: "Теперь нажмите, куда она указывает.", measureStart: "Нажмите, где начинается область.", pointTile: "Нажмите на клетку, и все увидят её.", place: "Назовите, затем нажмите клетку.", edit: "Нажмите на фигуру, чтобы выбрать или изменить её. Это не расходует перемещение в раунде.", playerPoint: "Нажмите на клетку, чтобы указать на неё.", sceneMove: "Нажмите куда хотите пойти. Здесь ничего не отсчитывается.", move: "Нажмите на подсвеченную клетку для перемещения", left: "осталось в этом раунде", turn: "Вы сможете двигаться в свой ход. Туман скрывает то, чего персонаж не видит.", none: "У вас нет токена на этом поле.", hidden: "скрыт", ground: "Земля здесь", map: "Карта боя, раунд" } });
  const [enlarged, setEnlarged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pointing, setPointing] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [handledPing, setHandledPing] = useState<number | null>(null);
  const [expiredPing, setExpiredPing] = useState<number | null>(null);

  // DM tools.
  const [tool, setTool] = useState<BoardTool>("handle");
  const [held, setHeld] = useState<string | null>(null);
  const [cardTokenId, setCardTokenId] = useState<string | null>(null);
  const [placeKind, setPlaceKind] = useState<AdhocTokenKind>("npc");
  const [placeName, setPlaceName] = useState("");
  const [shape, setShape] = useState<TemplateShape>("sphere");
  const [sizeFeet, setSizeFeet] = useState(20);
  // A measure belongs to the board it was taken on. Both carry the map id so
  // a new board simply makes them stale, rather than an effect having to
  // remember to clear them.
  const [measure, setMeasure] = useState<
    { mapId: string; tiles: number[]; caught: CaughtToken[] } | null
  >(null);
  const [measureOrigin, setMeasureOrigin] = useState<
    { mapId: string; x: number; y: number } | null
  >(null);
  const liveMeasure = measure?.mapId === view.mapId ? measure : null;
  const liveOrigin = measureOrigin?.mapId === view.mapId ? measureOrigin : null;

  const scene = view.board === "scene";
  const canMove = view.reachable.length > 0;

  // A focusing ping opens the board on every client. That is an adjustment
  // made while rendering because the prop changed, not an effect: an effect
  // would render the closed dialog first and then flip it.
  if (ping && ping.at !== handledPing) {
    setHandledPing(ping.at);
    if (ping.focus) {
      setEnlarged(true);
    }
  }
  // The ring animates itself, so a ping needs no state beyond "has this one
  // been up long enough": it is the prop until the timer says otherwise.
  const pings = useMemo(
    () => (ping && ping.at !== expiredPing ? [ping] : []),
    [ping, expiredPing],
  );
  useEffect(() => {
    if (!ping) {
      return;
    }
    const timer = setTimeout(() => setExpiredPing(ping.at), PING_MS);
    return () => clearTimeout(timer);
  }, [ping]);

  async function post(path: string, body: unknown): Promise<boolean> {
    if (busy) {
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? copy.denied);
        return false;
      }
      return true;
    } catch {
      setError(copy.reach);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(x: number, y: number) {
    if (await post("/battle-map/move", { x, y })) {
      setHover(null);
    }
    await refreshBattleMap();
  }

  async function sendPing(x: number, y: number) {
    setPointing(false);
    await post("/battle-map/ping", { x, y, focus: canFocusPing });
  }

  async function board(body: unknown) {
    if (await post("/dm/board", body)) {
      await refreshBattleMap();
      return true;
    }
    return false;
  }

  const tokensById = useMemo(
    () => new Map(view.tokens.map((token) => [token.id, token])),
    [view.tokens],
  );

  // The drag ruler. It runs the server's own pathfinder over the projection
  // the viewer holds, so it can only ever promise a route the move route
  // would also allow; over budget it turns red rather than disappearing,
  // because "how far past my speed is this" is the question being asked.
  //
  // It routes around the tokens this viewer can see, which for a player does
  // not include one the DM has hidden. That is the right trade: the server's
  // reachable set does count the hidden token, so the tile still refuses the
  // click, and a ruler that bent around an invisible ambusher would give it
  // away.
  const ruler = useMemo(() => {
    // Whoever is being measured: the piece the DM picked up, or the player's
    // own character.
    const fromId = held ?? view.myTokenId;
    if (!hover || !fromId) {
      return null;
    }
    const from = view.tokens.find((token) => token.id === fromId);
    if (!from || (from.x === hover.x && from.y === hover.y)) {
      return null;
    }
    const occupied = new Set(
      view.tokens
        .filter((token) => token.id !== from.id)
        .map((token) => token.y * view.width + token.x),
    );
    const path = findPath(view.terrain, view.width, view.height, occupied, from, hover);
    if (!path?.length) {
      return null;
    }
    const cost = path.reduce(
      (total, step) => total + moveCost(tileAt(view.terrain, view.width, step.x, step.y)),
      0,
    );
    return {
      path: [{ x: from.x, y: from.y }, ...path],
      label: formatDistance(cost * TILE_FEET),
      // The DM spends no budget, so nothing they measure is ever too far.
      overBudget: held === null && cost > view.budgetLeft,
    };
  }, [hover, held, view, formatDistance]);

  const overlay = useMemo<MapOverlay>(
    () => ({
      template: liveMeasure?.tiles,
      ruler,
      pings,
      selectedTokenId: held,
    }),
    [liveMeasure, ruler, pings, held],
  );

  // What a tap on a tile means right now. One place, because "which mode am
  // I in" is the only thing that changes between them.
  // Not memoized on purpose: the grid reads its handlers through refs and
  // its memo only checks whether one was passed, so a fresh identity every
  // render costs nothing and a dependency list here would be a trap.
  function handleTile(x: number, y: number) {
      if (pointing) {
        void sendPing(x, y);
        return;
      }
      if (canDirect) {
        if (tool === "point") {
          void sendPing(x, y);
          return;
        }
        if (tool === "place") {
          if (!placeName.trim()) {
            setError(copy.name);
            return;
          }
          void board({ do: "add", kind: placeKind, name: placeName.trim(), x, y }).then((ok) => {
            if (ok) {
              setPlaceName("");
            }
          });
          return;
        }
        if (tool === "measure") {
          if (!liveOrigin) {
            setMeasureOrigin({ mapId: view.mapId, x, y });
            setMeasure(null);
            return;
          }
          void (async () => {
            setBusy(true);
            setError("");
            try {
              const response = await fetch(`/api/campaigns/${campaignId}/dm/board`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  do: "template",
                  shape,
                  origin: { x: liveOrigin.x, y: liveOrigin.y },
                  target: { x, y },
                  sizeFeet,
                }),
              });
              const data = (await response.json().catch(() => ({}))) as {
                tiles?: number[];
                caught?: CaughtToken[];
                error?: string;
              };
              if (!response.ok) {
                setError(data.error ?? copy.measure);
                return;
              }
              setMeasure({
                mapId: view.mapId,
                tiles: data.tiles ?? [],
                caught: data.caught ?? [],
              });
              setMeasureOrigin(null);
            } finally {
              setBusy(false);
            }
          })();
          return;
        }
        if (held) {
          void board({ do: "place", tokenId: held, x, y }).then((ok) => {
            if (ok) {
              setHeld(null);
              setCardTokenId(null);
            }
          });
          return;
        }
        return;
      }
      if (canMove) {
        void moveTo(x, y);
      }
  }

  // Every tile takes a tap when the DM is placing something, when anyone is
  // pointing, or when an area is being measured. Otherwise the reachable
  // overlay is the whole clickable surface, exactly as before.
  const everyTileClickable =
    pointing || (canDirect && (tool !== "handle" || held !== null));

  const card = cardTokenId ? tokensById.get(cardTokenId) : undefined;
  const grid = (
    <BattleMapGrid
      view={view}
      sheets={sheets}
      onTileClick={canDirect || canMove || pointing ? handleTile : undefined}
      onTileHover={
        canMove || held
          ? (x, y) => setHover(y === null ? null : { x, y })
          : undefined
      }
      onTokenClick={canDirect ? (tokenId) => setCardTokenId(tokenId) : undefined}
      everyTileClickable={everyTileClickable}
      overlay={overlay}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-stone-200">
          {scene ? (
            <>
              <Footprints className="size-4 text-amber-400" />
              Exploring
            </>
          ) : (
            <>
              <Swords className="size-4 text-red-400" />
              Round {view.round}
              {view.currentTurnName ? (
                <span className="text-xs font-normal text-stone-400">
                  {view.currentTurnName}&apos;s turn
                </span>
              ) : null}
            </>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {canDirect ? null : (
            <button
              type="button"
              onClick={() => setPointing((current) => !current)}
              title={copy.point}
              aria-pressed={pointing}
              className={`rounded p-1 ${
                pointing ? "bg-amber-950/60 text-amber-300" : "text-stone-400 hover:bg-stone-900"
              }`}
            >
              <MapPin className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setEnlarged(true)}
            className="rounded p-1 text-stone-400 hover:bg-stone-900 hover:text-stone-200"
            aria-label={copy.enlarge}
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>
      {canDirect ? (
        <BoardToolRail
          tool={tool}
          onTool={(next) => {
            setTool(next);
            setHeld(null);
            setMeasureOrigin(null);
          }}
          disabled={busy}
        />
      ) : null}
      {grid}
      {canDirect && tool === "place" ? (
        <PlaceTokenForm
          kind={placeKind}
          name={placeName}
          onKind={setPlaceKind}
          onName={setPlaceName}
        />
      ) : null}
      {canDirect && tool === "measure" ? (
        <MeasureControls
          shape={shape}
          sizeFeet={sizeFeet}
          caught={liveMeasure?.caught ?? []}
          onShape={setShape}
          onSize={setSizeFeet}
          onClear={() => {
            setMeasure(null);
            setMeasureOrigin(null);
          }}
        />
      ) : null}
      {card ? (
        <TokenCard
          token={card}
          hp={view.tokenHp?.[card.id]}
          held={held === card.id}
          busy={busy}
          onHold={() => {
            setHeld((current) => (current === card.id ? null : card.id));
            setTool("handle");
          }}
          onVisibility={(hidden) => {
            void board({ do: "visibility", tokenId: card.id, hidden });
          }}
          onRemove={() => {
            void board({ do: "remove", tokenId: card.id }).then((ok) => {
              if (ok) {
                setCardTokenId(null);
              }
            });
          }}
          onClose={() => setCardTokenId(null)}
        />
      ) : null}
      <p className="text-[11px] leading-4 text-stone-500">
        {canDirect
          ? held
            ? copy.directHeld
            : tool === "measure"
              ? liveOrigin
                ? copy.measurePoint
                : copy.measureStart
              : tool === "point"
                ? copy.pointTile
                : tool === "place"
                  ? copy.place
                  : copy.edit
          : pointing
            ? copy.playerPoint
            : canMove
              ? scene
                ? copy.sceneMove
                : (locale === "ru"
                    ? `${copy.move} (${formatDistance(view.budgetLeft * TILE_FEET)} ${copy.left}).`
                    : `${copy.move} (${formatDistance(view.budgetLeft * TILE_FEET)} ${copy.left}).`)
              : view.myTokenId
                ? copy.turn
                : copy.none}
      </p>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {encounter?.orderReady ? (
        <ol className="flex flex-wrap gap-1 text-[11px] text-stone-400">
          {encounter.order.map((entry, index) => (
            <li
              key={`${entry.id}-${index}`}
              className={
                index === encounter.turnIndex
                  ? "rounded bg-amber-950/60 px-1.5 py-0.5 font-medium text-amber-300"
                  : "rounded bg-stone-900 px-1.5 py-0.5"
              }
            >
              {entry.name}
               {entry.hidden ? ` (${copy.hidden})` : ""}
            </li>
          ))}
        </ol>
      ) : null}
      <Dialog.Root open={enlarged} onOpenChange={setEnlarged}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/80" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto panel rounded-xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <Dialog.Title className="font-serif text-stone-100">
                 {scene ? copy.ground : `${copy.map} ${view.round}`}
              </Dialog.Title>
              <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            {grid}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
