import { BotEngine, type BotFrame, EXPRESSION_BY_ID, SHAPE_BY_ID } from "@norbert_bodziony/bloub";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";

export const FPS = 60;
const IDLE = 1.2;
const THINKING = 1.7;
const WIDE = 1;
const CYCLE = IDLE + THINKING + WIDE;
export const FRAME_COUNT = Math.round(CYCLE * FPS);
export const SETTLE = 0.45;

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

// Color and agent identity do not change the sampled geometry.
export function bloubActivityGeometry(seed: string) {
  const profile = bloubAvatarProfile(seed, null);
  const silhouette = SHAPE_BY_ID.get(profile.shape);
  const expression = EXPRESSION_BY_ID.get(profile.expression);
  if (!silhouette || !expression) throw new Error("Bloub avatar profile is invalid.");
  return { key: `${profile.shape}:${profile.expression}`, radii: silhouette.radii, expression };
}

type Geometry = ReturnType<typeof bloubActivityGeometry>;
const MAX_CACHED_SEQUENCES = 8;
const sequences = new Map<string, BloubActivityFrame[]>();
type Ready = (frames: BloubActivityFrame[]) => void;
type Schedule = (callback: () => void) => () => void;
const pending = new Map<string, { listeners: Set<Ready>; cancel: () => void }>();

function scheduleIdle(callback: () => void) {
  const id = requestIdleCallback(callback);
  return () => cancelIdleCallback(id);
}

export function cycleEngine(geometry: Geometry, seconds: number, looping: boolean) {
  const engine = new BotEngine(100, "idle", geometry.radii, geometry.expression);
  if (looping) engine.reset("idle", -IDLE);
  engine.setState("thinking", 0);
  if (seconds >= THINKING) engine.setState("wide", THINKING);
  if (seconds >= THINKING + WIDE) engine.setState("idle", THINKING + WIDE);
  return engine;
}

function* activityFrames(geometry: Geometry): Generator<BloubActivityFrame> {
  for (const looping of [false, true]) {
    const engine = cycleEngine(geometry, 0, looping);
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      if (index === Math.round(THINKING * FPS)) engine.setState("wide", THINKING);
      if (index === Math.round((THINKING + WIDE) * FPS)) engine.setState("idle", THINKING + WIDE);
      yield nativeFrame(engine.sample(index / FPS));
    }
  }
}

export function prepareBloubActivityFrames(geometry: Geometry, onReady: Ready, schedule: Schedule = scheduleIdle) {
  const cached = sequences.get(geometry.key);
  if (cached) {
    sequences.delete(geometry.key);
    sequences.set(geometry.key, cached);
    onReady(cached);
    return () => {};
  }
  let preparation = pending.get(geometry.key);
  if (!preparation) {
    const listeners = new Set<Ready>();
    const frames: BloubActivityFrame[] = [];
    const source = activityFrames(geometry);
    function batch() {
      // Share pending work too: the header and activity row can mount together.
      for (let count = 0; count < 4; count += 1) {
        const next = source.next();
        if (next.done) {
          const oldest = sequences.keys().next().value;
          if (sequences.size >= MAX_CACHED_SEQUENCES && oldest !== undefined) sequences.delete(oldest);
          // Mounted players retain their frames after cache eviction.
          sequences.set(geometry.key, frames);
          pending.delete(geometry.key);
          for (const listener of listeners) listener(frames);
          return;
        }
        frames.push(next.value);
      }
      cancel = schedule(batch);
    }
    let cancel = schedule(batch);
    preparation = { listeners, cancel: () => cancel() };
    pending.set(geometry.key, preparation);
  }
  const current = preparation;
  current.listeners.add(onReady);
  return () => {
    current.listeners.delete(onReady);
    if (current.listeners.size === 0 && pending.get(geometry.key) === current) {
      current.cancel();
      pending.delete(geometry.key);
    }
  };
}
