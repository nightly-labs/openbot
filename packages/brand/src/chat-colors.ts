import type { AvatarColor } from "@openbot/contracts/ipc";

/**
 * The 11 chat colors that the desktop picker and the mobile settings offer as presets. A desktop
 * bubble mixes a part of its color into the surface, so the presets have one OKLCH lightness (0.68)
 * and the most chroma up to 0.19 that sRGB holds at each hue. Their tints then have the same weight
 * in the light and the dark theme. Yellow is lighter, because a yellow at that lightness is mustard.
 */
export const CHAT_COLOR_PRESETS = [
  { id: "red", value: "#f75d59" },
  { id: "orange", value: "#eb7007" },
  { id: "yellow", value: "#e5a50a" },
  { id: "green", value: "#07b655" },
  { id: "cyan", value: "#0eafa2" },
  { id: "sky", value: "#06a8d3" },
  { id: "blue", value: "#4699fe" },
  { id: "indigo", value: "#8688ff" },
  { id: "violet", value: "#b474f4" },
  { id: "magenta", value: "#dc63c6" },
  { id: "pink", value: "#f05b93" },
] as const satisfies readonly { id: string; value: AvatarColor }[];

export type ChatColorPresetId = (typeof CHAT_COLOR_PRESETS)[number]["id"];
