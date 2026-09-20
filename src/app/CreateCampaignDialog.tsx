"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { submitWorldSetup } from "@/app/WorldSetupFields";
import { submitContentImport } from "@/app/workshop/ContentImportPicker";
import { groupByFranchise, type WorldPackSummary } from "@/lib/worlds/summary";
import type { Genre } from "@/lib/schemas/game-settings";
import { useI18n } from "@/lib/i18n";
import {
  applyPack,
  clearPack,
  DEFAULT_DRAFT,
  type CampaignDraft,
  type WizardGates,
} from "@/app/create-campaign/draft";
import { PremiseStep } from "@/app/create-campaign/PremiseStep";
import { WorldStep } from "@/app/create-campaign/WorldStep";
import { PartyStep } from "@/app/create-campaign/PartyStep";
import { FeelStep } from "@/app/create-campaign/FeelStep";
import { AdvancedStep } from "@/app/create-campaign/AdvancedStep";
import { ReviewStep } from "@/app/create-campaign/ReviewStep";

const COPY = {
  en: {
    createFailed: "Could not create the campaign.",
    serverFailed: "Could not reach the server.",
    soloTitle: "New solo adventure",
    campaignTitle: "New campaign",
    premiseTitle: "The premise",
    premiseSoloBlurb: "Name the adventure and decide who narrates.",
    premiseBlurb: "Name it and decide who runs the table.",
    worldTitle: "The world",
    worldBlurb: "Pick a setting and say what the story is about.",
    partyTitle: "The party",
    partySoloBlurb: "Where your hero begins.",
    partyBlurb: "Who is adventuring, and how hard the road is.",
    feelTitle: "The feel",
    feelBlurb: "What is on at the table. Flip any of these later in the lobby too.",
    advancedTitle: "Advanced",
    advancedBlurb: "Variant rules, house rules, prep and live voice. All optional.",
    reviewTitle: "Review",
    reviewBlurb: "Ready the table.",
    createAdventure: "Create adventure",
    createCampaign: "Create campaign",
  },
  ru: {
    createFailed: "Не удалось создать кампанию.",
    serverFailed: "Не удалось связаться с сервером.",
    soloTitle: "Новое одиночное приключение",
    campaignTitle: "Новая кампания",
    premiseTitle: "Завязка",
    premiseSoloBlurb: "Назовите приключение и решите, кто будет вести повествование.",
    premiseBlurb: "Назовите кампанию и решите, кто будет вести игру.",
    worldTitle: "Мир",
    worldBlurb: "Выберите сеттинг и расскажите, о чём будет история.",
    partyTitle: "Группа",
    partySoloBlurb: "Определите, с чего начнёт ваш герой.",
    partyBlurb: "Кто отправляется в приключение и насколько трудным будет путь.",
    feelTitle: "Атмосфера игры",
    feelBlurb: "Выберите, что будет включено за столом. Всё это можно изменить позже в лобби.",
    advancedTitle: "Дополнительно",
    advancedBlurb: "Вариантные и домашние правила, подготовка и голосовой чат. Всё необязательно.",
    reviewTitle: "Проверка",
    reviewBlurb: "Подготовьте стол к игре.",
    createAdventure: "Создать приключение",
    createCampaign: "Создать кампанию",
  },
  pl: {
    createFailed: "Nie udało się utworzyć kampanii.",
    serverFailed: "Nie udało się połączyć z serwerem.",
    soloTitle: "Nowa przygoda solo",
    campaignTitle: "Nowa kampania",
    premiseTitle: "Założenia",
    premiseSoloBlurb: "Nadaj przygodzie nazwę i zdecyduj, kto prowadzi narrację.",
    premiseBlurb: "Nadaj kampanii nazwę i zdecyduj, kto prowadzi stół.",
    worldTitle: "Świat",
    worldBlurb: "Wybierz setting i określ, o czym będzie historia.",
    partyTitle: "Drużyna",
    partySoloBlurb: "Określ, gdzie zaczyna twój bohater.",
    partyBlurb: "Kto wyrusza na przygodę i jak trudna będzie droga.",
    feelTitle: "Styl rozgrywki",
    feelBlurb: "Wybierz, co ma być aktywne przy stole. Wszystko można później zmienić w lobby.",
    advancedTitle: "Zaawansowane",
    advancedBlurb: "Zasady wariantowe i domowe, przygotowanie oraz czat głosowy. Wszystko opcjonalne.",
    reviewTitle: "Podsumowanie",
    reviewBlurb: "Przygotuj stół do gry.",
    createAdventure: "Utwórz przygodę",
    createCampaign: "Utwórz kampanię",
  },
} as const;

// The slice of /api/capabilities this dialog gates on. null means the
// endpoint never answered, and the dialog assumes everything is available:
// a flaky capability check must never block creating a campaign.
type ServerCapabilities = {
  story: { configured: boolean; reachable: boolean };
  images: { configured: boolean };
  tts: { configured: boolean };
};

// The new-campaign wizard: six screens over one draft (src/app/create-
// campaign/draft.ts), paced one decision at a time instead of one long form.
// The steps only draw fields; every default, every gate and the payload that
// leaves for the server are decided here.
//
// solo: creates a one-player campaign (maxPlayers 1); the player count is
// hidden and the lobby streamlines itself for a party of one.
//
// Some game settings are deliberately not offered here; scripts/test-create-
// campaign-options.mjs holds the list and fails if one goes missing without a
// reason. `targetParty` is one of them: it is the stand-in party a workshop
// budgets prep against, and a campaign reads its real character sheets
// instead (docs/workshop-plan.md section 1.1).
export function CreateCampaignDialog({
  open,
  onOpenChange,
  onCreated,
  solo = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (campaignId: string) => void;
  solo?: boolean;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const [draft, setDraft] = useState<CampaignDraft>(DEFAULT_DRAFT);
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (changes: Partial<CampaignDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  // Everything the AI narrator brings with it. A table running its own game
  // still gets the rules engine, the maps and the dice; what it does not get
  // is a second author, so those settings are hidden rather than shown
  // switched off with no explanation.
  const aiNarrates = draft.dmMode !== "human";

  // "Known missing" is an admin's positive statement (provider "none" or no
  // backend at all), which hides the AI seat. "Unreachable" is a configured
  // backend that is not answering, which keeps the seat but warns.
  const storyKnownMissing = capabilities ? !capabilities.story.configured : false;
  const storyUnreachable = capabilities
    ? capabilities.story.configured && !capabilities.story.reachable
    : false;
  const gates: WizardGates = {
    solo,
    aiNarrates,
    storyKnownMissing,
    storyUnreachable,
    ttsAvailable: capabilities ? capabilities.tts.configured : true,
    mapsAvailable: capabilities ? capabilities.images.configured : true,
  };

  // Fetched rather than imported: the pack files are read off disk on the
  // server, and the summaries are all a picker needs.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void fetch("/api/worlds")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .then((data) => {
        if (!cancelled) {
          setPacks(Array.isArray(data.packs) ? data.packs : []);
        }
      })
      .catch(() => {
        // No packs installed is a valid state; the section simply hides.
      });
    void fetch("/api/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ServerCapabilities | null) => {
        if (cancelled || !data?.story) {
          return;
        }
        setCapabilities(data);
        // Defaults follow reality: a table should not discover on turn one
        // that the AI seat was never fillable.
        setDraft((current) => ({
          ...current,
          dmMode: !data.story.configured || !data.story.reachable ? "human" : current.dmMode,
          ttsEnabled: data.tts?.configured ? current.ttsEnabled : false,
          mapsEnabled: data.images?.configured ? current.mapsEnabled : false,
        }));
      })
      .catch(() => {
        // No answer is not "no AI": without capabilities the dialog offers
        // everything, exactly as it did before the endpoint existed.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const franchises = useMemo(() => groupByFranchise(packs), [packs]);
  const selectedPack = packs.find((pack) => pack.id === draft.worldPack) ?? null;

  const choosePack = (pack: WorldPackSummary) => setDraft((current) => applyPack(current, pack));
  const dropPack = () => setDraft((current) => clearPack(current, selectedPack));
  // Picking a bare genre by hand leaves the pack. A pack is defined as its
  // baseGenre plus overrides, so letting the two disagree would blend the
  // pack's flavor over the wrong preset and overlay its monsters onto the
  // wrong bestiary catalog.
  const pickGenre = (genre: Genre) =>
    setDraft((current) => ({
      ...(current.worldPack ? clearPack(current, selectedPack) : current),
      genre,
    }));

  async function submit() {
    if (busy || (solo && storyKnownMissing)) {
      return;
    }
    const {
      title,
      description,
      theme,
      maxPlayers,
      startingLevel,
      difficulty,
      dmMode,
      genre,
      customGenreText,
      aiStorySetup,
      campaignLength,
      dicePolicy,
      dmDifficulty,
      ttsEnabled,
      ttsVoice,
      mapsEnabled,
      ambienceEnabled,
      ambienceAuto,
      multiclassingEnabled,
      midGameJoinOpen,
      holdSubmissions,
      narrationGuard,
      relationships,
      romance,
      worldSimulation,
      inventoryApprovals,
      variantRules,
      companions,
      maxCompanions,
      maxGuests,
      worldPack,
      voiceChat,
      unitSystem,
      combatMode,
      houseRules,
      loreDrafts,
      contentImport,
    } = draft;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          theme: theme.trim(),
          maxPlayers: solo ? 1 : maxPlayers,
          startingLevel,
          difficulty,
          gameSettings: {
            dmMode,
            genre,
            customGenreText: customGenreText.trim(),
            aiStorySetup: aiNarrates && aiStorySetup,
            campaignLength,
            dicePolicy,
            dmDifficulty,
            ttsEnabled,
            ttsVoice,
            mapsEnabled,
            ambienceEnabled,
            ambienceAuto: ambienceEnabled && ambienceAuto,
            multiclassingEnabled,
            midGameJoinOpen,
            holdSubmissions,
            narrationGuard: aiNarrates && narrationGuard,
            relationships,
            // Romance rides on the bond meter, so it cannot be on without it.
            romance: relationships === "off" ? "off" : romance,
            worldSimulation: aiNarrates && worldSimulation,
            inventoryApprovals,
            variantRules,
            companions: aiNarrates ? companions : "off",
            maxCompanions,
            maxGuests,
            worldPack,
            voice: voiceChat,
            unitSystem,
            combatMode,
            // Game settings fields deliberately not offered at initial creation:
            //
            // `stages` trades turn quality for speed on a slow local model,
            // which is an operator decision, not a table decision, so it
            // stays in the lobby's settings panel where the labels can
            // explain which stages actually save a model call.
            //
            // `beatReminder` is how often a human DM is nudged to write down
            // the story they told out loud. Nobody knows their answer before
            // they have run a session, and the nudge is the thing that
            // teaches them they want one, so it lives in the settings panel
            // they are already looking at when it fires.
            //
            // `dmAssist` is which parts of the game an assisted-mode DM hands
            // to the AI. Picking "I run the game, with AI help" on the first
            // step is already the answer to "do you want help"; which help,
            // and when, is a question a person answers at the table with the
            // console in front of them, so all three start on and the
            // settings panel shows them only once the mode is assisted.
            //
            // `globalTurn` is pacing and turn timers (turn timeouts, quorum)
            // for an active table, tuned in the Party and Lead panels during play
            // rather than before characters or participants exist.
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || copy.createFailed);
        return;
      }
      // House rules and starting lore land right after the campaign row
      // exists; anything that fails to post can be re-entered in the lobby.
      await submitWorldSetup(data.campaign.id, houseRules, loreDrafts);
      // The workshop import goes last so its house rules win over the ones
      // typed in this dialog: choosing a prepared workshop is the more
      // deliberate of the two, and the picker says which it will do.
      await submitContentImport(data.campaign.id, contentImport);
      onCreated(data.campaign.id);
    } catch {
      setError(copy.serverFailed);
    } finally {
      setBusy(false);
    }
  }

  const stepProps = { draft, patch, gates };
  const title = solo ? copy.soloTitle : copy.campaignTitle;

  // A step is dropped when nothing on it applies. Today every step keeps at
  // least one field in every mode (voice chat leaves the Advanced step on a
  // solo table, but the variant rules and prep stay), so the filter is there
  // for the mode that changes that, not for one that exists now.
  const steps = (
    [
      {
        key: "premise",
        title: copy.premiseTitle,
        blurb: solo ? copy.premiseSoloBlurb : copy.premiseBlurb,
        content: (
          <PremiseStep
            {...stepProps}
            packs={packs}
            franchises={franchises}
            selectedPack={selectedPack}
            onChoosePack={choosePack}
            onClearPack={dropPack}
          />
        ),
        canContinue: draft.title.trim().length > 0,
        applies: true,
      },
      {
        key: "world",
        title: copy.worldTitle,
        blurb: copy.worldBlurb,
        content: <WorldStep {...stepProps} onPickGenre={pickGenre} />,
        applies: true,
      },
      {
        key: "party",
        title: copy.partyTitle,
        blurb: solo ? copy.partySoloBlurb : copy.partyBlurb,
        content: <PartyStep {...stepProps} />,
        applies: true,
      },
      {
        key: "feel",
        title: copy.feelTitle,
        blurb: copy.feelBlurb,
        content: <FeelStep {...stepProps} />,
        applies: true,
      },
      {
        key: "advanced",
        title: copy.advancedTitle,
        blurb: copy.advancedBlurb,
        content: <AdvancedStep {...stepProps} />,
        applies: true,
      },
      {
        key: "review",
        title: copy.reviewTitle,
        blurb: copy.reviewBlurb,
        content: <ReviewStep {...stepProps} selectedPack={selectedPack} error={error} />,
        canContinue: !busy && !(solo && storyKnownMissing),
        applies: true,
      },
    ] satisfies Array<WizardStep & { applies: boolean }>
  ).filter((step) => step.applies);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        {/* A fixed height rather than a cap: the wizard's steps sit side by
            side and each scrolls on its own, so the panel has to be the
            thing that decides how tall a step may be. 90vh reads as a full
            sheet on a phone; the rem cap keeps it a dialog on a monitor. */}
        <Dialog.Content className="panel fixed left-1/2 top-1/2 flex h-[min(90vh,46rem)] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl p-6">
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Close className="absolute right-5 top-5 z-10 rounded p-1 text-stone-400 hover:bg-stone-900">
            <X className="size-4" />
          </Dialog.Close>
          <Wizard
            title={title}
            steps={steps}
            onDone={() => void submit()}
            onCancel={() => onOpenChange(false)}
            doneLabel={
              <>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {solo ? copy.createAdventure : copy.createCampaign}
              </>
            }
            className="[&>header]:pr-9"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
