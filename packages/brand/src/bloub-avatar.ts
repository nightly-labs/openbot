import {
  COLOR_BY_ID,
  type ColorId,
  EXPRESSIONS,
  type ExpressionId,
  SHAPES,
  type ShapeId,
} from "@norbert_bodziony/bloub";
import { type AvatarColor, type AvatarHue, nearestAvatarHue } from "@openbot/contracts/ipc";

export type SupportedAvatarSilhouetteId = Exclude<ShapeId, "goutte">;

export interface BloubAvatarProfile {
  shape: SupportedAvatarSilhouetteId;
  color: string;
  expression: ExpressionId;
}

const AUTOMATIC_COLORS = ["rouge", "orange", "ambre", "vert", "turquoise", "bleu", "violet", "rose"] as const;
const UNSUPPORTED_AVATAR_SILHOUETTE = "goutte" as const satisfies ShapeId;
export const SUPPORTED_AVATAR_SILHOUETTES = SHAPES.map((option) => option.id).filter(
  (silhouette): silhouette is SupportedAvatarSilhouetteId => silhouette !== UNSUPPORTED_AVATAR_SILHOUETTE,
);

const HUE_COLORS: Readonly<Record<AvatarHue, string>> = {
  0: colorHex("rouge"),
  30: colorHex("orange"),
  55: colorHex("ambre"),
  100: "#8ece34",
  150: colorHex("vert"),
  185: colorHex("turquoise"),
  215: colorHex("bleu"),
  245: "#5d67ee",
  280: colorHex("violet"),
  320: colorHex("rose"),
};

export const AVATAR_EXPRESSIONS: readonly ExpressionId[] = EXPRESSIONS.map((option) => option.id);

export const AVATAR_HUE_CHOICES: ReadonlyArray<{ hue: AvatarHue; label: string }> = [
  { hue: 0, label: "Red" },
  { hue: 30, label: "Orange" },
  { hue: 55, label: "Yellow" },
  { hue: 100, label: "Lime" },
  { hue: 150, label: "Green" },
  { hue: 185, label: "Cyan" },
  { hue: 215, label: "Blue" },
  { hue: 245, label: "Indigo" },
  { hue: 280, label: "Violet" },
  { hue: 320, label: "Magenta" },
];

export const AVATAR_COLOR_PRESETS = {
  pink: "#f27ba5",
  sky: "#38bdf8",
  navy: "#34479c",
  wine: "#a8324e",
  brown: "#8b5e3c",
  sand: "#d6b98c",
  grey: "#a3a3a3",
} as const satisfies Record<string, AvatarColor>;
export type AvatarColorPresetId = keyof typeof AVATAR_COLOR_PRESETS;

export type AvatarColorChoice =
  | { kind: "hue"; hue: AvatarHue; color: null; swatch: string }
  | { kind: "preset"; preset: AvatarColorPresetId; hue: AvatarHue | null; color: AvatarColor; swatch: string };

function hueChoice(hue: AvatarHue): AvatarColorChoice {
  return { kind: "hue", hue, color: null, swatch: HUE_COLORS[hue] };
}

function presetChoice(preset: AvatarColorPresetId): AvatarColorChoice {
  const color = AVATAR_COLOR_PRESETS[preset];
  return { kind: "preset", preset, hue: nearestAvatarHue(color), color, swatch: color };
}

export const AVATAR_COLOR_CHOICES: readonly AvatarColorChoice[] = [
  hueChoice(0),
  hueChoice(30),
  hueChoice(55),
  hueChoice(100),
  hueChoice(150),
  hueChoice(185),
  presetChoice("sky"),
  hueChoice(215),
  presetChoice("navy"),
  hueChoice(245),
  hueChoice(280),
  hueChoice(320),
  presetChoice("pink"),
  presetChoice("wine"),
  presetChoice("brown"),
  presetChoice("sand"),
  presetChoice("grey"),
];

export function isAvatarColorChoice(
  choice: AvatarColorChoice,
  hue: AvatarHue | null,
  color: AvatarColor | null | undefined,
): boolean {
  return choice.color === null ? (color ?? null) === null && hue === choice.hue : color === choice.color;
}

export function bloubAvatarProfile(
  seed: string,
  hue: AvatarHue | null,
  color: AvatarColor | null = null,
): BloubAvatarProfile {
  const storedSilhouette = requiredItem(SHAPES, stableIndex(`${seed}:shape`, SHAPES.length)).id;
  const silhouette =
    storedSilhouette === UNSUPPORTED_AVATAR_SILHOUETTE
      ? requiredItem(
          SUPPORTED_AVATAR_SILHOUETTES,
          stableIndex(`${seed}:shape:replacement`, SUPPORTED_AVATAR_SILHOUETTES.length),
        )
      : storedSilhouette;
  const expression = requiredItem(EXPRESSIONS, stableIndex(`${seed}:expression`, EXPRESSIONS.length)).id;

  return {
    shape: silhouette,
    expression,
    color: color ?? (hue === null ? colorHex(automaticColor(seed)) : HUE_COLORS[hue]),
  };
}

export function avatarHueSwatch(hue: AvatarHue): string {
  return HUE_COLORS[hue];
}

export function avatarHeadColor(seed: string, hue: AvatarHue | null, color: AvatarColor | null = null): string {
  return bloubAvatarProfile(seed, hue, color).color;
}

export type ServerPlushColor = (typeof AUTOMATIC_COLORS)[number];

export function serverPlushColor(serverId: string): ServerPlushColor {
  return automaticColor(serverId);
}

export function serverPlushHex(serverId: string, color: string | null | undefined): string {
  return (color ?? colorHex(automaticColor(serverId))).toLowerCase();
}

function automaticColor(seed: string): ServerPlushColor {
  return requiredItem(AUTOMATIC_COLORS, stableIndex(`${seed}:color`, AUTOMATIC_COLORS.length));
}

export function avatarCandidateSeeds(agentId: string, currentSeed: string, batch: number): string[] {
  const candidates = [currentSeed];
  const firstProfile = bloubAvatarProfile(currentSeed, null);
  const unseenSilhouetteIds = new Set<SupportedAvatarSilhouetteId>(SUPPORTED_AVATAR_SILHOUETTES);
  const usedExpressions = new Set<ExpressionId>([firstProfile.expression]);
  unseenSilhouetteIds.delete(firstProfile.shape);
  let index = 1;

  while (unseenSilhouetteIds.size > 0) {
    const candidate = `${agentId}:avatar:${batch}:${index}`;
    index += 1;
    if (candidates.includes(candidate)) continue;
    const profile = bloubAvatarProfile(candidate, null);
    if (!unseenSilhouetteIds.delete(profile.shape)) continue;
    candidates.push(candidate);
    usedExpressions.add(profile.expression);
  }

  while (candidates.length < 12) {
    const candidate = `${agentId}:avatar:${batch}:${index}`;
    index += 1;
    if (candidates.includes(candidate)) continue;
    const profile = bloubAvatarProfile(candidate, null);
    if (usedExpressions.has(profile.expression)) continue;
    candidates.push(candidate);
    usedExpressions.add(profile.expression);
  }

  return candidates;
}

const FACE_SEED_TRIES = 10_000;

export type AvatarStyle = "plush" | "flat";

export const AVATAR_STYLES: readonly AvatarStyle[] = ["plush", "flat"];

const STYLE_SEED_SEGMENT: Readonly<Record<AvatarStyle, string>> = { plush: "face", flat: "flat" };

const FLAT_SEED_PATTERN = /:flat:\d+$/;

export function avatarStyleForSeed(seed: string): AvatarStyle {
  return FLAT_SEED_PATTERN.test(seed) ? "flat" : "plush";
}

export function avatarDefaultSeed(agentId: string, style: AvatarStyle): string {
  if (style === "plush") return agentId;
  const face = bloubAvatarProfile(agentId, null);
  return avatarSeedForFace(agentId, { shape: face.shape, expression: face.expression }, style);
}

export function avatarSeedForFace(
  agentId: string,
  face: { shape: SupportedAvatarSilhouetteId; expression: ExpressionId },
  style: AvatarStyle = "plush",
): string {
  for (let index = 0; index < FACE_SEED_TRIES; index += 1) {
    const candidate = `${agentId}:${STYLE_SEED_SEGMENT[style]}:${index}`;
    const profile = bloubAvatarProfile(candidate, null);
    if (profile.shape === face.shape && profile.expression === face.expression) return candidate;
  }
  throw new Error("No avatar seed draws this face.");
}

export function avatarHueForColor(color: string): AvatarHue | null {
  return AVATAR_HUE_CHOICES.find((option) => HUE_COLORS[option.hue] === color)?.hue ?? null;
}

function stableIndex(value: string, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % length;
}

function colorHex(color: ColorId): string {
  const value = COLOR_BY_ID.get(color)?.hex;
  if (!value) throw new Error(`Bloub did not return a color for ${color}.`);
  return value;
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error("Bloub avatar options are empty.");
  return item;
}
