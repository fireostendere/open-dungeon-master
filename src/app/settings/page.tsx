"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Check, Copy, Link2, Loader2, ShieldCheck, Trash2, Undo2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, ui } from "@/lib/ui";
import { PageLoading, PageNotice, PageSection, PageShell } from "@/components/PageShell";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { BlockedPlayersSection } from "@/app/settings/BlockedPlayersSection";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";
import { currentPathname, currentQuery, replaceAddress } from "@/lib/navigation";
import { useI18n, type Locale } from "@/lib/i18n";
import { localeText } from "@/lib/i18n/locale-text";
import { readSeatSecret } from "@/lib/device-seat";

type Me = {
  id: string;
  username: string;
  avatar: { url: string } | null;
  isAdmin?: boolean;
  discordLinked?: boolean;
  discordAvailable?: boolean;
  hasPassword?: boolean;
  deletionDueAt?: string | null;
};

function dueDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(
    locale === "ru" ? "ru-RU" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );
}

export default function SettingsPage() {
  const { locale, t } = useI18n();
  const copy = localeText(locale, {
    en: {
      discordLinkedNotice: "Discord account linked.",
      discordTaken: "That Discord account is already linked to another user.",
      deleteFailed: "Could not delete your account.",
      immediateGrace: "Your account, the campaigns you created, your characters and your pictures are erased immediately.",
      grace: (days: number) => `Your account is signed out everywhere and erased after ${days} day${days === 1 ? "" : "s"}, together with the campaigns you created, your characters and your pictures. Signing in before then lets you keep it.`,
      deleted: "Your account and everything it owned have been deleted.",
      scheduled: (date: string) => `Your account is scheduled for deletion on ${date}. You have been signed out everywhere. To keep it, sign in again before then and choose “Keep my account”.`,
      backFront: "Back to the front door",
      login: "Log in",
      manageSuffix: "to manage your account.",
      accountSettings: "Account settings",
      signedInAs: "Signed in as",
      adminPanel: "Admin panel",
      profilePicture: "Profile picture",
      yourAvatar: "Your avatar",
      changePicture: "Change picture",
      addPicture: "Add picture",
      remove: "Remove",
      pictureHelp: "Shown next to your name in lobbies and at the table. Character portraits are set on each character.",
      setPasswordHeading: "Set a password",
      passwordHeading: "Password",
      passwordDiscordHelp: "You sign in with Discord. Set a password to also log in with your username, for example in the desktop and mobile apps.",
      setPassword: "Set password",
      passwordSaved: "Password saved. Other devices were signed out.",
      otherDevicesHeading: "Other devices",
      otherDevicesHelp: "This local table seat uses a private seat key instead of a normal password. Copy it to a second browser once; each browser then keeps its own independent session. Treat the key like a password.",
      seatKeyUnavailable: "This browser does not have the seat key. Open settings on a device that already joined this seat.",
      copySeatKey: "Copy seat key",
      seatKeyCopied: "Copied",
      discordLinked: "Linked. You can sign in with Discord.",
      linkDiscord: "Link Discord account",
      deletionScheduled: "Deletion scheduled",
      pending: "Pending",
      deletionIntro: (date: string) => `This account will be permanently deleted on ${date}. Until then everything still works, and you can call it off.`,
      keepAccount: "Keep my account",
      deleteAccount: "Delete account",
      irreversible: "Irreversible",
      about: "About",
      rulesReference: "Rules reference",
      licenses: "Licenses and attribution",
      deleteQuestion: "Delete your account?",
      deleteDialogSuffix: "Messages you wrote in other people’s campaigns stay in those transcripts without your name on them. Once the account is erased it cannot be brought back.",
      passwordConfirm: "Enter your password to confirm",
      typeDelete: "Type DELETE to confirm",
      deleteForever: "Delete forever",
      deleteMine: "Delete my account",
    },
    ru: {
      discordLinkedNotice: "Аккаунт Discord привязан.",
      discordTaken: "Этот аккаунт Discord уже привязан к другому пользователю.",
      deleteFailed: "Не удалось удалить аккаунт.",
      immediateGrace: "Ваш аккаунт, созданные вами кампании, персонажи и изображения будут удалены немедленно.",
      grace: (days: number) => `Ваш аккаунт будет разлогинен на всех устройствах и окончательно удалён через ${days} дн., вместе с созданными вами кампаниями, персонажами и изображениями. Если войти до этого срока, удаление можно отменить.`,
      deleted: "Ваш аккаунт и все принадлежавшие ему данные удалены.",
      scheduled: (date: string) => `Удаление аккаунта назначено на ${date}. Вы вышли из аккаунта на всех устройствах. Чтобы сохранить аккаунт, войдите снова до этой даты и выберите «Сохранить мой аккаунт».`,
      backFront: "Вернуться на главную",
      login: "Войти",
      manageSuffix: "чтобы управлять аккаунтом.",
      accountSettings: "Настройки аккаунта",
      signedInAs: "Вы вошли как",
      adminPanel: "Панель администратора",
      profilePicture: "Изображение профиля",
      yourAvatar: "Ваш аватар",
      changePicture: "Изменить изображение",
      addPicture: "Добавить изображение",
      remove: "Удалить",
      pictureHelp: "Показывается рядом с вашим именем в лобби и за игровым столом. Портреты персонажей настраиваются отдельно.",
      setPasswordHeading: "Задать пароль",
      passwordHeading: "Пароль",
      passwordDiscordHelp: "Вы входите через Discord. Задайте пароль, чтобы также входить по имени пользователя, например в настольном и мобильном приложениях.",
      setPassword: "Задать пароль",
      passwordSaved: "Пароль сохранён. На других устройствах выполнен выход.",
      otherDevicesHeading: "Другие устройства",
      otherDevicesHelp: "В локальном мире вместо обычного пароля используется приватный ключ места. Один раз скопируйте его во второй браузер — после входа у каждого устройства будет своя независимая сессия. Относитесь к ключу как к паролю.",
      seatKeyUnavailable: "В этом браузере ключа места нет. Откройте настройки на устройстве, где это место уже было занято.",
      copySeatKey: "Скопировать ключ места",
      seatKeyCopied: "Скопировано",
      discordLinked: "Привязан. Теперь можно входить через Discord.",
      linkDiscord: "Привязать аккаунт Discord",
      deletionScheduled: "Удаление запланировано",
      pending: "Ожидает",
      deletionIntro: (date: string) => `Аккаунт будет окончательно удалён ${date}. До этого момента всё продолжит работать, а удаление можно отменить.`,
      keepAccount: "Сохранить мой аккаунт",
      deleteAccount: "Удалить аккаунт",
      irreversible: "Необратимо",
      about: "О приложении",
      rulesReference: "Справочник правил",
      licenses: "Лицензии и авторство",
      deleteQuestion: "Удалить ваш аккаунт?",
      deleteDialogSuffix: "Сообщения, которые вы писали в чужих кампаниях, останутся в их истории без вашего имени. После окончательного удаления восстановить аккаунт невозможно.",
      passwordConfirm: "Введите пароль для подтверждения",
      typeDelete: "Введите DELETE для подтверждения",
      deleteForever: "Удалить навсегда",
      deleteMine: "Удалить мой аккаунт",
    },
  });
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [cropping, setCropping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [scheduled, setScheduled] = useState<{ dueAt: string; purged: boolean } | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [about, setAbout] = useState<{ serverName: string; version: string; graceDays: number } | null>(null);
  const [deviceWorld, setDeviceWorld] = useState(false);
  const [seatKey, setSeatKey] = useState("");
  const [seatCopied, setSeatCopied] = useState(false);
  const [discordNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    const query = currentQuery();
    if (query.get("linked") === "1") return copy.discordLinkedNotice;
    if (query.get("error") === "discord_taken") return copy.discordTaken;
    return "";
  });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const user = (data?.user ?? null) as Me | null;
        setMe(user);
        if (user) setSeatKey(readSeatSecret(user.username));
      })
      .finally(() => setLoading(false));
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        setDeviceWorld(data?.deviceWorld === true);
        if (data?.serverName && data?.version) {
          setAbout({
            serverName: data.serverName,
            version: data.version,
            graceDays: typeof data.accountDeletionGraceDays === "number" ? data.accountDeletionGraceDays : 14,
          });
        }
      })
      .catch(() => undefined);
    const query = currentQuery();
    if (query.get("linked") || query.get("error")) replaceAddress(currentPathname());
  }, []);

  async function setAvatar(avatar: { url: string } | null) {
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar }),
      });
      if (response.ok && me) setMe({ ...me, avatar });
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    if (!me) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(me.hasPassword ? { password: deleteConfirm } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeleteError(data.error || copy.deleteFailed);
        setDeleting(false);
        return;
      }
      setConfirmingDelete(false);
      setScheduled({ dueAt: data.dueAt, purged: data.purged === true });
    } catch {
      setDeleteError(copy.deleteFailed);
      setDeleting(false);
    }
  }

  async function keepAccount() {
    setKeeping(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepAccount: true }),
      });
      if (response.ok) setMe((current) => (current ? { ...current, deletionDueAt: null } : current));
    } finally {
      setKeeping(false);
    }
  }

  function flashPasswordSaved() {
    setPasswordChanged(true);
    setTimeout(() => setPasswordChanged(false), 2500);
  }

  async function copySeatKey() {
    if (!seatKey) return;
    try {
      await navigator.clipboard.writeText(seatKey);
      setSeatCopied(true);
      setTimeout(() => setSeatCopied(false), 2500);
    } catch {
      // The key remains selectable below when Clipboard API is unavailable.
    }
  }

  const deleteReady = me?.hasPassword ? deleteConfirm.length > 0 : deleteConfirm === "DELETE";
  const graceDays = about?.graceDays ?? 14;
  const graceCopy = graceDays === 0 ? copy.immediateGrace : copy.grace(graceDays);

  if (loading) return <PageLoading width="narrow" />;

  if (scheduled) {
    return (
      <PageNotice width="narrow">
        {scheduled.purged ? copy.deleted : copy.scheduled(dueDate(scheduled.dueAt, locale))} {" "}
        <Link href="/" className="text-amber-200 hover:text-amber-400">{copy.backFront}</Link>
      </PageNotice>
    );
  }

  if (!me) {
    return (
      <PageNotice width="narrow">
        <Link href="/" className="text-amber-200 hover:text-amber-400">{copy.login}</Link>{" "}
        {copy.manageSuffix}
      </PageNotice>
    );
  }

  return (
    <PageShell
      user={me}
      width="narrow"
      icon={PIXEL_ICONS.characters}
      glyph="tab-settings"
      title={copy.accountSettings}
      blurb={`${copy.signedInAs} ${me.username}`}
      actions={
        me.isAdmin ? (
          <Link href="/admin" className={ui.btnSecondary}>
            <ShieldCheck className="size-4" /> {copy.adminPanel}
          </Link>
        ) : null
      }
    >
      <PageSection heading={copy.profilePicture} glyph="tab-characters">
        <div className="flex items-center gap-5">
          {me.avatar ? (
            <ImageLightbox
              src={me.avatar.url}
              alt={copy.yourAvatar}
              caption={copy.yourAvatar}
              className="size-24 rounded-full border-2 border-amber-500/40 object-cover shadow-glow-gold"
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-full border border-stone-700 bg-stone-900">
              <UserRound className="size-10 text-stone-600" />
            </div>
          )}
          <div className="space-y-2">
            <button type="button" onClick={() => setCropping(true)} disabled={saving} className={ui.btnPrimary}>
              {me.avatar ? copy.changePicture : copy.addPicture}
            </button>
            {me.avatar ? (
              <button
                type="button"
                onClick={() => setAvatar(null)}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-red-400"
              >
                <Trash2 className="size-3.5" /> {copy.remove}
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-500">{copy.pictureHelp}</p>
      </PageSection>

      {deviceWorld && !me.isAdmin ? (
        <PageSection heading={copy.otherDevicesHeading} intro={copy.otherDevicesHelp}>
          {seatKey ? (
            <div className="space-y-2">
              <code className="block select-all break-all rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-xs text-stone-300">
                {seatKey}
              </code>
              <button type="button" onClick={copySeatKey} className={ui.btnSmall}>
                {seatCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {seatCopied ? copy.seatKeyCopied : copy.copySeatKey}
              </button>
            </div>
          ) : (
            <p className="text-sm text-stone-500">{copy.seatKeyUnavailable}</p>
          )}
        </PageSection>
      ) : (
        <PageSection heading={me.hasPassword === false ? copy.setPasswordHeading : copy.passwordHeading} glyph="tab-admin">
          {me.hasPassword === false ? (
            <>
              <p className="mb-3 text-sm text-stone-400">{copy.passwordDiscordHelp}</p>
              <ChangePasswordForm
                currentPassword=""
                lockCurrent
                submitLabel={copy.setPassword}
                onChanged={() => {
                  setMe((current) => (current ? { ...current, hasPassword: true } : current));
                  flashPasswordSaved();
                }}
              />
            </>
          ) : (
            <ChangePasswordForm onChanged={flashPasswordSaved} />
          )}
          {passwordChanged ? (
            <p className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-400">
              <Check className="size-4" /> {copy.passwordSaved}
            </p>
          ) : null}
        </PageSection>
      )}

      {me.discordAvailable || me.discordLinked ? (
        <PageSection heading="Discord" glyph="system-share">
          {me.discordLinked ? (
            <p className="text-sm text-stone-400">
              <Check className="mr-1 inline size-4 text-emerald-400" /> {copy.discordLinked}
            </p>
          ) : (
            <a href="/api/auth/discord/start?link=1" className={ui.btnSmall}>
              <Link2 className="size-3.5" /> {copy.linkDiscord}
            </a>
          )}
          {discordNotice ? <p className="mt-2 text-sm text-amber-300">{discordNotice}</p> : null}
        </PageSection>
      ) : null}

      <BlockedPlayersSection />

      {me.deletionDueAt ? (
        <PageSection
          heading={copy.deletionScheduled}
          glyph="quest-failed"
          ribbon={copy.pending}
          ribbonTone="ember"
          tone="danger"
          intro={copy.deletionIntro(dueDate(me.deletionDueAt, locale))}
        >
          <button type="button" onClick={keepAccount} disabled={keeping} className={ui.btnPrimary}>
            {keeping ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            {copy.keepAccount}
          </button>
        </PageSection>
      ) : (
        <PageSection
          heading={copy.deleteAccount}
          glyph="quest-failed"
          ribbon={copy.irreversible}
          ribbonTone="ember"
          tone="danger"
          intro={graceCopy}
        >
          <button
            type="button"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteError("");
              setConfirmingDelete(true);
            }}
            className={cn(ui.btnSmall, "hover:border-red-500/50 hover:text-red-400")}
          >
            <Trash2 className="size-3.5" /> {copy.deleteAccount}
          </button>
        </PageSection>
      )}

      <PageSection heading={copy.about} glyph="system-lore">
        {about ? (
          <p className="text-sm text-stone-300">
            {about.serverName} <span className="text-stone-500">v{about.version}</span>
          </p>
        ) : (
          <p className="text-sm text-stone-500">{t("common.appName")}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/rulebook" className="text-xs text-stone-500 hover:text-amber-200">{t("nav.rulebook")}</Link>
          <Link href="/reference" className="text-xs text-stone-500 hover:text-amber-200">{copy.rulesReference}</Link>
          <Link href="/terms" className="text-xs text-stone-500 hover:text-amber-200">{t("auth.termsOfService")}</Link>
          <Link href="/privacy" className="text-xs text-stone-500 hover:text-amber-200">{t("auth.privacyPolicy")}</Link>
          <Link href="/licenses" className="text-xs text-stone-500 hover:text-amber-200">{copy.licenses}</Link>
          <a
            href="https://github.com/Lebbitheplow/open-dungeon-master"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-stone-500 hover:text-amber-200"
          >
            GitHub
          </a>
        </div>
      </PageSection>

      {cropping ? (
        <AvatarCropDialog
          title={copy.profilePicture}
          onUploaded={(image) => setAvatar({ url: image.url })}
          onClose={() => setCropping(false)}
        />
      ) : null}

      {confirmingDelete ? (
        <AlertDialog.Root
          open
          onOpenChange={(open) => {
            if (!open && !deleting) setConfirmingDelete(false);
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
            <AlertDialog.Content
              className={cn(
                ui.dialog,
                "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,24rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
              )}
            >
              <AlertDialog.Title className="font-display text-lg tracking-wide text-amber-50">
                {copy.deleteQuestion}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-xs text-stone-400">
                {graceCopy} {copy.deleteDialogSuffix}
              </AlertDialog.Description>
              <div className="mt-4">
                {me.hasPassword ? (
                  <label className="block text-xs text-stone-400">
                    {copy.passwordConfirm}
                    <input
                      type="password"
                      autoFocus
                      value={deleteConfirm}
                      onChange={(event) => setDeleteConfirm(event.target.value)}
                      className={cn(ui.input, "mt-1")}
                    />
                  </label>
                ) : (
                  <label className="block text-xs text-stone-400">
                    {copy.typeDelete}
                    <input
                      type="text"
                      autoFocus
                      value={deleteConfirm}
                      onChange={(event) => setDeleteConfirm(event.target.value)}
                      className={cn(ui.input, "mt-1")}
                    />
                  </label>
                )}
                {deleteError ? <p className="mt-2 text-xs text-red-400">{deleteError}</p> : null}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <AlertDialog.Cancel className={ui.btnSmall} disabled={deleting}>
                  {t("common.cancel")}
                </AlertDialog.Cancel>
                <button
                  type="button"
                  onClick={deleteAccount}
                  disabled={!deleteReady || deleting}
                  className={cn(ui.btnPrimary, "from-red-200 via-red-300 to-red-500 text-red-950")}
                >
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
                  {graceDays === 0 ? copy.deleteForever : copy.deleteMine}
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </PageShell>
  );
}
