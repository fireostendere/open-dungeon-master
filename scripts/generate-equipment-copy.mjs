// node scripts/generate-equipment-copy.mjs <OmnisGM-Rules>/src/dnd/srd-5.1
// Same pinned CC-BY-4.0 source as the Russian rulebook; see docs/LICENSES.md.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { metricize } from "./lib/metricize-russian-rules.mjs";
const source = process.argv[2];
assert.ok(source, "Pass the SRD source directory");
const read = (locale) => readFileSync(`${source}/${locale}/09_Equipment.md`, "utf8");
const en = read("en"), ru = metricize(read("ru"));
const slug = (name) => name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const rows = (text) => text.split("\n").filter((line) => line.startsWith("|")).map((line) => line.split("|")[1].replace(/[*~]/g, "").trim());
const english = rows(en), russian = rows(ru);
assert.equal(english.length, russian.length);
const out = {};
for (let i = 0; i < english.length; i++) {
  const name = english[i], title = russian[i];
  if (!/[a-z]/i.test(name) || !/[а-яё]/i.test(title)) continue;
  out[slug(name)] = { en: { title: name }, ru: { title } };
}
const descriptions = (text) => [...text.matchAll(/^\*\*_([^\n]+?)_\*\*\s*([\s\S]*?)(?=^\*\*_|^#{1,6} |^Таблица:|^Table:|$(?![\s\S]))/gm)];
const ed = descriptions(en), rd = descriptions(ru);
assert.equal(ed.length, rd.length);
for (let i = 0; i < ed.length; i++) {
  const name = ed[i][1].replace(/\.$/, "").replace(/\s*\(\d+ gp\)$/, "");
  const title = rd[i][1].replace(/\.$/, "").replace(/\s*\(\d+ зм\)$/, "").replace(/\s*\([A-Za-z][^()]*\)$/, "");
  out[slug(name)] = { en: { title: name, text: ed[i][2].trim() }, ru: { title, text: rd[i][2].trim() } };
}
Object.assign(out, {
  "crossbow-light": {
    "en": {
      "title": "Crossbow, light"
    },
    "ru": {
      "title": "Арбалет лёгкий"
    }
  },
  "crossbow-hand": {
    "en": {
      "title": "Crossbow, hand"
    },
    "ru": {
      "title": "Ручной арбалет"
    }
  },
  "crossbow-heavy": {
    "en": {
      "title": "Crossbow, heavy"
    },
    "ru": {
      "title": "Тяжёлый арбалет"
    }
  },
  "pistol": {
    "en": {
      "title": "Pistol"
    },
    "ru": {
      "title": "Пистолет"
    }
  },
  "revolver": {
    "en": {
      "title": "Revolver"
    },
    "ru": {
      "title": "Револьвер"
    }
  },
  "sawed-off-scattergun": {
    "en": {
      "title": "Sawed-off Scattergun"
    },
    "ru": {
      "title": "Обрез дробовика"
    }
  },
  "hunting-rifle": {
    "en": {
      "title": "Hunting Rifle"
    },
    "ru": {
      "title": "Охотничья винтовка"
    }
  },
  "musket": {
    "en": {
      "title": "Musket"
    },
    "ru": {
      "title": "Мушкет"
    }
  },
  "hand-cannon": {
    "en": {
      "title": "Hand Cannon"
    },
    "ru": {
      "title": "Ручная пушка"
    }
  },
  "monoblade": {
    "en": {
      "title": "Monoblade"
    },
    "ru": {
      "title": "Моноклинок"
    }
  },
  "chainblade": {
    "en": {
      "title": "Chainblade"
    },
    "ru": {
      "title": "Цепной клинок"
    }
  },
  "shock-baton": {
    "en": {
      "title": "Shock Baton"
    },
    "ru": {
      "title": "Электрошоковая дубинка"
    }
  },
  "vibroknife": {
    "en": {
      "title": "Vibroknife"
    },
    "ru": {
      "title": "Вибронож"
    }
  },
  "ripper-gauntlet": {
    "en": {
      "title": "Ripper Gauntlet"
    },
    "ru": {
      "title": "Разрывающая перчатка"
    }
  },
  "heavy-spanner": {
    "en": {
      "title": "Heavy Spanner"
    },
    "ru": {
      "title": "Тяжёлый гаечный ключ"
    }
  },
  "sword-cane": {
    "en": {
      "title": "Sword Cane"
    },
    "ru": {
      "title": "Трость-меч"
    }
  },
  "machete": {
    "en": {
      "title": "Machete"
    },
    "ru": {
      "title": "Мачете"
    }
  },
  "silvered-stake": {
    "en": {
      "title": "Silvered Stake"
    },
    "ru": {
      "title": "Посеребрённый кол"
    }
  },
  "censer-mace": {
    "en": {
      "title": "Censer Mace"
    },
    "ru": {
      "title": "Булава-кадило"
    }
  },
  "hurled-vial": {
    "en": {
      "title": "Hurled Vial"
    },
    "ru": {
      "title": "Метательный флакон"
    }
  },
  "armorweave-vest": {
    "en": {
      "title": "Armorweave Vest"
    },
    "ru": {
      "title": "Жилет из бронеткани"
    }
  },
  "kevlar-vest": {
    "en": {
      "title": "Kevlar Vest"
    },
    "ru": {
      "title": "Кевларовый жилет"
    }
  },
  "riot-plating": {
    "en": {
      "title": "Riot Plating"
    },
    "ru": {
      "title": "Штурмовой доспех"
    }
  },
  "brass-carapace": {
    "en": {
      "title": "Brass Carapace"
    },
    "ru": {
      "title": "Латунный панцирь"
    }
  },
  "scrap-plate": {
    "en": {
      "title": "Scrap Plate"
    },
    "ru": {
      "title": "Латы из металлолома"
    }
  },
  "ballistic-shield": {
    "en": {
      "title": "Ballistic Shield"
    },
    "ru": {
      "title": "Баллистический щит"
    }
  }
});
writeFileSync("src/lib/i18n/equipment-copy.json", `${JSON.stringify(out, null, 2)}\n`);
console.log(`${Object.keys(out).length} equipment entries`);
