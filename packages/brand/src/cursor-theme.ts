// The cursor the Computer Use driver draws while an agent acts on the desktop.

/**
 * The theme id, which is what `cua-driver serve --cursor-theme` is given.
 *
 * The driver requires a bounded reverse-DNS identifier and reserves `com.example` for its own
 * development themes, so this one is named from `openbot.run`. The id is also the file name of the
 * compiled artifact: the driver refuses an installed theme whose id and file name disagree.
 */
export const OPENBOT_CURSOR_THEME_ID = "run.openbot.cursor";

/**
 * The semantic actions the driver's `cua-driver-actions-v2` profile requires.
 *
 * The driver picks the animation for an action itself; a theme that leaves one out is refused at
 * build time. The names are the driver's, not OpenBot's, so they stay as upstream spells them.
 */
export type CursorAction =
  | "idle"
  | "click"
  | "observe"
  | "drag"
  | "scroll"
  | "text"
  | "key"
  | "navigate"
  | "app"
  | "transfer"
  | "record"
  | "system";

/** The two drawings, named as the dotLottie manifest names them. */
const POINTER = { animation: "pointer" } as const;
const PULSE = { animation: "pulse" } as const;

/** `--openbot-accent`, `#007cf7`, as the 0-to-1 channels a Lottie colour takes, with its alpha. */
const ACCENT = [0, 0.486, 0.969, 1] as const;
/** The outline the driver's own cursor uses, which keeps the shape readable on any wallpaper. */
const OUTLINE = [1, 1, 1, 1] as const;
/** The canvas the profile fixes: any other size or rate is refused. */
const CANVAS = { width: 128, height: 128, fps: 30 } as const;
/** The hotspot, which is where the arrow's tip is drawn. */
const TIP = { x: CANVAS.width / 2, y: CANVAS.height / 2 } as const;

/**
 * The arrow, as the corners of a closed path with its tip at the origin.
 *
 * These are the proportions of a desktop pointer, so the drawing reads as a cursor at a glance and
 * not as a marker that happens to sit near one.
 */
const ARROW = [
  [0, 0],
  [0, 21.5],
  [5.4, 16.6],
  [9.1, 24.8],
  [12.8, 23.1],
  [9.2, 15.2],
  [16.2, 15.2],
] as const;
/** How much of the canvas the arrow takes. */
const ARROW_SCALE = 1.9;
/** The middle of the arrow, which is what a glow grows around. */
const ARROW_CENTRE = { x: 8.1 * ARROW_SCALE, y: 12.4 * ARROW_SCALE } as const;
const ARROW_OUTLINE_WIDTH = 3.4;

/**
 * The glow behind the arrow: the same shape, larger, in weaker copies of the accent.
 *
 * The profile refuses a gradient and a blur, so the soft edge is three stacked copies. Each one is
 * faint enough that the sum reads as a halo rather than as an outline.
 */
const GLOW = [
  { scale: 152, opacity: 12 },
  { scale: 130, opacity: 20 },
  { scale: 114, opacity: 30 },
] as const;

/** The mark the click draws on the point, in the same accent-and-outline treatment. */
const MARK_DIAMETER = 16;
const MARK_OUTLINE_WIDTH = 3;
const PULSE_FRAMES = 15;
const STEADY_FRAMES = 30;

/** One step of an animated property. The profile allows one run, so `e` holds its end value. */
interface CursorKeyframe {
  readonly t: number;
  readonly s: readonly number[];
  readonly e?: readonly number[];
  readonly i?: { readonly x: readonly number[]; readonly y: readonly number[] };
  readonly o?: { readonly x: readonly number[]; readonly y: readonly number[] };
}

interface CursorKeyframedProperty {
  readonly a: 1;
  readonly k: readonly CursorKeyframe[];
}

type CursorScalarProperty = { readonly a: 0; readonly k: number } | CursorKeyframedProperty;
type CursorVectorProperty = { readonly a: 0; readonly k: readonly number[] } | CursorKeyframedProperty;

/** A closed path of straight corners: `i` and `o` are the tangents, which stay flat. */
interface CursorPath {
  readonly ty: "sh";
  readonly d: 1;
  readonly ks: {
    readonly a: 0;
    readonly k: {
      readonly c: true;
      readonly v: readonly (readonly number[])[];
      readonly i: readonly (readonly number[])[];
      readonly o: readonly (readonly number[])[];
    };
  };
}

/** A circle. The profile refuses a group, so every shape sits directly on a layer. */
interface CursorEllipse {
  readonly ty: "el";
  readonly d: 1;
  readonly s: { readonly a: 0; readonly k: readonly [number, number] };
  readonly p: { readonly a: 0; readonly k: readonly [number, number] };
}

interface CursorStroke {
  readonly ty: "st";
  readonly c: { readonly a: 0; readonly k: readonly number[] };
  readonly o: { readonly a: 0; readonly k: number };
  readonly w: { readonly a: 0; readonly k: number };
  readonly lc: 2;
  readonly lj: 2;
}

interface CursorFill {
  readonly ty: "fl";
  readonly c: { readonly a: 0; readonly k: readonly number[] };
  readonly o: { readonly a: 0; readonly k: number };
  readonly r: 1;
}

type CursorShape = CursorPath | CursorEllipse | CursorStroke | CursorFill;

/** A layer's own transform, the only place the profile allows a keyframe. */
interface CursorTransform {
  readonly o: CursorScalarProperty;
  readonly r: { readonly a: 0; readonly k: number };
  readonly p: { readonly a: 0; readonly k: readonly number[] };
  readonly a: { readonly a: 0; readonly k: readonly number[] };
  readonly s: CursorVectorProperty;
}

interface CursorLayer {
  readonly ddd: 0;
  readonly ind: number;
  readonly ty: 4;
  readonly nm: string;
  readonly sr: 1;
  readonly ks: CursorTransform;
  readonly ao: 0;
  readonly shapes: readonly CursorShape[];
  readonly ip: 0;
  readonly op: number;
  readonly st: 0;
  readonly bm: 0;
}

interface CursorAnimation {
  readonly v: string;
  readonly fr: number;
  readonly ip: 0;
  readonly op: number;
  readonly w: number;
  readonly h: number;
  readonly nm: string;
  readonly ddd: 0;
  readonly assets: readonly never[];
  readonly markers: readonly never[];
  readonly layers: readonly CursorLayer[];
}

/** The dotLottie index, which names each animation the archive carries. */
interface CursorManifest {
  readonly version: "1";
  readonly generator: string;
  readonly animations: readonly { readonly id: string }[];
}

/** The driver's own descriptor, which binds an animation to each semantic action. */
interface CursorThemeManifest {
  readonly schema: "cua.cursor-theme/2";
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly license: string;
  readonly compatibility: { readonly profile: "cua-driver-actions-v2"; readonly semantics: number };
  readonly canvas: { readonly width: number; readonly height: number; readonly fps: number };
  readonly hotspot: { readonly x: number; readonly y: number };
  readonly actions: Readonly<Record<CursorAction, { readonly animation: string }>>;
}

/** The files of the source archive, keyed by the path each one takes inside it. */
export interface CursorThemeSource {
  readonly "manifest.json": CursorManifest;
  readonly "a/pointer.json": CursorAnimation;
  readonly "a/pulse.json": CursorAnimation;
  readonly "cua/theme.json": CursorThemeManifest;
}

/**
 * The OpenBot cursor, as the files of a dotLottie source archive.
 *
 * `scripts/build-cursor-theme.ts` writes these into an archive and hands it to
 * `cua-cursor-theme build`, which validates and compiles them. The drawing follows the driver's own
 * cursor, because that shape is what a user already reads as "something else is driving this
 * computer": a pointer over a larger pointer-shaped glow, with a white outline. Only the colour is
 * OpenBot's. The driver's own cursor cannot simply be recoloured - it is built into the binary and
 * a theme owns the twelve action drawings only - so the treatment is drawn again here.
 *
 * The profile is narrow: no groups, no gradients, no geometry animation, and only a layer's own
 * transform may hold keyframes. So the glow is stacked flat copies, and the click animates the
 * scale and opacity of one layer.
 */
export function openbotCursorThemeSource(): CursorThemeSource {
  return {
    "manifest.json": {
      version: "1",
      generator: "openbot",
      animations: [{ id: "pointer" }, { id: "pulse" }],
    },
    "a/pointer.json": pointerAnimation(),
    "a/pulse.json": pulseAnimation(),
    "cua/theme.json": {
      schema: "cua.cursor-theme/2",
      id: OPENBOT_CURSOR_THEME_ID,
      name: "OpenBot",
      version: "1.0.0",
      author: "OpenBot",
      license: "PolyForm-Noncommercial-1.0.0",
      compatibility: { profile: "cua-driver-actions-v2", semantics: 2 },
      canvas: CANVAS,
      hotspot: TIP,
      // One cursor for every action but the click, which is the one moment a reader has to see
      // land. A drawing for each action would say more than OpenBot knows: the driver reports the
      // route it took in the tool result, not in the cursor. Every action is written out because
      // the profile requires all of them, and the record type is then what checks the set.
      actions: {
        idle: POINTER,
        click: PULSE,
        observe: POINTER,
        drag: POINTER,
        scroll: POINTER,
        text: POINTER,
        key: POINTER,
        navigate: POINTER,
        app: POINTER,
        transfer: POINTER,
        record: POINTER,
        system: POINTER,
      },
    },
  };
}

/** The steady cursor: the accent arrow on its glow. */
function pointerAnimation(): CursorAnimation {
  return animation("pointer", STEADY_FRAMES, cursorLayers(STEADY_FRAMES));
}

/** The click: a mark opens out of the point and fades, while the arrow holds still. */
function pulseAnimation(): CursorAnimation {
  const mark = markLayer(1, PULSE_FRAMES);
  return animation("pulse", PULSE_FRAMES, [
    {
      ...mark,
      ks: { ...mark.ks, o: keyframed([100], [0]), s: keyframed([60, 60, 100], [220, 220, 100]) },
    },
    ...cursorLayers(PULSE_FRAMES, 2),
  ]);
}

/**
 * The arrow and its glow, from the front backwards.
 *
 * A Lottie layer covers the ones after it, so the sharp arrow is first and the widest, faintest
 * copy of the glow is last.
 */
function cursorLayers(frames: number, firstIndex = 1): readonly CursorLayer[] {
  return [
    arrowLayer(firstIndex, frames),
    ...GLOW.map((step, offset) => glowLayer(firstIndex + 1 + offset, frames, step)),
  ];
}

/** The arrow itself: accent, under a white outline that carries it over any wallpaper. */
function arrowLayer(index: number, frames: number): CursorLayer {
  return shapeLayer("arrow", index, frames, [arrowPath(), stroke(OUTLINE, ARROW_OUTLINE_WIDTH), fill(ACCENT, 100)]);
}

/** One copy of the glow: the same arrow, grown around its middle, in a weaker accent. */
function glowLayer(index: number, frames: number, step: { scale: number; opacity: number }): CursorLayer {
  const layer = shapeLayer("glow", index, frames, [arrowPath(), fill(ACCENT, 100)]);
  return {
    ...layer,
    ks: {
      ...layer.ks,
      o: { a: 0, k: step.opacity },
      // The anchor moves to the middle of the arrow, and the position with it, so the copy grows
      // around the shape instead of away from the tip.
      a: { a: 0, k: [ARROW_CENTRE.x, ARROW_CENTRE.y, 0] },
      p: { a: 0, k: [TIP.x + ARROW_CENTRE.x, TIP.y + ARROW_CENTRE.y, 0] },
      s: { a: 0, k: [step.scale, step.scale, 100] },
    },
  };
}

/** The click mark, drawn on the point in the same accent-and-outline treatment. */
function markLayer(index: number, frames: number): CursorLayer {
  return shapeLayer("mark", index, frames, [
    { d: 1, ty: "el", s: { a: 0, k: [MARK_DIAMETER, MARK_DIAMETER] }, p: { a: 0, k: [0, 0] } },
    stroke(OUTLINE, MARK_OUTLINE_WIDTH),
    fill(ACCENT, 100),
  ]);
}

function arrowPath(): CursorPath {
  const corners = ARROW.map(([x, y]) => [x * ARROW_SCALE, y * ARROW_SCALE]);
  const flat = corners.map(() => [0, 0]);
  return { ty: "sh", d: 1, ks: { a: 0, k: { c: true, v: corners, i: flat, o: flat } } };
}

function stroke(colour: readonly number[], width: number): CursorStroke {
  return { ty: "st", c: { a: 0, k: colour }, o: { a: 0, k: 100 }, w: { a: 0, k: width }, lc: 2, lj: 2 };
}

function fill(colour: readonly number[], opacity: number): CursorFill {
  return { ty: "fl", c: { a: 0, k: colour }, o: { a: 0, k: opacity }, r: 1 };
}

function animation(name: string, frames: number, layers: readonly CursorLayer[]): CursorAnimation {
  return {
    v: "5.7.4",
    fr: CANVAS.fps,
    ip: 0,
    op: frames,
    w: CANVAS.width,
    h: CANVAS.height,
    nm: name,
    ddd: 0,
    assets: [],
    markers: [],
    layers,
  };
}

function shapeLayer(name: string, index: number, frames: number, shapes: readonly CursorShape[]): CursorLayer {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: name,
    sr: 1,
    ks: transform(),
    ao: 0,
    shapes,
    ip: 0,
    op: frames,
    st: 0,
    bm: 0,
  };
}

/** The layer transform at rest, drawn on the point the hotspot names. */
function transform(): CursorTransform {
  return {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [TIP.x, TIP.y, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
  };
}

/** One eased run from `from` to `to`, which is the only animation the profile allows. */
function keyframed(from: readonly number[], to: readonly number[]): CursorKeyframedProperty {
  return {
    a: 1,
    k: [
      { t: 0, s: from, e: to, i: { x: [0.4], y: [1] }, o: { x: [0.2], y: [0] } },
      { t: PULSE_FRAMES, s: to },
    ],
  };
}
