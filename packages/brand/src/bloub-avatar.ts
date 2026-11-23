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
function isSupportedSilhouette<Silhouette extends ShapeId>(
  silhouette: Silhouette,
): silhouette is Exclude<Silhouette, typeof UNSUPPORTED_AVATAR_SILHOUETTE> {
  return silhouette !== UNSUPPORTED_AVATAR_SILHOUETTE;
}
export const SUPPORTED_AVATAR_SILHOUETTES = SHAPES.map((option) => option.id).filter(isSupportedSilhouette);
const SEEDED_AVATAR_SILHOUETTES = [
  "cercle",
  "galet",
  "squircle",
  "capsule",
  "triangle",
  "hexagone",
  "nuage",
  "goutte",
  "carre",
  "losange",
  "pentagone",
] as const satisfies readonly ShapeId[];
type SeededSilhouette = (typeof SEEDED_AVATAR_SILHOUETTES)[number];
type SeededSupportedSilhouette = Exclude<SeededSilhouette, typeof UNSUPPORTED_AVATAR_SILHOUETTE>;
type NamedSilhouette = Exclude<ShapeId, SeededSilhouette>;
const SEEDED_SUPPORTED_SILHOUETTES = SEEDED_AVATAR_SILHOUETTES.filter(isSupportedSilhouette);
const NAMED_SILHOUETTE_LOOKALIKES: Readonly<Record<NamedSilhouette, SeededSupportedSilhouette>> = {
  fantome: "squircle",
  meduse: "galet",
  poulpe: "nuage",
};
const NAMED_SILHOUETTE_SEED_PATTERN = /:([a-z]+):(?:face|flat):\d+$/;

function isNamedSilhouette(silhouette: string): silhouette is NamedSilhouette {
  return Object.hasOwn(NAMED_SILHOUETTE_LOOKALIKES, silhouette);
}

function namedSilhouette(seed: string): NamedSilhouette | null {
  const silhouette = NAMED_SILHOUETTE_SEED_PATTERN.exec(seed)?.[1];
  return silhouette !== undefined && isNamedSilhouette(silhouette) ? silhouette : null;
}

function seededSilhouette(seed: string): SeededSupportedSilhouette {
  const silhouette = requiredItem(
    SEEDED_AVATAR_SILHOUETTES,
    stableIndex(`${seed}:shape`, SEEDED_AVATAR_SILHOUETTES.length),
  );
  return silhouette === UNSUPPORTED_AVATAR_SILHOUETTE
    ? requiredItem(
        SEEDED_SUPPORTED_SILHOUETTES,
        stableIndex(`${seed}:shape:replacement`, SEEDED_SUPPORTED_SILHOUETTES.length),
      )
    : silhouette;
}

function seededLookalike(silhouette: SupportedAvatarSilhouetteId): SeededSupportedSilhouette {
  return isNamedSilhouette(silhouette) ? NAMED_SILHOUETTE_LOOKALIKES[silhouette] : silhouette;
}

function seededExpression(seed: string): ExpressionId {
  return requiredItem(EXPRESSIONS, stableIndex(`${seed}:expression`, EXPRESSIONS.length)).id;
}

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
  const silhouette = namedSilhouette(seed) ?? seededSilhouette(seed);
  const expression = seededExpression(seed);

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
  const unseenSilhouetteIds = new Set<SupportedAvatarSilhouetteId>(SEEDED_SUPPORTED_SILHOUETTES);
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
  const named = isNamedSilhouette(face.shape) ? face.shape : null;
  const prefix = named ? `${agentId}:${named}` : agentId;
  const seededShape = seededLookalike(face.shape);
  for (let index = 0; index < FACE_SEED_TRIES; index += 1) {
    const candidate = `${prefix}:${STYLE_SEED_SEGMENT[style]}:${index}`;
    if (
      namedSilhouette(candidate) === named &&
      seededSilhouette(candidate) === seededShape &&
      seededExpression(candidate) === face.expression
    ) {
      return candidate;
    }
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
