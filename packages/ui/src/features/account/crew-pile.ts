import type { PlushCharacterId } from "@norbert_bodziony/bloub/plush";
import { PLUSH_MASCOT_BODY } from "../../plush-loader";
import { clamp } from "../../utils";

/*
 * The crew pile of the app loading screen: each run, a different crew of felt plushes rains into a
 * pile, and the lilac OpenBot plush lands last, on top. Any plush can be grabbed and thrown. When
 * the app is ready, each plush hops out of the screen in its own direction.
 *
 * This is a small fixed-step simulation: circles on an invisible bowl between two walls, with
 * friction, so each bounce is a reaction to a contact. Each plush also has a squash spring, which
 * its impacts kick, and a tilt spring. The simulation holds the faces too, so a second screen can
 * continue the pile of the first. It has no DOM and no clock of its own.
 */

type CrewPilePhase = "intro" | "live" | "exit";

/** What a plush shows. `look` is the point it looks at, relative to its centre; `happy` is the exit. */
export interface CrewFace {
  state: "idle" | "wide" | "wink";
  look: { dx: number; dy: number } | null;
  happy: boolean;
  /** Goes up at each change, so a view updates only what changed. */
  version: number;
}

export interface CrewMember {
  id: string;
  /** A bloub character. The lead has none: it is the lilac OpenBot plush. */
  character?: PlushCharacterId;
  lead: boolean;
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
}

interface CrewBody {
  member: CrewMember;
  radius: number;
  mass: number;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  squash: number;
  squashSpeed: number;
  tilt: number;
  tiltSpeed: number;
  impact: number;
  breathePhase: number;
  /** Held still: a held plush, or the lead while the crew hop out from under it. */
  pinned: boolean;
  /** When it hopped out, in simulation seconds. The lead then grows toward the viewer. */
  hopAt: number;
  face: CrewFace;
}

/** The felt body of each character inside its box, measured from the images. */
const CHARACTERS: readonly { character: PlushCharacterId; cy: number; w: number; h: number }[] = [
  { character: "yoshi", cy: 0.499, w: 0.647, h: 0.401 },
  { character: "nexo", cy: 0.501, w: 0.612, h: 0.608 },
  { character: "malu", cy: 0.5, w: 0.626, h: 0.622 },
  { character: "fred", cy: 0.499, w: 0.625, h: 0.596 },
  { character: "vita", cy: 0.502, w: 0.632, h: 0.595 },
  { character: "cloe", cy: 0.448, w: 0.603, h: 0.565 },
];

/** Each run picks this many crew (the lead comes on top), each character at most `copies` times. */
const CREW_COUNT = { min: 3, max: 10, copies: 2 } as const;
/** The size of a crew plush when six drop. Fewer are larger and more are smaller. */
const CREW_SIZE = 168;
/** The lead's felt body is 1.27 times as wide as a bloub character's (0.621 + 0.608 of its box). */
const LEAD_SCALE = (1.27 * (0.621 + 0.608)) / (PLUSH_MASCOT_BODY.w + PLUSH_MASCOT_BODY.h);

/** The pit, in pixels: the pile rests on an invisible bowl near its bottom. */
export const CREW_PIT = { width: 620, height: 440, floor: 420, curve: 0.0011 } as const;
const SPAWN_Y = -520;
const SPAWN_SPEED = 1400;
const GRAVITY = 5200;
const STEP = 1 / 240;
const ITERATIONS = 4;
const FLOOR_BOUNCE = 0.32;
const BODY_BOUNCE = 0.22;
const FRICTION = 0.5;
const AIR_DRAG = 0.4;
const SQUASH = { stiffness: 1100, damping: 21, kick: 0.0011, min: -0.16, max: 0.28 } as const;
const TILT = { stiffness: 420, damping: 12, kick: 0.006, max: 0.3 } as const;
const BREATHE = { period: 3.2, amount: 0.012 } as const;
/** An impact faster than this, in pixels a second, is a landing. */
const LANDING_SPEED = 500;
/** The pile is still when no plush moves faster than this, after the lead has landed for a time. */
const SETTLE = { after: 0.55, speed: 28, limit: 3 } as const;
/** The simulation speed for the rest of the intro when the app is ready before the intro ends. */
const RUSH_RATE = 2.2;
/** If the lead does not land in this time after its drop, a ready app does not wait for it. */
const LEAD_LANDING_LIMIT = 1;
const EXIT = { stagger: 0.035, leadDelay: 0.12, length: 1.1, zoom: 9 } as const;
/**
 * A throw: the release speed limit, the impact that startles a plush in the pile, the shortest time
 * between two pointer points for a speed, and the time after the last move that a release drops.
 */
const THROW = { maxSpeed: 3200, startle: 700, minMove: 1 / 60, still: 0.1 } as const;
/** A glance: one crew member looks up at the lead, in turn. */
const GLANCE = { every: 1.1, hold: 0.8 } as const;
/** The longest frame that the simulation takes in one go, so a slow frame does not tunnel. */
const MAX_FRAME = 1 / 30;

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

/** A new crew: how many, who, how large, and where and how each one falls. */
function createCrew(random: () => number): CrewMember[] {
  const count = CREW_COUNT.min + Math.floor(random() * (CREW_COUNT.max - CREW_COUNT.min + 1));
  const pool = CHARACTERS.flatMap((body) => Array.from({ length: CREW_COUNT.copies }, (_, copy) => ({ body, copy })))
    .map((entry) => ({ entry, key: random() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count);
  const base = CREW_SIZE * clamp(Math.sqrt(6 / count), 0.74, 1.12);
  const dropWindow = 0.12 + count * 0.05;
  const crew = pool.map(({ entry }): CrewMember => {
    const size = Math.round(base * between(random, 0.86, 1.12));
    return {
      id: `${entry.body.character}-${entry.copy}`,
      character: entry.body.character,
      lead: false,
      size,
      cy: entry.body.cy,
      w: entry.body.w,
      h: entry.body.h,
      dropX: between(random, -1, 1) * (CREW_PIT.width / 2 - size * 0.42),
      dropAt: random() * dropWindow,
      spawnLift: random() * 220,
      dropVx: between(random, -280, 280),
      dropTilt: between(random, -0.5, 0.5),
      dropSpin: between(random, -7, 7),
      restTilt: between(random, -0.14, 0.14),
    };
  });
  crew.sort((a, b) => a.dropAt - b.dropAt);
  crew.push({
    id: "openbot",
    lead: true,
    size: Math.round(base * LEAD_SCALE),
    cy: PLUSH_MASCOT_BODY.cy,
    w: PLUSH_MASCOT_BODY.w,
    h: PLUSH_MASCOT_BODY.h,
    dropX: between(random, -70, 70),
    dropAt: dropWindow + 0.16,
    spawnLift: 0,
    dropVx: between(random, -60, 60),
    dropTilt: between(random, -0.2, 0.2),
    dropSpin: between(random, -2, 2),
    restTilt: 0,
  });
  return crew;
}

function createBody(member: CrewMember, index: number, reduced: boolean): CrewBody {
  const radius = 0.25 * (member.w + member.h) * member.size;
  return {
    member,
    radius,
    mass: radius * radius,
    active: false,
    x: CREW_PIT.width / 2 + member.dropX,
    y: SPAWN_Y - member.spawnLift,
    vx: member.dropVx,
    vy: SPAWN_SPEED,
    squash: 0,
    squashSpeed: 0,
    tilt: member.dropTilt,
    tiltSpeed: member.dropSpin,
    impact: 0,
    breathePhase: index * 0.9,
    pinned: false,
    hopAt: -1,
    face: { state: reduced ? "idle" : "wide", look: null, happy: false, version: 0 },
  };
}

function floorAt(x: number): { y: number; nx: number; ny: number } {
  const dx = x - CREW_PIT.width / 2;
  const slope = -2 * CREW_PIT.curve * dx;
  const length = Math.hypot(slope, 1);
  return { y: CREW_PIT.floor - CREW_PIT.curve * dx * dx, nx: slope / length, ny: -1 / length };
}

function collideFloor(body: CrewBody): void {
  const floor = floorAt(body.x);
  const depth = (body.y + body.radius - floor.y) * -floor.ny;
  if (depth <= 0) return;
  body.x += floor.nx * depth;
  body.y += floor.ny * depth;
  const normal = body.vx * floor.nx + body.vy * floor.ny;
  if (normal >= 0) return;
  body.impact = Math.max(body.impact, -normal);
  body.vx -= (1 + FLOOR_BOUNCE) * normal * floor.nx;
  body.vy -= (1 + FLOOR_BOUNCE) * normal * floor.ny;
  const tangent = body.vx * -floor.ny + body.vy * floor.nx;
  body.vx -= FRICTION * tangent * -floor.ny;
  body.vy -= FRICTION * tangent * floor.nx;
  body.tiltSpeed += tangent * TILT.kick * 0.5;
}

/** The two side walls of the pit: a thrown plush bounces back into the pile. */
function collideWalls(body: CrewBody): void {
  if (body.x < body.radius) {
    body.x = body.radius;
    body.vx = Math.abs(body.vx) * FLOOR_BOUNCE;
  } else if (body.x > CREW_PIT.width - body.radius) {
    body.x = CREW_PIT.width - body.radius;
    body.vx = -Math.abs(body.vx) * FLOOR_BOUNCE;
  }
}

function collidePair(a: CrewBody, b: CrewBody): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 0.001;
  const overlap = a.radius + b.radius - distance;
  if (overlap <= 0) return;
  const nx = dx / distance;
  const ny = dy / distance;
  // A held plush does not give way: it pushes the others aside.
  const inverseA = a.pinned ? 0 : 1 / a.mass;
  const inverseB = b.pinned ? 0 : 1 / b.mass;
  if (inverseA + inverseB === 0) return;
  const share = inverseA / (inverseA + inverseB);
  a.x -= nx * overlap * share;
  a.y -= ny * overlap * share;
  b.x += nx * overlap * (1 - share);
  b.y += ny * overlap * (1 - share);
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const normal = rvx * nx + rvy * ny;
  if (normal >= 0) return;
  a.impact = Math.max(a.impact, -normal * share);
  b.impact = Math.max(b.impact, -normal * (1 - share));
  const impulse = (-(1 + BODY_BOUNCE) * normal) / (inverseA + inverseB);
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
function step(bodies: readonly CrewBody[], collide: boolean): void {
  for (const body of bodies) {
    if (!body.active || body.pinned) continue;
    body.impact = 0;
    body.vy += GRAVITY * STEP;
    body.vx *= 1 - AIR_DRAG * STEP;
    body.vy *= 1 - AIR_DRAG * STEP;
    body.x += body.vx * STEP;
    body.y += body.vy * STEP;
  }
  if (collide) {
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      for (const body of bodies) {
        if (body.active && !body.pinned) {
          collideFloor(body);
          collideWalls(body);
        }
      }
      for (let a = 0; a < bodies.length; a++) {
        for (let b = a + 1; b < bodies.length; b++) {
          const first = bodies[a];
          const second = bodies[b];
          if (first?.active && second?.active) collidePair(first, second);
        }
      }
    }
  }
  for (const body of bodies) {
    if (!body.active) continue;
    body.squashSpeed += body.impact * SQUASH.kick;
    body.squashSpeed += (-SQUASH.stiffness * body.squash - SQUASH.damping * body.squashSpeed) * STEP;
    body.squash = clamp(body.squash + body.squashSpeed * STEP, SQUASH.min, SQUASH.max);
    body.tiltSpeed += (-TILT.stiffness * (body.tilt - body.member.restTilt) - TILT.damping * body.tiltSpeed) * STEP;
    body.tilt = clamp(body.tilt + body.tiltSpeed * STEP, -TILT.max, TILT.max);
  }
}

function setFace(body: CrewBody, change: Partial<Omit<CrewFace, "version">>): void {
  body.face = { ...body.face, ...change, version: body.face.version + 1 };
}

/** Where a plush is drawn: its box's top left corner, its angle, its scale and its squash. */
interface CrewPose {
  x: number;
  y: number;
  tilt: number;
  scale: number;
  squashX: number;
  squashY: number;
  visible: boolean;
}

/** A held plush: where the pointer took it, and the last pointer point, in pit pixels and seconds. */
interface Hold {
  index: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  at: number;
}

export class CrewPile {
  readonly crew: readonly CrewMember[];
  readonly bodies: readonly CrewBody[];
  readonly reduced: boolean;
  phase: CrewPilePhase;
  private time = 0;
  private rate = 1;
  private leadLandedAt = -1;
  private exitStartedAt = -1;
  private nextGlance = 0;
  private glanceIndex = 0;
  private events: { at: number; run: () => void }[] = [];
  private held: Hold | undefined;
  /** The user put the lead down before it landed. A soft contact then counts as its landing. */
  private leadPlaced = false;

  /** `reduced` builds the pile at once and keeps it still. */
  constructor(seed: number, reduced: boolean) {
    this.reduced = reduced;
    this.crew = createCrew(createRandom(seed));
    this.bodies = this.crew.map((member, index) => createBody(member, index, reduced));
    this.phase = reduced ? "live" : "intro";
    if (reduced) {
      while (this.time < 3) this.advance(STEP * 60);
      for (const body of this.bodies) {
        body.squash = 0;
        body.squashSpeed = 0;
        body.tilt = 0;
        body.tiltSpeed = 0;
      }
      this.events = [];
      for (const body of this.bodies) setFace(body, { state: "idle", look: null });
    }
  }

  private get lead(): number {
    return this.bodies.length - 1;
  }

  /** The exit has run its course: every plush is out of the screen. */
  get finished(): boolean {
    return this.phase === "exit" && this.time > this.exitStartedAt + EXIT.length;
  }

  /**
   * Moves the pile on by one frame of `seconds`. When `ready` is set, the intro runs faster and the
   * crew hop out after the lead lands; a live pile hops out at once.
   */
  tick(seconds: number, ready: boolean): void {
    if (this.reduced || this.finished) return;
    if (ready && this.phase === "intro") this.rate = RUSH_RATE;
    this.advance(Math.min(seconds, MAX_FRAME) * this.rate);
    if (this.phase === "intro") {
      const lead = this.bodies[this.lead];
      const leadLate = lead !== undefined && this.time > lead.member.dropAt + LEAD_LANDING_LIMIT;
      if (ready && ((this.leadLandedAt >= 0 && this.time > this.leadLandedAt + 0.15) || leadLate)) this.startExit();
      else if (this.settled()) this.phase = "live";
    } else if (this.phase === "live") {
      if (ready) this.startExit();
      else this.runGlances();
    }
  }

  /** Where to draw each plush now. */
  poses(): CrewPose[] {
    const breatheOn = this.phase !== "intro" || this.leadLandedAt >= 0;
    return this.bodies.map((body, index) => {
      const { member } = body;
      const breathe =
        breatheOn && !this.reduced
          ? BREATHE.amount * Math.sin((2 * Math.PI * this.time) / BREATHE.period + body.breathePhase)
          : 0;
      return {
        x: body.x - member.size / 2,
        y: body.y - member.size * member.cy,
        tilt: body.tilt,
        scale: this.leadZoom(body, index),
        squashX: 1 + body.squash * 0.6 - breathe * 0.5,
        squashY: 1 - body.squash + breathe,
        visible: body.active,
      };
    });
  }

  /** The point that a plush looks at, relative to the lead, for its face. */
  private lookAtLead(index: number): void {
    const body = this.bodies[index];
    const lead = this.bodies[this.lead];
    if (!body || !lead) return;
    setFace(body, { look: { dx: lead.x - body.x, dy: lead.y - body.y } });
  }

  /** Takes a plush at a pit point. Returns false when the plush cannot be held now. */
  grab(index: number, x: number, y: number, at: number): boolean {
    const body = this.bodies[index];
    if (this.reduced || this.phase === "exit" || this.held || !body?.active) return false;
    this.held = { index, offsetX: body.x - x, offsetY: body.y - y, x, y, at };
    body.pinned = true;
    body.vx = 0;
    body.vy = 0;
    body.squashSpeed -= 3;
    setFace(body, { state: "wide" });
    return true;
  }

  drag(x: number, y: number, at: number): void {
    const held = this.held;
    const body = held && this.bodies[held.index];
    if (!held || !body) return;
    // Coalesced pointer events can have the same time: a minimum time keeps the speed real.
    const seconds = Math.max(at - held.at, THROW.minMove);
    // The held plush carries the pointer's speed, so the plushes that it hits get pushed.
    body.vx = (x - held.x) / seconds;
    body.vy = (y - held.y) / seconds;
    body.tiltSpeed += clamp(body.vx * 0.002, -2, 2);
    body.x = clamp(x + held.offsetX, body.radius, CREW_PIT.width - body.radius);
    body.y = Math.min(y + held.offsetY, floorAt(body.x).y - body.radius);
    this.held = { ...held, x, y, at };
  }

  /** Lets go of the held plush. A plush that the pointer held still for a moment drops; it is not thrown. */
  release(at?: number): void {
    const held = this.held;
    const body = held && this.bodies[held.index];
    this.held = undefined;
    if (!held || !body) return;
    if (at === undefined || at - held.at > THROW.still) {
      body.vx = 0;
      body.vy = 0;
    }
    if (held.index === this.lead && this.leadLandedAt < 0) this.leadPlaced = true;
    const speed = Math.hypot(body.vx, body.vy);
    const limit = speed > THROW.maxSpeed ? THROW.maxSpeed / speed : 1;
    body.vx *= limit;
    body.vy *= limit;
    body.pinned = false;
    // An impact from before the hold must not startle the plush when it is let go.
    body.impact = 0;
    this.schedule(0.3, () => setFace(body, { state: "idle" }));
  }

  private schedule(delay: number, run: () => void): void {
    this.events.push({ at: this.time + delay, run });
  }

  private leadLanded(): void {
    const leadIndex = this.lead;
    const lead = this.bodies[leadIndex];
    if (!lead) return;
    this.leadLandedAt = this.time;
    this.leadPlaced = false;
    setFace(lead, { state: "wink" });
    this.schedule(0.6, () => setFace(lead, { state: "idle" }));
    this.bodies.forEach((body, index) => {
      if (index === leadIndex) return;
      const near = Math.hypot(body.x - lead.x, body.y - lead.y) < (body.radius + lead.radius) * 1.25;
      if (near) {
        setFace(body, { state: "wide" });
        this.schedule(0.32, () => setFace(body, { state: "idle" }));
      }
      this.schedule(0.12 + index * 0.05, () => this.lookAtLead(index));
      this.schedule(1 + index * 0.08, () => setFace(body, { look: null }));
    });
    this.nextGlance = this.time + 1 + this.crew.length * 0.08 + 0.3;
  }

  private startExit(): void {
    this.release();
    this.phase = "exit";
    this.exitStartedAt = this.time;
    this.rate = 1;
    const leadIndex = this.lead;
    this.bodies.forEach((body, index) => {
      setFace(body, { happy: true, look: null });
      const isLead = index === leadIndex;
      // The exit has no floor, so each plush stays still until its hop.
      body.pinned = true;
      body.vx = 0;
      body.vy = 0;
      const delay = isLead ? (this.crew.length - 1) * EXIT.stagger + EXIT.leadDelay : index * EXIT.stagger;
      this.schedule(delay, () => {
        const side = Math.sign(body.x - CREW_PIT.width / 2) || (index % 2 ? 1 : -1);
        body.active = true;
        body.vx = isLead ? 0 : side * (720 + ((index * 137) % 5) * 110);
        body.vy = isLead ? -900 : -(1500 + ((index * 61) % 4) * 160);
        body.hopAt = this.time;
        body.pinned = false;
        body.squashSpeed -= 6;
        body.tiltSpeed += isLead ? 0 : side * 9;
      });
    });
  }

  private leadZoom(body: CrewBody, index: number): number {
    if (index !== this.lead || body.hopAt < 0) return 1;
    const t = this.time - body.hopAt;
    return 1 + EXIT.zoom * t * t;
  }

  private advance(seconds: number): void {
    const collide = this.phase !== "exit";
    const leadIndex = this.lead;
    let remaining = seconds;
    while (remaining > 0) {
      remaining -= STEP;
      this.time += STEP;
      for (const body of this.bodies) {
        if (!body.active && this.phase !== "exit" && this.time >= body.member.dropAt) body.active = true;
      }
      step(this.bodies, collide);
      this.bodies.forEach((body, index) => {
        const placedLead = index === leadIndex && this.leadPlaced;
        if (this.phase === "exit" || body.pinned || body.impact < (placedLead ? SETTLE.speed : LANDING_SPEED)) return;
        if (this.phase === "intro" && index === leadIndex && this.leadLandedAt < 0) {
          this.leadLanded();
        } else if (
          this.phase === "intro" &&
          index !== leadIndex &&
          body.face.state === "wide" &&
          this.leadLandedAt < 0
        ) {
          this.schedule(0.22, () => setFace(body, { state: "idle" }));
        } else if (this.leadLandedAt >= 0 && body.impact > THROW.startle && body.face.state === "idle") {
          // Hit by a thrown plush: a short startle.
          setFace(body, { state: "wide" });
          this.schedule(0.35, () => setFace(body, { state: "idle" }));
        }
      });
      for (let i = this.events.length - 1; i >= 0; i--) {
        const event = this.events[i];
        if (event && event.at <= this.time) {
          this.events.splice(i, 1);
          event.run();
        }
      }
    }
  }

  private settled(): boolean {
    if (this.held || this.leadLandedAt < 0 || this.time < this.leadLandedAt + SETTLE.after) return false;
    if (this.time > this.leadLandedAt + SETTLE.limit) return true;
    return this.bodies.every((body) => Math.hypot(body.vx, body.vy) < SETTLE.speed);
  }

  private runGlances(): void {
    if (this.time < this.nextGlance || this.lead === 0) return;
    this.nextGlance = this.time + GLANCE.every;
    const index = this.glanceIndex % this.lead;
    this.glanceIndex += 1;
    this.lookAtLead(index);
    const body = this.bodies[index];
    if (body) this.schedule(GLANCE.hold, () => setFace(body, { look: null }));
  }
}

/** A seed for a new random pile. */
export function randomCrewSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
}
