"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import type { RegistryEntry, WorldPackSummary } from "@/lib/worlds/types";
import { forgetPackArt } from "@/lib/worlds/use-pack-art";

// The campaign plugin browser.
//
// World packs are the app's plugin format: a single JSON manifest that renames
// the SRD's races, classes, spells, items and monsters into some other setting
// and tells the DM how that setting sounds. It changes no rules.
//
// Packs built on somebody else's universe are NOT shipped with this app and
// are not covered by its MIT license. They are downloaded from whatever
// registry the operator configured, or added by hand from a file, and they
// carry an explicit non-affiliation notice wherever they appear.
// The same ceiling as MAX_MANIFEST_BYTES in src/lib/worlds/install.ts, which
// this client component cannot import: a pack with its thumbnails aboard is a
// few megabytes, and anything near this is not one.
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

type RegistryState = {
  configured: boolean;
  url?: string;
  error?: string;
  packs: RegistryEntry[];
  installed: WorldPackSummary[];
};

export function AdminWorldsPanel() {
  const uiText = useInlineText();
  const [state, setState] = useState<RegistryState | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // Uncontrolled, seeded from whatever registry is in force and re-keyed when
  // that changes, so an admin edits the live value rather than typing over a
  // blank box. Same shape as the custom-genre textarea in GameSettingsPanel.
  const registryInput = useRef<HTMLInputElement>(null);

  // Reload after an install, a removal, or a registry change. Only ever called
  // from an event handler; the first load is the effect below, which fetches
  // inline and sets state from the callback the way the other panels do.
  const load = useCallback(async () => {
    const response = await fetch("/api/worlds/registry");
    setState(
      response.ok ? await response.json() : { configured: false, packs: [], installed: [] },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/worlds/registry")
      .then((response) =>
        response.ok ? response.json() : { configured: false, packs: [], installed: [] },
      )
      .then((data) => {
        if (!cancelled) {
          setState(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ configured: false, packs: [], installed: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveRegistry() {
    const next = registryInput.current?.value.trim() ?? "";
    setBusyId("registry");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldRegistryUrl: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not save the registry URL.");
        return;
      }
      setNotice(next ? "Registry saved." : "Registry cleared.");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function install(body: Record<string, unknown>, key: string) {
    setBusyId(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/worlds/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not install that world.");
        return;
      }
      setNotice(
        data.replaced
          ? `Updated ${data.pack.name}. Campaigns already using it pick up the new build on their next turn.`
          : `Installed ${data.pack.name}.`,
      );
      forgetPackArt(data.pack?.id);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(pack: WorldPackSummary) {
    setBusyId(pack.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/worlds/${encodeURIComponent(pack.id)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not remove that world.");
        return;
      }
      setNotice(`Removed ${pack.name}. Campaigns that used it fall back to their plain setting.`);
      forgetPackArt(pack.id);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function onFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is larger than 16MB, so it is not a world pack.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("That file is not valid JSON.");
      return;
    }
    await install({ pack: parsed }, "upload");
  }

  if (!state) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  const installedIds = new Map(state.installed.map((pack) => [pack.id, pack]));
  const registryById = new Map(state.packs.map((entry) => [entry.id, entry]));
  // An installed pack lives in the "Installed" section below (with its own
  // update control), so keep it out of the download list rather than showing a
  // second, redundant tile for it here.
  const available = state.packs.filter((entry) => !installedIds.has(entry.id));

  return (
    <div className="space-y-6 text-sm">
      <section className={cn(ui.card, "texture-noise p-5")}>
        <h2 className={ui.sectionEyebrow}>{uiText("campaignPlugins")}</h2>
        <p className="mt-2 text-xs leading-5 text-stone-400">
          {uiText("aWorldPackRenamesTheRulesIntoA")}
        </p>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          {uiText("packsBasedOnAnExistingUniverseAreCommunity")}
        </p>
      </section>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {notice ? <p className="text-xs text-amber-200">{notice}</p> : null}

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400">
            {uiText("installFromAFile")}
          </h3>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset first, so picking the same file twice still fires.
            event.target.value = "";
            if (file) {
              void onFile(file);
            }
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busyId === "upload"}
          className={cn(ui.btnSmall, "text-xs")}
        >
          {busyId === "upload" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {uiText("chooseAPackFile")}
        </button>
        <p className="mt-1 text-[11px] text-stone-500">
          {uiText("aSingleJsonManifestItIsValidatedBefore")}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          {uiText("registry")}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            key={state.url ?? ""}
            ref={registryInput}
            defaultValue={state.url ?? ""}
            placeholder={uiText("blankUsesTheBuiltInRegistry")}
            className={cn(ui.input, "min-w-0 flex-1 text-xs")}
          />
          <button
            type="button"
            onClick={saveRegistry}
            disabled={busyId === "registry"}
            className={cn(ui.btnSmall, "text-xs")}
          >
            {busyId === "registry" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {uiText("save")}
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-stone-500">
          {uiText("aJsonIndexOfDownloadableCampaignsOverHttps9abd4b")}
          <span className="font-mono"> WORLD_REGISTRY_URL </span>
          {uiText("thenTheRegistryBuiltIntoThisAppUse")}
          <span className="font-mono">{uiText("offda7a68")}</span>{" "}
          {uiText("toTurnOffBrowsingListedWorldsAreThird")}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          {uiText("availableToDownload")}
        </h3>
        {!state.configured ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs leading-5 text-stone-500">
            {uiText("thisServerAposSRegistryIsTurnedOff")}
          </p>
        ) : state.error ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-red-400">
            {state.error}
          </p>
        ) : !state.packs.length ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-stone-500">
            {uiText("thatRegistryListsNoCampaigns")}
          </p>
        ) : !available.length ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-stone-500">
            {uiText("everythingThisRegistryOffersIsAlreadyInstalled")}
          </p>
        ) : (
          <ul className="space-y-2">
            {available.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-stone-800 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-stone-100">
                    <GameIcon icon={{ kind: "glyph", key: "system-plugin" }} size="size-6" />
                    {entry.name}
                  </span>
                  <span className="text-[11px] text-stone-500">
                    v{entry.version}
                    {entry.author ? ` · ${entry.author}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-400">{entry.blurb}</p>
                <UnofficialPackNotice
                  rightsHolder={entry.rightsHolder}
                  inspiredBy={entry.inspiredBy}
                  variant="inline"
                  className="mt-1"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => install({ packId: entry.id }, entry.id)}
                    disabled={busyId === entry.id}
                    className={cn(ui.btnSmall, "text-xs")}
                  >
                    {busyId === entry.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    {uiText("install")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          {uiText("installed")}
        </h3>
        {!state.installed.length ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-stone-500">
            {uiText("noWorldPacksYetCampaignsRunOnThe")}
          </p>
        ) : (
          <ul className="space-y-2">
            {state.installed.map((pack) => {
              const update = registryById.get(pack.id);
              const outdated = Boolean(update && update.version !== pack.version);
              return (
                <li key={pack.id} className="rounded-lg border border-stone-800 p-3">
                  {pack.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pack.cover}
                      alt=""
                      className="mb-2 h-24 w-full rounded-md border border-stone-800 object-cover"
                    />
                  ) : null}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-stone-100">
                      <GameIcon icon={{ kind: "glyph", key: "system-plugin" }} size="size-6" />
                      {pack.name}
                    </span>
                    <span className="text-[11px] text-stone-500">
                      v{pack.version}
                      {pack.author ? ` · ${pack.author}` : ""}
                      {pack.source === "bundled" ? ` · ${uiText("bundled")}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-stone-400">{pack.blurb}</p>
                  <UnofficialPackNotice
                    rightsHolder={pack.rightsHolder}
                    inspiredBy={pack.inspiredBy}
                    variant="inline"
                    className="mt-1"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {outdated ? (
                      <button
                        type="button"
                        onClick={() => install({ packId: pack.id }, pack.id)}
                        disabled={busyId === pack.id}
                        className={cn(ui.btnSmall, "text-xs")}
                      >
                        {busyId === pack.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                        {uiText("updateToV")}{update?.version}
                      </button>
                    ) : null}
                    {pack.source === "installed" ? (
                      <button
                        type="button"
                        onClick={() => remove(pack)}
                        disabled={busyId === pack.id}
                        className={cn(ui.btnSmall, "text-xs")}
                      >
                        {busyId === pack.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        {uiText("remove")}
                      </button>
                    ) : outdated ? null : (
                      <p className="text-[11px] text-stone-600">
                        {uiText("shipsWithTheAppAndCannotBeRemoved")}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
