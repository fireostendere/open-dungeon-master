"use client";

import { useI18n } from "@/lib/i18n";
import { characterDisplay } from "@/lib/i18n/character-display";
import { helpText } from "@/lib/i18n/help-copy";
import { describeSkill } from "@/lib/help";
import { InfoButton } from "@/components/ui/InfoDialog";
import { glossaryText, type GlossaryEntry } from "@/lib/help/terms";

// The ⓘ beside a pick list whose options are single words a new DM may not
// know (conditions, schools, weapon properties, damage types). Opens the
// whole list with a sentence per option, because a native <option> cannot
// carry one and a chip row has no room for them.
export function OptionGlossary({
  title,
  entries,
  className,
}: {
  title: string;
  entries: readonly GlossaryEntry[];
  className?: string;
}) {
  const { locale } = useI18n();
  const translated = entries.map((entry) => ({
    name: characterDisplay(entry.name, locale),
    blurb: describeSkill(entry.name.toLowerCase().replace(/ /g, "_"), locale) ?? helpText(entry.blurb, locale),
  }));
  if (!entries.length) return null;
  return <InfoButton label={characterDisplay(title, locale)} text={glossaryText(translated)} className={className} />;
}
