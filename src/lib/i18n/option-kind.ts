import type { Locale } from "@/lib/i18n";
import type { OptionKind } from "@/lib/srd/options";

const labels: Record<Locale, Record<OptionKind, string>> = {
  en: {
    invocation: "Eldritch Invocation",
    maneuver: "Maneuver",
    metamagic: "Metamagic",
    pact_boon: "Pact Boon",
    infusion: "Infusion",
    rune: "Rune",
    discipline: "Elemental Discipline",
  },
  ru: {
    invocation: "Потустороннее воззвание",
    maneuver: "Манёвр",
    metamagic: "Метамагия",
    pact_boon: "Дар договора",
    infusion: "Инфузия",
    rune: "Руна",
    discipline: "Стихийная дисциплина",
  },
};

export function optionKindLabel(kind: OptionKind, locale: Locale): string {
  return labels[locale][kind];
}
