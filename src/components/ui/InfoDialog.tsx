"use client";

import { useInlineText } from "@/lib/i18n/inline-text";
import { Info, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import type { IconRef } from "@/lib/icons";
import { localizedContentName } from "@/lib/help";
import { useI18n } from "@/lib/i18n";
import type { ItemSheet } from "@/lib/help/item-sheet";
import { parseRulesBlocks } from "@/lib/help/rules-text";

// The "what does this do?" affordance, used everywhere a game term appears.
//
// Built on the shared Dialog rather than a popover on purpose: Radix tooltips
// never open on a touch tap, and the session layout is used on phones. A
// dialog behaves identically with a mouse, a finger and a keyboard.
//
// Text can be passed directly (features, glossary terms) or fetched lazily
// from the content pack by {kind, slug} for spells, feats and items, which is
// what /api/content/[kind]/[slug] was built for.

// `name` lets the lookup recover when a row's slug is not the plain
// slugified name (third-party documents pick their own), by falling back to
// a search.
export type ContentRef = { kind: string; slug: string; name?: string };

// Content-pack descriptions are markdown-ish: headings, bold, italics, tables.
// Rendering the handful of constructs that actually appear is far cheaper than
// a markdown dependency, and unknown syntax degrades to plain text rather than
// showing raw asterisks. Table rows keep their pipes inside a monospace block.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|(?<![\w])_[^_\n]+_(?![\w]))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    index += 1;
    if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-medium text-stone-200">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key} className="text-stone-300">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

export function renderRules(text: string): ReactNode {
  // Block structure (headings, lists, captioned tables) comes from
  // src/lib/help/rules-text.ts, which knows the content pack's quirks.
  return parseRulesBlocks(text).map((block, blockIndex) => {
    switch (block.kind) {
      case "table":
        // Keep the alignment by rendering the raw rows in a scroll box.
        return (
          <pre
            key={blockIndex}
            className="overflow-x-auto rounded-md bg-stone-900/60 p-2 text-[11px] leading-relaxed text-stone-400"
          >
            {block.rows.join("\n")}
          </pre>
        );
      case "list":
        return (
          <ul key={blockIndex} className="list-disc space-y-1 pl-4">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item, `${blockIndex}-${itemIndex}`)}</li>
            ))}
          </ul>
        );
      case "heading":
        // A heading line becomes a small label rather than showing its hashes.
        return (
          <p key={blockIndex} className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-200/80">
            {block.text}
          </p>
        );
      default:
        return <p key={blockIndex}>{renderInline(block.text, String(blockIndex))}</p>;
    }
  });
}

// Loads a content-pack entry's description on first open, so opening a sheet
// with forty spells on it costs nothing until one is actually inspected.
function ContentBody({ reference }: { reference: ContentRef }) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const [state, setState] = useState<{ text: string | null; loading: boolean }>({
    text: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { describeContentEntry } = await import("@/lib/help");
        const response = await fetch(
          `/api/content/${reference.kind}/${encodeURIComponent(reference.slug)}`,
        );
        if (response.ok) {
          const data = await response.json();
          const text = describeContentEntry(data?.entry?.data, locale, {
            kind: reference.kind,
            name: reference.name,
            slug: reference.slug,
          });
          if (text) {
            if (!cancelled) {
              setState({ text, loading: false });
            }
            return;
          }
        }
        // The slug guessed from the name missed, or the row it found carries
        // no text. Search by name and take an exact match.
        const wanted = (reference.name ?? reference.slug).trim().toLowerCase();
        const search = await fetch(
          `/api/content/${reference.kind}?q=${encodeURIComponent(wanted)}&limit=20`,
        );
        const results = search.ok ? ((await search.json()).results ?? []) : [];
        const hit = results.find(
          (entry: { name: string }) => entry.name.trim().toLowerCase() === wanted,
        );
        if (!cancelled) {
          setState({
            text: describeContentEntry(hit?.data, locale, {
              kind: reference.kind,
              name: reference.name,
              slug: reference.slug,
            }),
            loading: false,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ text: null, loading: false });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reference.kind, reference.slug, reference.name, locale]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500">
        <Loader2 className="size-4 animate-spin" /> {uiText("lookingItUp")}
      </p>
    );
  }
  if (!state.text) {
    return (
      <p className="text-sm text-stone-500">
        {uiText("noDescriptionAvailableTheContentPackMayNot")}
      </p>
    );
  }
  return <>{renderRules(state.text)}</>;
}

function StatTile({ label, value, note }: { label: string; value: string | null; note?: string | null }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p className={cn("font-display text-base leading-tight", value ? "text-amber-100" : "text-stone-600")}>
        {value ?? "—"}
      </p>
      {note ? <p className="text-[11px] leading-tight text-stone-400">{note}</p> : null}
    </div>
  );
}

function ItemSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-200/80">{title}</p>
      {children}
    </section>
  );
}

function RuleList({ rows }: { rows: Array<{ label: string; text: string | null }> }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
          <dt className="shrink-0 font-medium text-stone-200 sm:w-32">{row.label}</dt>
          <dd className="text-stone-400">{row.text ?? ""}</dd>
        </div>
      ))}
    </dl>
  );
}

// The item card: what it is, weight and value always on show, then the
// armour or weapon stats, then the long text when there is any. The facts
// come from every row that shares the name plus the bundled SRD tables
// (src/lib/help/item-sheet.ts), so a v1 table row with no prose, a v2 gear
// row with no stats and a genre item the pack lacks all get a full card.
function ItemBody({ reference }: { reference: ContentRef }) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const [state, setState] = useState<{ sheet: ItemSheet | null; loading: boolean }>({
    sheet: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const name = (reference.name ?? reference.slug).trim();
      const wanted = name.toLowerCase();
      const readJson = async (response: Response) => (response.ok ? response.json() : null);
      try {
        const [{ buildItemSheet }, direct, search] = await Promise.all([
          import("@/lib/help/item-sheet"),
          fetch(`/api/content/items/${encodeURIComponent(reference.slug)}`).then(readJson).catch(() => null),
          fetch(`/api/content/items?q=${encodeURIComponent(wanted)}&limit=20`).then(readJson).catch(() => null),
        ]);
        const hits = ((search?.results ?? []) as Array<{ name: string; data?: Record<string, unknown> }>)
          .filter((entry) => entry.name.trim().toLowerCase() === wanted)
          .map((entry) => entry.data);
        const sheet = buildItemSheet(name, [direct?.entry?.data, ...hits], locale);
        if (!cancelled) {
          setState({ sheet, loading: false });
        }
      } catch {
        if (!cancelled) {
          setState({ sheet: null, loading: false });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reference.slug, reference.name, locale]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500">
        <Loader2 className="size-4 animate-spin" /> {uiText("lookingItUp")}
      </p>
    );
  }
  const sheet = state.sheet;
  if (!sheet) {
    return (
      <p className="text-sm text-stone-500">
        {uiText("noDetailsAvailableTheContentPackMayNot")}
      </p>
    );
  }

  const tags = [
    sheet.rarity,
    sheet.attunement ? uiText("requiresAttunement") : null,
    sheet.bonus ? uiText("bonusMagic", { bonus: sheet.bonus }) : null,
  ].filter((tag): tag is string => Boolean(tag));
  const tiles: Array<{ label: string; value: string | null; note?: string | null }> = [
    { label: uiText("weight"), value: sheet.weight },
    { label: uiText("value"), value: sheet.cost },
  ];
  if (sheet.armor) {
    tiles.push({ label: sheet.armor.shield ? uiText("acBonus") : uiText("armorClass"), value: sheet.armor.ac });
  }
  if (sheet.weapon) {
    tiles.push({
      label: uiText("damage"),
      value: sheet.weapon.damage ?? uiText("none"),
      note: sheet.weapon.damageType,
    });
    if (sheet.weapon.range) {
      tiles.push({ label: uiText("range"), value: sheet.weapon.range });
    }
  }

  const armorRows: Array<{ label: string; text: string | null }> = [];
  if (sheet.armor) {
    if (sheet.armor.shield) {
      armorRows.push({ label: uiText("shield"), text: uiText("carriedInOneHandOnlyOneShieldCounts") });
    }
    if (sheet.armor.dex) {
      armorRows.push({ label: uiText("dexterity"), text: sheet.armor.dex });
    }
    armorRows.push({
      label: uiText("strength"),
      text: sheet.armor.strength
        ? uiText("needsStrengthBelowThatYourSpeedDropsBy", { strength: sheet.armor.strength })
        : uiText("noMinimum"),
    });
    armorRows.push({
      label: uiText("stealth"),
      text: sheet.armor.stealthDisadvantage
        ? uiText("disadvantageOnDexterityStealthChecksWhileWearingIt")
        : uiText("noPenalty"),
    });
  }
  const weaponRows: Array<{ label: string; text: string | null }> = [];
  if (sheet.weapon) {
    if (sheet.bonus) {
      weaponRows.push({
        label: uiText("bonusWeapon", { bonus: sheet.bonus }),
        text: uiText("addsBonusToAttackAndDamageRolls", { bonus: sheet.bonus }),
      });
    }
    for (const property of sheet.weapon.properties) {
      weaponRows.push({ label: property.name, text: property.blurb });
    }
    if (sheet.weapon.damageType && sheet.weapon.damageBlurb) {
      weaponRows.push({ label: capitalize(sheet.weapon.damageType), text: sheet.weapon.damageBlurb });
    }
    if (!sheet.weapon.damage) {
      weaponRows.push({ label: uiText("noDamage"), text: uiText("itDoesNotHurtOnItsOwnIts") });
    }
  }

  return (
    <div className="space-y-4">
      {sheet.type || tags.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {sheet.type ? <span className="text-sm font-medium text-stone-200">{sheet.type}</span> : null}
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-amber-200/20 bg-amber-200/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200/80"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))]">
        {tiles.map((tile) => (
          <StatTile key={tile.label} {...tile} />
        ))}
      </div>
      {armorRows.length ? (
        <ItemSection title={uiText("armor")}>
          <RuleList rows={armorRows} />
        </ItemSection>
      ) : null}
      {weaponRows.length ? (
        <ItemSection title={uiText("weapon")}>
          <RuleList rows={weaponRows} />
        </ItemSection>
      ) : null}
      {sheet.description ? (
        <ItemSection title={uiText("description")}>
          <div className="space-y-2 border-t border-stone-800 pt-2">{renderRules(sheet.description)}</div>
        </ItemSection>
      ) : null}
    </div>
  );
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// The ⓘ button plus its dialog. `label` names the thing; `text` is its
// description, or omit it and pass `reference` to fetch one.
export function InfoButton({
  label,
  text,
  reference,
  meta,
  icon,
  className,
  size = "sm",
}: {
  label: string;
  text?: string | null;
  reference?: ContentRef;
  // The painted icon shown beside the dialog's title.
  icon?: IconRef;
  // A short line under the title: spell level and school, feature level, and
  // so on.
  meta?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const uiText = useInlineText();
  const { locale } = useI18n();
  const displayLabel = reference ? localizedContentName(reference.kind, label, locale) : label;
  const [open, setOpen] = useState(false);
  // Nothing to say and nothing to look up: render no control at all rather
  // than a button that opens an empty box.
  if (!text?.trim() && !reference) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={uiText("whatIsLabel", { label: displayLabel })}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:text-amber-200",
          className,
        )}
      >
        <Info className={size === "md" ? "size-4" : "size-3.5"} />
      </button>
      <InfoDialog
        open={open}
        onOpenChange={setOpen}
        title={displayLabel}
        meta={meta}
        text={text}
        reference={reference}
        icon={icon}
      />
    </>
  );
}

// A list of named things, each with its own ⓘ. Replaces the comma-joined
// strings the sheets used to print for features, feats and spells.
export function InfoChipList({
  items,
  emptyText,
}: {
  items: Array<{
    name: string;
    text?: string | null;
    meta?: string;
    reference?: ContentRef;
    // Rendered after the name, e.g. "(story)" for a feature the DM granted.
    note?: string;
    // The painted icon that leads the chip, when the thing has one.
    icon?: IconRef;
  }>;
  emptyText?: string;
}) {
  const { locale } = useI18n();
  if (!items.length) {
    return emptyText ? <p className="text-xs text-stone-500">{emptyText}</p> : null;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.name} className="flex items-center gap-1 text-xs text-stone-300">
          {item.icon ? <GameIcon icon={item.icon} size="size-6" /> : null}
          {item.reference ? localizedContentName(item.reference.kind, item.name, locale) : item.name}
          {item.note ? <span className="text-stone-500">{item.note}</span> : null}
          <InfoButton
            label={item.reference ? localizedContentName(item.reference.kind, item.name, locale) : item.name}
            meta={item.meta}
            text={item.text}
            reference={item.reference}
            icon={item.icon}
          />
        </span>
      ))}
    </div>
  );
}

export function InfoDialog({
  open,
  onOpenChange,
  title,
  meta,
  text,
  reference,
  icon,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  meta?: string;
  text?: string | null;
  reference?: ContentRef;
  icon?: IconRef;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      icon={icon ? <GameIcon icon={icon} size="size-10" /> : undefined}
      width="w-[min(92vw,32rem)]"
    >
      {meta ? (
        <p className="mb-3 text-xs uppercase tracking-wide text-amber-200/70">{meta}</p>
      ) : null}
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">
        {text?.trim() ? (
          renderRules(text)
        ) : reference?.kind === "items" ? (
          <ItemBody reference={reference} />
        ) : reference ? (
          <ContentBody reference={reference} />
        ) : null}
        {children}
      </div>
    </Dialog>
  );
}
