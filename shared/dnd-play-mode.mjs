const YOLO_VALUES = new Set(["1", "true", "yes", "on", "yolo", "fast", "field"]);

function normalized(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function explicitYoloRequested({ requested, env = process.env } = {}) {
  if (requested === true || normalized(requested) === "yolo") return true;
  if (normalized(env.ODM_DND_MODE) === "yolo") return true;
  return YOLO_VALUES.has(normalized(env.YOLO_DND));
}

// Runtime policy requested by the project owner:
// - the trusted in-repo custom OpenCode narrator gets the full DM path;
// - every other source gets YOLO;
// - an explicit YOLO request wins even inside custom OpenCode.
//
// "full" is intentionally NOT a bypass for web/other clients: a non-OpenCode
// caller cannot opt itself into the expensive full pipeline by claiming a mode.
export function resolveDndPlayMode({ source = "internal", requested, env = process.env } = {}) {
  if (explicitYoloRequested({ requested, env })) return "yolo";
  return source === "custom-opencode" ? "full" : "yolo";
}

export function isYoloMode(options = {}) {
  return resolveDndPlayMode(options) === "yolo";
}
