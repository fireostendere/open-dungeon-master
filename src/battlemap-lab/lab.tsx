// Battle-map lab: a standalone page (battlemap-lab.html) that draws the
// game's real map renderer in every style over a generated battle, so the
// looks can be compared side by side without starting a campaign.
// Build: npm run map:lab. Address bar: #theme=cave&style=torchlit&fog=0

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import { BattleMapGrid } from "@/app/campaigns/[campaignId]/BattleMapGrid";
import { BattleMapPanel } from "@/app/campaigns/[campaignId]/BattleMapPanel";
import { MAP_THEMES, type MapTheme } from "@/lib/battlemap/generate";
import { MAP_STYLES, type MapStyle } from "@/lib/battlemap/map-style";
import type { AmbientLight } from "@/lib/battlemap/types";
import { sampleView } from "./sample";
import "./lab.css";

const STYLE_NAME: Record<MapStyle, [string, string]> = {
  classic: ["Классика", "как сейчас"],
  flagstone: ["Каменные плиты", "текстуры и тени"],
  relief: ["Объём", "стены с высотой, жетоны стоят"],
  torchlit: ["Свет факелов", "тёмный, с живым огнём"],
  parchment: ["Пергамент", "чернила на старой бумаге"],
  blueprint: ["Чертёж", "плоский, лёгкий, читаемый"],
};
const THEME_NAME: Record<MapTheme, string> = {
  cave: "Пещера",
  forest: "Лес",
  swamp: "Болото",
  riverside: "Берег реки",
  interior: "Помещение",
  field: "Поле",
};
const AMBIENT_NAME: Record<AmbientLight | "auto", string> = { auto: "как у карты", bright: "день", dim: "сумерки", dark: "темно" };

type State = { theme: MapTheme; style: MapStyle | "all"; ambient: AmbientLight | "auto"; fog: boolean; across: boolean; art: boolean; tilt: boolean; foes: string[]; panel: boolean };

function readHash(): State {
  const p = new URLSearchParams(window.location.hash.slice(1));
  const theme = p.get("theme") as MapTheme;
  const style = p.get("style") as MapStyle | "all";
  const ambient = p.get("ambient") as AmbientLight;
  return {
    theme: MAP_THEMES.includes(theme) ? theme : "cave",
    style: style === "all" || (MAP_STYLES as readonly string[]).includes(style) ? style : "all",
    ambient: ["bright", "dim", "dark"].includes(ambient) ? ambient : "auto",
    fog: p.get("fog") !== "0",
    across: p.get("across") === "1",
    art: p.get("art") === "1",
    tilt: p.get("tilt") === "1",
    panel: p.get("panel") === "1",
    foes: (p.get("foes") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="bar" style={{ margin: 0 }}>
      <b>{label}</b>
      <span className="seg">
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </span>
    </div>
  );
}

// The lab has no game behind it, so what the map reports is kept on the window
// for a person (or a test) to look at.
function record(name: "taps" | "hovers", value: [number, number | null]) {
  const w = window as unknown as Record<string, unknown[]>;
  (w[`__${name}`] ??= []).push(value);
}

function Lab() {
  const [state, setState] = useState<State>(readHash);
  useEffect(() => {
    const on = () => setState(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const set = (patch: Partial<State>) => {
    const next = { ...state, ...patch };
    setState(next);
    const p = new URLSearchParams();
    p.set("theme", next.theme);
    p.set("style", next.style);
    if (next.ambient !== "auto") p.set("ambient", next.ambient);
    if (!next.fog) p.set("fog", "0");
    if (next.across) p.set("across", "1");
    if (next.art) p.set("art", "1");
    if (next.tilt) p.set("tilt", "1");
    if (next.foes.length) p.set("foes", next.foes.join(","));
    try {
      window.history.replaceState(null, "", `#${p.toString()}`);
    } catch {
      // A host that owns the address bar: the choice still lives in the page.
    }
  };

  const styles: MapStyle[] = state.style === "all" ? [...MAP_STYLES] : [state.style];
  const themes: MapTheme[] = state.across ? [...MAP_THEMES] : [state.theme];
  const cards = state.across
    ? themes.flatMap((theme) => styles.map((style) => ({ theme, style })))
    : styles.map((style) => ({ theme: state.theme, style }));

  return (
    <div className="lab">
      <h1>Карта боя — варианты оформления</h1>
      <p>
        Карту можно приближать (колесо с Ctrl, щипок двумя пальцами, кнопки «+» и «−») и двигать перетаскиванием; на телефоне она сразу крупная и открывается на вашей фигуре.
      </p>
      <p>
        Это настоящий рендерер карты из игры на сгенерированной схватке: часть поля в тумане, часть в поле зрения, золотая клетка — ваш токен, подсвечены клетки, куда можно шагнуть. Стиль
        выбирается в игре кнопкой «палитра» рядом с разворотом карты, там же включается небольшой наклон стола; оба выбора запоминаются на устройстве.
      </p>
      <div className="bar">
        <Seg label="Стиль" value={state.style} options={[["all", "Все"], ...MAP_STYLES.map((s) => [s, STYLE_NAME[s][0]] as [MapStyle, string])]} onChange={(style) => set({ style })} />
      </div>
      <div className="bar">
        <Seg label="Местность" value={state.theme} options={MAP_THEMES.map((t) => [t, THEME_NAME[t]] as [MapTheme, string])} onChange={(theme) => set({ theme, across: false })} />
        <Seg label="Свет" value={state.ambient} options={(["auto", "bright", "dim", "dark"] as const).map((a) => [a, AMBIENT_NAME[a]] as [AmbientLight | "auto", string])} onChange={(ambient) => set({ ambient })} />
        <Seg label="Туман" value={state.fog ? "on" : "off"} options={[["on", "Игрок"], ["off", "Мастер"]]} onChange={(v) => set({ fog: v === "on" })} />
        <Seg label="Подложка" value={state.art ? "on" : "off"} options={[["off", "Нет"], ["on", "Картинка"]]} onChange={(v) => set({ art: v === "on" })} />
        <Seg label="Наклон" value={state.tilt ? "on" : "off"} options={[["off", "Нет"], ["on", "Немного"]]} onChange={(v) => set({ tilt: v === "on" })} />
        <Seg label="Показ" value={state.across ? "themes" : "one"} options={[["one", "Одна местность"], ["themes", "Все местности"]]} onChange={(v) => set({ across: v === "themes" })} />
      </div>
      {state.panel ? (
        // The game's own map panel (the one with the palette menu, the
        // enlarge button and the full-screen phone dialog), for checking it.
        <div style={{ maxWidth: 460 }}>
          <BattleMapPanel
            campaignId="lab"
            view={sampleView(state.theme, { ambient: state.ambient === "auto" ? undefined : state.ambient, fog: state.fog, art: state.art, foes: state.foes })}
            encounter={null}
            sheets={[]}
            refreshBattleMap={async () => {}}
          />
        </div>
      ) : null}
      {state.panel ? null : (
      <div className={`maps${cards.length === 1 ? " single" : ""}`}>
        {cards.map(({ theme, style }) => (
          <section className="card" key={`${theme}-${style}`}>
            <h2>
              {STYLE_NAME[style][0]}
              <span>
                {state.across ? `${THEME_NAME[theme]} · ` : ""}
                {STYLE_NAME[style][1]}
              </span>
            </h2>
            <BattleMapGrid
              view={sampleView(theme, { ambient: state.ambient === "auto" ? undefined : state.ambient, fog: state.fog, art: state.art, foes: state.foes })}
              sheets={[]}
              mapStyle={style}
              tilt={state.tilt}
              onTileClick={(x, y) => record("taps", [x, y])}
              onTileHover={(x, y) => record("hovers", [x, y])}
            />
          </section>
        ))}
      </div>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider initialLocale="ru">
        <Lab />
      </I18nProvider>
    </StrictMode>,
  );
}
