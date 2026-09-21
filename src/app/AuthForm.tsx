"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { SessionUser } from "@/lib/campaign-types";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { currentPathname, currentQuery, replaceAddress } from "@/lib/navigation";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/translations";
import {
  mintSeatSecret,
  normalizeSeatSecret,
  readSeatSecret,
  rememberSeatSecret,
} from "@/lib/device-seat";

type AuthMode = "login" | "register";
type SignupMode = "open" | "invite" | "closed";

function authCopy(locale: Locale) {
  if (locale === "ru") {
    return {
      oauthErrors: {
        discord: "Не удалось войти через Discord. Попробуйте ещё раз.",
        signups_disabled: "Регистрация на этом сервере отключена.",
        invite_required: "Для регистрации на этом сервере нужен код приглашения.",
        invite_invalid: "Этот код приглашения недействителен или уже использован.",
      } as Record<string, string>,
      seatTaken: "Это имя уже занято за этим столом. Выберите другое или попросите владельца удалить старое место.",
      seatKeyNeeded: "Это место уже существует. Введите ключ места, чтобы открыть его на этом устройстве.",
      seatKeyWrong: "Ключ места не подходит к этому имени.",
      seatKeyInvalid: "Ключ места должен состоять из 48 шестнадцатеричных символов.",
      seatKeyLabel: "Ключ места",
      seatKeyPlaceholder: "Вставьте ключ с другого устройства",
      seatKeyHelp: "На устройстве, где это место уже открыто, зайдите в Настройки аккаунта → Другие устройства и скопируйте ключ.",
      genericError: "Что-то пошло не так.",
      unreachable: "Не удалось подключиться к серверу.",
      resetIntro: "Администратор сбросил ваш пароль. Задайте новый пароль, чтобы продолжить.",
      deviceWorld:
        "Этот мир запущен на устройстве владельца. Укажите имя за столом — и вы внутри; запоминать пароль не нужно.",
      tableName: "Ваше имя за этим столом",
      continueDiscord: "Продолжить через Discord",
      signInDiscord: "Войти через Discord",
      newHere: "Впервые здесь? ",
      haveAccount: "Уже есть аккаунт? ",
      closed: "Этот сервер сейчас не принимает новые регистрации.",
    };
  }
  if (locale === "pl") {
    return {
      oauthErrors: {
        discord: "Logowanie przez Discord nie powiodło się. Spróbuj ponownie.",
        signups_disabled: "Rejestracja na tym serwerze jest wyłączona.",
        invite_required: "Do utworzenia konta na tym serwerze potrzebny jest kod zaproszenia.",
        invite_invalid: "Ten kod zaproszenia jest nieprawidłowy albo został już wykorzystany.",
      } as Record<string, string>,
      seatTaken: "Ta nazwa jest już zajęta przy tym stole. Wybierz inną albo poproś gospodarza o usunięcie starego miejsca.",
      seatKeyNeeded: "To miejsce już istnieje. Wpisz jego klucz, aby użyć go na tym urządzeniu.",
      seatKeyWrong: "Ten klucz miejsca nie pasuje do tej nazwy.",
      seatKeyInvalid: "Klucz miejsca ma 48 znaków szesnastkowych.",
      seatKeyLabel: "Klucz miejsca",
      seatKeyPlaceholder: "Wklej klucz z innego zalogowanego urządzenia",
      seatKeyHelp: "Na urządzeniu, które już używa tego miejsca, otwórz Ustawienia konta → Inne urządzenia i skopiuj klucz.",
      genericError: "Coś poszło nie tak.",
      unreachable: "Nie udało się połączyć z serwerem.",
      resetIntro: "Administrator zresetował twoje hasło. Ustaw nowe, aby kontynuować.",
      deviceWorld:
        "Ten świat działa na urządzeniu gospodarza. Podaj nazwę używaną przy stole i możesz dołączyć; nie musisz zapamiętywać hasła.",
      tableName: "Twoja nazwa przy tym stole",
      continueDiscord: "Kontynuuj przez Discord",
      signInDiscord: "Zaloguj się przez Discord",
      newHere: "Jesteś tu pierwszy raz? ",
      haveAccount: "Masz już konto? ",
      closed: "Ten serwer obecnie nie przyjmuje nowych kont.",
    };
  }
  return {
    oauthErrors: {
      discord: "Discord sign-in failed. Try again.",
      signups_disabled: "Signups are disabled on this server.",
      invite_required: "This server needs an invite code to create an account.",
      invite_invalid: "That invite code is not valid (or has been used up).",
    } as Record<string, string>,
    seatTaken: "That name is already taken at this table. Pick another, or ask the host to remove the old seat.",
    seatKeyNeeded: "That seat already exists. Enter its seat key to use it on this device.",
    seatKeyWrong: "That seat key is not valid for this name.",
    seatKeyInvalid: "A seat key is 48 hexadecimal characters.",
    seatKeyLabel: "Seat key",
    seatKeyPlaceholder: "Paste the key from another signed-in device",
    seatKeyHelp: "On a device already using this seat, open Account settings → Other devices and copy the key.",
    genericError: "Something went wrong.",
    unreachable: "Could not reach the server.",
    resetIntro: "An admin reset your password. Pick a new one to continue.",
    deviceWorld:
      "This world runs on its host's device. Give the table a name and you are in; there is no password to remember.",
    tableName: "Your name at this table",
    continueDiscord: "Continue with Discord",
    signInDiscord: "Sign in with Discord",
    newHere: "New here? ",
    haveAccount: "Have an account? ",
    closed: "This server is not accepting new accounts.",
  };
}

const FIELD = cn(ui.input, "h-11");
const DISCORD_BTN =
  "inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-indigo-400/30 bg-[#5865f2]/15 px-4 text-sm text-indigo-100 transition-all duration-150 ease-snap hover:bg-[#5865f2]/25 hover:text-white active:scale-[0.98]";
function discordStartHref(inviteCode: string, joinCode?: string): string {
  const query = new URLSearchParams();
  if (inviteCode.trim()) query.set("invite", inviteCode.trim().toUpperCase());
  if (joinCode) query.set("next", `/join/${joinCode.trim().toUpperCase()}`);
  const qs = query.toString();
  return qs ? `/api/auth/discord/start?${qs}` : "/api/auth/discord/start";
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-[#8b9bf5]" aria-hidden="true">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.1 13 13 0 0 1-1.87-.9.08.08 0 0 1-.01-.12c.13-.1.25-.2.37-.3a.07.07 0 0 1 .08 0c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08 0c.12.1.25.21.38.3a.08.08 0 0 1-.01.13c-.6.35-1.22.64-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.02-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z" />
    </svg>
  );
}

export default function AuthForm({
  onAuthed,
  joinCode,
}: {
  onAuthed: (user: SessionUser) => void;
  joinCode?: string;
}) {
  const { t, locale } = useI18n();
  const copy = authCopy(locale);
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [urlInvite] = useState(() => {
    if (typeof window === "undefined") return "";
    return (currentQuery().get("invite") || "").trim().toUpperCase().slice(0, 40);
  });
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    const oauthError = currentQuery().get("error");
    return (oauthError && copy.oauthErrors[oauthError]) || "";
  });
  const [busy, setBusy] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [signupMode, setSignupMode] = useState<SignupMode>("open");
  const [deviceWorld, setDeviceWorld] = useState(false);
  const [inviteCode, setInviteCode] = useState(urlInvite);
  const [seatKey, setSeatKey] = useState("");
  const [seatKeyRequested, setSeatKeyRequested] = useState(false);
  const [pendingReset, setPendingReset] = useState<{ user: SessionUser; tempPassword: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        setDiscordEnabled(data?.discord === true);
        setDeviceWorld(data?.deviceWorld === true);
        if (data?.signupMode === "invite" || data?.signupMode === "closed") setSignupMode(data.signupMode);
      })
      .catch(() => undefined);
    if (currentQuery().get("error")) replaceAddress(currentPathname());
  }, []);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
  }

  const seatJoin = deviceWorld && Boolean(joinCode);
  const effectiveMode: AuthMode = seatJoin ? "register" : mode;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const name = username.trim();
      const kept = seatJoin ? readSeatSecret(name) : "";
      const entered = seatJoin ? normalizeSeatSecret(seatKey) : "";
      if (seatJoin && seatKey.trim() && !entered) {
        setSeatKeyRequested(true);
        setError(copy.seatKeyInvalid);
        return;
      }
      const secret = seatJoin ? entered || kept || mintSeatSecret() : password;
      const payload: Record<string, string> = { username: name, password: secret };
      if (effectiveMode === "register" && inviteCode.trim()) payload.inviteCode = inviteCode.trim().toUpperCase();
      if (effectiveMode === "register" && joinCode) payload.joinCode = joinCode.trim().toUpperCase();

      let response = await fetch(`/api/auth/${effectiveMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let resumedSeat = false;
      if (seatJoin && response.status === 409) {
        const resumeSecret = entered || kept;
        if (!resumeSecret) {
          setSeatKeyRequested(true);
          setError(copy.seatKeyNeeded);
          return;
        }
        resumedSeat = true;
        response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: name, password: resumeSecret }),
        });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          seatJoin && resumedSeat
            ? copy.seatKeyWrong
            : seatJoin && response.status === 409
              ? copy.seatTaken
              : copy.genericError,
        );
        return;
      }
      if (seatJoin) {
        rememberSeatSecret(name, secret);
        setSeatKeyRequested(false);
      }
      if (data.user?.mustChangePassword) {
        setPendingReset({ user: data.user, tempPassword: password });
        return;
      }
      onAuthed(data.user);
    } catch {
      setError(copy.unreachable);
    } finally {
      setBusy(false);
    }
  }

  if (pendingReset) {
    return (
      <>
        <p className="mb-3 text-sm text-stone-400">{copy.resetIntro}</p>
        <ChangePasswordForm
          currentPassword={pendingReset.tempPassword}
          lockCurrent
          submitLabel={t("auth.setNewPassword")}
          onChanged={() => onAuthed({ ...pendingReset.user, mustChangePassword: false })}
        />
      </>
    );
  }

  const canRegister = signupMode !== "closed" && !seatJoin;
  const submitLabel = joinCode
    ? t("campaign.takeYourSeat")
    : mode === "login"
      ? t("auth.login")
      : t("auth.register");
  const modeOptions: Array<{ value: AuthMode; label: string }> = [
    { value: "login", label: t("auth.login") },
    { value: "register", label: t("auth.register") },
  ];

  return (
    <>
      {seatJoin ? <p className="mb-4 text-sm text-stone-400">{copy.deviceWorld}</p> : null}
      {canRegister ? (
        <SegmentedControl
          options={modeOptions}
          value={mode}
          onChange={switchMode}
          label={t("auth.logInOrRegister")}
          className="mb-5 w-full"
        />
      ) : null}

      <form onSubmit={submit} className="space-y-3.5">
        <label className="block">
          <span className="mb-1.5 block text-xs text-stone-400">{t("auth.username")}</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={24}
            placeholder={seatJoin ? copy.tableName : mode === "register" ? t("auth.chooseUsername") : undefined}
            className={FIELD}
          />
        </label>
        {seatJoin && seatKeyRequested ? (
          <label className="block">
            <span className="mb-1.5 block text-xs text-stone-400">{copy.seatKeyLabel}</span>
            <input
              type="password"
              value={seatKey}
              onChange={(event) => setSeatKey(event.target.value)}
              autoComplete="off"
              required
              spellCheck={false}
              placeholder={copy.seatKeyPlaceholder}
              className={cn(FIELD, "font-mono tracking-wider")}
            />
            <span className="mt-1.5 block text-xs text-stone-500">{copy.seatKeyHelp}</span>
          </label>
        ) : null}
        {seatJoin ? null : (
          <label className="block">
            <span className="mb-1.5 block text-xs text-stone-400">{t("auth.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 8 : 1}
              maxLength={100}
              placeholder={t("auth.enterPassword")}
              className={FIELD}
            />
          </label>
        )}
        {effectiveMode === "register" && signupMode === "invite" && !seatJoin ? (
          <label className="block">
            <span className="mb-1.5 block text-xs text-stone-400">{t("auth.inviteCode")}</span>
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              required
              readOnly={Boolean(urlInvite)}
              maxLength={40}
              placeholder={t("auth.inviteCodePlaceholder")}
              className={cn(FIELD, "font-mono uppercase tracking-wider", urlInvite && "text-amber-200")}
            />
            <span className="mt-1.5 block text-xs text-stone-500">
              {urlInvite ? t("auth.inviteCodeFromLink") : t("auth.inviteCodeHelp")}
            </span>
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "h-12 w-full")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </button>
        {effectiveMode === "register" ? (
          <p className="text-center text-xs leading-5 text-stone-500">
            {t("auth.creatingAccountNotice")}{" "}
            <a href="/terms" className="text-stone-400 underline hover:text-amber-200">
              {t("auth.termsOfService")}
            </a>{" "}
            {t("common.and")}{" "}
            <a href="/privacy" className="text-stone-400 underline hover:text-amber-200">
              {t("auth.privacyPolicy")}
            </a>
            .
          </p>
        ) : null}
      </form>

      {discordEnabled && !seatJoin ? (
        <>
          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-stone-700/60" />
            <span className="text-[11px] uppercase tracking-[0.2em] text-stone-600">{t("common.or")}</span>
            <span className="h-px flex-1 bg-stone-700/60" />
          </div>
          <a href={discordStartHref(inviteCode, joinCode)} className={DISCORD_BTN}>
            <DiscordMark />
            {joinCode ? copy.continueDiscord : copy.signInDiscord}
          </a>
        </>
      ) : null}

      {canRegister ? (
        <p className="mt-5 text-center text-[13px] text-stone-400">
          {mode === "login" ? copy.newHere : copy.haveAccount}
          <button
            type="button"
            onClick={() => switchMode(mode === "login" ? "register" : "login")}
            className="text-amber-200 underline-offset-2 hover:text-amber-100 hover:underline"
          >
            {mode === "login" ? t("auth.register") : t("auth.login")}
          </button>
        </p>
      ) : mode === "login" ? (
        <p className="mt-5 text-center text-xs text-stone-500">{copy.closed}</p>
      ) : null}
    </>
  );
}
