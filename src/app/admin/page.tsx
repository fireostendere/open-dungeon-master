"use client";

import { Flag, Globe2, Settings2, Users, Cpu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PIXEL_ICONS } from "@/lib/ui";
import { PageLoading, PageNotice, PageShell } from "@/components/PageShell";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { AdminModelsPanel } from "@/app/admin/AdminModelsPanel";
import { AdminReportsPanel } from "@/app/admin/AdminReportsPanel";
import { AdminSettingsPanel } from "@/app/admin/AdminSettingsPanel";
import { AdminUsersPanel } from "@/app/admin/AdminUsersPanel";
import { AdminWorldsPanel } from "@/app/admin/AdminWorldsPanel";
import ProviderAuthPanel from "@/components/admin/ProviderAuthPanel";
import { useI18n } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";

type Me = { id: string; username: string; avatar?: { url: string } | null; isAdmin: boolean };
type Tab = "settings" | "models" | "providers" | "worlds" | "users" | "reports";
export default function AdminPage() {
  const { locale } = useI18n();
  const copy = localeText(locale, {
    en: {
      settings: "Server settings",
      models: "Models",
      providers: "LLM connections",
      worlds: "Campaign plugins",
      users: "Users",
      reports: "Reports",
      adminsOnly: "Admins only.",
      back: "Back to campaigns",
      title: "Admin panel",
      signedInAs: (username: string) => `Signed in as ${username}`,
      section: "Admin section",
    },
    ru: {
      settings: "Настройки сервера",
      models: "Модели",
      providers: "Подключения LLM",
      worlds: "Плагины кампаний",
      users: "Пользователи",
      reports: "Жалобы",
      adminsOnly: "Только для администраторов.",
      back: "Назад к кампаниям",
      title: "Панель администратора",
      signedInAs: (username: string) => `Вы вошли как ${username}`,
      section: "Раздел администрирования",
    },
    pl: {
      settings: "Ustawienia serwera",
      models: "Modele",
      providers: "Połączenia LLM",
      worlds: "Wtyczki kampanii",
      users: "Użytkownicy",
      reports: "Zgłoszenia",
      adminsOnly: "Tylko dla administratorów.",
      back: "Wróć do kampanii",
      title: "Panel administratora",
      signedInAs: (username: string) => `Zalogowano jako ${username}`,
      section: "Sekcja administracyjna",
    },
  });
  const tabs: SegmentedOption<Tab>[] = [
    { value: "settings", label: copy.settings, icon: Settings2 },
    { value: "models", label: copy.models, icon: Cpu },
    { value: "providers", label: copy.providers, icon: Cpu },
    { value: "worlds", label: copy.worlds, icon: Globe2 },
    { value: "users", label: copy.users, icon: Users },
    { value: "reports", label: copy.reports, icon: Flag },
  ];
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("settings");
  useEffect(() => {
    fetch("/api/auth/me").then(response => response.ok ? response.json() : null)
      .then(data => setMe(data?.user ?? null)).finally(() => setLoading(false));
  }, []);
  if (loading) return <PageLoading />;
  if (!me?.isAdmin) return <PageNotice user={me ?? null}>{copy.adminsOnly}{" "}<Link href="/" className="text-amber-200 hover:text-amber-400">{copy.back}</Link></PageNotice>;
  return <PageShell user={me} icon={PIXEL_ICONS.localData} title={copy.title} blurb={copy.signedInAs(me.username)}>
    <SegmentedControl options={tabs} value={tab} onChange={setTab} label={copy.section} className="w-full sm:w-auto" />
    {tab === "settings" ? <AdminSettingsPanel /> : tab === "models" ? <AdminModelsPanel /> : tab === "providers" ? <ProviderAuthPanel /> : tab === "worlds" ? <AdminWorldsPanel /> : tab === "reports" ? <AdminReportsPanel /> : <AdminUsersPanel meId={me.id} />}
  </PageShell>;
}
