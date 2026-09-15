"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { submitWorldSetup } from "@/app/WorldSetupFields";
import { submitContentImport } from "@/app/workshop/ContentImportPicker";
import { groupByFranchise, type WorldPackSummary } from "@/lib/worlds/summary";
import type { Genre } from "@/lib/schemas/game-settings";
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
import { useI18n } from "@/lib/i18n";
import { campaignWizardCopy } from "@/lib/i18n/campaign-wizard";

type ServerCapabilities = {
  story: { configured: boolean; reachable: boolean };
  images: { configured: boolean };
  tts: { configured: boolean };
};

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
  const copy = campaignWizardCopy(locale);
  const [draft, setDraft] = useState<CampaignDraft>(DEFAULT_DRAFT);
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (changes: Partial<CampaignDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const aiNarrates = draft.dmMode !== "human";
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch("/api/worlds")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .then((data) => {
        if (!cancelled) setPacks(Array.isArray(data.packs) ? data.packs : []);
      })
      .catch(() => undefined);
    void fetch("/api/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ServerCapabilities | null) => {
        if (cancelled || !data?.story) return;
        setCapabilities(data);
        setDraft((current) => ({
          ...current,
          dmMode: !data.story.configured || !data.story.reachable ? "human" : current.dmMode,
          ttsEnabled: data.tts?.configured ? current.ttsEnabled : false,
          mapsEnabled: data.images?.configured ? current.mapsEnabled : false,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const franchises = useMemo(() => groupByFranchise(packs), [packs]);
  const selectedPack = packs.find((pack) => pack.id === draft.worldPack) ?? null;
  const choosePack = (pack: WorldPackSummary) => setDraft((current) => applyPack(current, pack));
  const dropPack = () => setDraft((current) => clearPack(current, selectedPack));
  const pickGenre = (genre: Genre) =>
    setDraft((current) => ({
      ...(current.worldPack ? clearPack(current, selectedPack) : current),
      genre,
    }));

  async function submit() {
    if (busy || (solo && storyKnownMissing)) return;
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
            romance: relationships === "off" ? "off" : romance,
            worldSimulation: aiNarrates && worldSimulation,
            inventoryApprovals,
            variantRules,
            companions: aiNarrates ? companions : "off",
            maxCompanions,
            maxGuests,
            worldPack,
            voice: voiceChat,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(copy.dialog.createFailed);
        return;
      }
      await submitWorldSetup(data.campaign.id, houseRules, loreDrafts);
      await submitContentImport(data.campaign.id, contentImport);
      onCreated(data.campaign.id);
    } catch {
      setError(copy.dialog.serverUnreachable);
    } finally {
      setBusy(false);
    }
  }

  const stepProps = { draft, patch, gates };
  const title = solo ? copy.dialog.newSolo : copy.dialog.newCampaign;

  const steps = (
    [
      {
        key: "premise",
        title: copy.dialog.premiseTitle,
        blurb: solo ? copy.dialog.premiseSoloBlurb : copy.dialog.premiseBlurb,
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
        title: copy.dialog.worldTitle,
        blurb: copy.dialog.worldBlurb,
        content: <WorldStep {...stepProps} onPickGenre={pickGenre} />,
        applies: true,
      },
      {
        key: "party",
        title: copy.dialog.partyTitle,
        blurb: solo ? copy.dialog.partySoloBlurb : copy.dialog.partyBlurb,
        content: <PartyStep {...stepProps} />,
        applies: true,
      },
      {
        key: "feel",
        title: copy.dialog.feelTitle,
        blurb: copy.dialog.feelBlurb,
        content: <FeelStep {...stepProps} />,
        applies: true,
      },
      {
        key: "advanced",
        title: copy.dialog.advancedTitle,
        blurb: copy.dialog.advancedBlurb,
        content: <AdvancedStep {...stepProps} />,
        applies: true,
      },
      {
        key: "review",
        title: copy.dialog.reviewTitle,
        blurb: copy.dialog.reviewBlurb,
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
                {solo ? copy.dialog.createSolo : copy.dialog.createCampaign}
              </>
            }
            className="[&>header]:pr-9"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
