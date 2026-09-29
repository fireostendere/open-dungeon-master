import type { ReactNode } from "react";
import { CombatStart } from "@/components/fx/cinematics/CombatStart";
import { EndingCinematic } from "@/components/fx/cinematics/EndingCinematic";
import { SlainBanner, TurnBanner } from "@/components/fx/cinematics/Banners";
import { FallenCinematic, LevelUpCinematic, LootReveal, RestCinematic } from "@/components/fx/cinematics/Moments";

export type CinematicScenario = {
  id: string;
  group: string;
  label: string;
  hint: string;
  render: (props: { key: number; yolo: boolean; onClose: () => void }) => ReactNode;
};

const CLOSING =
  "И когда пыль над руинами Чёрного Бастиона осела, четверо стояли среди пепла. Дракон пал, город спасён, а в тавернах ещё долго будут спорить, кто же нанёс последний удар.\n\nСпасибо, что играли. До новых встреч за столом.";

export const CINEMATIC_SCENARIOS: CinematicScenario[] = [
  {
    id: "victory",
    group: "Финал кампании",
    label: "Победа",
    hint: "Золотой d20 падает на 20, фанфары, салют с d20-вспышками, конфетти",
    render: ({ key, yolo, onClose }) => <EndingCinematic key={key} active mode="victory" isYolo={yolo} campaignTitle="Пепел Чёрного Бастиона" closingMessage={CLOSING} onClose={onClose} />,
  },
  {
    id: "defeat",
    group: "Финал кампании",
    label: "Поражение (TPK)",
    hint: "Мир обесцвечивается, сердце замирает, проклятый d20 падает на 1 и трескается",
    render: ({ key, yolo, onClose }) => <EndingCinematic key={key} active mode="defeat" isYolo={yolo} campaignTitle="Пепел Чёрного Бастиона" closingMessage={CLOSING} onClose={onClose} />,
  },
  {
    id: "combat",
    group: "Бой",
    label: "Начало боя",
    hint: "Кинорамки, мечи скрещиваются, раздача инициативы",
    render: ({ key, onClose }) => (
      <CombatStart
        key={key}
        active
        round={1}
        order={[
          { id: "a", name: "Эйра", kind: "pc", initiative: 19 },
          { id: "b", name: "Гоблин-лучник", kind: "enemy", initiative: 17 },
          { id: "c", name: "Торин", kind: "pc", initiative: 12 },
          { id: "d", name: "Огр", kind: "enemy", initiative: 9 },
          { id: "e", name: "Лис", kind: "pc", initiative: 6 },
        ]}
        onDone={onClose}
      />
    ),
  },
  {
    id: "turn",
    group: "Бой",
    label: "Ваш ход",
    hint: "Золотая лента через экран",
    render: ({ key, onClose }) => <TurnBanner key={key} active subtitle="Эйра · Раунд 2" onDone={onClose} />,
  },
  {
    id: "slain",
    group: "Бой",
    label: "Враг повержен",
    hint: "Росчерк клинка и имя",
    render: ({ key, onClose }) => <SlainBanner key={key} active name="Огр" onDone={onClose} />,
  },
  {
    id: "won",
    group: "Бой",
    label: "Бой выигран",
    hint: "Все враги пали",
    render: ({ key, onClose }) => <TurnBanner key={key} active title="Бой выигран" subtitle="Все враги повержены" tone="emerald" onDone={onClose} />,
  },
  {
    id: "levelup",
    group: "Персонаж",
    label: "Новый уровень",
    hint: "Столп света, руны, 4 → 5",
    render: ({ key, onClose }) => <LevelUpCinematic key={key} active name="Эйра" className="Следопыт" fromLevel={4} toLevel={5} onContinue={onClose} />,
  },
  {
    id: "fallen",
    group: "Персонаж",
    label: "Вы пали (0 ХП)",
    hint: "Сердцебиение, спасброски от смерти",
    render: ({ key, onClose }) => <FallenCinematic key={key} active name="Эйра" mine successes={1} failures={2} onDone={onClose} />,
  },
  {
    id: "dead",
    group: "Персонаж",
    label: "Союзник погиб",
    hint: "Три провала",
    render: ({ key, onClose }) => <FallenCinematic key={key} active name="Торин" mine={false} dead onDone={onClose} />,
  },
  {
    id: "loot",
    group: "Персонаж",
    label: "Добыча: легендарка",
    hint: "Карта переворачивается, монеты",
    render: ({ key, onClose }) => <LootReveal key={key} active item="Клинок Рассвета" rarity="legendary" icon="🗡️" onDone={onClose} />,
  },
  {
    id: "loot2",
    group: "Персонаж",
    label: "Добыча: зелья",
    hint: "Необычный предмет ×3",
    render: ({ key, onClose }) => <LootReveal key={key} active item="Зелье лечения" qty={3} rarity="uncommon" icon="🧪" onDone={onClose} />,
  },
  {
    id: "rest-long",
    group: "Персонаж",
    label: "Долгий отдых",
    hint: "Ночь сменяется рассветом",
    render: ({ key, onClose }) => <RestCinematic key={key} active kind="long" onDone={onClose} />,
  },
  {
    id: "rest-short",
    group: "Персонаж",
    label: "Короткий отдых",
    hint: "Костёр и искры",
    render: ({ key, onClose }) => <RestCinematic key={key} active kind="short" onDone={onClose} />,
  },
];
