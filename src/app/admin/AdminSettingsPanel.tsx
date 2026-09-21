"use client";

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
    <PageSection heading="Server" intro="Identity and public access settings. AI providers are intentionally not hosted by this server.">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Server name"><input className={input} value={draft.serverName} onChange={(e) => setDraft({ ...draft, serverName: e.target.value })} /></Field>
        <Field label="Public URL" hint={data.envDefaults.publicUrl ? `Environment: ${data.envDefaults.publicUrl}` : undefined}>
          <input className={input} value={draft.publicUrl} onChange={(e) => setDraft({ ...draft, publicUrl: e.target.value })} placeholder="https://dungeon.example.org" />
        </Field>
        <Field label="World registry URL" hint={data.envDefaults.worldRegistryUrl ? `Environment: ${data.envDefaults.worldRegistryUrl}` : "Blank keeps community packs manual-only."}>
          <input className={input} value={draft.worldRegistryUrl} onChange={(e) => setDraft({ ...draft, worldRegistryUrl: e.target.value })} />
        </Field>
        <Field label="Account deletion grace days">
          <input className={input} type="number" min={0} max={90} value={draft.accountDeletionGraceDays} onChange={(e) => setDraft({ ...draft, accountDeletionGraceDays: Number(e.target.value) || 0 })} />
        </Field>
      </div>
    </PageSection>

    {!data.deviceWorld ? <>
      <PageSection heading="Accounts" intro="Choose who may create an account on this server.">
        <Field label="Signup policy">
          <select className={input} value={draft.signupMode} onChange={(e) => setDraft({ ...draft, signupMode: e.target.value as Config["signupMode"] })}>
            <option value="open">Open</option><option value="invite">Invite only</option><option value="closed">Closed</option>
          </select>
        </Field>
      </PageSection>
      {draft.signupMode === "invite" ? <AdminInvitesSection /> : null}

      <PageSection heading="Voice chat" intro="Browser-to-browser mesh or the built-in mediasoup SFU. This is ordinary WebRTC voice, not speech AI.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Enabled"><select className={input} value={draft.voiceChat.enabled} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, enabled: e.target.value as Config["voiceChat"]["enabled"] } })}><option value="">Environment/default</option><option value="on">On</option><option value="off">Off</option></select></Field>
          <Field label="Mode"><select className={input} value={draft.voiceChat.mode} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, mode: e.target.value as Config["voiceChat"]["mode"] } })}><option value="">Default</option><option value="mesh">Mesh</option><option value="sfu">SFU</option></select></Field>
          <Field label="Announced IP"><input className={input} value={draft.voiceChat.announcedIp} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, announcedIp: e.target.value } })} /></Field>
          <Field label="Domain"><input className={input} value={draft.voiceChat.domain} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, domain: e.target.value } })} /></Field>
          <Field label="RTC port"><input className={input} value={draft.voiceChat.rtcPort} onChange={(e) => setDraft({ ...draft, voiceChat: { ...draft.voiceChat, rtcPort: e.target.value } })} placeholder={data.envDefaults.voiceRtcPort} /></Field>
        </div>
        {data.voiceAnnounceUnroutable ? <p className="mt-3 text-xs text-amber-400">The SFU is announcing an address remote browsers cannot route to.</p> : null}
      </PageSection>

      <PageSection heading="Discord sign-in">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Client ID"><input className={input} value={draft.discord.clientId} onChange={(e) => setDraft({ ...draft, discord: { ...draft.discord, clientId: e.target.value } })} placeholder={data.envDefaults.discordClientId} /></Field>
          <Field label="Client secret" hint={draft.discord.hasClientSecret || data.envDefaults.hasDiscordClientSecret ? "A secret is already configured; leave blank to keep it." : undefined}>
            <input className={input} type="password" value={discordSecret} onChange={(e) => setDiscordSecret(e.target.value)} />
          </Field>
        </div>
      </PageSection>
    </> : <PageSection heading="Device-hosted world" intro="Signup, transport and account-provider settings are owned by the desktop/mobile host." />}

    {error ? <p className="text-sm text-red-400">{error}</p> : null}
    <button className={ui.btnPrimary} disabled={saving} onClick={() => void save()}>
      {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
      {saving ? "Saving…" : saved ? "Saved" : "Save settings"}
    </button>
  </div>;
}
