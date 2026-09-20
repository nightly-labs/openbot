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
/** The canvas the profile fixes: any other size or rate is refused. */
const CANVAS = { width: 128, height: 128, fps: 30 } as const;
/** The centre, which is both the hotspot and where every shape is drawn. */
const CENTRE = { x: CANVAS.width / 2, y: CANVAS.height / 2 } as const;
const RING_DIAMETER = 40;
const RING_WIDTH = 6;
const DOT_DIAMETER = 12;
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

type CursorShape = CursorEllipse | CursorStroke | CursorFill;

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
 * `cua-cursor-theme build`, which validates and compiles them. The profile is narrow: no groups, no
 * geometry animation, and only a layer's own transform may hold keyframes. So the art is two flat
 * layers, and the click pulse animates the scale and opacity of one of them.
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
      hotspot: CENTRE,
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

/** The steady cursor: an accent ring around the point, with a filled centre. */
function pointerAnimation(): CursorAnimation {
  return animation("pointer", STEADY_FRAMES, [ringLayer(1), dotLayer(2)]);
}

/** The click: the ring grows out and fades while the centre holds the point. */
function pulseAnimation(): CursorAnimation {
  const ring = ringLayer(1);
  return animation("pulse", PULSE_FRAMES, [
    {
      ...ring,
      op: PULSE_FRAMES,
      ks: {
        ...ring.ks,
        o: keyframed([100], [0]),
        s: keyframed([100, 100, 100], [190, 190, 100]),
      },
    },
    { ...dotLayer(2), op: PULSE_FRAMES },
  ]);
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

function ringLayer(index: number): CursorLayer {
  return shapeLayer("ring", index, [
    ellipse(RING_DIAMETER),
    { ty: "st", c: { a: 0, k: ACCENT }, o: { a: 0, k: 100 }, w: { a: 0, k: RING_WIDTH }, lc: 2, lj: 2 },
  ]);
}

function dotLayer(index: number): CursorLayer {
  return shapeLayer("dot", index, [
    ellipse(DOT_DIAMETER),
    { ty: "fl", c: { a: 0, k: ACCENT }, o: { a: 0, k: 100 }, r: 1 },
  ]);
}

function shapeLayer(name: string, index: number, shapes: readonly CursorShape[]): CursorLayer {
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
    op: STEADY_FRAMES,
    st: 0,
    bm: 0,
  };
}

function ellipse(diameter: number): CursorEllipse {
  return { d: 1, ty: "el", s: { a: 0, k: [diameter, diameter] }, p: { a: 0, k: [0, 0] } };
}

/** The layer transform at rest, drawn on the point the hotspot names. */
function transform(): CursorTransform {
  return {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [CENTRE.x, CENTRE.y, 0] },
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
