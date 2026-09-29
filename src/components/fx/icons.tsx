// Small inline glyphs for the overlays (lucide is not bundled into the lab).

import type { RollIcon } from "./roll-context";

const PATHS: Record<RollIcon | "skull" | "shield" | "arrow" | "crown", string> = {
  attack: "M14.5 3.5 20.5 3.5 20.5 9.5 9 21 6.5 21 3 17.5 3 15ZM5 13l6 6M3.5 20.5l3-3",
  damage: "M12 2c1 4 5 5.5 5 10.5A5 5 0 0 1 7 12.5C7 9 9.5 8 10 5c1.2 1.5 1.8 2.6 2 4.5C13.3 8 13 5 12 2Z",
  skill: "M12 3l2.4 5.6L20 9.3l-4.3 3.9 1.3 5.8L12 16l-5 3 1.3-5.8L4 9.3l5.6-.7Z",
  save: "M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5Z",
  ability: "M4 20 12 4l8 16ZM8.5 13h7",
  initiative: "M13 2 4 14h7l-1 8 9-12h-7Z",
  death: "M12 21s-7-4.5-9-9.5C1.6 8 3.6 4.5 7 4.5c2 0 3.5 1.2 5 3 1.5-1.8 3-3 5-3 3.4 0 5.4 3.5 4 7-2 5-9 9.5-9 9.5ZM12 7.5l-1.5 4 3 1.5-1.5 4",
  custom: "M12 2 21 7v10l-9 5-9-5V7ZM12 2v20M3 7l18 10M21 7 3 17",
  skull: "M12 3a8 8 0 0 0-8 8c0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6a8 8 0 0 0-8-8ZM9 11.5a1.5 1.5 0 1 0 0 .01M15 11.5a1.5 1.5 0 1 0 0 .01M10 20v-2M14 20v-2",
  shield: "M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5ZM12 7v9M8 11h8",
  arrow: "M3 12h15M13 6l6 6-6 6",
  crown: "M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z",
};

export function FxIcon({ name, size = 16, className = "" }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
