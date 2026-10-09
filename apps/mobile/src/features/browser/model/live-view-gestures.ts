import {
  clamp,
  clampFraction,
  clampZoom,
  MAX_ZOOM,
  type Point,
  pinchZoom,
  pointsPerPixel,
  type Size,
  shownRect,
  toFraction,
  type Zoom,
} from "./live-view-geometry";

// The touches on a live view, as the mouse of the host's page. The rules are the ones the help
// sheet gives the user:
//
// - One finger: a tap clicks where it lands, a drag holds the button, and a press and hold
//   right-clicks. In trackpad mode the finger moves the pointer instead, a tap clicks at the
//   pointer, and a tap followed by a press and hold drags.
// - Two fingers: a drag scrolls, a tap right-clicks, and a pinch zooms the picture on the phone.
//   With the picture zoomed, a two-finger drag pans it instead of scrolling the page.

export type LiveViewMode = "direct" | "trackpad";
export type LiveViewButton = "left" | "right";

export interface LiveViewTouch {
  id: number;
  x: number;
  y: number;
}

/** The screen that owns the gestures: what shows, and where the input goes. */
export interface LiveViewGestureHost {
  /** The stage, the page and the zoom as they show now. Null until a frame shows. */
  layout(): { stage: Size; frame: Size; zoom: Zoom } | null;
  mode(): LiveViewMode;
  /** The pointer, as a fraction of the page. */
  pointer(): Point;
  /** Moves the drawn pointer. In trackpad mode the screen also keeps it in view. */
  setPointer(fraction: Point): void;
  press(action: "move" | "down" | "up", at: Point, button: LiveViewButton, clickCount: number): void;
  /** Scrolls the page at `at` by page pixels. */
  wheel(at: Point, deltaX: number, deltaY: number): void;
  setZoom(zoom: Zoom): void;
  feedback(kind: "secondary-click" | "drag-start"): void;
}

export interface LiveViewScheduler {
  later(milliseconds: number, callback: () => void): () => void;
  frame(callback: (time: number) => void): () => void;
}

/** A finger that moves less than this many points is a tap or a hold. */
const TAP_SLOP = 10;
const HOLD_MS = 500;
/** In trackpad mode, a touch this soon after a tap starts a drag when it holds or moves. */
const DOUBLE_TAP_MS = 300;
const DRAG_HOLD_MS = 180;
/** A second tap this close to the first, in points, is a double click. */
const DOUBLE_TAP_SLOP = 32;
const TWO_FINGER_TAP_MS = 250;
const PINCH_SLOP = 16;
const SCROLL_SLOP = 8;
/** Trackpad pointer speed: the finger's distance at rest, up to twice that for a fast swipe. */
const POINTER_ACCELERATION_START = 0.3;
const POINTER_ACCELERATION_RANGE = 1.2;
/** A scroll that ends faster than this, in page pixels per millisecond, keeps moving. */
const FLING_MIN_SPEED = 0.25;
const FLING_STOP_SPEED = 0.03;
const FLING_SAMPLE_MS = 80;
const FLING_DECAY_PER_FRAME = 0.95;
const FLING_MAX_MS = 1_500;

interface OneFinger {
  kind: "one";
  id: number;
  start: Point;
  last: Point;
  lastTime: number;
  phase: "pending" | "drag" | "pointer" | "pointer-drag" | "held";
  /** Trackpad mode: the touch came right after a tap, so a hold or a move drags. */
  dragArmed: boolean;
  cancelHold: (() => void) | null;
}

interface TwoFingers {
  kind: "two";
  ids: [number, number];
  startMid: Point;
  startDistance: number;
  startTime: number;
  startZoom: Zoom;
  lastMid: Point;
  phase: "pending" | "scroll" | "zoom";
  /** Where the wheel events land, as a fraction of the page. */
  scrollAt: Point;
  samples: { time: number; x: number; y: number }[];
}

type GestureState = { kind: "idle" } | { kind: "lifting" } | OneFinger | TwoFingers;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function onPage(fraction: Point): boolean {
  return fraction.x >= 0 && fraction.x <= 1 && fraction.y >= 0 && fraction.y <= 1;
}

export function createLiveViewGestures(host: LiveViewGestureHost, scheduler: LiveViewScheduler) {
  const touches = new Map<number, Point>();
  let state: GestureState = { kind: "idle" };
  let lastTap: { time: number; point: Point; clickCount: number } | null = null;
  let stopFling: (() => void) | null = null;

  const fractionAt = (point: Point): Point | null => {
    const layout = host.layout();
    return layout ? toFraction(point, shownRect(layout.stage, layout.frame, layout.zoom)) : null;
  };

  const click = (at: Point, button: LiveViewButton, clickCount: number) => {
    host.press("down", at, button, clickCount);
    host.press("up", at, button, clickCount);
  };

  /** A click where the finger is, in direct mode. Nothing happens on the bars around the page. */
  const clickAt = (point: Point, button: LiveViewButton, clickCount: number) => {
    const at = fractionAt(point);
    if (!at || !onPage(at)) return false;
    host.setPointer(at);
    host.press("move", at, button, 0);
    click(at, button, clickCount);
    return true;
  };

  /** A right-click where the finger is in direct mode, or at the pointer in trackpad mode. */
  const secondaryClick = (point: Point | null) => {
    if (point) {
      if (!clickAt(point, "right", 1)) return;
    } else {
      click(host.pointer(), "right", 1);
    }
    host.feedback("secondary-click");
  };

  const endFling = () => {
    stopFling?.();
    stopFling = null;
  };

  /** The trackpad pointer moves by the finger's movement, a little faster for a fast swipe. */
  const movePointer = (from: Point, to: Point, elapsed: number) => {
    const layout = host.layout();
    if (!layout) return;
    const rect = shownRect(layout.stage, layout.frame, layout.zoom);
    if (rect.width <= 0 || rect.height <= 0) return;
    const speed = distance(from, to) / Math.max(1, elapsed);
    const factor = 1 + clamp((speed - POINTER_ACCELERATION_START) / POINTER_ACCELERATION_RANGE, 0, 1);
    const current = host.pointer();
    const next = clampFraction({
      x: current.x + ((to.x - from.x) * factor) / rect.width,
      y: current.y + ((to.y - from.y) * factor) / rect.height,
    });
    host.setPointer(next);
    host.press("move", next, "left", 0);
  };

  const startOne = (id: number, point: Point, time: number) => {
    const dragArmed = host.mode() === "trackpad" && lastTap !== null && time - lastTap.time <= DOUBLE_TAP_MS;
    const finger: OneFinger = {
      kind: "one",
      id,
      start: point,
      last: point,
      lastTime: time,
      phase: "pending",
      dragArmed,
      cancelHold: null,
    };
    finger.cancelHold = scheduler.later(dragArmed ? DRAG_HOLD_MS : HOLD_MS, () => {
      if (state !== finger || finger.phase !== "pending") return;
      finger.cancelHold = null;
      if (finger.dragArmed) {
        finger.phase = "pointer-drag";
        host.press("down", host.pointer(), "left", 1);
        host.feedback("drag-start");
        return;
      }
      finger.phase = "held";
      secondaryClick(host.mode() === "direct" ? finger.start : null);
    });
    state = finger;
  };

  const moveOne = (finger: OneFinger, point: Point, time: number) => {
    if (finger.phase === "held") return;
    if (finger.phase === "pending") {
      if (distance(point, finger.start) <= TAP_SLOP) return;
      finger.cancelHold?.();
      finger.cancelHold = null;
      if (host.mode() === "direct") {
        const at = fractionAt(finger.start);
        if (!at) return;
        const start = clampFraction(at);
        finger.phase = "drag";
        host.setPointer(start);
        host.press("move", start, "left", 0);
        host.press("down", start, "left", 1);
      } else if (finger.dragArmed) {
        finger.phase = "pointer-drag";
        host.press("down", host.pointer(), "left", 1);
        host.feedback("drag-start");
      } else {
        finger.phase = "pointer";
      }
    }
    if (finger.phase === "drag") {
      const at = fractionAt(point);
      if (at) {
        const next = clampFraction(at);
        host.setPointer(next);
        host.press("move", next, "left", 0);
      }
    } else {
      movePointer(finger.last, point, time - finger.lastTime);
    }
    finger.last = point;
    finger.lastTime = time;
  };

  const endOne = (finger: OneFinger, time: number) => {
    finger.cancelHold?.();
    finger.cancelHold = null;
    if (finger.phase === "drag") {
      const at = fractionAt(finger.last);
      host.press("up", at ? clampFraction(at) : host.pointer(), "left", 1);
    } else if (finger.phase === "pointer-drag") {
      host.press("up", host.pointer(), "left", 1);
    } else if (finger.phase === "pending") {
      const direct = host.mode() === "direct";
      const repeats =
        lastTap !== null &&
        time - lastTap.time <= DOUBLE_TAP_MS &&
        (!direct || distance(finger.start, lastTap.point) <= DOUBLE_TAP_SLOP);
      const clickCount = repeats && lastTap ? Math.min(lastTap.clickCount + 1, 3) : 1;
      let clicked = true;
      if (direct) clicked = clickAt(finger.start, "left", clickCount);
      else click(host.pointer(), "left", clickCount);
      lastTap = clicked ? { time, point: finger.start, clickCount } : null;
      return;
    }
    lastTap = null;
  };

  const startTwo = (ids: [number, number], time: number) => {
    const first = touches.get(ids[0]);
    const second = touches.get(ids[1]);
    const layout = host.layout();
    if (!first || !second || !layout) {
      state = { kind: "lifting" };
      return;
    }
    const startMid = middle(first, second);
    const at = fractionAt(startMid);
    state = {
      kind: "two",
      ids,
      startMid,
      startDistance: distance(first, second),
      startTime: time,
      startZoom: layout.zoom,
      lastMid: startMid,
      phase: "pending",
      scrollAt: host.mode() === "trackpad" || !at ? host.pointer() : clampFraction(at),
      samples: [],
    };
  };

  const moveTwo = (fingers: TwoFingers, time: number) => {
    const first = touches.get(fingers.ids[0]);
    const second = touches.get(fingers.ids[1]);
    const layout = host.layout();
    if (!first || !second || !layout) return;
    const mid = middle(first, second);
    const spread = distance(first, second);
    if (fingers.phase === "pending") {
      if (Math.abs(spread - fingers.startDistance) > PINCH_SLOP) fingers.phase = "zoom";
      else if (distance(mid, fingers.startMid) > SCROLL_SLOP)
        fingers.phase = fingers.startZoom.scale > 1.01 ? "zoom" : "scroll";
      else return;
      // The scroll starts here, so the distance under the slop does not jump the page.
      if (fingers.phase === "scroll") {
        fingers.lastMid = mid;
        return;
      }
    }
    if (fingers.phase === "scroll") {
      const perPixel = pointsPerPixel(layout.stage, layout.frame, layout.zoom);
      // The page follows the fingers, as a scroll view does: fingers up scroll the page down.
      const x = -(mid.x - fingers.lastMid.x) / perPixel;
      const y = -(mid.y - fingers.lastMid.y) / perPixel;
      fingers.lastMid = mid;
      fingers.samples.push({ time, x, y });
      while (fingers.samples.length > 0 && time - (fingers.samples[0]?.time ?? time) > FLING_SAMPLE_MS)
        fingers.samples.shift();
      host.wheel(fingers.scrollAt, x, y);
      return;
    }
    const scale = clamp((fingers.startZoom.scale * spread) / Math.max(1, fingers.startDistance), 1, MAX_ZOOM);
    host.setZoom(clampZoom(layout.stage, layout.frame, pinchZoom(fingers.startZoom, fingers.startMid, mid, scale)));
  };

  const fling = (at: Point, samples: TwoFingers["samples"], time: number) => {
    const first = samples[0];
    if (!first) return;
    const elapsed = Math.max(16, time - first.time);
    let x = samples.reduce((sum, sample) => sum + sample.x, 0) / elapsed;
    let y = samples.reduce((sum, sample) => sum + sample.y, 0) / elapsed;
    if (Math.hypot(x, y) < FLING_MIN_SPEED) return;
    let previous: number | null = null;
    let total = 0;
    const step = (now: number) => {
      const delta = previous === null ? 16 : Math.max(1, now - previous);
      previous = now;
      total += delta;
      host.wheel(at, x * delta, y * delta);
      const decay = FLING_DECAY_PER_FRAME ** (delta / 16);
      x *= decay;
      y *= decay;
      if (Math.hypot(x, y) < FLING_STOP_SPEED || total > FLING_MAX_MS) {
        stopFling = null;
        return;
      }
      stopFling = scheduler.frame(step);
    };
    stopFling = scheduler.frame(step);
  };

  const endTwo = (fingers: TwoFingers, time: number) => {
    if (fingers.phase === "pending" && time - fingers.startTime <= TWO_FINGER_TAP_MS) {
      secondaryClick(host.mode() === "direct" ? fingers.startMid : null);
    } else if (fingers.phase === "scroll") {
      fling(fingers.scrollAt, fingers.samples, time);
    }
    lastTap = null;
  };

  return {
    down(changed: readonly LiveViewTouch[], time: number) {
      endFling();
      for (const touch of changed) touches.set(touch.id, { x: touch.x, y: touch.y });
      if (!host.layout()) {
        state = { kind: "lifting" };
        return;
      }
      if (state.kind === "idle" && touches.size === 1) {
        const [entry] = touches;
        if (entry) startOne(entry[0], entry[1], time);
        return;
      }
      // Two fingers can land in one event.
      if (state.kind === "idle" && touches.size === 2) {
        const [first, second] = touches.keys();
        if (first !== undefined && second !== undefined) startTwo([first, second], time);
        return;
      }
      const current = state;
      if (
        current.kind === "one" &&
        touches.size === 2 &&
        (current.phase === "pending" || current.phase === "pointer")
      ) {
        current.cancelHold?.();
        const other = [...touches.keys()].find((id) => id !== current.id);
        if (other !== undefined) startTwo([current.id, other], time);
        return;
      }
      // A third finger, or a second one during a drag, is not a gesture of its own.
      if (current.kind === "two" && touches.size > 2) state = { kind: "lifting" };
    },
    move(all: readonly LiveViewTouch[], time: number) {
      for (const touch of all) if (touches.has(touch.id)) touches.set(touch.id, { x: touch.x, y: touch.y });
      if (state.kind === "one") {
        const point = touches.get(state.id);
        if (point) moveOne(state, point, time);
      } else if (state.kind === "two") {
        moveTwo(state, time);
      }
    },
    /** Returns how many fingers are still down. */
    up(changed: readonly LiveViewTouch[], time: number): number {
      for (const touch of changed) {
        if (touches.has(touch.id)) touches.set(touch.id, { x: touch.x, y: touch.y });
        if (state.kind === "one" && state.id === touch.id) {
          endOne(state, time);
          state = { kind: "lifting" };
        } else if (state.kind === "two" && state.ids.includes(touch.id)) {
          endTwo(state, time);
          state = { kind: "lifting" };
        }
        touches.delete(touch.id);
      }
      if (touches.size === 0) state = { kind: "idle" };
      return touches.size;
    },
    /** The system took the touches, or the view ended. A held button is released. */
    cancel() {
      if (state.kind === "one") {
        state.cancelHold?.();
        if (state.phase === "drag" || state.phase === "pointer-drag") host.press("up", host.pointer(), "left", 1);
      }
      endFling();
      touches.clear();
      state = { kind: "idle" };
      lastTap = null;
    },
  };
}
