import type { PlushCharacterId } from "@norbert_bodziony/bloub/plush";
import { clamp } from "../../utils";

type CrewPilePhase = "intro" | "live" | "exit";

export interface CrewFace {
  state: "idle" | "wide";
  happy: boolean;
}

export interface CrewMember {
  id: string;
  character: PlushCharacterId;
  size: number;
  cy: number;
  w: number;
  h: number;
  dropX: number;
  dropAt: number;
  spawnLift: number;
  dropVx: number;
  dropTilt: number;
  dropSpin: number;
  restTilt: number;
  reacts: boolean;
}

interface CrewBody {
  member: CrewMember;
  radius: number;
  mass: number;
  active: boolean;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  lastTilt: number;
  vx: number;
  vy: number;
  squash: number;
  squashSpeed: number;
  tilt: number;
  tiltSpeed: number;
  impact: number;
  breathePhase: number;
  pinned: boolean;
  asleep: boolean;
  stillFor: number;
  face: CrewFace;
}

const CHARACTERS = [
  { character: "yoshi", cy: 0.499, w: 0.647, h: 0.401 },
  { character: "nexo", cy: 0.501, w: 0.612, h: 0.608 },
  { character: "malu", cy: 0.5, w: 0.626, h: 0.622 },
  { character: "fred", cy: 0.499, w: 0.625, h: 0.596 },
  { character: "vita", cy: 0.502, w: 0.632, h: 0.595 },
  { character: "cloe", cy: 0.448, w: 0.603, h: 0.565 },
] as const satisfies readonly { character: PlushCharacterId; cy: number; w: number; h: number }[];

const CREW_SIZE = 168;
const CREW_RADIUS = (0.25 * CREW_SIZE * CHARACTERS.reduce((sum, body) => sum + body.w + body.h, 0)) / CHARACTERS.length;
const CREW_AREA = Math.PI * CREW_RADIUS * CREW_RADIUS;
const FILL = {
  share: 0.24,
  widthShare: 0.42,
  minSize: 120,
  maxSize: 480,
  density: 0.78,
  minCount: 8,
  maxCount: 64,
} as const;
const DEFAULT_ROOM = { width: 960, height: 640 } as const;
const FLOOR_INSET = 8;
const SPAWN_Y = -520;
const SPAWN_SPEED = 1400;
const GRAVITY = 5200;
const STEP = 1 / 240;
const ITERATIONS = 4;
const FLOOR_BOUNCE = 0.32;
const BODY_BOUNCE = 0.22;
const BOUNCE_SPEED = 90;
const SLOP = 0.5;
const SLEEP = { speed: 24, spring: 0.6, after: 0.3, wake: 80, reach: 3 } as const;
const REACTING = { share: 0.25, min: 4 } as const;
const FRICTION = 0.5;
const AIR_DRAG = 0.4;
const SQUASH = { stiffness: 1100, damping: 21, kick: 0.0011, min: -0.16, max: 0.28 } as const;
const TILT = { stiffness: 420, damping: 12, kick: 0.006, max: 0.3 } as const;
const BREATHE = { period: 3.2, amount: 0.012 } as const;
const LANDING_SPEED = 500;
const SETTLE = { after: 0.55, speed: 28, limit: 3 } as const;
const RUSH_RATE = 2.2;
const DROP_SAMPLES = 24;
const EXIT = { stagger: 0.05, spread: 0.8, after: 0.7 } as const;
const RUSH_TIME = 0.8;
const STARTLE_SPEED = 700;
const FILM_FRAME = 1 / 60;
const FILM_LIMIT = 30;

export interface CrewRoom {
  width: number;
  height: number;
}

export interface CrewPit {
  width: number;
  height: number;
  floor: number;
  unit: number;
}

function pitFor(room: CrewRoom, unit?: number): CrewPit {
  const shown = clamp(
    Math.min(Math.sqrt(room.width * room.height) * FILL.share, room.width * FILL.widthShare),
    FILL.minSize,
    FILL.maxSize,
  );
  const scale = unit ?? shown / CREW_SIZE;
  const width = Math.max(room.width / scale, CREW_SIZE);
  const height = Math.max(room.height / scale, CREW_SIZE);
  return { width, height, floor: height - FLOOR_INSET, unit: scale };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  return items
    .map((item) => ({ item, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function createCrew(random: () => number, pit: CrewPit): CrewMember[] {
  const count = clamp(Math.round((FILL.density * pit.width * pit.floor) / CREW_AREA), FILL.minCount, FILL.maxCount);
  const dropWindow = 0.12 + count * 0.05;
  const crew = Array.from({ length: count }, (_, index): CrewMember => {
    const body = CHARACTERS[Math.floor(random() * CHARACTERS.length)] ?? CHARACTERS[0];
    const size = Math.round(CREW_SIZE * between(random, 0.86, 1.12));
    const side = Math.max(0, pit.width / 2 - size * 0.42);
    return {
      id: `${body.character}-${index}`,
      character: body.character,
      size,
      cy: body.cy,
      w: body.w,
      h: body.h,
      dropX: between(random, -side, side),
      dropAt: ((index + random() * 0.8) / count) * dropWindow,
      spawnLift: random() * 220,
      dropVx: between(random, -280, 280),
      dropTilt: between(random, -0.5, 0.5),
      dropSpin: between(random, -7, 7),
      restTilt: between(random, -0.14, 0.14),
      reacts: false,
    };
  });
  crew.sort((a, b) => a.dropAt - b.dropAt);
  const reacting = Math.max(REACTING.min, Math.round(count * REACTING.share));
  for (const index of shuffle(Array.from(crew.keys()), random).slice(0, reacting)) {
    const member = crew[index];
    if (member) member.reacts = true;
  }
  return crew;
}

function createBody(member: CrewMember, index: number, reduced: boolean, pit: CrewPit): CrewBody {
  const radius = 0.25 * (member.w + member.h) * member.size;
  const x = pit.width / 2 + member.dropX;
  const y = SPAWN_Y - member.spawnLift;
  return {
    member,
    radius,
    mass: radius * radius,
    active: false,
    x,
    y,
    lastX: x,
    lastY: y,
    lastTilt: member.dropTilt,
    vx: member.dropVx,
    vy: SPAWN_SPEED,
    squash: 0,
    squashSpeed: 0,
    tilt: member.dropTilt,
    tiltSpeed: member.dropSpin,
    impact: 0,
    breathePhase: index * 0.9,
    pinned: false,
    asleep: false,
    stillFor: 0,
    face: { state: reduced || !member.reacts ? "idle" : "wide", happy: false },
  };
}

function collideFloor(body: CrewBody, pit: CrewPit): void {
  const depth = body.y + body.radius - pit.floor;
  if (depth <= 0) return;
  body.y -= depth;
  if (body.vy <= 0) return;
  body.impact = Math.max(body.impact, body.vy);
  body.vy = body.vy > BOUNCE_SPEED ? -FLOOR_BOUNCE * body.vy : 0;
  const tangent = body.vx;
  body.vx -= FRICTION * tangent;
  body.tiltSpeed += tangent * TILT.kick * 0.5;
}

function collideWalls(body: CrewBody, pit: CrewPit): void {
  if (body.x < body.radius) {
    body.x = body.radius;
    body.vx = Math.abs(body.vx) * FLOOR_BOUNCE;
  } else if (body.x > pit.width - body.radius) {
    body.x = pit.width - body.radius;
    body.vx = -Math.abs(body.vx) * FLOOR_BOUNCE;
  }
}

function wake(body: CrewBody): void {
  body.asleep = false;
  body.stillFor = 0;
}

function motionSquared(body: CrewBody): number {
  const dx = body.x - body.lastX;
  const dy = body.y - body.lastY;
  return (dx * dx + dy * dy) / (STEP * STEP);
}

function collidePair(a: CrewBody, b: CrewBody): void {
  if (a.asleep && b.asleep) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = a.radius + b.radius + SLEEP.reach;
  if (Math.abs(dx) > reach || Math.abs(dy) > reach) return;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= reach * reach) return;
  const wakeSpeed = SLEEP.wake * SLEEP.wake;
  if (a.asleep && motionSquared(b) > wakeSpeed) wake(a);
  else if (b.asleep && motionSquared(a) > wakeSpeed) wake(b);
  const distance = Math.sqrt(distanceSquared) || 0.001;
  const overlap = a.radius + b.radius - distance;
  if (overlap <= 0) return;
  const nx = dx / distance;
  const ny = dy / distance;
  const inverseA = a.pinned || a.asleep ? 0 : 1 / a.mass;
  const inverseB = b.pinned || b.asleep ? 0 : 1 / b.mass;
  if (inverseA + inverseB === 0) return;
  const share = inverseA / (inverseA + inverseB);
  const push = Math.max(0, overlap - SLOP);
  a.x -= nx * push * share;
  a.y -= ny * push * share;
  b.x += nx * push * (1 - share);
  b.y += ny * push * (1 - share);
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const normal = rvx * nx + rvy * ny;
  if (normal >= 0) return;
  a.impact = Math.max(a.impact, -normal * share);
  b.impact = Math.max(b.impact, -normal * (1 - share));
  const bounce = -normal > BOUNCE_SPEED ? BODY_BOUNCE : 0;
  const impulse = (-(1 + bounce) * normal) / (inverseA + inverseB);
  a.vx -= impulse * nx * inverseA;
  a.vy -= impulse * ny * inverseA;
  b.vx += impulse * nx * inverseB;
  b.vy += impulse * ny * inverseB;
  const tangent = rvx * -ny + rvy * nx;
  a.vx += FRICTION * tangent * -ny * share;
  a.vy += FRICTION * tangent * nx * share;
  b.vx -= FRICTION * tangent * -ny * (1 - share);
  b.vy -= FRICTION * tangent * nx * (1 - share);
  a.tiltSpeed -= tangent * TILT.kick * share;
  b.tiltSpeed += tangent * TILT.kick * (1 - share);
}

function step(bodies: readonly CrewBody[], pit: CrewPit, collide: boolean): void {
  for (const body of bodies) {
    body.lastX = body.x;
    body.lastY = body.y;
    body.lastTilt = body.tilt;
    if (!body.active || body.pinned) continue;
    body.impact = 0;
    if (body.asleep) continue;
    body.vy += GRAVITY * STEP;
    body.vx *= 1 - AIR_DRAG * STEP;
    body.vy *= 1 - AIR_DRAG * STEP;
    body.x += body.vx * STEP;
    body.y += body.vy * STEP;
  }
  if (collide) {
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      for (const body of bodies) {
        if (body.active && !body.pinned && !body.asleep) {
          collideFloor(body, pit);
          collideWalls(body, pit);
        }
      }
      for (let a = 0; a < bodies.length; a++) {
        const first = bodies[a];
        if (!first?.active) continue;
        for (let b = a + 1; b < bodies.length; b++) {
          const second = bodies[b];
          if (second?.active) collidePair(first, second);
        }
      }
    }
  }
  for (const body of bodies) {
    if (!body.active || body.asleep) continue;
    body.squashSpeed += body.impact * SQUASH.kick;
    body.squashSpeed += (-SQUASH.stiffness * body.squash - SQUASH.damping * body.squashSpeed) * STEP;
    body.squash = clamp(body.squash + body.squashSpeed * STEP, SQUASH.min, SQUASH.max);
    body.tiltSpeed += (-TILT.stiffness * (body.tilt - body.member.restTilt) - TILT.damping * body.tiltSpeed) * STEP;
    body.tilt = clamp(body.tilt + body.tiltSpeed * STEP, -TILT.max, TILT.max);
    if (collide && !body.pinned) {
      const fall = (body.y - body.lastY) / STEP;
      if (body.vy > 0) body.vy = Math.min(body.vy, Math.max(0, fall));
      settle(body);
    }
  }
}

function settle(body: CrewBody): void {
  const still =
    motionSquared(body) < SLEEP.speed * SLEEP.speed &&
    Math.abs(body.squashSpeed) < SLEEP.spring &&
    Math.abs(body.tilt - body.lastTilt) < SLEEP.spring * STEP;
  body.stillFor = still ? body.stillFor + STEP : 0;
  if (body.stillFor < SLEEP.after) return;
  body.asleep = true;
  body.vx = 0;
  body.vy = 0;
  body.squashSpeed = 0;
  body.tiltSpeed = 0;
}

function setFace(body: CrewBody, change: Partial<CrewFace>): void {
  body.face = { ...body.face, ...change };
}

interface CrewPose {
  x: number;
  y: number;
  tilt: number;
  scale: number;
  squashX: number;
  squashY: number;
}

function plushTransform(pose: CrewPose): string {
  return `translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0) rotate(${pose.tilt.toFixed(4)}rad) scale(${pose.scale.toFixed(4)})`;
}

function squashTransform(pose: CrewPose): string {
  return `scale(${pose.squashX.toFixed(4)}, ${pose.squashY.toFixed(4)})`;
}

interface CrewFaceCue {
  at: number;
  index: number;
  face: CrewFace;
}

interface CrewReel {
  length: number;
  plushes: Keyframe[][];
  squashes: Keyframe[][];
  faces: CrewFaceCue[];
}

export interface CrewFilm {
  faces: CrewFace[];
  intro: CrewReel;
  exit: CrewReel;
  rest: { plush: string; squash: string }[];
  breathe: { from: number; period: number; amount: number; phases: number[] };
  rush: { rate: number; time: number };
}

class TrackRecorder {
  private readonly frames: { at: number; value: string }[] = [];
  private held: { at: number; value: string } | undefined;

  add(at: number, value: string): void {
    if (this.frames.at(-1)?.value === value) {
      this.held = { at, value };
      return;
    }
    if (this.held) this.frames.push(this.held);
    this.held = undefined;
    this.frames.push({ at, value });
  }

  keyframes(length: number): Keyframe[] {
    const last = this.frames.at(-1);
    const frames = last && last.at < length ? [...this.frames, { at: length, value: last.value }] : this.frames;
    return frames.map((frame) => ({ offset: length > 0 ? Math.min(1, frame.at / length) : 1, transform: frame.value }));
  }
}

class ReelRecorder {
  private readonly plushes: TrackRecorder[];
  private readonly squashes: TrackRecorder[];
  private readonly faces: CrewFaceCue[] = [];
  private readonly shown: CrewFace[];

  constructor(private readonly bodies: readonly CrewBody[]) {
    this.plushes = bodies.map(() => new TrackRecorder());
    this.squashes = bodies.map(() => new TrackRecorder());
    this.shown = bodies.map((body) => body.face);
  }

  add(at: number, poses: readonly CrewPose[]): void {
    poses.forEach((pose, index) => {
      this.plushes[index]?.add(at, plushTransform(pose));
      this.squashes[index]?.add(at, squashTransform(pose));
    });
    this.cue(at);
  }

  cue(at: number): void {
    this.bodies.forEach((body, index) => {
      if (body.face === this.shown[index]) return;
      this.shown[index] = body.face;
      this.faces.push({ at, index, face: body.face });
    });
  }

  reel(length: number): CrewReel {
    return {
      length,
      plushes: this.plushes.map((track) => track.keyframes(length)),
      squashes: this.squashes.map((track) => track.keyframes(length)),
      faces: this.faces,
    };
  }
}

export class CrewPile {
  crew: readonly CrewMember[] = [];
  bodies: readonly CrewBody[] = [];
  readonly reduced: boolean;
  pit: CrewPit;
  private phase: CrewPilePhase;
  private readonly seed: number;
  private room: CrewRoom;
  private recorded: CrewFilm | undefined;
  private time = 0;
  private carry = 0;
  private exitStartedAt = -1;
  private events: { at: number; run: () => void }[] = [];

  constructor(seed: number, reduced: boolean, room?: CrewRoom) {
    this.seed = seed;
    this.reduced = reduced;
    this.room = room ?? DEFAULT_ROOM;
    this.pit = pitFor(this.room);
    this.phase = reduced ? "live" : "intro";
    this.build();
  }

  private build(): void {
    this.time = 0;
    this.carry = 0;
    this.events = [];
    this.crew = createCrew(createRandom(this.seed), this.pit);
    this.bodies = this.crew.map((member, index) => createBody(member, index, this.reduced, this.pit));
    if (this.reduced) {
      const end = this.lastDropAt + 1.5;
      while (this.time < end) this.advance(STEP * 60);
      for (const body of this.bodies) {
        body.squash = 0;
        body.squashSpeed = 0;
        body.tilt = 0;
        body.tiltSpeed = 0;
        body.lastX = body.x;
        body.lastY = body.y;
        body.lastTilt = 0;
      }
      this.events = [];
      for (const body of this.bodies) setFace(body, { state: "idle" });
    }
  }

  fit(room: CrewRoom): boolean {
    if (this.recorded || room.width <= 0 || room.height <= 0) return false;
    if (Math.abs(room.width - this.room.width) < 1 && Math.abs(room.height - this.room.height) < 1) return false;
    this.room = room;
    this.pit = pitFor(room);
    this.build();
    return true;
  }

  film(): CrewFilm {
    if (this.recorded) return this.recorded;
    const faces = this.bodies.map((body) => body.face);
    const intro = new ReelRecorder(this.bodies);
    if (!this.reduced) {
      intro.add(0, this.poses());
      while (this.phase === "intro" && this.time < FILM_LIMIT) {
        this.advance(FILM_FRAME);
        if (this.settled()) this.phase = "live";
        intro.add(this.time, this.poses());
      }
    }
    const introLength = this.time;
    const rest = this.poses().map((pose) => ({ plush: plushTransform(pose), squash: squashTransform(pose) }));
    const pending = [...this.events].sort((a, b) => a.at - b.at);
    this.events = [];
    for (const event of pending) {
      event.run();
      intro.cue(event.at);
    }
    const exit = new ReelRecorder(this.bodies);
    const exitFrom = this.time;
    if (!this.reduced) {
      this.phase = "live";
      this.startExit();
      exit.add(0, this.poses());
      while (!this.finished) {
        this.advance(FILM_FRAME);
        exit.add(this.time - exitFrom, this.poses());
      }
    }
    this.recorded = {
      faces,
      intro: intro.reel(introLength),
      exit: exit.reel(this.time - exitFrom),
      rest,
      breathe: {
        from: this.reduced ? 0 : Math.min(this.lastDropAt, introLength),
        period: BREATHE.period,
        amount: BREATHE.amount,
        phases: this.bodies.map((body) => body.breathePhase),
      },
      rush: { rate: RUSH_RATE, time: RUSH_TIME },
    };
    return this.recorded;
  }

  get startFaces(): readonly CrewFace[] {
    return this.recorded?.faces ?? this.bodies.map((body) => body.face);
  }

  private get lastDropAt(): number {
    return this.crew.at(-1)?.dropAt ?? 0;
  }

  private spacing(step: number, total: number, count = this.crew.length): number {
    return Math.min(step, total / Math.max(1, count));
  }

  private get exitLength(): number {
    return (this.crew.length - 1) * this.spacing(EXIT.stagger, EXIT.spread) + EXIT.after;
  }

  private get finished(): boolean {
    return this.phase === "exit" && this.time > this.exitStartedAt + this.exitLength;
  }

  private poses(): CrewPose[] {
    const blend = this.carry / STEP;
    return this.bodies.map((body) => {
      const { member } = body;
      const x = body.lastX + (body.x - body.lastX) * blend;
      const y = body.lastY + (body.y - body.lastY) * blend;
      return {
        x: x - member.size / 2,
        y: y - member.size * member.cy,
        tilt: body.lastTilt + (body.tilt - body.lastTilt) * blend,
        scale: 1,
        squashX: 1 + body.squash * 0.6,
        squashY: 1 - body.squash,
      };
    });
  }

  private schedule(delay: number, run: () => void): void {
    this.events.push({ at: this.time + delay, run });
  }

  private startExit(): void {
    this.phase = "exit";
    this.exitStartedAt = this.time;
    const stagger = this.spacing(EXIT.stagger, EXIT.spread);
    const reach = Math.max(1, this.pit.width / 620);
    const order = [...this.bodies].sort((a, b) => a.y - b.y);
    this.bodies.forEach((body, index) => {
      wake(body);
      if (body.member.reacts) setFace(body, { happy: true });
      body.pinned = true;
      body.vx = 0;
      body.vy = 0;
      this.schedule(order.indexOf(body) * stagger, () => {
        const side = Math.sign(body.x - this.pit.width / 2) || (index % 2 ? 1 : -1);
        body.active = true;
        body.vx = side * (720 + ((index * 137) % 5) * 110) * reach;
        body.vy = -(1500 + ((index * 61) % 4) * 160);
        body.pinned = false;
        body.squashSpeed -= 6;
        body.tiltSpeed += side * 9;
      });
    });
  }

  private advance(seconds: number): void {
    const collide = this.phase !== "exit";
    let remaining = this.carry + seconds;
    while (remaining >= STEP) {
      remaining -= STEP;
      this.time += STEP;
      for (const body of this.bodies) {
        if (!body.active && this.phase !== "exit" && this.time >= body.member.dropAt) {
          body.active = true;
          this.fillHole(body);
          body.lastX = body.x;
          body.lastY = body.y;
          body.lastTilt = body.tilt;
        }
      }
      step(this.bodies, this.pit, collide);
      for (const body of this.bodies) {
        if (this.phase !== "intro" || body.pinned || !body.member.reacts || body.impact < LANDING_SPEED) continue;
        if (body.face.state === "wide") {
          this.schedule(0.22, () => setFace(body, { state: "idle" }));
        } else if (body.impact > STARTLE_SPEED) {
          setFace(body, { state: "wide" });
          this.schedule(0.35, () => setFace(body, { state: "idle" }));
        }
      }
      for (let i = this.events.length - 1; i >= 0; i--) {
        const event = this.events[i];
        if (event && event.at <= this.time) {
          this.events.splice(i, 1);
          event.run();
        }
      }
    }
    this.carry = remaining;
  }

  private restAt(falling: CrewBody, x: number): number {
    let rest = this.pit.floor - falling.radius;
    for (const body of this.bodies) {
      if (body === falling || !body.active) continue;
      const reach = body.radius + falling.radius;
      const dx = Math.abs(body.x - x);
      if (dx < reach) rest = Math.min(rest, body.y - Math.sqrt(reach * reach - dx * dx));
    }
    return rest;
  }

  private fillHole(falling: CrewBody): void {
    if (this.restAt(falling, falling.x) - falling.radius < 0) falling.x = this.lowestPoint(falling);
  }

  private lowestPoint(falling: CrewBody): number {
    let best = falling.x;
    let bestRest = Number.NEGATIVE_INFINITY;
    const left = falling.radius;
    const right = this.pit.width - falling.radius;
    for (let sample = 0; sample <= DROP_SAMPLES; sample++) {
      const x = left + ((right - left) * sample) / DROP_SAMPLES;
      const rest = this.restAt(falling, x);
      const score = rest - Math.abs(x - falling.x) * 0.1;
      if (score > bestRest) {
        bestRest = score;
        best = x;
      }
    }
    return best;
  }

  private settled(): boolean {
    if (this.time < this.lastDropAt + SETTLE.after) return false;
    if (this.time > this.lastDropAt + SETTLE.limit) return true;
    return this.bodies.every((body) => Math.hypot(body.vx, body.vy) < SETTLE.speed);
  }
}

export function randomCrewSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
}
