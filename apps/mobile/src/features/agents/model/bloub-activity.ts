import { BotEngine, type BotFrame, blendExpression, EXPRESSION_BY_ID, SHAPE_BY_ID } from "@norbert_bodziony/bloub";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";
import { type AvatarMood, avatarMoodPresentation } from "@openbot/brand/bloub-avatar-motion";

/**
 * The pose the working cycle holds. It is shape-safe by type, so the cycle can never hand back a
 * different creature than the one the agent is recognised by. The working face arrives with the
 * geometry instead: `bloubActivityGeometry` reads it from the same mood table the desktop uses.
 */
const WORKING_STATE = avatarMoodPresentation("working").state;

export const FPS = 60;
const LEAD = 1.2;
const FOCUS = 1.7;
const WIDE = 1;
const CYCLE = LEAD + FOCUS + WIDE;
export const FRAME_COUNT = Math.round(CYCLE * FPS);
export const SETTLE = 0.45;
export const IDLE_FPS = 30;
const IDLE_SECONDS = 8;

function* idleFrames(geometry: Geometry) {
  const engine = new BotEngine(100, "idle", geometry.radii, geometry.expression);
  for (let index = 0; index < IDLE_SECONDS * IDLE_FPS; index += 1) {
    // A smooth periodic clock closes the loop without snapping the head or eyes.
    const seconds = 2 * (1 - Math.cos((index / (IDLE_SECONDS * IDLE_FPS)) * Math.PI * 2));
    yield nativeFrame(engine.sample(seconds));
  }
}

export function prepareBloubIdleFrames(geometry: Geometry, onReady: Ready, schedule: Schedule = scheduleIdle) {
  return prepareSharedFrames(`idle:${geometry.key}`, idleFrames(geometry), onReady, schedule);
}

export function nativeFrame(frame: BotFrame) {
  return {
    body: { d: frame.bodyPath, opacity: frame.bodyAlpha },
    eyes: frame.eyes.map((eye) => ({
      d: eye.d,
      opacity: eye.alpha,
      matrix: eye.matrix.slice(7, -1).split(",").map(Number),
    })),
    dots: frame.dots.map((dot) => ({ cx: dot.x, cy: dot.y, r: dot.r, opacity: dot.opacity })),
  };
}

export type BloubActivityFrame = ReturnType<typeof nativeFrame>;

/**
 * The shape and face to sample for an agent. Color and agent identity do not change it.
 *
 * The silhouette comes from the seed and never from the mood, so it is fixed for the life of the
 * agent. The mood only chooses the face, and a mood with no face of its own keeps the seeded one.
 * Because the key carries the expression, a mood change looks like any other appearance change to
 * the player above, which already glides between two geometries over `BotEngine.SHAPE_MORPH`.
 */
export function bloubActivityGeometry(seed: string, mood: AvatarMood = "idle") {
  const profile = bloubAvatarProfile(seed, null);
  const expressionId = avatarMoodPresentation(mood).expression ?? profile.expression;
  const silhouette = SHAPE_BY_ID.get(profile.shape);
  const expression = EXPRESSION_BY_ID.get(expressionId);
  if (!silhouette || !expression) throw new Error("Bloub avatar profile is invalid.");
  return { key: `${profile.shape}:${expressionId}`, radii: silhouette.radii, expression };
}

type Geometry = ReturnType<typeof bloubActivityGeometry>;

export function bloubMorphGeometry(from: Geometry, to: Geometry, seconds: number): Geometry {
  const progress = 1 - (1 - Math.min(1, Math.max(0, seconds / BotEngine.SHAPE_MORPH))) ** 5;
  return {
    key: to.key,
    radii: to.radii.map((radius, index) => {
      const source = from.radii[index] ?? radius;
      return source + (radius - source) * progress;
    }),
    expression: blendExpression(from.expression, to.expression, progress),
  };
}

function* morphFrames(from: Geometry, to: Geometry, sourceFrame: BloubActivityFrame) {
  const engine = new BotEngine(100, "idle", from.radii, from.expression);
  engine.setShape(to.radii, 0);
  engine.setExpression(to.expression, 0);
  const initial = nativeFrame(engine.sample(0));
  yield sourceFrame;
  for (let index = 1; index <= Math.ceil(BotEngine.SHAPE_MORPH * FPS); index += 1) {
    const frame = nativeFrame(engine.sample(index / FPS));
    // Eye placement is fitted to each silhouette by the engine. Retargeting a
    // partial morph must preserve the displayed placement while that fit settles.
    const remaining = (1 - Math.min(1, index / FPS / BotEngine.SHAPE_MORPH)) ** 5;
    frame.eyes = frame.eyes.map((eye, eyeIndex) => ({
      ...eye,
      matrix: eye.matrix.map((value, matrixIndex) => {
        const source = sourceFrame.eyes[eyeIndex]?.matrix[matrixIndex] ?? value;
        const start = initial.eyes[eyeIndex]?.matrix[matrixIndex] ?? source;
        return value + (source - start) * remaining;
      }),
    }));
    yield frame;
  }
}

export function prepareBloubMorphFrames(
  from: Geometry,
  to: Geometry,
  sourceFrame: BloubActivityFrame,
  onReady: Ready,
  schedule: Schedule = scheduleIdle,
) {
  return prepareFrames(morphFrames(from, to, sourceFrame), onReady, schedule);
}

const MAX_CACHED_SEQUENCES = 8;
const sequences = new Map<string, BloubActivityFrame[]>();
type Ready = (frames: BloubActivityFrame[]) => void;
type Schedule = (callback: () => void) => () => void;
const pending = new Map<string, { listeners: Set<Ready>; cancel: () => void }>();

function scheduleIdle(callback: () => void) {
  const id = requestIdleCallback(callback);
  return () => cancelIdleCallback(id);
}

/**
 * The working loop: the agent holds its working face, opens its eyes wide, and settles back.
 *
 * It used to open on `thinking`, which draws its own body, so a working agent on the phone turned
 * into a column of dots for most of the cycle. Both poses here keep the agent's silhouette.
 */
function cycleEngine(geometry: Geometry, seconds: number, looping: boolean) {
  const engine = new BotEngine(100, WORKING_STATE, geometry.radii, geometry.expression);
  if (looping) engine.reset(WORKING_STATE, -LEAD);
  if (seconds >= FOCUS) engine.setState("wide", FOCUS);
  if (seconds >= FOCUS + WIDE) engine.setState(WORKING_STATE, FOCUS + WIDE);
  return engine;
}

function* activityFrames(geometry: Geometry): Generator<BloubActivityFrame> {
  for (const looping of [false, true]) {
    const engine = cycleEngine(geometry, 0, looping);
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      if (index === Math.round(FOCUS * FPS)) engine.setState("wide", FOCUS);
      if (index === Math.round((FOCUS + WIDE) * FPS)) engine.setState(WORKING_STATE, FOCUS + WIDE);
      yield nativeFrame(engine.sample(index / FPS));
    }
  }
}

export function prepareBloubActivityFrames(geometry: Geometry, onReady: Ready, schedule: Schedule = scheduleIdle) {
  return prepareSharedFrames(geometry.key, activityFrames(geometry), onReady, schedule);
}

function prepareSharedFrames(key: string, source: Generator<BloubActivityFrame>, onReady: Ready, schedule: Schedule) {
  const cached = sequences.get(key);
  if (cached) {
    sequences.delete(key);
    sequences.set(key, cached);
    onReady(cached);
    return () => {};
  }
  let preparation = pending.get(key);
  if (!preparation) {
    const listeners = new Set<Ready>();
    // Share pending work too: the header and activity row can mount together.
    const cancel = prepareFrames(
      source,
      (frames) => {
        const oldest = sequences.keys().next().value;
        if (sequences.size >= MAX_CACHED_SEQUENCES && oldest !== undefined) sequences.delete(oldest);
        // Mounted players retain their frames after cache eviction.
        sequences.set(key, frames);
        pending.delete(key);
        for (const listener of listeners) listener(frames);
      },
      schedule,
    );
    preparation = { listeners, cancel };
    pending.set(key, preparation);
  }
  const current = preparation;
  current.listeners.add(onReady);
  return () => {
    current.listeners.delete(onReady);
    if (current.listeners.size === 0 && pending.get(key) === current) {
      current.cancel();
      pending.delete(key);
    }
  };
}

function* settlingFrames(
  geometry: Geometry,
  sourceIndex: number,
  sourceFrame: BloubActivityFrame,
): Generator<BloubActivityFrame> {
  const seconds = (Math.floor(sourceIndex) % FRAME_COUNT) / FPS;
  const engine = cycleEngine(geometry, seconds, sourceIndex >= FRAME_COUNT);
  engine.setState("idle", seconds);
  yield sourceFrame;
  for (let index = 1; index <= Math.ceil(SETTLE * FPS); index += 1) {
    yield nativeFrame(engine.sample(seconds + index / FPS));
  }
}

export function prepareBloubSettlingFrames(
  geometry: Geometry,
  sourceIndex: number,
  sourceFrame: BloubActivityFrame,
  onReady: Ready,
  schedule: Schedule = scheduleIdle,
) {
  return prepareFrames(settlingFrames(geometry, sourceIndex, sourceFrame), onReady, schedule);
}

function prepareFrames(source: Generator<BloubActivityFrame>, onReady: Ready, schedule: Schedule) {
  const frames: BloubActivityFrame[] = [];
  function batch() {
    for (let count = 0; count < 4; count += 1) {
      const next = source.next();
      if (next.done) {
        onReady(frames);
        return;
      }
      frames.push(next.value);
    }
    cancel = schedule(batch);
  }
  let cancel = schedule(batch);
  return () => cancel();
}
