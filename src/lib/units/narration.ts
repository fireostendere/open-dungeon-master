export type CampaignUnitSystem = "metric" | "imperial";

const NUMBER = "[+-]?(?:(?:\\d+\\s+)?\\d+/[1-9]\\d*|\\d{1,3}(?:[ \\u00a0]\\d{3})+(?:[.,]\\d+)?|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)";
const BOUNDARY = "(?<![\\p{L}\\p{N}_.,/])";
const MEASURE = `(${NUMBER}(?:\\s*[-–—x×]\\s*${NUMBER})*)`;
const FEET = "(?:feet|foot|ft|фут(?:а|ов|ах|ы|е)?|фт|stopy|stóp)";
const POUNDS = "(?:pounds?|lbs?|lb|фунт(?:а|ов|ах|ы|е)?|фнт|funt(?:y|ów|ach)?)";
const protectedText = /(```[\s\S]*?```|~~~[\s\S]*?~~~|``[^`]*``|`[^`]*`|https?:\/\/\S+|www\.\S+)/g;

export const feetToMeters = (feet: number) => feet * 0.3;
export const poundsToKilograms = (pounds: number) => pounds * 0.45;

function decimal(value: number) {
  return String(Math.round(value * 100) / 100);
}

export function formatDistanceFeet(feet: number, unitSystem: CampaignUnitSystem = "metric") {
  return unitSystem === "imperial" ? `${decimal(feet)} ft` : `${decimal(feetToMeters(feet))} m`;
}

function convertedValues(value: string, factor: number, english = false) {
  return value.replace(new RegExp(NUMBER, "g"), number => {
    const fraction = /^([+-]?)(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(number);
    if (fraction) {
      return decimal((fraction[1] === "-" ? -1 : 1) * (Number(fraction[2] ?? 0) + Number(fraction[3]) / Number(fraction[4])) * factor);
    }
    number = number.replace(/[ \u00a0]/g, "");
    const normalized = english && /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(number)
      ? number.replaceAll(",", "")
      : number.replace(",", ".");
    return decimal(Number(normalized) * factor);
  });
}

function convertPart(part: string) {
  const convert = (units: string, factor: number, replacement: string) => {
    const standalone = new RegExp(`${BOUNDARY}${MEASURE}\\s*(${units})(\\.)?(?![\\p{L}\\p{N}_])`, "giu");
    part = part.replace(standalone, (_match, values, unit, punctuation = "") =>
      `${convertedValues(values, factor, /^(?:feet|foot|ft|pounds?|lbs?)$/i.test(unit))} ${replacement}${punctuation}`);
  };
  // Hyphenated English/Russian size adjectives are measurements, unlike bare
  // "foot" anatomy. Keep the adjective form rather than producing "9 m-wide".
  part = part.replace(new RegExp(`${BOUNDARY}${MEASURE}-foot(?=[-\\s.,!?]|$)`, "giu"), (_match, values) => `${convertedValues(values, 0.3, true)}-meter`);
  part = part.replace(new RegExp(`${BOUNDARY}${MEASURE}-футов(ый|ая|ое|ые|ых|ом|ую|ого|ой|ым|ыми)(?=[-\\s.,!?]|$)`, "giu"), (_match, values, ending) => `${convertedValues(values, 0.3)}-метров${ending}`);
  convert(FEET, 0.3, "m");
  convert(POUNDS, 0.45, "kg");
  return part;
}

/** Converts only explicit numeric imperial measurements in newly-authored DM prose. */
export function normalizeNarrationUnits(content: string, unitSystem: CampaignUnitSystem = "metric") {
  if (unitSystem === "imperial") return content;
  return content.split(protectedText).map((part, index) => index % 2 ? part : convertPart(part)).join("");
}
