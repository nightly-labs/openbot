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

export type ChatBackgroundScheme = "light" | "dark";

/**
 * The chat background presets: calm tints of the chat color preset hues, in the same order, that the
 * text of each scheme reads well on: OKLCH lightness 0.965 and chroma 0.018 in Light, lightness 0.25
 * and chroma 0.035 in Dark. The desktop, the web client and mobile offer the same presets.
 */
export const CHAT_BACKGROUND_PRESETS = {
  light: [
    { id: "red", value: "#ffefed" },
    { id: "orange", value: "#fef0e9" },
    { id: "yellow", value: "#faf2e6" },
    { id: "green", value: "#ebf7ed" },
    { id: "cyan", value: "#e7f8f5" },
    { id: "sky", value: "#e7f6fd" },
    { id: "blue", value: "#ecf4ff" },
    { id: "indigo", value: "#f1f2ff" },
    { id: "violet", value: "#f6f1fe" },
    { id: "magenta", value: "#fceff8" },
    { id: "pink", value: "#ffeff3" },
  ],
  dark: [
    { id: "red", value: "#311b19" },
    { id: "orange", value: "#2f1d12" },
    { id: "yellow", value: "#2a200d" },
    { id: "green", value: "#152619" },
    { id: "cyan", value: "#0a2724" },
    { id: "sky", value: "#0c252e" },
    { id: "blue", value: "#162232" },
    { id: "indigo", value: "#1e2032" },
    { id: "violet", value: "#251d2f" },
    { id: "magenta", value: "#2c1b28" },
    { id: "pink", value: "#2f1a21" },
  ],
} as const satisfies Record<ChatBackgroundScheme, readonly { id: ChatColorPresetId; value: AvatarColor }[]>;

/**
 * The OKLCH limits that keep the muted text of each scheme at about 4.5:1 on a chat background. The
 * desktop applies the same limits in `styles/chat-background.css`; keep the two the same.
 */
const READABLE_BACKGROUND = {
  light: { minLightness: 0.95, maxChroma: 0.02 },
  dark: { maxLightness: 0.3, maxChroma: 0.05 },
} as const;

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function gamma(channel: number): number {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, value));
}

function hexByte(channel: number): string {
  return Math.round(gamma(channel) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * The chat background that a screen without CSS relative colors shows, such as the mobile app: the
 * color made darker in Dark and lighter in Light when text would be hard to read on it, as
 * `#rrggbb`. A color out of sRGB is clipped, as CSS clips it.
 */
export function readableChatBackground(color: AvatarColor, scheme: ChatBackgroundScheme): AvatarColor {
  const channel = (start: number) => linear(Number.parseInt(color.slice(start, start + 2), 16) / 255);
  const r = channel(1);
  const g = channel(3);
  const b = channel(5);
  // sRGB to OKLab (Björn Ottosson's matrices).
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bAxis);
  const limits = READABLE_BACKGROUND[scheme];
  const nextLightness =
    "minLightness" in limits ? Math.max(lightness, limits.minLightness) : Math.min(lightness, limits.maxLightness);
  const nextChroma = Math.min(chroma, limits.maxChroma);
  const scale = chroma === 0 ? 0 : nextChroma / chroma;
  const nextA = a * scale;
  const nextB = bAxis * scale;
  const l2 = (nextLightness + 0.3963377774 * nextA + 0.2158037573 * nextB) ** 3;
  const m2 = (nextLightness - 0.1055613458 * nextA - 0.0638541728 * nextB) ** 3;
  const s2 = (nextLightness - 0.0894841775 * nextA - 1.291485548 * nextB) ** 3;
  const red = 4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2;
  const green = -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2;
  const blue = -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2;
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}
