export interface CursorPoint {
  x: number;
  y: number;
}

interface CursorSample extends CursorPoint {
  t: number;
}

export type CursorMove = readonly CursorSample[];

const SAMPLE_MS = 1000 / 120;
const TARGET_POINTS = 24;
const LONG_MOVE_POINTS = 900;
const PATH_STEPS = 256;
const SWOOP_ARC = 0.3;

const distance = (a: CursorPoint, b: CursorPoint) => Math.hypot(b.x - a.x, b.y - a.y);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function unit(a: CursorPoint, b: CursorPoint): CursorPoint {
  const d = distance(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

const naturalSide = (a: CursorPoint, b: CursorPoint) => (unit(a, b).x >= 0 ? -1 : 1);

const minJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t);

const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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
  samples[0] = { t: 0, ...from };
  samples[steps] = { t: durationMs, ...to };
  return samples;
}

export function planAgentCursorMove(from: CursorPoint, to: CursorPoint): CursorMove {
  const d = distance(from, to);
  if (d < 0.5) return [];
  const side = naturalSide(from, to);
  if (d > LONG_MOVE_POINTS) {
    const durationMs = Math.min(1100, Math.max(450, 350 + 0.35 * d));
    return glide(from, to, swoopPath(from, to, SWOOP_ARC * side), inOutCubic, durationMs);
  }
  const durationMs = Math.min(1400, Math.max(180, 50 + 150 * Math.log2(d / TARGET_POINTS + 1)));
  return glide(from, to, bowPath(from, to, 0.02 * side), minJerk, durationMs);
}

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
