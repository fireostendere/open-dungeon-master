const payload = {
  action: "characters.create",
  params: {
    owner: { username: "Lev" },
    level: 3,
    role: "pc",
    workshopId: "",
    sheet: {
      name: "Левик",
      race: "goblin",
      class: "paladin",
      subclass: "",
      background: "караванщик / музыкант-самоучка",
      alignment: "chaotic_good",
      gender: "male",
      appearance:
        "Маленький зелёный гоблин ростом около метра (метр с кепкой). Одет в роскошный, расшитый красный халат прямо поверх настоящей кольчуги. На поясе висит внушительная булава «Аргумент», за спиной деревянный щит и инструмент дудук. Обвешан кошельками (один честный, второй отрицаемый), мешочками со специями, сухофруктами и свёртком травы для культурного обмена с Олегом. Взгляд деловой, хитрый, но дружелюбный.",
      abilities: {
        str: 14,
        dex: 14,
        con: 14,
        int: 10,
        wis: 10,
        cha: 16,
      },
      maxHp: 27,
      ac: 18,
      acOverride: true,
      speed: 30,
      hitDice: {
        die: "d10",
        total: 3,
        spent: 0,
      },
      classes: [
        { id: "paladin", subclass: "", level: 2 },
        { id: "bard", subclass: "", level: 1 },
      ],
      hitDicePools: [
        { classId: "paladin", die: "d10", total: 2, spent: 0 },
        { classId: "bard", die: "d8", total: 1, spent: 0 },
      ],
      proficiencies: {
        saves: ["wis", "cha"],
        skills: ["persuasion", "performance", "insight", "intimidation"],
        expertise: [],
        armor: ["light", "medium", "heavy", "shields"],
        weapons: ["simple", "martial"],
        tools: ["duduk"],
        languages: ["common", "goblin"],
      },
      equipment: [
        { name: "Кольчуга", qty: 1, equipped: true },
        { name: "Булава «Аргумент»", qty: 1, equipped: true },
        { name: "Деревянный щит", qty: 1, equipped: true },
        { name: "Красный расшитый халат", qty: 1, equipped: true },
        { name: "Деревянный дудук (музыкальный инструмент)", qty: 1 },
        { name: "Набор караванщика-путешественника", qty: 1 },
        { name: "Кошель с честно заработанными деньгами", qty: 1 },
        { name: "Второй кошель (существование отрицается)", qty: 1 },
        { name: "Свёрток травы «для культурного обмена с Олегом»", qty: 1 },
        { name: "Запас вкусного (сушёные фрукты, чурчхела)", qty: 3 },
        { name: "Святой символ (уважаемого, но неизвестного бога)", qty: 1 },
      ],
      gold: 25,
      copper: 50,
      feats: [],
      features: [
        { name: "Darkvision 60 ft", source: "race" },
        { name: "Fury of the Small", source: "race" },
        { name: "Nimble Escape", source: "race" },
        { name: "Divine Sense", source: "class", level: 1, classId: "paladin" },
        { name: "Lay on Hands", source: "class", level: 1, classId: "paladin" },
        { name: "Fighting Style (Defense)", source: "class", level: 2, classId: "paladin" },
        { name: "Spellcasting (Paladin)", source: "class", level: 2, classId: "paladin" },
        { name: "Divine Smite", source: "class", level: 2, classId: "paladin" },
        { name: "Spellcasting (Bard)", source: "story" },
        { name: "Bardic Inspiration (d6)", source: "story" },
        { name: "Великий армянский караван", source: "story" },
        { name: "Булава «Аргумент»", source: "story" },
        { name: "Divine Smite — «Последний аргумент»", source: "story" },
        { name: "Lay on Hands — «Не умирай, деньги должен»", source: "story" },
        { name: "Bardic Inspiration — «Давай, брат»", source: "story" },
        { name: "Особая совместная техника с Олегом (дудук и трава)", source: "story" },
        { name: "Дудук", source: "story" },
        { name: "Красный халат поверх кольчуги", source: "story" },
        { name: "Persuasion — «Давай нормально»", source: "story" },
        { name: "Intimidation — «Расширенный тариф»", source: "story" },
      ],
      asiChoices: [],
      spellcasting: {
        ability: "cha",
        slots: {
          "1": {
            max: 3,
            used: 0,
          },
        },
        prepared: ["Bless", "Heroism", "Thunderous Smite", "Wrathful Smite"],
        known: [
          "Vicious Mockery",
          "Friends",
          "Dissonant Whispers",
          "Healing Word",
          "Charm Person",
          "Faerie Fire",
        ],
        casters: [
          {
            classId: "paladin",
            ability: "cha",
            known: [],
            prepared: ["Bless", "Heroism", "Thunderous Smite", "Wrathful Smite"],
          },
          {
            classId: "bard",
            ability: "cha",
            known: [
              "Vicious Mockery",
              "Friends",
              "Dissonant Whispers",
              "Healing Word",
              "Charm Person",
              "Faerie Fire",
            ],
            prepared: [],
          },
        ],
      },
      portrait: {
        name: "levik.png",
        url: "/uploads/levik.png",
        type: "image/png",
      },
      notes:
        "Идеал: Достаток. Жизнь слишком короткая, чтобы быть бедным, голодным и злым одновременно. Если можно хорошо жить, не делая окружающим слишком много хуйни — надо хорошо жить.\nПривязанность: Караван. Люди, которые когда-то подобрали странного гоблина и показали ему мир за пределами родной деревни. Левик никогда этого не забывает.\nНедостаток: Торг. Левик физически не способен принять первую предложенную цену. Даже если цена — бесплатно. Он всё равно спросит: «А если два?».\n\nЛюбимые фразы:\n«Давай нормально.»\n«Деньги есть? Уже хорошо.»\n«Не краду. Зарабатываю.»\n«Я маленький, не дешёвый.»\n«Брат, мы можем договориться.»\n«Ты сейчас очень плохо торгуешься.»\n«Ну я же нормально просил.»\n«Дудук сначала. Булава потом.»\n«Олег, трава осталась?»\n«Я не угрожаю. Я показываю ассортимент.»\n«Деньги любят уважение.»\n«Так нельзя делать бизнес.»\n«Можно без драки. (пауза) Но можно и с дракой.»",
      backstory:
        "Левик родился обычным горным гоблином в дикой глуши, где слово «инфраструктура» считалось древним заклинанием. Жизнь там была примитивной: кто сильнее — тот прав, кто богаче — тот подозрительный. Левика такая перспектива категорически не устраивала.\n\nВсё изменилось, когда в деревню въехал Великий армянский караван — купцы, музыканты и ремесленники с коврами, вином, фруктами, музыкой и непонятной гоблинам привычкой сначала договориться, а уже потом бить по голове. Левик испытал культурный шок и побежал за последней телегой «становиться армянином». Караванщики сжалились, усыновили гоблина и сократили его непроизносимое имя до звучного «Левик».\n\nВ караване Левик впитал простую философию: «Живи нормально, зарабатывай нормально, ешь вкусно и не будь долбоёбом без необходимости». Там же он научился торговать, играть на деревянном дудуке и уверовал в паладинский кодекс чести: договор надо соблюдать, слово держать, гостя кормить, а за базар отвечать. Технически божество ему не назвали, но магия света почему-то исправно наполняет его булаву «Аргумент».\n\nЛевик принципиально не ворует («Украсть может любой дурак, ты заработай»), торгуется до последнего медяка из принципа, носит дорогой красный халат поверх кольчуги и искренне считает: сначала надо договориться, потом сыграть на дудуке, потом заработать — и только если собеседник упорствует, въебать сияющей булавой с криком «Ну я же нормально просил!».",
    },
  },
};

const serverUrl = process.argv[2] || "http://127.0.0.1:3005";
const token = process.env.ODM_MCP_TOKEN || process.argv[3];
if (!token) throw new Error("Set ODM_MCP_TOKEN or pass token as argument 3.");

console.log(`Creating Levik for Lev at ${serverUrl}...`);

const res = await fetch(`${serverUrl}/api/internal/mcp`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const data = await res.json();
if (data.ok) {
  console.log(`[SUCCESS] Created Levik for Lev: ${data.result.character.id}`);
} else {
  console.error(`[ERROR] Failed for Lev:`, data.error);
}
