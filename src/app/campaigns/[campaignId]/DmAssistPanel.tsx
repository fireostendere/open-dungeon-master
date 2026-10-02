"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { adjudicationGlyph } from "@/app/campaigns/[campaignId]/SessionGlyph";
import { cn } from "@/lib/cn";
import { DmActionForm } from "@/app/campaigns/[campaignId]/DmActionForm";
import { ADJUDICATIONS } from "@/lib/dm/invoke-catalog";
import { findAdjudication } from "@/lib/dm/catalog-types";
import { DIFFICULTY_TIERS, dcForDifficulty, type DifficultyTier } from "@/lib/srd/dc";
import { evaluateEncounter, type EncounterVerdict } from "@/lib/srd/encounter-math";
import { OddsCalculator, type CritRules } from "@/app/campaigns/[campaignId]/DmOddsPanel";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The DM's assist rail: read-only answers from engines that already exist.
// Nothing here applies anything to the game. The one exception is the
// suggestion, which hands the DM a prefilled adjudication form; they still
// press the button.

const TIER_LABELS: Record<DifficultyTier, string> = {
  very_easy: "Very easy",
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  very_hard: "Very hard",
  nearly_impossible: "Nearly impossible",
};

const VERDICT_LABELS: Record<EncounterVerdict, string> = {
  trivial: "Trivial",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  deadly: "Deadly",
  beyond_deadly: "Beyond deadly",
};

const VERDICT_TONE: Record<EncounterVerdict, string> = {
  trivial: "text-stone-400",
  easy: "text-emerald-300",
  medium: "text-amber-200",
  hard: "text-orange-300",
  deadly: "text-red-300",
  beyond_deadly: "text-red-400",
};

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none";

function Section({
  glyph,
  title,
  children,
}: {
  glyph: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-5" />
        {title}
      </p>
      {children}
    </section>
  );
}

type Suggestion = {
  name: string;
  label: string;
  summary: string;
  args?: Record<string, unknown>;
  why?: string;
};

// "The player said this. What am I supposed to press?" The shortlist comes
// from a keyword/rules pass over the catalog and arrives instantly.
function IntentSuggest({
  campaignId,
  sheets,
  encounter,
  intent,
  onIntentChange,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  intent: string;
  onIntentChange: (next: string) => void;
}) {
  const uiText = useInlineText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState<Suggestion | null>(null);

  async function ask() {
    const text = intent.trim();
    if (!text) {
      return;
    }
    setBusy(true);
    setError("");
    setOpen(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/assist/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not work that out.");
        return;
      }
      setSuggestions(data.suggestions ?? []);
      if (!data.suggestions?.length) {
        setError("Nothing in the engine matches that. It may just be narration.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const openEntry = open ? findAdjudication(ADJUDICATIONS, open.name) : null;

  return (
    <Section glyph="die-d20" title={uiText("whatShouldIPress")}>
      <textarea
        value={intent}
        onChange={(event) => onIntentChange(event.target.value.slice(0, 1000))}
        rows={2}
        placeholder={uiText("iTryToTalkTheGuardIntoLetting")}
        className={cn(inputClass, "resize-y")}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void ask()}
          disabled={busy || !intent.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/50 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {uiText("suggest")}
        </button>
      </div>
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}

      {suggestions.length ? (
        <ul className="mt-2 space-y-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion.name}>
              {open?.name === suggestion.name && openEntry ? (
                <div className="space-y-1">
                  <DmActionForm
                    campaignId={campaignId}
                    entry={openEntry}
                    sheets={sheets}
                    encounter={encounter}
                    initialArgs={suggestion.args}
                    glyph={adjudicationGlyph(suggestion.name, "tab-dm")}
                  />
                  <button
                    type="button"
                    onClick={() => setOpen(null)}
                    className="text-[11px] text-stone-500 hover:text-stone-300"
                  >
                    {uiText("close")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(suggestion)}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2 text-left hover:border-stone-700"
                >
                  <GameIcon icon={{ kind: "glyph", key: adjudicationGlyph(suggestion.name, "tab-dm") }} size="size-7" />
                  <span className="min-w-0 grow">
                  <span className="block text-sm text-stone-200">
                    {suggestion.label}
                    {suggestion.args ? (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-300/80">
                        {uiText("filledIn")}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-stone-500">
                    {suggestion.why || suggestion.summary}
                  </span>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

// The DMG's difficulty ladder, so "hard" is DC 20 in every scene.
function DcLadder() {
  const uiText = useInlineText();
  return (
    <Section glyph="rest-proficiency" title={uiText("whatShouldThisCost")}>
      <div className="flex flex-wrap gap-1">
        {DIFFICULTY_TIERS.map((tier) => (
          <span
            key={tier}
            className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300"
          >
            {TIER_LABELS[tier]}
            <span className="ml-1.5 font-semibold text-amber-200">
              DC {dcForDifficulty(tier)}
            </span>
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-stone-500">
        {uiText("namingTheTierRatherThanTheNumberIs")}
      </p>
    </Section>
  );
}

// The fight on the board, measured against the party in front of it.
function EncounterBudget({
  sheets,
  encounter,
}: {
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
}) {
  const uiText = useInlineText();
  const evaluation = useMemo(() => {
    const levels = sheets.filter((sheet) => !sheet.deathSaves?.dead).map((sheet) => sheet.level);
    const crs = (encounter?.enemies ?? [])
      .filter((enemy) => enemy.status === "alive")
      .map((enemy) => enemy.cr);
    if (!levels.length || !crs.length) {
      return null;
    }
    return evaluateEncounter(levels, crs);
  }, [sheets, encounter]);

  if (!evaluation) {
    return (
      <Section glyph="system-encounters" title={uiText("howHardIsThisFight")}>
        <p className="text-xs text-stone-500">
          {uiText("nothingOnTheBoardYetAddEnemiesAnd")}
        </p>
      </Section>
    );
  }
  return (
    <Section glyph="system-encounters" title={uiText("howHardIsThisFight")}>
      <p className={cn("flex items-center gap-1.5 text-sm font-medium", VERDICT_TONE[evaluation.verdict])}>
        <GameIcon icon={{ kind: "glyph", key: "tab-battle" }} size="size-5" />
        {VERDICT_LABELS[evaluation.verdict]}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-stone-500">
        {uiText("adjustedAdjustedXpAgainstThresholdsEasyEasyMedium", {
          adjusted: evaluation.adjustedXp.toLocaleString(),
          easy: evaluation.thresholds.easy.toLocaleString(),
          medium: evaluation.thresholds.medium.toLocaleString(),
          hard: evaluation.thresholds.hard.toLocaleString(),
          deadly: evaluation.thresholds.deadly.toLocaleString(),
          total: evaluation.totalXp.toLocaleString(),
        })}
      </p>
    </Section>
  );
}

// Rules lookup, which is Ask with the scope pinned to "rules" and the answer
// kept private. Not a second Ask: the same endpoint, the same retrieval, the
// same citations. What it adds is that the DM does not have to leave the
// console to use it, which on a phone means not leaving the screen.
//
// House rules already win here: assembleEvidence pulls the table's own
// rule_chunks, sorts pinned ones first, and tells the model they override the
// standard rules.
function RulesLookup({ campaignId }: { campaignId: string }) {
  const uiText = useInlineText();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<{
    answer: string;
    citations: Array<{ kind: string; ref: string; quote: string }>;
  } | null>(null);

  async function look() {
    const text = question.trim();
    if (!text) {
      return;
    }
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, scope: "rules", visibility: "private" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not look that up.");
        return;
      }
      setAnswer({ answer: data.ask?.answer ?? "", citations: data.ask?.citations ?? [] });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section glyph="system-rules" title={uiText("lookUpARule")}>
      <div className="flex gap-1.5">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value.slice(0, 500))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void look();
            }
          }}
          placeholder={uiText("canYouCastASpellAndUseA")}
          className={inputClass}
        />
        <button
          type="button"
          onClick={look}
          disabled={busy || !question.trim()}
          className="shrink-0 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : uiText("ask")}
        </button>
      </div>
      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
      {answer ? (
        <div className="mt-1.5 text-xs text-stone-300">
          <p className="whitespace-pre-wrap">{answer.answer}</p>
          {answer.citations.length ? (
            <ul className="mt-1 space-y-0.5 text-[11px] text-stone-500">
              {answer.citations.map((citation) => (
                <li key={`${citation.kind}:${citation.ref}`}>
                  {citation.ref}: {citation.quote}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

export function DmAssistPanel({
  campaignId,
  sheets,
  encounter,
  variantRules,
  intent,
  onIntentChange,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter | null;
  // The table's crit rules, so the consequence preview agrees with what the
  // server would roll.
  variantRules: CritRules;
  intent: string;
  onIntentChange: (next: string) => void;
}) {
  return (
    <div className="space-y-3">
      <IntentSuggest
        campaignId={campaignId}
        sheets={sheets}
        encounter={encounter}
        intent={intent}
        onIntentChange={onIntentChange}
      />
      <EncounterBudget sheets={sheets} encounter={encounter} />
      <DcLadder />
      <OddsCalculator variantRules={variantRules} />
      <RulesLookup campaignId={campaignId} />
    </div>
  );
}
