// The server's grant_item carries only a name and a quantity, so the loot
// card guesses an icon and a rarity band from the name. Purely cosmetic.

const ICONS: [RegExp, string][] = [
  [/(sword|blade|dagger|rapier|scimitar|axe|клин|меч|кинжал|рапир|сабл|топор)/i, "🗡️"],
  [/(bow|crossbow|arrow|лук|арбалет|стрел)/i, "🏹"],
  [/(potion|elixir|flask|зель|эликсир|флакон)/i, "🧪"],
  [/(ring|кольц|перстень)/i, "💍"],
  [/(scroll|свит)/i, "📜"],
  [/(shield|armor|armour|mail|plate|щит|доспех|кольчуг|латы)/i, "🛡️"],
  [/(gold|coin|silver|gem|монет|золот|серебр|самоцвет|драгоцен)/i, "💰"],
  [/(key|ключ)/i, "🗝️"],
  [/(book|tome|grimoire|книг|том|гримуар)/i, "📖"],
  [/(amulet|necklace|pendant|амулет|ожерель|кулон)/i, "📿"],
  [/(staff|wand|rod|посох|жезл|палочк)/i, "🪄"],
  [/(map|карт)/i, "🗺️"],
];

export function lootIcon(name: string): string {
  return ICONS.find(([re]) => re.test(name))?.[1] ?? "🎁";
}

export function lootRarity(name: string): string {
  if (/\+3|legendary|легендар|артефакт|artifact/i.test(name)) return "legendary";
  if (/\+2|very rare|очень редк/i.test(name)) return "very rare";
  if (/\+1|rare|редк|magic|магическ|зачарован|enchanted/i.test(name)) return "rare";
  if (/(potion|elixir|scroll|зель|эликсир|свит)/i.test(name)) return "uncommon";
  return "common";
}
