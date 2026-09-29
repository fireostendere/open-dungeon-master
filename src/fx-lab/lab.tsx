// Animations lab: a standalone page (animations-lab.html) that mounts the
// real game overlays with fake campaign data. Build: npm run fx:lab

import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider, useI18n } from "@/lib/i18n";
import type { PendingRoll } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { DiceRollOverlay, type DiceRollData } from "@/app/campaigns/[campaignId]/DiceRollOverlay";
import { useFxMuted } from "@/components/fx/shared";
import { FxSettingsPanel } from "@/components/fx/FxSettingsPanel";
import { CINEMATIC_SCENARIOS, type CinematicScenario } from "./cinematic-scenarios";
import { DICE_SCENARIOS, LAB_ENEMIES, LAB_ME, LAB_SHEETS, type DiceScenario } from "./dice-scenarios";
import "./lab.css";

const sheets = LAB_SHEETS as unknown as CharacterSheet[];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lab-section">
      <h2>{title}</h2>
      <div className="lab-grid">{children}</div>
    </section>
  );
}

function FakeTable() {
  // A rough sketch of the campaign screen so overlays are seen over "the game".
  return (
    <div className="lab-table" aria-hidden="true">
      <div className="lab-table__chat">
        {["Мастер: Ворота охраняют двое стражников с алебардами.", "Эйра: Я пытаюсь проскользнуть в тени у стены.", "Торин: Прикрою, если что.", "Мастер: Сделай проверку Скрытности."].map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <div className="lab-table__map" />
    </div>
  );
}

function Lab() {
  const { locale, toggleLocale } = useI18n();
  const [muted, setMuted] = useFxMuted();
  const [pending, setPending] = useState<PendingRoll[]>([]);
  const [latest, setLatest] = useState<DiceRollData | null>(null);
  const seq = useRef(1);
  const keys = useRef(1);
  const [cinematic, setCinematic] = useState<{ scenario: CinematicScenario; key: number } | null>(null);
  const [yolo, setYolo] = useState(true);
  const [last, setLast] = useState("");

  const push = useCallback((roll: DiceRollData["roll"]) => {
    setLatest({ roll, source: "digital", seq: seq.current++ });
  }, []);

  const runDice = (s: DiceScenario) => {
    setLast(s.id);
    setCinematic(null);
    if (s.pending) {
      setPending([{ ...s.pending, id: `pending-${keys.current++}`, createdAt: "" }]);
      return;
    }
    push(s.roll());
  };

  const submitPending = useCallback(
    async (p: PendingRoll) => {
      const scenario = DICE_SCENARIOS.find((s) => s.pending?.detail === p.detail) ?? DICE_SCENARIOS[0];
      // Pretend the server takes a moment to roll.
      await new Promise((r) => setTimeout(r, 650));
      setPending([]);
      push(scenario.roll());
    },
    [push],
  );

  const reroll = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 700));
    const scenario = DICE_SCENARIOS.find((s) => s.id === last) ?? DICE_SCENARIOS[0];
    push(scenario.roll());
  }, [last, push]);

  const runCinematic = (scenario: CinematicScenario) => {
    setCinematic({ scenario, key: keys.current++ });
  };

  // For scripted screenshots: window.fxLab.run("dice", "attack").
  const runRef = useRef({ runDice, runCinematic });
  useEffect(() => {
    runRef.current = { runDice, runCinematic };
  });
  useEffect(() => {
    (window as unknown as { fxLab?: unknown }).fxLab = {
      run(kind: string, id: string) {
        if (kind === "dice") {
          const s = DICE_SCENARIOS.find((d) => d.id === id);
          if (s) runRef.current.runDice(s);
        } else {
          const c = CINEMATIC_SCENARIOS.find((d) => d.id === id);
          if (c) runRef.current.runCinematic(c);
        }
      },
    };
  }, []);

  return (
    <div className="lab">
      <FakeTable />
      <aside className="lab-panel">
        <header className="lab-head">
          <h1>Анимации ODM</h1>
          <p>Стенд собран из тех же компонентов, что и игра. Нажмите сценарий — оверлей откроется поверх «стола».</p>
          <div className="lab-toggles">
            <button type="button" onClick={toggleLocale}>{locale === "ru" ? "RU → EN" : "EN → RU"}</button>
            <button type="button" onClick={() => setMuted(!muted)}>{muted ? "🔇 Звук выкл" : "🔊 Звук вкл"}</button>
            <button type="button" aria-pressed={yolo} onClick={() => setYolo(!yolo)}>{yolo ? "YOLO 21+ вкл" : "YOLO 21+ выкл"}</button>
          </div>
        </header>
        <details className="lab-prefs">
          <summary>Настройки анимаций (как в шапке игры)</summary>
          <FxSettingsPanel />
        </details>
        <Section title="Кубики">
          {DICE_SCENARIOS.map((s) => (
            <button key={s.id} type="button" className="lab-card" onClick={() => runDice(s)}>
              <b>{s.label}</b>
              <span>{s.hint}</span>
            </button>
          ))}
        </Section>
        {Array.from(new Set(CINEMATIC_SCENARIOS.map((c) => c.group))).map((group) => (
          <Section key={group} title={group}>
            {CINEMATIC_SCENARIOS.filter((c) => c.group === group).map((c) => (
              <button key={c.id} type="button" className="lab-card" onClick={() => runCinematic(c)}>
                <b>{c.label}</b>
                <span>{c.hint}</span>
              </button>
            ))}
          </Section>
        ))}
      </aside>

      <DiceRollOverlay
        pendingRolls={pending}
        meUserId={LAB_ME}
        latestRoll={latest}
        sheets={sheets}
        enemies={LAB_ENEMIES}
        enabled
        submitPending={submitPending}
        rerollWithInspiration={reroll}
        persistDismissed={false}
        onDismiss={() => setPending([])}
      />
      {cinematic ? cinematic.scenario.render({ key: cinematic.key, yolo, onClose: () => setCinematic(null) }) : null}
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
