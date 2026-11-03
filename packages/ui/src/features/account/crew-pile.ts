import type { PlushCharacterId } from "@norbert_bodziony/bloub/plush";
import { clamp } from "../../utils";

/*
 * The crew pile of the app loading screen: each run, a different crew of felt plushes rains into the
 * screen until it is full. Each plush is a random character and drops at a random point. When the
 * app is ready, each plush hops out of the screen in its own direction.
 *
 * This is a small fixed-step simulation: circles on an invisible floor between two walls, with
 * friction, so each bounce is a reaction to a contact. The pit has the shape of the screen, and its
 * plushes are larger on a larger screen, so about the same crew fills each screen. Each plush also has a squash spring, which
 * its impacts kick, and a tilt spring. A plush that stays still sleeps until a fast contact wakes it,
 * so a resting pile does not shake.
 *
 * Nothing can change the pile while it moves, so the pile records its whole motion once, as a film:
 * the rain until the pile is still, and the hop out from the still pile. The view plays the film as
 * Web Animations, which the compositor runs also while the app mounts its views on the main thread.
 * Only some plushes change their face, because each face change redraws a plush. It has no DOM and
 * no clock of its own.
 */

type CrewPilePhase = "intro" | "live" | "exit";

/** What a plush shows. `wide` is a fall or a startle; `happy` is the exit. */
export interface CrewFace {
  state: "idle" | "wide";
  happy: boolean;
}

export interface CrewMember {
  id: string;
  /** A bloub character. */
  character: PlushCharacterId;
  /** The size of the plush's square box, in pixels. */
  size: number;
  /** The felt body inside the box, as fractions of the box: centre y, width and height. */
  cy: number;
  w: number;
  h: number;
  /** Where it drops, in pixels from the centre of the pit, and when, in seconds. */
  dropX: number;
  dropAt: number;
  /** How it leaves the spawn line: height above it, sideways speed, angle and spin. */
  spawnLift: number;
  dropVx: number;
  dropTilt: number;
  dropSpin: number;
  /** The angle that its tilt spring goes back to, so the pile is not all upright. */
  restTilt: number;
  /** It changes its face when it falls, lands, is hit hard and hops out. */
  reacts: boolean;
}

interface CrewBody {
  member: CrewMember;
  radius: number;
  mass: number;
  active: boolean;
  x: number;
  y: number;
  /** The position and the angle at the start of the last step, so a frame can draw between steps. */
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
  /** Held still: the crew wait for their hops. */
  pinned: boolean;
  /** It stays still and does not move. A plush that pushes it fast enough wakes it. */
  asleep: boolean;
  /** How long it has been almost still, in simulation seconds. */
  stillFor: number;
  face: CrewFace;
}

/** The felt body of each character inside its box, measured from the images. */
const CHARACTERS = [
  { character: "yoshi", cy: 0.499, w: 0.647, h: 0.401 },
  { character: "nexo", cy: 0.501, w: 0.612, h: 0.608 },
  { character: "malu", cy: 0.5, w: 0.626, h: 0.622 },
  { character: "fred", cy: 0.499, w: 0.625, h: 0.596 },
  { character: "vita", cy: 0.502, w: 0.632, h: 0.595 },
  { character: "cloe", cy: 0.448, w: 0.603, h: 0.565 },
] as const satisfies readonly { character: PlushCharacterId; cy: number; w: number; h: number }[];

/** The size of a crew plush, in simulation pixels. The pit scales them to the screen. */
const CREW_SIZE = 168;
/** The mean radius and area of a crew plush, from the felt bodies of the characters. */
const CREW_RADIUS = (0.25 * CREW_SIZE * CHARACTERS.reduce((sum, body) => sum + body.w + body.h, 0)) / CHARACTERS.length;
const CREW_AREA = Math.PI * CREW_RADIUS * CREW_RADIUS;
/**
 * How the crew fill a screen. A plush shows at `share` of the square root of the screen area, in
 * screen pixels, and at most at `widthShare` of the screen width. The crew cover `density` of the
 * pit up to its top, so the screen shows no empty band.
 */
const FILL = {
  share: 0.24,
  widthShare: 0.42,
  minSize: 120,
  maxSize: 480,
  density: 0.78,
  minCount: 8,
  maxCount: 64,
} as const;
/** The screen of a pile that has no window yet. A screen fits the pile to its size before it moves. */
const DEFAULT_ROOM = { width: 960, height: 640 } as const;
/** The floor is this far above the bottom of the pit, in simulation pixels. */
const FLOOR_INSET = 8;
const SPAWN_Y = -520;
const SPAWN_SPEED = 1400;
const GRAVITY = 5200;
const STEP = 1 / 240;
const ITERATIONS = 4;
const FLOOR_BOUNCE = 0.32;
const BODY_BOUNCE = 0.22;
/** A contact slower than this, in pixels a second, does not bounce, so a resting pile stays still. */
const BOUNCE_SPEED = 90;
/** Two plushes can overlap by this much, in simulation pixels, before the contact pushes them apart. */
const SLOP = 0.5;
/**
 * A plush sleeps after `after` seconds slower than `speed`, while its springs move slower than
 * `spring`. A plush faster than `wake` wakes the sleeping plushes that it touches, or that are
 * nearer than `reach`.
 */
const SLEEP = { speed: 24, spring: 0.6, after: 0.3, wake: 80, reach: 3 } as const;
/** About this share of the crew change their face, and at least `min` of them. */
const REACTING = { share: 0.25, min: 4 } as const;
const FRICTION = 0.5;
const AIR_DRAG = 0.4;
const SQUASH = { stiffness: 1100, damping: 21, kick: 0.0011, min: -0.16, max: 0.28 } as const;
const TILT = { stiffness: 420, damping: 12, kick: 0.006, max: 0.3 } as const;
const BREATHE = { period: 3.2, amount: 0.012 } as const;
/** An impact faster than this, in pixels a second, is a landing. */
const LANDING_SPEED = 500;
/**
 * The pile is still when no plush moves faster than `speed`, from `after` seconds after the last
 * drop, and at the latest `limit` seconds after it.
 */
const SETTLE = { after: 0.55, speed: 28, limit: 3 } as const;
/** The simulation speed for the rest of the intro when the app is ready before the intro ends. */
const RUSH_RATE = 2.2;
/** The number of points across the pit where a plush that fills a hole at the top can drop. */
const DROP_SAMPLES = 24;
/**
 * The exit: the time between two hops, with at most `spread` for all of the crew, and the time
 * after the last hop. The screen fades while the crew hop, so the hops fill the fade.
 */
const EXIT = { stagger: 0.05, spread: 0.8, after: 0.7 } as const;
/** When the app is ready during the intro, the rest of the intro takes about this time. */
const RUSH_TIME = 0.8;
/** An impact this fast startles a plush of the pile that reacts, after it landed. */
const STARTLE_SPEED = 700;
/** The film keeps one pose in each frame of this length. The animations interpolate between them. */
const FILM_FRAME = 1 / 60;
/** The longest rain that the film records, in seconds. The pile is still long before. */
const FILM_LIMIT = 30;

/** The size of a loading screen, in screen pixels. */
export interface CrewRoom {
  width: number;
  height: number;
}

/** The pit, in simulation pixels, and `unit`, the screen pixels of one simulation pixel. */
export interface CrewPit {
  width: number;
  height: number;
  floor: number;
  unit: number;
}

/** The pit for a room. A pile that already moves keeps its `unit`, so its plushes keep their size. */
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

/** A small seeded generator (mulberry32), so one seed always makes the same pile. */
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

/**
 * A new crew for a pit: how many, who, how large, and where and how each one falls. Each plush is a
 * random character and drops at a random point across the pit.
 */
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

/** The two side walls of the pit: a plush that falls against one bounces back into the pile. */
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

/**
 * The squared speed at which a plush really moves in this step. A plush low in a tall pile keeps some
 * velocity that the contacts take back each step, so its velocity is not its motion.
 */
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
  // A plush that moves fast wakes a sleeping plush near it, also one that it stops supporting.
  const wakeSpeed = SLEEP.wake * SLEEP.wake;
  if (a.asleep && motionSquared(b) > wakeSpeed) wake(a);
  else if (b.asleep && motionSquared(a) > wakeSpeed) wake(b);
  const distance = Math.sqrt(distanceSquared) || 0.001;
  const overlap = a.radius + b.radius - distance;
  if (overlap <= 0) return;
  const nx = dx / distance;
  const ny = dy / distance;
  // A pinned plush does not give way. A sleeping plush also stays still.
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

/** One fixed step. `collide` is off during the exit, so the crew fly out freely. */
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
      // The contacts of a tall pile hold a plush up but leave its fall speed: it falls only as fast as it moves.
      const fall = (body.y - body.lastY) / STEP;
      if (body.vy > 0) body.vy = Math.min(body.vy, Math.max(0, fall));
      settle(body);
    }
  }
}

/** A plush that stays almost still for a time sleeps, so the pile under it does not shake. */
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

/** Where a plush is drawn: its box's top left corner, its angle, its scale and its squash. */
interface CrewPose {
  x: number;
  y: number;
  tilt: number;
  scale: number;
  squashX: number;
  squashY: number;
}

/** The transform of a plush's box, and of the squash inside it. */
function plushTransform(pose: CrewPose): string {
  return `translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0) rotate(${pose.tilt.toFixed(4)}rad) scale(${pose.scale.toFixed(4)})`;
}

function squashTransform(pose: CrewPose): string {
  return `scale(${pose.squashX.toFixed(4)}, ${pose.squashY.toFixed(4)})`;
}

/** A face change of plush `index`, at `at` seconds into its reel. */
interface CrewFaceCue {
  at: number;
  index: number;
  face: CrewFace;
}

/** One part of the film: the keyframes of each plush and of its squash, and the face changes. */
interface CrewReel {
  /** In seconds. */
  length: number;
  plushes: Keyframe[][];
  squashes: Keyframe[][];
  /** In time order. A cue can come after the end of the reel: the plushes are still, and only faces change. */
  faces: CrewFaceCue[];
}

/** The motion of a pile, from the start of its run, for a view that plays it. */
export interface CrewFilm {
  /** The faces before the first cue. */
  faces: CrewFace[];
  /** The rain, until the pile is still. */
  intro: CrewReel;
  /** From the still pile: the crew hop out of the screen. */
  exit: CrewReel;
  /** The transforms of the still pile, for a pile without motion. */
  rest: { plush: string; squash: string }[];
  /**
   * The breath of each plush: a squash that goes on without end after the last drop, at `from`
   * seconds into the intro. `amount` is the change in height; the width changes by half of it.
   */
  breathe: { from: number; period: number; amount: number; phases: number[] };
  /**
   * When the app is ready during the intro, the rest of the intro plays at least `rate` times as
   * fast, and fast enough to end in `time` seconds.
   */
  rush: { rate: number; time: number };
}

/** The keyframes of one element. A pose that holds keeps two keyframes, at the start and the end of the hold. */
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

  /** The last keyframe is at the end, so the animation does not go back to the element's own style. */
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

  /** Each face that changed since the last cue. */
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
  /** The crew and their bodies. They change only when `fit` builds the pile again. */
  crew: readonly CrewMember[] = [];
  bodies: readonly CrewBody[] = [];
  readonly reduced: boolean;
  pit: CrewPit;
  private phase: CrewPilePhase;
  private readonly seed: number;
  private room: CrewRoom;
  /** The film, after it is recorded. The pile then does not change again. */
  private recorded: CrewFilm | undefined;
  private time = 0;
  /** The simulation time of this frame that is not a full step yet. */
  private carry = 0;
  private exitStartedAt = -1;
  private events: { at: number; run: () => void }[] = [];

  /** `reduced` builds the pile at once and keeps it still. `room` is the screen size, if it is known. */
  constructor(seed: number, reduced: boolean, room?: CrewRoom) {
    this.seed = seed;
    this.reduced = reduced;
    this.room = room ?? DEFAULT_ROOM;
    this.pit = pitFor(this.room);
    this.phase = reduced ? "live" : "intro";
    this.build();
  }

  /** A new crew for the pit, from the seed. A reduced pile also falls into place at once. */
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

  /**
   * Fits the pit to the size of its screen, with a new crew for the size, and then returns true. A
   * pile with a film keeps its crew and its pit.
   */
  fit(room: CrewRoom): boolean {
    if (this.recorded || room.width <= 0 || room.height <= 0) return false;
    if (Math.abs(room.width - this.room.width) < 1 && Math.abs(room.height - this.room.height) < 1) return false;
    this.room = room;
    this.pit = pitFor(room);
    this.build();
    return true;
  }

  /**
   * The motion of the pile, recorded once: the rain until the pile is still, then the hop out. After
   * this, the pile does not change: screens that share the pile play the same film.
   */
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
    // The last face changes come after the pile is still. They need no steps.
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

  /** The faces at the start of the run, also after the film is recorded. */
  get startFaces(): readonly CrewFace[] {
    return this.recorded?.faces ?? this.bodies.map((body) => body.face);
  }

  /** When the last plush drops, in seconds. */
  private get lastDropAt(): number {
    return this.crew.at(-1)?.dropAt ?? 0;
  }

  /** The time between two steps of a sequence over `count` plushes, so a large crew takes at most `total`. */
  private spacing(step: number, total: number, count = this.crew.length): number {
    return Math.min(step, total / Math.max(1, count));
  }

  private get exitLength(): number {
    return (this.crew.length - 1) * this.spacing(EXIT.stagger, EXIT.spread) + EXIT.after;
  }

  /** The exit has run its course: every plush is out of the screen. */
  private get finished(): boolean {
    return this.phase === "exit" && this.time > this.exitStartedAt + this.exitLength;
  }

  /** Where to draw each plush now: between its last two steps, at the share of a step that is left. */
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
    // A wide pit needs faster hops, so the crew at its middle still leave by the sides.
    const reach = Math.max(1, this.pit.width / 620);
    // The top of the pile hops first.
    const order = [...this.bodies].sort((a, b) => a.y - b.y);
    this.bodies.forEach((body, index) => {
      wake(body);
      if (body.member.reacts) setFace(body, { happy: true });
      // The exit has no floor, so each plush stays still until its hop.
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
          // It landed: its face goes back to rest.
          this.schedule(0.22, () => setFace(body, { state: "idle" }));
        } else if (body.impact > STARTLE_SPEED) {
          // Hit hard by a plush that settles: a short startle.
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

  /** Where a plush that falls at `x` comes to rest on the pile: the y of its centre. */
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

  /**
   * A plush that would come to rest above the top of the screen drops at the lowest point of the
   * pile, so the full pile has no holes at the top.
   */
  private fillHole(falling: CrewBody): void {
    if (this.restAt(falling, falling.x) - falling.radius < 0) falling.x = this.lowestPoint(falling);
  }

  /**
   * The x where a falling plush comes to rest lowest on the pile. Of two points at about the same
   * height, the one nearer the plush's own drop point wins.
   */
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

/** A seed for a new random pile. */
export function randomCrewSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
}
