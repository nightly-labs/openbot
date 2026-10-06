/** Linear 0-1 channels, as the aurora shader takes them. */
export type VoiceRgb = readonly [number, number, number];

/** Four lobe colours for the aurora: the shader needs a fixed count. */
export type VoicePalette = readonly [VoiceRgb, VoiceRgb, VoiceRgb, VoiceRgb];

const FALLBACK: VoiceRgb = [0.545, 0.361, 0.965];

function parseHex(hex: string): VoiceRgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function toHsl([r, g, b]: VoiceRgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function fromHsl(hue: number, saturation: number, lightness: number): VoiceRgb {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number) => {
    const t = (h + offset + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

/**
 * The aurora stays inside the agent's own colour: its hue, two neighbours a
 * little to each side, and a lighter core. A channel takes one colour from each
 * of its first members, so the glow mixes the agents the user speaks to.
 */
export function voicePalette(colors: readonly string[], dark: boolean): VoicePalette {
  const parsed = colors.map(parseHex).filter((color): color is VoiceRgb => color !== null);
  // A dark canvas takes the colours a little lighter. On a light canvas a light
  // colour fades into the background, so they go deeper and more saturated.
  const lift = dark ? 0.06 : -0.05;
  const minSaturation = dark ? 0.62 : 0.72;
  if (parsed.length >= 2) {
    const pick = (index: number) => {
      const [hue, saturation, lightness] = toHsl(parsed[index % parsed.length] ?? FALLBACK);
      return fromHsl(hue, Math.max(saturation, minSaturation - 0.02), Math.min(0.7, lightness + lift));
    };
    return [pick(0), pick(1), pick(2), pick(3)];
  }
  const [hue, saturation, lightness] = toHsl(parsed[0] ?? FALLBACK);
  const vivid = Math.max(saturation, minSaturation);
  const base = Math.min(0.66, Math.max(0.42, lightness)) + lift;
  return [
    fromHsl(hue - 22, vivid, base - 0.02),
    fromHsl(hue, vivid, base),
    fromHsl(hue + 18, vivid * 0.95, base + 0.04),
    fromHsl(hue + 6, vivid * 0.9, Math.min(0.76, base + 0.11)),
  ];
}

function luminance(color: VoiceRgb): number {
  const [r, g, b] = color.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/**
 * The palette's main colour for the filled voice controls, and the glyph colour
 * with the higher contrast on it: a yellow agent gets a dark glyph.
 */
export function voiceAccent(palette: VoicePalette): { fill: string; glyph: string } {
  const color = palette[1];
  const [r, g, b] = color.map((channel) => Math.round(channel * 255));
  const light = luminance(color);
  return {
    fill: `rgb(${r}, ${g}, ${b})`,
    glyph: (light + 0.05) / 0.05 > 1.05 / (light + 0.05) ? "#000000" : "#ffffff",
  };
}
