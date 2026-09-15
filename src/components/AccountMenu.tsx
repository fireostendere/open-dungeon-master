"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  Check,
  CircleHelp,
  DoorOpen,
  Globe,
  LogOut,
  Ruler,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { HelpDialog } from "@/components/HelpDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { cn } from "@/lib/cn";
import { shellHost, type ShellHost } from "@/lib/shell-host";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/translations";

// window.odmShell is set once before any page script runs and never changes.
const subscribeNever = () => () => {};

function shellLabels(locale: Locale) {
  if (locale === "ru") {
    return {
      homeTooltip: "Вернуться на главный экран приложения",
      homeAria: "Главная Open Dungeon Master",
      accountTooltip: "Аккаунт и меню приложения",
      accountAria: "Аккаунт",
    };
  }
  if (locale === "pl") {
    return {
      homeTooltip: "Wróć do ekranu głównego aplikacji",
      homeAria: "Strona główna Open Dungeon Master",
      accountTooltip: "Konto i menu aplikacji",
      accountAria: "Konto",
    };
  }
  return {
    homeTooltip: "Back to the app's home screen",
    homeAria: "Open Dungeon Master home",
    accountTooltip: "Account and app menu",
    accountAria: "Account",
  };
}

// The book tile and wordmark at the top of a page. In a browser it leads
// to this server's home; inside the desktop or Android app it leads to the
// app's own home screen, because that is what the same mark does on every
// screen of the app, and a mark that does one thing here and nothing there
// is the first thing a newcomer trips over.
export function AppBrand({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const shell = useSyncExternalStore<ShellHost | null>(subscribeNever, shellHost, () => null);
  const { locale } = useI18n();
  const labels = shellLabels(locale);
  const classes = cn(
    "flex min-w-0 items-center gap-2.5 rounded-md text-left outline-none transition-colors hover:text-amber-200 focus-visible:text-amber-200",
    className,
  );
  if (shell) {
    return (
      <Tooltip content={labels.homeTooltip} side="bottom">
        <button type="button" onClick={() => shell.showServers()} aria-label={labels.homeAria} className={classes}>
          {children}
        </button>
      </Tooltip>
    );
  }
  return (
    <Link href="/" className={classes} aria-label={labels.homeAria}>
      {children}
    </Link>
  );
}

// Inside the desktop or Android app, the one visible way back to the app's
// own home screen (its servers, device world and settings) from any page.
export function AppHomeButton({ className }: { className?: string }) {
  const shell = useSyncExternalStore<ShellHost | null>(subscribeNever, shellHost, () => null);
  const { locale } = useI18n();
  const labels = shellLabels(locale);
  if (!shell) return null;
  return (
    <Tooltip content={labels.homeTooltip} side="bottom">
      <button
        type="button"
        onClick={() => shell.showServers()}
        aria-label={labels.homeAria}
        className={headerButtonClass(false, className)}
      >
        <AppWindow className="size-4" />
      </button>
    </Tooltip>
  );
}

export type AccountMenuUser = {
  username: string;
  avatar?: { url: string } | null;
  isAdmin?: boolean;
  deletionDueAt?: string | null;
};

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100";
const subContentClass =
  "min-w-48 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2";

export function AccountMenu({
  user,
  onLogout,
  onHelp,
}: {
  user: AccountMenuUser;
  onLogout?: () => void;
  onHelp?: () => void;
}) {
  const { t, locale, setLocale, unitSystem, toggleUnitSystem } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  const pathname = usePathname();
  const shell = useSyncExternalStore<ShellHost | null>(subscribeNever, shellHost, () => null);
  const router = useRouter();
  const labels = shellLabels(locale);

  const localeOptions: Array<{ value: Locale; label: string }> = [
    { value: "en", label: t("common.languageEnglish") },
    { value: "ru", label: t("common.languageRussian") },
    { value: "pl", label: t("common.languagePolish") },
  ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    if (onLogout) {
      onLogout();
    } else {
      router.push("/");
    }
  }

  return (
    <>
      <DropdownMenu.Root>
        <Tooltip content={labels.accountTooltip} side="bottom">
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={labels.accountAria}
              className="rounded-full outline-none transition-shadow duration-150 hover:shadow-glow-gold focus-visible:shadow-glow-gold"
            >
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar.url}
                  alt=""
                  className="size-9 rounded-full border border-amber-500/40 object-cover"
                />
              ) : (
                <span className="flex size-9 items-center justify-center rounded-full border border-stone-600/70 bg-stone-900">
                  <UserRound className="size-4 text-stone-400" />
                </span>
              )}
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className={subContentClass}
          >
            {pathname !== "/" ? (
              <DropdownMenu.Item asChild>
                <Link href="/" className={itemClass}>
                  <DoorOpen className="size-4" /> {t("nav.campaigns")}
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item asChild>
              <Link href="/characters" className={itemClass}>
                <Users className="size-4" /> {t("nav.characters")}
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link href="/settings" className={itemClass}>
                <Settings className="size-4" /> {t("nav.settings")}
              </Link>
            </DropdownMenu.Item>
            {user.isAdmin ? (
              <DropdownMenu.Item asChild>
                <Link href="/admin" className={itemClass}>
                  <ShieldCheck className="size-4" /> {t("nav.admin")}
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item
              onSelect={() => (onHelp ? onHelp() : setHelpOpen(true))}
              className={itemClass}
            >
              <CircleHelp className="size-4" /> {t("nav.help")}
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-stone-800" />

            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={itemClass}>
                <Globe className="size-4 text-amber-400" />
                <span className="flex-1">{t("common.language")}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                  {locale}
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={6} collisionPadding={12} className={subContentClass}>
                  {localeOptions.map((option) => (
                    <DropdownMenu.Item
                      key={option.value}
                      onSelect={() => setLocale(option.value)}
                      className={itemClass}
                    >
                      <span className="flex-1">{option.label}</span>
                      {locale === option.value ? <Check className="size-4 text-amber-400" /> : null}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>

            <DropdownMenu.Item onSelect={toggleUnitSystem} className={itemClass}>
              <Ruler className="size-4 text-amber-400" />
              <span>
                {t("common.units")}: {unitSystem === "metric" ? t("common.metric") : t("common.imperial")}
              </span>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-stone-800" />

            {shell ? (
              <DropdownMenu.Item onSelect={() => shell.showServers()} className={itemClass}>
                <AppWindow className="size-4" /> {t("nav.home")}
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item onSelect={logout} className={itemClass}>
              <LogOut className="size-4" /> {t("nav.logout")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {onHelp ? null : <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />}
    </>
  );
}
