const formatMetric = (value) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Math.round(value * 10) / 10);

function parseNumber(raw) {
  const compact = raw.replace(/[\s\u00a0]/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/,(?=\d{3}$)/, "").replace(",", ".")
    : compact;
  return Number(normalized);
}

export function metricize(text) {
  let result = text
    .replace(/([¼½¾⅓⅔])(?=\s)/gu, (fraction) => ({
      "¼": "0.25",
      "½": "0.5",
      "¾": "0.75",
      "⅓": "0.333333",
      "⅔": "0.666667",
    })[fraction])
    .replace(/число футов, равное пятикратному модификатору вашей характеристики заклинателя/giu,
      "1,5 м за каждую единицу модификатора вашей характеристики заклинателя",
    )
    .replace(/каждый фут перемещения стоит дополнительный фут/giu,
      "каждые 0,3 м перемещения требуют дополнительных 0,3 м",
    )
    .replace(/удвоенному количеству футов, на которое вас переместили/giu,
      "двукратному расстоянию перемещения в метрах, делённому на 0,3",
    )
    .replace(/от\s+(менее\s+)?(\d[\d\s\u00a0,]*(?:\.\d+)?)\s+до\s+((?:значительно\s+)?более\s+)?(\d[\d\s\u00a0,]*(?:\.\d+)?)\s*(фут\p{L}*|фт\.?|фунт\p{L}*|фнт\.?)/giu,
      (_whole, lower, first, upper, second, unit) => {
        const factor = unit.toLowerCase().startsWith("фут") || unit.toLowerCase().startsWith("фт")
          ? 0.3
          : 0.45;
        const metricUnit = factor === 0.3 ? "м" : "кг";
        return `от ${lower ?? ""}${formatMetric(parseNumber(first) * factor)} ${metricUnit} до ${upper ?? ""}${formatMetric(parseNumber(second) * factor)} ${metricUnit}`;
      },
    )
    .replace(/(\d[\d\s\u00a0,]*(?:\.\d+)?)\s+(и|или)\s+более\s+куб\p{L}*\s+фут\p{L}*/giu, (_whole, raw, conjunction) =>
      `${formatMetric(parseNumber(raw) * 0.0283168)} м³ ${conjunction} более`,
    )
    .replace(/(\d[\d\s\u00a0,]*(?:\.\d+)?)\s+куб\p{L}*\s+фут\p{L}*/giu, (_whole, raw) =>
      `${formatMetric(parseNumber(raw) * 28.3168)} л`,
    )
    .replace(/(\d[\d\s\u00a0,]*(?:\.\d+)?)\s+куб\p{L}*\s+дюйм\p{L}*/giu, (_whole, raw) =>
      `${formatMetric(parseNumber(raw) * 16.387)} см³`,
    )
    .replace(/(\d[\d\s\u00a0,]*(?:\.\d+)?)\s+квадрат\p{L}*\s+фут\p{L}*/giu, (_whole, raw) =>
      `${formatMetric(parseNumber(raw) * 0.092903)} м²`,
    )
    .replace(/(\d[\d\s\u00a0,]*(?:\.\d+)?)\s+квадрат\p{L}*\s+миль\p{L}*/giu, (_whole, raw) =>
      `${formatMetric(parseNumber(raw) * 2.58999)} км²`,
    );
  const measurement = /(\d[\d\s\u00a0,]*(?:\.\d+)?)(?:\s+(и|или)\s+более)?\s*(-?)(фут\p{L}*|фт\.?|фунт\p{L}*|фнт\.?|дюйм\p{L}*|миль\p{L}*|унци\p{L}*)/giu;
  result = result.replace(measurement, (_whole, raw, range, hyphen, unit) => {
    const value = parseNumber(raw);
    const lower = unit.toLowerCase();
    const suffix = range ? ` ${range} более` : "";
    if (lower.startsWith("фут")) {
      const meters = formatMetric(value * 0.3);
      const adjective = /^фут(?:овый|овая|овое|овые|овых|ового|овому|овым|овыми|овую|овой|овом)$/.test(lower);
      return hyphen
        ? `${meters}-${adjective ? lower.replace(/^фут/, "метр") : "м"}`
        : `${meters} ${adjective ? lower.replace(/^фут/, "метр") : "м"}${suffix}`;
    }
    if (lower.startsWith("фт")) return `${formatMetric(value * 0.3)} м${suffix}`;
    if (lower.startsWith("фунт")) return `${formatMetric(value * 0.45)} кг${suffix}`;
    if (lower.startsWith("фнт")) return `${formatMetric(value * 0.45)} кг${suffix}`;
    if (lower.startsWith("дюйм")) return `${formatMetric(value * 2.54)} см${suffix}`;
    if (lower.startsWith("миль")) return `${formatMetric(value * 1.609344)} км${suffix}`;
    return `${formatMetric(value * 28.35)} г${suffix}`;
  });
  result = result
    .replace(/Если заклинание обычно имеет дальность, выраженную в футах, его дальность становится [\d.,]+ м, если она уже не такая\./giu,
      "Если обычная дальность заклинания меньше 36 м, она становится 36 м.",
    )
    .replace(/полунци\p{L}*/giu, "14 г")
    .replace(/одн(?:у|ой|а)\s+унци\p{L}*/giu, "28 г")
    .replace(/куб\p{L}*\s+фут\p{L}*/giu, "0,03 м³")
    .replace(/квадрат\p{L}*\s+фут\p{L}*/giu, "0,1 м²")
    .replace(/фут(?:а|ов)?(?!\p{L})/giu, "метров")
    .replace(/дюйм\p{L}*/giu, "2,5 см")
    .replace(/унци\p{L}*/giu, "28 г")
    .replace(/полумил(?:и|ю|ей|е|ёй)/giu, "750 м")
    .replace(/полфунт\p{L}*/giu, "0,2 кг")
    .replace(/один фунт/giu, "0,45 кг");
  return result;
}

