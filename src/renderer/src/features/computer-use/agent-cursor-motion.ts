/**
 * How the agent cursor travels from one point to the next.
 *
 * This is the `adaptive` motion style of cua-driver 0.34.0, ported from
 * `libs/cua-driver/rust/crates/cursor-overlay/src/trajectory.rs` (MIT, trycua/cua). OpenBot starts
 * the driver with `--no-overlay` and draws the cursor itself, so the driver's own motion styles
 * never reach the screen; this gives OpenBot's cursor the motion the driver gives its own.
 *
 * `adaptive` picks a move by its distance and its target: a careful approach for a target under
 * 16 points, a wide swoop for a move over 900 points, and a Fitts min-jerk glide otherwise. The tap
 * reads a point and no element, so every target is the driver's own default for a pixel action, a
 * 24-point box, and the careful approach is never picked. It is left out rather than kept unused.
 *
 * A move is planned once, as samples, and played back by time. The units are the overlay's own
 * pixels, which are points on macOS, the unit the driver's thresholds are in.
 */

export interface CursorPoint {
  x: number;
  y: number;
}

/** One planned position, `t` milliseconds after the move starts. */
export interface CursorSample extends CursorPoint {
  t: number;
}

/** The samples of one move, the first on the start point and the last on the target. */
export type CursorMove = readonly CursorSample[];

/** The sample period, 120 Hz, as the driver plans. */
const SAMPLE_MS = 1000 / 120;
/** The target the driver assumes for an action that names a point and no element. */
const TARGET_POINTS = 24;
/** A move longer than this swoops. */
const LONG_MOVE_POINTS = 900;
/** Arc-length table resolution of one path. */
const PATH_STEPS = 256;
/**
 * How far the swoop bends, as a share of its length. The driver draws it from 0.25 to 0.35 with a
 * seeded random number; the middle keeps every move the same shape for the same two points.
 */
const SWOOP_ARC = 0.3;

const distance = (a: CursorPoint, b: CursorPoint) => Math.hypot(b.x - a.x, b.y - a.y);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function unit(a: CursorPoint, b: CursorPoint): CursorPoint {
  const d = distance(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** Which side of the chord a path bends to: upward, for a move across the screen. */
const naturalSide = (a: CursorPoint, b: CursorPoint) => (unit(a, b).x >= 0 ? -1 : 1);

const minJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A curve sampled by arc length, so that an easing profile sets the speed along it rather than
 * the speed of its parameter. The profiles here stay inside 0 to 1, so the ends are not extended.
 */
function arcLengthPath(curve: (u: number) => CursorPoint): (fraction: number) => CursorPoint {
  const us = [0];
  const lengths = [0];
  let previous = curve(0);
  let total = 0;
  for (let step = 1; step <= PATH_STEPS; step += 1) {
    const u = step / PATH_STEPS;
    const point = curve(u);
    total += distance(previous, point);
    us.push(u);
    lengths.push(total);
    previous = point;
  }
  return (fraction) => {
    if (total < 1e-9) return curve(Math.min(1, Math.max(0, fraction)));
    const target = fraction * total;
    let lo = 0;
    let hi = lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((lengths[mid] ?? 0) < target) lo = mid;
      else hi = mid;
    }
    const from = lengths[lo] ?? 0;
    const span = (lengths[hi] ?? 0) - from || 1;
    return curve(lerp(us[lo] ?? 0, us[hi] ?? 1, (target - from) / span));
  };
}

/** The driver's gentle one-sided bend (`bow_path`). */
function bowPath(a: CursorPoint, b: CursorPoint, amount: number) {
  const d = distance(a, b);
  const direction = unit(a, b);
  const control = {
    x: lerp(a.x, b.x, 0.5) - direction.y * amount * d,
    y: lerp(a.y, b.y, 0.5) + direction.x * amount * d,
  };
  return arcLengthPath((u) => {
    const v = 1 - u;
    return {
      x: v * v * a.x + 2 * v * u * control.x + u * u * b.x,
      y: v * v * a.y + 2 * v * u * control.y + u * u * b.y,
    };
  });
}

/** The driver's arc (`cua_path`), with both handles at 0.3 and a flow of 0.2. */
function swoopPath(a: CursorPoint, b: CursorPoint, arc: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / length;
  const py = dx / length;
  const deflection = length * arc;
  const flow = (0.2 + 1) / 2;
  const nearDeflection = deflection * (1 - 0.5 * flow);
  const farDeflection = deflection * (1 - 0.5 * (1 - flow));
  const c1 = { x: a.x + dx * 0.3 + px * nearDeflection, y: a.y + dy * 0.3 + py * nearDeflection };
  const c2 = { x: b.x - dx * 0.3 + px * farDeflection, y: b.y - dy * 0.3 + py * farDeflection };
  return arcLengthPath((u) => {
    const v = 1 - u;
    const k0 = v * v * v;
    const k1 = 3 * v * v * u;
    const k2 = 3 * v * u * u;
    const k3 = u * u * u;
    return {
      x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x,
      y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y,
    };
  });
}

function glide(
  from: CursorPoint,
  to: CursorPoint,
  path: (fraction: number) => CursorPoint,
  profile: (t: number) => number,
  durationMs: number,
): CursorMove {
  const steps = Math.max(2, Math.ceil(durationMs / SAMPLE_MS));
  const samples: CursorSample[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const tau = step / steps;
    samples.push({ t: tau * durationMs, ...path(profile(tau)) });
  }
  // The curve ends on both points already; this keeps rounding from leaving the cursor a hair off.
  samples[0] = { t: 0, ...from };
  samples[steps] = { t: durationMs, ...to };
  return samples;
}

/**
 * Plans one move of the agent cursor from where it is to where the agent aimed.
 *
 * A move shorter than half a pixel has nothing to show and plans no samples, so the caller places
 * the cursor without playing anything.
 */
export function planAgentCursorMove(from: CursorPoint, to: CursorPoint): CursorMove {
  const d = distance(from, to);
  if (d < 0.5) return [];
  const side = naturalSide(from, to);
  if (d > LONG_MOVE_POINTS) {
    const durationMs = Math.min(1100, Math.max(450, 350 + 0.35 * d));
    return glide(from, to, swoopPath(from, to, SWOOP_ARC * side), inOutCubic, durationMs);
  }
  // Fitts' law in its Shannon form, as the driver times a min-jerk glide.
  const durationMs = Math.min(1400, Math.max(180, 50 + 150 * Math.log2(d / TARGET_POINTS + 1)));
  return glide(from, to, bowPath(from, to, 0.02 * side), minJerk, durationMs);
}

/** Where a planned move holds the cursor `elapsedMs` after it starts. */
export function agentCursorPointAt(move: CursorMove, elapsedMs: number): CursorPoint | null {
  const first = move[0];
  const last = move[move.length - 1];
  if (!first || !last) return null;
  if (elapsedMs <= first.t) return { x: first.x, y: first.y };
  if (elapsedMs >= last.t) return { x: last.x, y: last.y };
  let index = 1;
  while ((move[index]?.t ?? Number.POSITIVE_INFINITY) <= elapsedMs) index += 1;
  const a = move[index - 1] ?? first;
  const b = move[index] ?? last;
  const f = (elapsedMs - a.t) / (b.t - a.t || 1);
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}
