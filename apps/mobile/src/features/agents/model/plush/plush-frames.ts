import {
  BotEngine,
  type BotExpression,
  type BotFrame,
  type Look,
  SHAPE_BY_ID,
  type ShapeId,
} from "@norbert_bodziony/bloub";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";
import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import {
  ballBox,
  type DecorTrack,
  decorLevel,
  EMERGE,
  engineState,
  enterLook,
  eyeSample,
  lookOf,
  type Matrix,
  morphOf,
  NO_DECOR,
  type PlushBall,
  type PlushEye,
  type PlushEyeSample,
  type PlushState,
  type PlushZ,
  plushEye,
  plushFace,
  plushMood,
  SHAKE,
  SHOWN_DECOR,
  sleepZs,
  thinkingDots,
  toggleDecor,
} from "./plush-felt";

/** The desktop caps the avatar at 30 fps; the eyes of a 24 to 144 point plush show no difference. */
export const PLUSH_FPS = 30;
/**
 * One loop of a state. The thinking dots pulse every 1.5 s and the z's of sleep rise every 3 s, so
 * the loop holds a whole number of both.
 */
const LOOP_SECONDS = 6;
const LOOP_FRAMES = LOOP_SECONDS * PLUSH_FPS;
/**
 * The eyes play the engine on a smooth periodic clock that goes forward and back, so a loop closes
 * without a jump of the gaze or the lids. The decor keeps a linear clock.
 */
const LIFE_SWING = 1.5;
/**
 * The engine time where loops start. The entry of a state, such as the felt dot of `notify`, is
 * over, and the engine blinks once at 5.3 s, inside the swing: the loop blinks on the way forward
 * and on the way back.
 */
const SETTLED = 4;

/** What the plush shows: its body, the face and the state. The colour does not change the frames. */
export interface PlushGeometry {
  key: string;
  shape: ShapeId;
  radii: number[];
  face: BotExpression;
  state: PlushState;
}

export function plushGeometry(seed: string, mood: AvatarMood = "idle"): PlushGeometry {
  const profile = bloubAvatarProfile(seed, null);
  const { state, expression } = plushMood(mood);
  const face = plushFace(state, expression ?? profile.expression);
  const silhouette = SHAPE_BY_ID.get(profile.shape);
  if (!silhouette) throw new Error("The plush avatar shape is unknown.");
  return { key: `${profile.shape}:${face.id}:${state}`, shape: profile.shape, radii: silhouette.radii, face, state };
}

/** One frame, ready to draw on the UI thread. Units are those of the bloub viewBox. */
export interface PlushFrame {
  bodyAlpha: number;
  eyes: PlushEye[];
  dots: PlushBall[];
  notif: PlushBall | null;
  zs: PlushZ[];
}

/** What a transition continues from: the engine eyes and the decor of a frame on screen. */
interface FrameSource {
  eyes: PlushEyeSample[];
  /** The decor clock of the frame. */
  t: number;
  dots: DecorTrack;
  zs: DecorTrack;
}

export interface PlushSequence {
  frames: PlushFrame[];
  sources: FrameSource[];
}

function plushFrame(engine: BotFrame, eyes: PlushEyeSample[], dots: DecorTrack, zs: DecorTrack, t: number): PlushFrame {
  const closed = decorLevel(zs, t);
  const notif = engine.notif;
  return {
    bodyAlpha: engine.bodyAlpha,
    eyes: eyes.map((eye) => plushEye(eye, closed)),
    dots: thinkingDots(dots, t),
    notif: notif ? ballBox(notif.x, notif.y, notif.r, 1, 1) : null,
    zs: sleepZs(zs, t),
  };
}

function loopEngine(geometry: PlushGeometry): BotEngine {
  const engine = new BotEngine(100, engineState(geometry.state), geometry.radii, geometry.face);
  engine.setLook(lookOf(geometry.state), 0, 1 / PLUSH_FPS);
  return engine;
}

const lifeTime = (index: number) => SETTLED + LIFE_SWING * (1 - Math.cos((index / LOOP_FRAMES) * Math.PI * 2));

function* loopFrames(geometry: PlushGeometry): Generator<[PlushFrame, FrameSource]> {
  const engine = loopEngine(geometry);
  const dots = geometry.state === "thinking" ? SHOWN_DECOR : NO_DECOR;
  const zs = geometry.state === "asleep" ? SHOWN_DECOR : NO_DECOR;
  for (let index = 0; index < LOOP_FRAMES; index += 1) {
    const sampled = engine.sample(lifeTime(index));
    const eyes = sampled.eyes.map(eyeSample);
    const t = index / PLUSH_FPS;
    yield [plushFrame(sampled, eyes, dots, zs, t), { eyes, t, dots, zs }];
  }
}

const MAX_CACHED_REST_FRAMES = 128;
const restFrames = new Map<string, { frame: PlushFrame; source: FrameSource }>();

function rest(geometry: PlushGeometry) {
  const cached = restFrames.get(geometry.key);
  if (cached) return cached;
  const [frame, source] = loopFrames(geometry).next().value ?? [];
  if (!frame || !source) throw new Error("The plush avatar has no frame.");
  const oldest = restFrames.keys().next().value;
  if (restFrames.size >= MAX_CACHED_REST_FRAMES && oldest !== undefined) restFrames.delete(oldest);
  restFrames.set(geometry.key, { frame, source });
  return { frame, source };
}

/**
 * The still face of a geometry: the first frame of its loop. A long list mounts many avatars with few
 * distinct faces, so it is sampled once per face rather than once per row.
 */
export function plushRestFrame(geometry: PlushGeometry): PlushFrame {
  return rest(geometry).frame;
}

/**
 * The change from the frame on screen to `to`: the engine glides the face and the gaze, the decor
 * fades, and `failed` shakes "no" once. The eyes start where the source frame shows them. Returns the
 * loop frame of `to` to continue with, so the pulse of the decor goes on without a jump.
 */
function* transitionFrames(
  from: PlushGeometry,
  to: PlushGeometry,
  source: FrameSource,
): Generator<[PlushFrame, FrameSource]> {
  const start = SETTLED;
  const engine = loopEngine(from);
  if (engineState(to.state) !== engineState(from.state)) engine.setState(engineState(to.state), start);
  engine.setExpression(to.face, start);
  const fromLook: Look = lookOf(from.state);
  const initial = engine.sample(start).eyes.map(eyeSample);
  const dots = toggleDecor(source.dots, to.state === "thinking", source.t, to.state);
  const zs = toggleDecor(source.zs, to.state === "asleep", source.t, to.state);
  const length = Math.max(morphOf(to.state), BotEngine.SHAPE_MORPH, EMERGE, to.state === "failed" ? SHAKE : 0);
  const count = Math.ceil(length * PLUSH_FPS);
  for (let index = 0; index <= count; index += 1) {
    const seconds = index / PLUSH_FPS;
    engine.setLook(enterLook(fromLook, to.state, seconds), start + seconds, 1 / PLUSH_FPS);
    const sampled = engine.sample(start + seconds);
    // The source frame can be anywhere in a loop; the offset to it fades over the face morph.
    const remaining = (1 - Math.min(1, seconds / BotEngine.SHAPE_MORPH)) ** 5;
    const eyes = sampled.eyes.map((eye, eyeIndex) => {
      const value = eyeSample(eye);
      const shown = source.eyes[eyeIndex];
      const base = initial[eyeIndex];
      if (!shown || !base || remaining === 0) return value;
      const blend = (target: number, sourceValue: number, baseValue: number) =>
        target + (sourceValue - baseValue) * remaining;
      const [a, b, c, d, e, f] = value.matrix;
      const m = (entry: number, entryIndex: number) =>
        blend(entry, shown.matrix[entryIndex] ?? entry, base.matrix[entryIndex] ?? entry);
      const matrix: Matrix = [m(a, 0), m(b, 1), m(c, 2), m(d, 3), m(e, 4), m(f, 5)];
      return { ...value, matrix, w: blend(value.w, shown.w, base.w), h: blend(value.h, shown.h, base.h) };
    });
    const t = source.t + seconds;
    yield [plushFrame(sampled, eyes, dots, zs, t), { eyes, t, dots, zs }];
  }
}

/** The loop frame that continues a transition that ends at `end`, with the pulse of its decor. */
export function plushLoopEntry(end: FrameSource | undefined, to: PlushGeometry): number {
  if (!end) return 0;
  const track = to.state === "thinking" ? end.dots : to.state === "asleep" ? end.zs : null;
  const clock = track ? end.t - track.phase : 0;
  return ((Math.round(clock * PLUSH_FPS) % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES;
}

type Ready = (sequence: PlushSequence) => void;
type Schedule = (callback: () => void) => () => void;

function scheduleIdle(callback: () => void) {
  const id = requestIdleCallback(callback);
  return () => cancelIdleCallback(id);
}

/** Samples a sequence a few frames at a time between idle callbacks, so a list does not stop the interface. */
function prepareFrames(source: Generator<[PlushFrame, FrameSource]>, onReady: Ready, schedule: Schedule) {
  const sequence: PlushSequence = { frames: [], sources: [] };
  let cancel = () => {};
  function batch() {
    for (let count = 0; count < 6; count += 1) {
      const next = source.next();
      if (next.done) {
        onReady(sequence);
        return;
      }
      sequence.frames.push(next.value[0]);
      sequence.sources.push(next.value[1]);
    }
    cancel = schedule(batch);
  }
  cancel = schedule(batch);
  return () => cancel();
}

const MAX_CACHED_LOOPS = 8;
const loops = new Map<string, PlushSequence>();
const pending = new Map<string, { listeners: Set<Ready>; cancel: () => void }>();

/**
 * The loop of a geometry. Sampled paths are shared by the header, the activity row and later turns
 * of the same agent; pending work is shared too, since they can mount together.
 */
export function preparePlushLoop(geometry: PlushGeometry, onReady: Ready, schedule: Schedule = scheduleIdle) {
  const key = geometry.key;
  const cached = loops.get(key);
  if (cached) {
    loops.delete(key);
    loops.set(key, cached);
    onReady(cached);
    return () => {};
  }
  const current = pending.get(key) ?? { listeners: new Set<Ready>(), cancel: () => {} };
  current.listeners.add(onReady);
  if (!pending.has(key)) {
    pending.set(key, current);
    current.cancel = prepareFrames(
      loopFrames(geometry),
      (sequence) => {
        const oldest = loops.keys().next().value;
        if (loops.size >= MAX_CACHED_LOOPS && oldest !== undefined) loops.delete(oldest);
        // Mounted players keep their frames after the cache drops them.
        loops.set(key, sequence);
        pending.delete(key);
        for (const listener of current.listeners) listener(sequence);
      },
      schedule,
    );
  }
  return () => {
    current.listeners.delete(onReady);
    if (current.listeners.size === 0 && pending.get(key) === current) {
      current.cancel();
      pending.delete(key);
    }
  };
}

/** The change from frame `index` of `shown`, which plays `from`, to `to`. */
export function preparePlushTransition(
  from: PlushGeometry,
  to: PlushGeometry,
  shown: PlushSequence,
  index: number,
  onReady: Ready,
  schedule: Schedule = scheduleIdle,
) {
  const source = shown.sources[index] ?? rest(from).source;
  return prepareFrames(transitionFrames(from, to, source), onReady, schedule);
}

/** The sequence of one still frame. */
export function plushStillSequence(geometry: PlushGeometry): PlushSequence {
  const { frame, source } = rest(geometry);
  return { frames: [frame], sources: [source] };
}
