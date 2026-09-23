"use client";

import { ScrollText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import type { SessionUser } from "@/lib/campaign-types";
import { offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import { CreateCampaignDialog } from "@/app/CreateCampaignDialog";
import { AccountMenu, AppBrand, AppHomeButton } from "@/components/AccountMenu";
import { DeletionBanner } from "@/components/DeletionBanner";
import { NotificationBell } from "@/components/NotificationBell";
import { HowToPlayDialog } from "@/components/HowToPlayDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import type { WorkshopSummary } from "@/app/workshop/types";
import { CampaignList } from "@/app/home/CampaignList";
import { ContinueHero, EmptyHero } from "@/app/home/ContinueHero";
import { HomeFooter } from "@/app/home/HomeFooter";
import { JoinCard } from "@/app/home/JoinCard";
import { QuickTiles } from "@/app/home/QuickTiles";
import { WorkshopSection } from "@/app/home/WorkshopSection";
import { pickContinue, type HomeCampaign } from "@/app/home/types";
import { currentPathname, currentQuery, navigateTo, replaceAddress } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

function requestedWizard(): "campaign" | "solo" | null {
  if (typeof window === "undefined") return null;
  const value = currentQuery().get("new");
  return value === "solo" ? "solo" : value === "1" ? "campaign" : null;
}

export function Dashboard({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const { t, locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      signedIn: "Signed in as",
      howToTooltip: "What this app is and how a table works",
      deleteForEveryone: "for everyone? All characters, messages, and story progress are lost. This cannot be undone.",
      couldNotDelete: "Could not delete",
      couldNotCopy: "Could not make the copy.",
    },
    ru: {
      signedIn: "Вы вошли как",
      howToTooltip: "Что это за приложение и как проходит игра за столом",
      deleteForEveryone: "для всех? Все персонажи, сообщения и прогресс истории будут потеряны. Это действие нельзя отменить.",
      couldNotDelete: "Не удалось удалить",
      couldNotCopy: "Не удалось создать копию.",
    },
  });
  const [campaigns, setCampaigns] = useState<HomeCampaign[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState("");
  const [cloningId, setCloningId] = useState("");
  const [createOpen, setCreateOpen] = useState(() => requestedWizard() === "campaign");
  const [soloOpen, setSoloOpen] = useState(() => requestedWizard() === "solo");
  const [howToOpen, setHowToOpen] = useState(false);
  const joinInputRef = useRef<HTMLInputElement | null>(null);
  const capabilities = useCapabilities();

  useEffect(() => {
    if (!requestedWizard()) return;
    const query = currentQuery();
    query.delete("new");
    replaceAddress(`${currentPathname()}${query.size ? `?${query}` : ""}`);
  }, []);

  const refresh = useCallback(
    () =>
      fetch("/api/campaigns")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) {
            setCampaigns(data.campaigns ?? []);
            setLoadFailed(false);
          } else {
            setLoadFailed(true);
          }
        })
        .catch(() => setLoadFailed(true))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshWorkshops = useCallback(
    () =>
      fetch("/api/workshops")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) setWorkshops(data.workshops ?? []);
        })
        .catch(() => undefined),
    [],
  );

  useEffect(() => {
    void refreshWorkshops();
  }, [refreshWorkshops]);

  async function deleteCampaign(campaign: HomeCampaign) {
    if (!window.confirm(`${t("common.delete")} "${campaign.title}" ${copy.deleteForEveryone}`)) return;
    setActionError("");
    const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (response?.ok) {
      setCampaigns((current) => current.filter((entry) => entry.id !== campaign.id));
    } else {
      const data = await response?.json().catch(() => ({}));
      setActionError(data?.error || `${copy.couldNotDelete} "${campaign.title}".`);
    }
  }

  async function clone(id: string) {
    setCloningId(id);
    setActionError("");
    try {
      const response = await fetch(`/api/campaigns/${id}/clone`, { method: "POST" }).catch(
        () => null,
      );
      if (!response?.ok) {
        const data = await response?.json().catch(() => ({}));
        setActionError(data?.error || copy.couldNotCopy);
        return;
      }
      const data = await response.json().catch(() => ({}));
      await (data.campaign?.kind === "workshop" ? refreshWorkshops() : refresh());
    } finally {
      setCloningId("");
    }
  }

  function focusJoin() {
    const input = joinInputRef.current;
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }

  const continueCampaign = pickContinue(campaigns);
  const onCreated = (campaignId: string) => navigateTo(`/campaigns/${campaignId}`);

  return (
    <main className="bg-starfield flex-1">
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <AppBrand className="gap-3">
            <PixelTile src={PIXEL_ICONS.story} />
            <span className="min-w-0">
              <span className="block text-balance font-display text-lg leading-tight tracking-wide text-amber-50 sm:text-xl">
                {t("common.appName")}
              </span>
              <span className="block truncate text-sm text-stone-500">
                {copy.signedIn} {user.username}
              </span>
            </span>
          </AppBrand>
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <AppHomeButton />
            <NotificationBell />
            <Tooltip content={copy.howToTooltip} side="bottom">
              <button type="button" onClick={() => setHowToOpen(true)} className={ui.btnSmall}>
                <ScrollText className="size-4" />
                <span className="hidden sm:inline">{t("nav.howToPlay")}</span>
              </button>
            </Tooltip>
            <AccountMenu user={user} onLogout={onLogout} />
          </div>
        </header>
        {user.deletionDueAt ? <DeletionBanner dueAt={user.deletionDueAt} className="mb-6" /> : null}

        {!loading && continueCampaign ? (
          <section className="mb-6">
            <ContinueHero campaign={continueCampaign} userId={user.id} />
          </section>
        ) : !loading && !loadFailed && campaigns.length === 0 ? (
          <section className="mb-6">
            <EmptyHero />
          </section>
        ) : null}

        <section className="mb-8">
          <QuickTiles
            onNewCampaign={() => setCreateOpen(true)}
            onSolo={() => setSoloOpen(true)}
            showSolo={offersStoryModel(capabilities)}
            onJoin={focusJoin}
          />
        </section>

        <CampaignList
          campaigns={campaigns}
          loading={loading}
          loadFailed={loadFailed}
          userId={user.id}
          cloningId={cloningId}
          actionError={actionError}
          onRetry={() => {
            setLoading(true);
            void refresh();
          }}
          onClone={clone}
          onDelete={deleteCampaign}
        />

        <WorkshopSection workshops={workshops} cloningId={cloningId} onClone={clone} />
        <JoinCard inputRef={joinInputRef} />
        <HomeFooter />

        <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
        <CreateCampaignDialog solo open={soloOpen} onOpenChange={setSoloOpen} onCreated={onCreated} />
        <HowToPlayDialog open={howToOpen} onOpenChange={setHowToOpen} />
      </div>
    </main>
  );
}
