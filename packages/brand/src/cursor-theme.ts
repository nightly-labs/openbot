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
/**
 * Where the arrow's tip is drawn, which is the point the driver holds over the target.
 *
 * The driver does not read the hotspot of the manifest when it draws. It holds one fixed point of
 * the canvas over the agent's position, and its own cursor is drawn on that point. A tip on the
 * middle of the canvas is therefore drawn about 8 points down and to the right of the target, which
 * a user sees as a cursor that misses the button it presses. The point is measured from the
 * pinned driver: move the cursor to a known position, capture the overlay window alone, because a
 * full-screen capture leaves the overlay out, and read where the tip lands.
 *
 * The hotspot below names this same point, so the cursor is correct for this driver and for one
 * that reads the hotspot.
 */
const TIP = { x: 38, y: 41 } as const;

/**
 * The arrow, as the corners of a closed path with its tip at the origin.
 *
 * It is a dart: two wings from the tip and a notch between them, the shape the driver's own cursor
 * draws. A desktop pointer says "this is your mouse"; the dart says that something else is driving
 * this computer, which is the whole job of this drawing.
 */
const ARROW = [
  [0, 0],
  [45, 20],
  [27, 31],
  [14, 49],
] as const;
/** How much of the canvas the arrow takes. */
const ARROW_SCALE = 0.86;
/** How round each corner is, which is what keeps the dart soft rather than sharp. */
const ARROW_CORNER = 5 * ARROW_SCALE;
/** The middle of the arrow, which is what a glow grows around. */
const ARROW_CENTRE = { x: 21.5 * ARROW_SCALE, y: 25 * ARROW_SCALE } as const;
const ARROW_OUTLINE_WIDTH = 4.4;

/**
 * The glow behind the arrow: the same shape, larger, in weaker copies of the accent.
 *
 * The profile refuses a gradient and a blur, so the soft edge is three stacked copies. Each one is
 * faint enough that the sum reads as a halo rather than as an outline.
 */
const GLOW = [
  { scale: 158, opacity: 7 },
  { scale: 146, opacity: 9 },
  { scale: 134, opacity: 11 },
  { scale: 122, opacity: 14 },
  { scale: 110, opacity: 18 },
] as const;

/** The mark the click draws on the point, in the same accent-and-outline treatment. */
const MARK_DIAMETER = 16;
const MARK_OUTLINE_WIDTH = 3;
/** How far a Bezier control point travels toward a corner to draw a circular arc. */
const CIRCULAR_TANGENT = 0.5523;
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
 * computer": a rounded dart on a soft glow of the same shape, under a white outline. The driver
 * draws chips beside its own tip; OpenBot leaves them out, because they say nothing the dart does
 * not and they take room beside the point the cursor acts on. Only the colour is OpenBot's. The driver's own cursor cannot simply be
 * recoloured - it is built into the binary and a theme owns the twelve action drawings only - so
 * the treatment is drawn again here.
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

/**
 * The dart, with an arc in place of each corner.
 *
 * Every corner becomes two points, one on each edge, and the two tangents between them bend toward
 * the corner they replace. `CIRCULAR_TANGENT` is the share of that distance a Bezier needs to pass
 * for a circle; it is the same number a rounded rectangle uses.
 */
function arrowPath(): CursorPath {
  const corners = ARROW.map(([x, y]) => [x * ARROW_SCALE, y * ARROW_SCALE]);
  const v: number[][] = [];
  const i: number[][] = [];
  const o: number[][] = [];
  for (const [index, corner] of corners.entries()) {
    const previous = corners[(index - 1 + corners.length) % corners.length];
    const next = corners[(index + 1) % corners.length];
    const start = towards(corner, previous);
    const end = towards(corner, next);
    v.push(start, end);
    i.push([0, 0], scaled(corner, end, CIRCULAR_TANGENT));
    o.push(scaled(corner, start, CIRCULAR_TANGENT), [0, 0]);
  }
  return { ty: "sh", d: 1, ks: { a: 0, k: { c: true, v, i, o } } };
}

/** The point on the edge where the corner's arc begins, at most halfway along that edge. */
function towards(corner: readonly number[], neighbour: readonly number[]): number[] {
  const dx = neighbour[0] - corner[0];
  const dy = neighbour[1] - corner[1];
  const length = Math.hypot(dx, dy);
  const step = Math.min(ARROW_CORNER, length / 2) / length;
  return [corner[0] + dx * step, corner[1] + dy * step];
}

/** The tangent from a point on the arc toward the corner it replaces, as Lottie wants it: relative. */
function scaled(corner: readonly number[], point: readonly number[], share: number): number[] {
  return [(corner[0] - point[0]) * share, (corner[1] - point[1]) * share];
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
