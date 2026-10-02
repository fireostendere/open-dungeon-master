"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminInvitesSection } from "@/app/admin/AdminInvitesSection";
import { PageSection } from "@/components/PageShell";
import { ui } from "@/lib/ui";

type Config = {
  signupsEnabled: boolean;
  signupMode: "open" | "invite" | "closed";
  signupModeForced: boolean;
  serverName: string;
  accountDeletionGraceDays: number;
  publicUrl: string;
  worldRegistryUrl: string;
  voiceChat: {
    enabled: "" | "on" | "off";
    mode: "" | "sfu" | "mesh";
    announcedIp: string;
    domain: string;
    rtcPort: string;
  };
  discord: { clientId: string; hasClientSecret: boolean };
};
type Payload = {
  config: Config;
  envDefaults: {
    discordClientId: string;
    hasDiscordClientSecret: boolean;
    publicUrl: string;
    voiceEnabled: boolean;
    voiceAnnouncedIp: string;
    voiceDomain: string;
    voiceRtcPort: string;
    worldRegistryUrl: string;
  };
  voiceAnnounceUnroutable: boolean;
  deviceWorld: boolean;
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block">
    <span className="mb-1 block text-xs font-medium text-stone-400">{label}</span>
    {children}
    {hint ? <span className="mt-1 block text-[11px] text-stone-600">{hint}</span> : null}
  </label>;
}

export function AdminSettingsPanel() {
  const uiText = useInlineText();
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [discordSecret, setDiscordSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/admin/settings", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not load settings.");
        return r.json() as Promise<Payload>;
      })
      .then((payload) => { setData(payload); setDraft(payload.config); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load settings."));
  }, []);

  if (!data || !draft) {
    return <div className="flex min-h-48 items-center justify-center text-stone-500">
      {error || <Loader2 className="size-5 animate-spin" />}
    </div>;
  }

  async function save() {
    setSaving(true); setSaved(false); setError("");
    try {
      const body: Record<string, unknown> = {
        serverName: draft!.serverName,
        accountDeletionGraceDays: draft!.accountDeletionGraceDays,
        publicUrl: draft!.publicUrl,
        worldRegistryUrl: draft!.worldRegistryUrl,
      };
      if (!data!.deviceWorld) {
        body.signupMode = draft!.signupMode;
        body.voiceChat = draft!.voiceChat;
        body.discord = {
          clientId: draft!.discord.clientId,
          ...(discordSecret ? { clientSecret: discordSecret } : {}),
        };
      }
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save settings.");
      setData(payload); setDraft(payload.config); setDiscordSecret(""); setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally { setSaving(false); }
  }

  const input = ui.input;
  return <div className="space-y-5">
    <PageSection heading={uiText("server")} glyph="tab-settings" intro={uiText("identityAndPublicAccessSettingsAiProvidersAre")}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={uiText("serverName")}><input className={input} value={draft.serverName} onChange={(e) => setDraft({ ...draft, serverName: e.target.value })} /></Field>
        <Field label={uiText("publicUrl")} hint={data.envDefaults.publicUrl ? uiText("environmentValue", { value: data.envDefaults.publicUrl }) : undefined}>
          <input className={input} value={draft.publicUrl} onChange={(e) => setDraft({ ...draft, publicUrl: e.target.value })} placeholder={uiText("httpsDungeonExampleOrg")} />
        </Field>
        <Field label={uiText("worldRegistryUrl")} hint={data.envDefaults.worldRegistryUrl ? uiText("environmentValue", { value: data.envDefaults.worldRegistryUrl }) : uiText("blankKeepsCommunityPacksManualOnly")}>
          <input className={input} value={draft.worldRegistryUrl} onChange={(e) => setDraft({ ...draft, worldRegistryUrl: e.target.value })} />
        </Field>
        <Field label={uiText("accountDeletionGraceDays")}>
          <input className={input} type="number" min={0} max={90} value={draft.accountDeletionGraceDays} onChange={(e) => setDraft({ ...draft, accountDeletionGraceDays: Number(e.target.value) || 0 })} />
        </Field>
      </div>
    </PageSection>

    {!data.deviceWorld ? <>
      <PageSection heading={uiText("accounts")} glyph="tab-characters" intro={uiText("chooseWhoMayCreateAnAccountOnThis")}>
        <Field label={uiText("signupPolicy")}>
          <select className={input} value={draft.signupMode} onChange={(e) => setDraft({ ...draft, signupMode: e.target.value as Config["signupMode"] })}>
            <option value="open">{uiText("open")}</option><option value="invite">{uiText("inviteOnly")}</option><option value="closed">{uiText("closed")}</option>
          </select>
        </Field>
      </PageSection>
      {draft.signupMode === "invite" ? <AdminInvitesSection /> : null}

      <PageSection heading={uiText("voiceChat")} glyph="cue-horn" intro={uiText("browserToBrowserMeshOrTheBuiltIn")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={uiText("enabled")}><select className={input} value={draft.voiceChat.enabled} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, enabled: e.target.value as Config["voiceChat"]["enabled"] } })}><option value="">{uiText("environmentDefault")}</option><option value="on">On</option><option value="off">{uiText("off")}</option></select></Field>
          <Field label={uiText("mode")}><select className={input} value={draft.voiceChat.mode} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, mode: e.target.value as Config["voiceChat"]["mode"] } })}><option value="">{uiText("default")}</option><option value="mesh">{uiText("mesh")}</option><option value="sfu">SFU</option></select></Field>
          <Field label={uiText("announcedIp")}><input className={input} value={draft.voiceChat.announcedIp} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, announcedIp: e.target.value } })} /></Field>
          <Field label={uiText("domain")}><input className={input} value={draft.voiceChat.domain} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, domain: e.target.value } })} /></Field>
          <Field label={uiText("rtcPort")}><input className={input} value={draft.voiceChat.rtcPort} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, rtcPort: e.target.value } })} placeholder={data.envDefaults.voiceRtcPort} /></Field>
        </div>
        {data.voiceAnnounceUnroutable ? <p className="mt-3 text-xs text-amber-400">{uiText("theSfuIsAnnouncingAnAddressRemoteBrowsers")}</p> : null}
      </PageSection>

      <PageSection heading={uiText("discordSignIn")} glyph="system-share">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={uiText("clientId")}><input className={input} value={draft.discord.clientId} onChange={(e) => setDraft({ ...draft, discord: { ...draft.discord, clientId: e.target.value } })} placeholder={data.envDefaults.discordClientId} /></Field>
          <Field label={uiText("clientSecret")} hint={draft.discord.hasClientSecret || data.envDefaults.hasDiscordClientSecret ? uiText("aSecretIsAlreadyConfiguredLeaveBlankTo") : undefined}>
            <input className={input} type="password" value={discordSecret} onChange={(e) => setDiscordSecret(e.target.value)} />
          </Field>
        </div>
      </PageSection>
    </> : <PageSection heading={uiText("deviceHostedWorld")} intro={uiText("signupTransportAndAccountProviderSettingsAreOwned")} />}

    {error ? <p className="text-sm text-red-400">{error}</p> : null}
    <button className={ui.btnPrimary} disabled={saving} onClick={() => void save()}>
      {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
      {saving ? uiText("saving") : saved ? uiText("saved") : uiText("saveSettings")}
    </button>
  </div>;
}
