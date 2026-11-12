import {
  type BotExpression,
  dotPulse,
  EXPRESSION_BY_ID,
  type ExpressionId,
  type Look,
  type RenderedEye,
  STATE_BY_ID,
  type StateId,
} from "@norbert_bodziony/bloub";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";

/*
 * The felt plush of `@norbert_bodziony/bloub/plush` 0.6.3 (MIT), for the phone. That entry renders
 * with Solid and the DOM, and names its pictures with `import.meta.url`, so Metro cannot load it.
 * This file keeps the pure parts it needs, with the same numbers: the tint ramp, the eye pads cut
 * into felt pieces, the eyelids of a blink, and the felt decor of each state. The phone draws them
 * with Skia (`plush-draw.ts`). Check them against the package when its version changes.
 */

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const TAU = Math.PI * 2;

/** The states that keep the body. `thinking`, `asleep` and `failed` exist only for the plush. */
export type PlushState = "idle" | "wink" | "wide" | "thinking" | "notify" | "asleep" | "failed";

/** The bloub viewBox is 316 units wide, centred on the origin. The body radius is 100. */
export const VIEW_BOX = 316;
export const HALF_VIEW_BOX = VIEW_BOX / 2;
/**
 * The plush body has the radius of the flat body, but its soft, dark fur edge makes it look smaller.
 * The desktop scales the drawing by this amount so that it looks the same size (`PLUSH_BODY_STYLE`),
 * and the fur and the felt decor reach past the avatar box. The phone does the same.
 */
export const PLUSH_BODY_SCALE = 1.15;

/**
 * How each mood shows on the plush, as the desktop `AgentAvatar` shows it. Only the eyes and the felt
 * decor move; the body is the identity of the agent and keeps its colour. `null` keeps the seed face.
 */
const PLUSH_MOODS: Readonly<Record<AvatarMood, { state: PlushState; expression: ExpressionId | null }>> = {
  idle: { state: "idle", expression: null },
  working: { state: "thinking", expression: "attentif" },
  connecting: { state: "thinking", expression: "attentif" },
  waiting: { state: "notify", expression: "curieux" },
  failed: { state: "failed", expression: null },
  responded: { state: "idle", expression: "heureux" },
  asleep: { state: "asleep", expression: null },
};

export function plushMood(mood: AvatarMood) {
  return PLUSH_MOODS[mood];
}

/** The engine state under a plush state. The plush-only states keep the body at rest. */
export const engineState = (state: PlushState): StateId =>
  state === "thinking" || state === "asleep" || state === "failed" ? "idle" : state;

/** How long the arrival in a state takes: the morph of the engine state of the same name. */
export const morphOf = (state: PlushState): number =>
  STATE_BY_ID.get(state === "asleep" ? "sleep" : state === "failed" ? "idle" : state)?.morph ?? 0.45;

const REST_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 0.4 };
/** While thinking the eyes look up, towards the dots. */
const THINK_LOOK: Look = { yaw: 18, pitch: 22, mix: 1, spin: 0, wander: 0.4 };
/** Closed eyes do not search and do not blink. */
const ASLEEP_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 0.15, blink: 0 };

export const lookOf = (state: PlushState): Look =>
  state === "thinking" ? THINK_LOOK : state === "asleep" ? ASLEEP_LOOK : REST_LOOK;

function blendLook(from: Look, to: Look, t: number): Look {
  const look: Look = {
    yaw: lerp(from.yaw, to.yaw, t),
    pitch: lerp(from.pitch, to.pitch, t),
    mix: lerp(from.mix, to.mix, t),
    spin: lerp(from.spin, to.spin, t),
    wander: lerp(from.wander, to.wander, t),
  };
  if (from.blink !== undefined || to.blink !== undefined) look.blink = lerp(from.blink ?? 1, to.blink ?? 1, t);
  return look;
}

/** The "no" of `failed`: two shakes of the gaze, in degrees of yaw. */
export const SHAKE = 0.8;
const SHAKE_YAW = 12;
const shake = (t: number) =>
  t <= 0 || t >= SHAKE ? 0 : SHAKE_YAW * Math.sin((2 * TAU * t) / SHAKE) * Math.sin((Math.PI * t) / SHAKE);

/** The gaze `t` seconds after the plush enters `state`, from the gaze `from` that was on screen. */
export function enterLook(from: Look, state: PlushState, t: number): Look {
  const look = blendLook(from, lookOf(state), easeOutQuint(clamp01(t / morphOf(state))));
  if (state === "failed") look.spin += shake(t);
  return look;
}

function expression(id: ExpressionId): BotExpression {
  const face = EXPRESSION_BY_ID.get(id);
  if (!face) throw new Error("The plush expression is unknown.");
  return face;
}

/** The face of a plush shape. The desktop gives `failed` this face as its base, not the seed face. */
const NEUTRAL = expression("neutre");
const SAD = expression("triste");
const SLEEPY = expression("somnolent");
/**
 * A face that is not in the catalogue. The package names these faces `plush-asleep` and
 * `neutre-failed`; the engine reads an id only to find the eye fit of a catalogue face, and gives an
 * id it does not know the fit of `neutre`. So `neutre` draws the same eyes, and keeps the type of a
 * catalogue id. The geometry key holds the state too, so these faces do not share a key with it.
 */
function uncataloguedFace(face: Omit<BotExpression, "id">): BotExpression {
  return { ...face, id: NEUTRAL.id };
}

const ASLEEP_EYE = { w: 0.3, h: STATE_BY_ID.get("wink")?.pose(0).eyes[1].h ?? 0.089, open: 1, tilt: 0 };
/** Both eyes closed, with the low gaze of `somnolent`. */
const ASLEEP_FACE = uncataloguedFace({
  gaze: SLEEPY.gaze,
  split: SLEEPY.split,
  eyes: [{ ...ASLEEP_EYE }, { ...ASLEEP_EYE }],
});

/** The more open eye of a face, by the area of its capsule. */
const openEye = ({ eyes: [left, right] }: BotExpression): 0 | 1 => (right.w * right.h > left.w * left.h ? 1 : 0);

/** `failed`: the more open eye on both sides, flattened, with the tilt and gaze of `triste`. */
const FAILED_FACE = (() => {
  const eye = NEUTRAL.eyes[openEye(NEUTRAL)];
  const ratio = eye.w / eye.h;
  const height = ratio > 0.6 && ratio < 1.7 ? eye.w / 1.8 : eye.h;
  const side = (index: 0 | 1) => ({ w: eye.w, h: height, tilt: SAD.eyes[index].tilt ?? 0, open: 1 });
  return uncataloguedFace({
    gaze: { ...SAD.gaze },
    split: NEUTRAL.split,
    eyes: [side(0), side(1)],
  });
})();

/** The face a plush state shows: `asleep` and `failed` set their own, the others the given face. */
export function plushFace(state: PlushState, resting: ExpressionId): BotExpression {
  if (state === "asleep") return ASLEEP_FACE;
  if (state === "failed") return FAILED_FACE;
  return expression(resting);
}

/**
 * The felt eye pad of a plush shape: the first pad of Fred, without its offset. It is baked as two
 * capsules, lying (`x`) and standing (`y`). `court` is the short side of the fitted capsule; the
 * round pad measures `kw` x `kh` of it.
 */
const PAD = (() => {
  const eye = { w: 0.46, h: 0.5 };
  const [width, height] = [1.7586780224155572, 1.667393362265376];
  const short = Math.min(eye.w, eye.h);
  const straightX = eye.w > eye.h ? eye.w - short : 0;
  const straightY = eye.h > eye.w ? eye.h - short : 0;
  return { kw: (width - straightX) / short, kh: (height - straightY) / short };
})();

/** One piece of a pad on the screen, and the part of its picture it shows, from 0 to 1. */
interface PlushPiece {
  /** 0: the lying capsule, 1: the standing capsule. */
  src: 0 | 1;
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** A straight part of a pad, in short sides: half of the straight part of the picture. */
const BAR = 0.5;

/**
 * The pad on a capsule of `w` x `h`: pieces of a felt capsule, never stretched. Each half shows its
 * round end and the straight part, in sections that mirror the picture, so the felt grain stays.
 */
function padPieces(w: number, h: number): PlushPiece[] {
  const short = Math.min(w, h);
  const lying = w >= h;
  const extra = (Math.max(w, h) - short) / 2;
  const [round, across] = lying ? [PAD.kw * short, PAD.kh * short] : [PAD.kh * short, PAD.kw * short];
  const bar = BAR * short;
  const length = round + 2 * bar;
  const piece = (from: number, to: number, start: number, end: number): PlushPiece =>
    lying
      ? {
          src: 0,
          x: from,
          y: -across / 2,
          w: to - from,
          h: across,
          sx: start / length,
          sy: 0,
          sw: (end - start) / length,
          sh: 1,
        }
      : {
          src: 1,
          x: -across / 2,
          y: from,
          w: across,
          h: to - from,
          sx: 0,
          sy: start / length,
          sw: 1,
          sh: (end - start) / length,
        };
  const pieces: PlushPiece[] = [];
  const pair = (from: number, to: number, start: number, end: number) => {
    pieces.push(piece(from, to, start, end));
    pieces.push(piece(-to, -from, length - end, length - start));
  };
  const step = Math.max(bar, extra / 3);
  if (step === bar) pair(-extra - round / 2, Math.min(-extra + bar, 0), 0, round / 2 + Math.min(extra, bar));
  else pair(-extra - round / 2, -extra, 0, round / 2);
  for (let index = step === bar ? 1 : 0; index * step < extra - 1e-9 * short; index += 1) {
    const from = -extra + index * step;
    const to = Math.min(from + step, 0);
    const start = round / 2 + (index % 2) * bar;
    pair(from, to, start, start + ((to - from) / step) * bar);
  }
  return pieces;
}

function padExtent(pieces: readonly PlushPiece[]) {
  let x = 0;
  let y = 0;
  for (const piece of pieces) {
    x = Math.max(x, Math.abs(piece.x), Math.abs(piece.x + piece.w));
    y = Math.max(y, Math.abs(piece.y), Math.abs(piece.y + piece.h));
  }
  return { x, y };
}

export type Matrix = readonly [number, number, number, number, number, number];

/** The six numbers of a `matrix(a,b,c,d,e,f)` string. */
export function matrixOf(transform: string): Matrix {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = (transform.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  return [a, b, c, d, e, f];
}

/**
 * The engine closes an eye by squashing it on the screen, which turns a felt photo into a stick. The
 * pad goes under the matrix without that squash; this is the matrix that removes it.
 */
function unsquash([a, b, c, d]: Matrix, open: number): Matrix | null {
  if (open >= 1) return null;
  const bOpen = b / open;
  const dOpen = d / open;
  const det = a * d - b * c;
  return [
    (d * a - c * bOpen) / det,
    (a * bOpen - b * a) / det,
    (d * c - c * dOpen) / det,
    (a * dOpen - b * c) / det,
    0,
    0,
  ];
}

/** The capsule of an eye half closed at rest (`somnolent`): a shorter capsule, never a squashed one. */
function restCapsule([a, b, c, d]: Matrix, open: number, rest: number, w: number, h: number) {
  if (rest >= 1) return { w, h };
  const bOpen = b / open;
  const dOpen = d / open;
  return {
    w: (w * Math.hypot(a, bOpen * rest)) / Math.hypot(a, bOpen),
    h: (h * Math.hypot(c, dOpen * rest)) / Math.hypot(c, dOpen),
  };
}

/** The squash of a closed eye in the engine (`blinkScale(0)`). */
const BLINK_CLOSED = 0.06;
/** The felt fringe outside the capsule, and the soft edge of the lids, in short sides. */
const LID_FRINGE = 30 / 205;
const LID_SOFT = 0.1;
const LID_BANDS = 4;
const LID_MARGIN = 8;

interface PlushLid {
  /** The eye centre, and the vertical squash about it, on the screen. */
  cx: number;
  cy: number;
  s: number;
  /** Nested capsules in the pad frame, from the widest to the opening, painted one over the other. */
  bands: { w: number; h: number; r: number; alpha: number }[];
}

/** The lids of a blinking eye: the fur of the body closes over the pad. `null` when it does not blink. */
function lidMask(
  [, , , , x, y]: Matrix,
  open: number,
  rest: number,
  capsule: { x: number; y: number },
  image: { x: number; y: number },
): PlushLid | null {
  if (open >= rest) return null;
  const s = clamp01((open - BLINK_CLOSED) / (rest - BLINK_CLOSED));
  const short = Math.min(capsule.x, capsule.y);
  const fringe = LID_FRINGE * 2 * short;
  const full = Math.max(fringe, Math.hypot(image.x - capsule.x + short, image.y - capsule.y + short) - short);
  const margin = fringe + s ** LID_MARGIN * (full - fringe);
  const soft = LID_SOFT * 2 * short;
  const bands: PlushLid["bands"] = [];
  for (let band = LID_BANDS - 1; band >= 0; band -= 1) {
    const grow = margin + (soft * band) / LID_BANDS;
    bands.push({ w: capsule.x + grow, h: capsule.y + grow, r: short + grow, alpha: 1 / (band + 1) });
  }
  return { cx: x, cy: y, s, bands };
}

/** The felt shapes of one eye on a frame, ready to draw. */
export interface PlushEye {
  matrix: Matrix;
  alpha: number;
  /** The matrix under `matrix` that removes the blink squash from the pad. */
  inner: Matrix | null;
  pieces: PlushPiece[];
  /** The pad opacity. Closed eyes (`asleep`) fade the pad out and the closed line in. */
  pad: number;
  lid: PlushLid | null;
  /** The closed eye line: the capsule width and the opacity. */
  closed: { w: number; opacity: number } | null;
}

/** The engine values of an eye that a transition blends. */
export interface PlushEyeSample {
  matrix: Matrix;
  w: number;
  h: number;
  open: number;
  rest: number;
  alpha: number;
}

export function eyeSample(eye: RenderedEye): PlushEyeSample {
  return { matrix: matrixOf(eye.matrix), w: eye.w, h: eye.h, open: eye.open, rest: eye.rest, alpha: eye.alpha };
}

/** The pieces, lids and closed line of an eye. `closedLevel` is the visibility of the sleep decor. */
export function plushEye(eye: PlushEyeSample, closedLevel: number): PlushEye {
  const capsule = restCapsule(eye.matrix, eye.open, eye.rest, eye.w, eye.h);
  const pieces = padPieces(capsule.w, capsule.h);
  return {
    matrix: eye.matrix,
    alpha: eye.alpha,
    inner: unsquash(eye.matrix, eye.open),
    pieces,
    pad: 1 - closedLevel,
    lid:
      closedLevel < 1
        ? lidMask(eye.matrix, eye.open, eye.rest, { x: capsule.w / 2, y: capsule.h / 2 }, padExtent(pieces))
        : null,
    closed: closedLevel > 0 ? { w: eye.w, opacity: closedLevel } : null,
  };
}

/** Fade in of the thinking dots: the emergence of the `thinking` state. */
export const EMERGE = 0.3;

/** A felt decor that fades in and out: the thinking dots, or the z's of sleep. */
export interface DecorTrack {
  /** The origin of the pulse. */
  phase: number;
  /** The latest entry or exit, and the visibility it starts from. */
  at: number;
  from: number;
  on: boolean;
  /** The exit duration: the morph of the next state. */
  exit: number;
}

export const NO_DECOR: DecorTrack = { phase: 0, at: Number.NEGATIVE_INFINITY, from: 0, on: false, exit: 1 };
export const SHOWN_DECOR: DecorTrack = { ...NO_DECOR, from: 1, on: true };

export function decorLevel(track: DecorTrack, t: number): number {
  const since = t - track.at;
  return track.on
    ? track.from + (1 - track.from) * easeOutCubic(clamp01(since / EMERGE))
    : track.from * (1 - easeOutQuint(clamp01(since / track.exit)));
}

/** Entry in the decor (`on`) or exit to `next`, at `t`. */
export function toggleDecor(track: DecorTrack, on: boolean, t: number, next: PlushState): DecorTrack {
  if (on === track.on) return track;
  const level = decorLevel(track, t);
  return { phase: on && level < 0.001 ? t : track.phase, at: t, from: level, on, exit: morphOf(next) };
}

/** A felt ball: its box in viewBox units. */
export interface PlushBall {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

/** The felt ball fills this part of its picture. */
const BALL_FILL = 0.8;
const THINK_X = 0.62;
const THINK_Y = -1.3;
const THINK_SCALE = 0.6;
/** The thinking dots of the engine: their offsets, radius and pulse scale, in body radii. */
const DOT_OFFSETS = [-0.557, -0.013, 0.532];
const DOT_RADIUS = 0.165;
const DOT_PULSE = 1.25;

/** The three thinking dots at `t`, beside the head. Empty when they do not show. */
export function thinkingDots(track: DecorTrack, t: number): PlushBall[] {
  const level = decorLevel(track, t);
  if (level < 0.001) return [];
  return DOT_OFFSETS.map((offset, index) => {
    const pulse = dotPulse(t - track.phase, index);
    const r = DOT_RADIUS * THINK_SCALE * (1 + (DOT_PULSE - 1) * pulse) * (0.5 + 0.5 * level);
    return ballBox(THINK_X + offset * THINK_SCALE, THINK_Y, r, level * (0.55 + 0.45 * pulse), 100);
  });
}

/** The box of a felt ball of radius `r` at `x`, `y`, in units of `unit`. */
export function ballBox(x: number, y: number, r: number, opacity: number, unit: number): PlushBall {
  return { x: (x - r / BALL_FILL) * unit, y: (y - r / BALL_FILL) * unit, size: ((2 * r) / BALL_FILL) * unit, opacity };
}

/** A "z" of sleep, as the path of its three strokes, in viewBox units. */
export interface PlushZ {
  x: number;
  y: number;
  half: number;
  width: number;
  opacity: number;
}

const Z_LIFE = 3;
const Z_COUNT = 3;
const Z_FROM = { x: 0.55, y: -0.74 };
const Z_TO = { x: 1.25, y: -1.38 };
const Z_SIZE = [0.1, 0.2] as const;
/** The stroke of a "z", in parts of its side. */
const Z_STROKE = 0.24;

/** The z's that rise beside a sleeping plush at `t`. Empty when they do not show. */
export function sleepZs(track: DecorTrack, t: number): PlushZ[] {
  const level = decorLevel(track, t);
  if (level < 0.001) return [];
  const zs: PlushZ[] = [];
  for (let index = 0; index < Z_COUNT; index += 1) {
    const life = ((((t - track.phase) / Z_LIFE - index / Z_COUNT) % 1) + 1) % 1;
    const opacity = clamp01(life / 0.15) * clamp01((1 - life) / 0.45) * level;
    if (opacity < 0.001) continue;
    const size = lerp(Z_SIZE[0], Z_SIZE[1], life) * 100;
    zs.push({
      x: (lerp(Z_FROM.x, Z_TO.x, life) + Math.sin(life * TAU) * 0.04) * 100,
      y: lerp(Z_FROM.y, Z_TO.y, life) * 100,
      half: size / 2,
      width: size * Z_STROKE,
      opacity,
    });
  }
  return zs;
}

/**
 * The curve of the tint, fitted to the baked bodies: for each grey 0..255, the RGB colour 0..255. In
 * linear light: the colour times the distance in luminance to the median, then blended to white above.
 */
const GREY = 0.55;
const TINT = { gamma: 0.6, sheen: 0.08 };
const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toSrgb = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

/** The tint ramp of `hex` as 256 RGBA pixels. */
export function tintRamp(hex: string): Uint8Array {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const ink = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => toLinear(channel / 255));
  const median = toLinear(GREY);
  const ramp = new Uint8Array(256 * 4);
  for (let grey = 0; grey < 256; grey += 1) {
    const light = (toLinear(grey / 255) / median) ** TINT.gamma;
    const sheen = TINT.sheen * Math.max(0, (grey / 255 - GREY) / (1 - GREY)) ** 2;
    for (let channel = 0; channel < 3; channel += 1) {
      const tinted = Math.min(1, (ink[channel] ?? 0) * light);
      ramp[grey * 4 + channel] = Math.round(toSrgb(tinted + (1 - tinted) * sheen) * 255);
    }
    ramp[grey * 4 + 3] = 255;
  }
  return ramp;
}

/** The colour of the felt dot of `notify`. */
export const NOTIFY_COLOR = "#2496e8";
/** The closed eye line of `asleep`. */
export const CLOSED_EYE_COLOR = "#1c1a1d";
/** The closed eye line: its bend and its stroke, in parts of the capsule width. */
export const CLOSED_EYE_BEND = 0.42;
export const CLOSED_EYE_STROKE = 0.2;
