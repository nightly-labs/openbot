/*
 * Wild plush motion scenes, round 2. Each scene runs in a real container of the app, as the calm
 * scenes of `motion-scenes-prototype.tsx` do. The felt parts are the shipped plush art: the lilac
 * plush, its eyes, the felt balls and the bloub crew. A small physics world moves the parts that fly.
 */
import { PlushBot, type PlushCharacterId, type PlushState } from "@norbert_bodziony/bloub/plush";
import { Button, Heading, type PlushMascotFace, Text } from "@openbot/ui";
import { GlobalSearch } from "@openbot/ui/components/GlobalSearch";
import { ComposerNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import { ServerConnectionNotice } from "@openbot/ui/features/servers/ServerConnectionNotice";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createSignal, For, onSettled, Show, untrack } from "solid-js";
import eyeLeft from "./assets/motion-scenes/wild/eye-left.webp";
import eyeRight from "./assets/motion-scenes/wild/eye-right.webp";
import { STORY_AGENTS } from "./fixtures";
import {
  BALLS,
  Mascot,
  MountInto,
  NO_PAGE,
  play,
  SceneControls,
  SIDEBAR_BASE,
  useElement,
} from "./motion-scenes-prototype";
import { PrototypeApp } from "./prototype-support";
import "./WildMotionScenesPrototype.css";

// Felt physics -------------------------------------------------------------

/** One felt part in the world: a circle with a spin. `kind` "ghost" passes through the others. */
interface FeltBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  spin: number;
  mass: number;
  /** Solid parts touch each other; ghosts touch only the walls; kinematic parts push and are not pushed. */
  kind: "solid" | "ghost" | "kinematic";
  /** Out of the world: not moved and not drawn. */
  asleep: boolean;
  /** Held by the pointer. */
  held: boolean;
  /** A point that pulls the part, for a scene that calls the parts back. */
  home: { x: number; y: number } | null;
  /** The tilt that the part goes back to when it rests. */
  restAngle: number;
  /** Seconds that the part has moved slowly. A world with `settle` stops a part that stays slow. */
  calm: number;
}

interface WorldRules {
  gravity: number;
  bounce: number;
  /** Walls of the world, in the coordinates of its stage. `null` is an open side. */
  left: number | null;
  right: number | null;
  top: number | null;
  floor: number | null;
  /**
   * Stops the parts that stay slow, so that a pile rests. Circles on a flat floor never rest: each
   * contact pushes its neighbours a little to the side. A hit, a grab or a fast part starts them again.
   */
  settle?: boolean;
}

function feltBody(partial: Partial<FeltBody> & { r: number }): FeltBody {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    mass: partial.r * partial.r,
    kind: "solid",
    asleep: false,
    held: false,
    home: null,
    restAngle: 0,
    calm: 0,
    ...partial,
  };
}

const random = (min: number, max: number) => min + Math.random() * (max - min);

/** Moves each part by `dt` seconds: gravity, the walls, the contacts, and the pull to a home point. */
/** Seconds that a part must stay slow before it stops, the speed that counts as slow, and the speed that starts it again. */
const SETTLE_AFTER = 0.35;
const SETTLE_SPEED = 26;
const WAKE_SPEED = 90;

function stepWorld(bodies: readonly FeltBody[], rules: WorldRules, dt: number): void {
  const still = (body: FeltBody) =>
    rules.settle === true && body.calm >= SETTLE_AFTER && body.kind === "solid" && !body.home && !body.held;
  /** Starts a stopped part again, with each stopped part that touches it, so that nothing floats. */
  const wake = (first: FeltBody) => {
    const queue = [first];
    first.calm = 0;
    for (let next = queue.pop(); next; next = queue.pop()) {
      for (const other of bodies) {
        if (other === next || other.asleep || !still(other)) continue;
        if (Math.hypot(other.x - next.x, other.y - next.y) > other.r + next.r + 3) continue;
        other.calm = 0;
        queue.push(other);
      }
    }
  };
  const startX = bodies.map((body) => body.x);
  const startY = bodies.map((body) => body.y);
  for (const body of bodies) {
    if (body.held && body.calm >= SETTLE_AFTER) wake(body);
  }
  for (const body of bodies) {
    if (body.asleep || body.held || body.kind === "kinematic") continue;
    if (still(body)) {
      if (Math.hypot(body.vx, body.vy) <= WAKE_SPEED) continue;
      wake(body);
    }
    if (body.home) {
      const ax = (body.home.x - body.x) * 90 - body.vx * 14;
      const ay = (body.home.y - body.y) * 90 - body.vy * 14;
      body.vx += ax * dt;
      body.vy += ay * dt;
      body.spin *= 0.9;
    } else {
      body.vy += rules.gravity * dt;
    }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.angle += body.spin * dt;
    if (body.home) continue;
    let resting = false;
    if (rules.floor !== null && body.y + body.r > rules.floor) {
      body.y = rules.floor - body.r;
      if (body.vy > 0) body.vy = -body.vy * rules.bounce;
      if (Math.abs(body.vy) < 40) body.vy = 0;
      body.vx *= 0.94;
      body.spin = body.vx / body.r;
      resting = true;
    }
    if (rules.top !== null && body.y - body.r < rules.top) {
      body.y = rules.top + body.r;
      if (body.vy < 0) body.vy = -body.vy * rules.bounce;
    }
    if (rules.left !== null && body.x - body.r < rules.left) {
      body.x = rules.left + body.r;
      if (body.vx < 0) body.vx = -body.vx * rules.bounce;
      body.spin *= -0.6;
    }
    if (rules.right !== null && body.x + body.r > rules.right) {
      body.x = rules.right - body.r;
      if (body.vx > 0) body.vx = -body.vx * rules.bounce;
      body.spin *= -0.6;
    }
    if (resting && Math.abs(body.vx) < 30) body.angle += (body.restAngle - body.angle) * Math.min(1, dt * 6);
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (!a || a.asleep || a.kind === "ghost" || a.home) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (!b || b.asleep || b.kind === "ghost" || b.home) continue;
      if (a.kind === "kinematic" && b.kind === "kinematic") continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      const overlap = a.r + b.r - distance;
      if (overlap <= 0 || distance === 0) continue;
      // A stopped part starts again when something pushes it; two stopped parts stay as they are.
      const pushes = (body: FeltBody) =>
        body.kind === "kinematic" || body.held || Math.hypot(body.vx, body.vy) > WAKE_SPEED;
      if (still(a) && !still(b) && pushes(b)) wake(a);
      if (still(b) && !still(a) && pushes(a)) wake(b);
      const aStill = still(a);
      const bStill = still(b);
      if (aStill && bStill) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const aFree = a.kind === "kinematic" || a.held || aStill ? 0 : 1 / a.mass;
      const bFree = b.kind === "kinematic" || b.held || bStill ? 0 : 1 / b.mass;
      const share = aFree + bFree;
      if (share === 0) continue;
      a.x -= nx * overlap * (aFree / share);
      a.y -= ny * overlap * (aFree / share);
      b.x += nx * overlap * (bFree / share);
      b.y += ny * overlap * (bFree / share);
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (closing >= 0) continue;
      const impulse = (-(1 + rules.bounce * 0.6) * closing) / share;
      a.vx -= impulse * nx * aFree;
      a.vy -= impulse * ny * aFree;
      b.vx += impulse * nx * bFree;
      b.vy += impulse * ny * bFree;
      a.spin += (b.vx - a.vx) * 0.002;
      b.spin -= (b.vx - a.vx) * 0.002;
    }
  }
  if (rules.settle !== true || dt === 0) return;
  bodies.forEach((body, index) => {
    if (body.asleep || body.kind !== "solid" || body.home || body.held || still(body)) {
      if (body.home || body.held) body.calm = 0;
      return;
    }
    const moved = Math.hypot(body.x - (startX[index] ?? body.x), body.y - (startY[index] ?? body.y)) / dt;
    body.calm = moved < SETTLE_SPEED ? body.calm + dt : 0;
    if (body.calm >= SETTLE_AFTER) {
      body.vx = 0;
      body.vy = 0;
      body.spin = 0;
    }
  });
}

/**
 * Calls `run` on each animation frame with the seconds since the last one, until the scene goes. A
 * physics scene asks for two steps a frame, so fast parts do not pass through each other.
 */
function onFrames(run: (dt: number, now: number) => void, steps = 2): void {
  onSettled(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      for (let step = 0; step < steps; step++) run(dt / steps, now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });
}

/** Puts each element on its part. Elements are boxes of the part's diameter, at the stage's origin. */
function drawBodies(bodies: readonly FeltBody[], elements: readonly (HTMLElement | undefined)[]): void {
  bodies.forEach((body, index) => {
    const element = elements[index];
    if (!element) return;
    if (body.asleep) {
      element.style.visibility = "hidden";
      return;
    }
    element.style.visibility = "visible";
    element.style.transform = `translate(${body.x - body.r}px, ${body.y - body.r}px) rotate(${body.angle}rad)`;
  });
}

/**
 * Lets the pointer grab a part and throw it. The part follows the pointer; on release, it keeps the
 * speed of the last moves.
 */
function grab(event: PointerEvent, body: FeltBody, stage: HTMLElement | undefined): void {
  if (!stage || body.asleep) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  event.preventDefault();
  target.setPointerCapture(event.pointerId);
  const origin = stage.getBoundingClientRect();
  let last = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  body.held = true;
  body.home = null;
  const move = (next: PointerEvent) => {
    const dt = Math.max(0.008, (next.timeStamp - last.t) / 1000);
    body.vx = (next.clientX - last.x) / dt;
    body.vy = (next.clientY - last.y) / dt;
    body.x = next.clientX - origin.left;
    body.y = next.clientY - origin.top;
    last = { x: next.clientX, y: next.clientY, t: next.timeStamp };
  };
  const release = () => {
    body.held = false;
    body.vx = Math.max(-2400, Math.min(2400, body.vx));
    body.vy = Math.max(-2400, Math.min(2400, body.vy));
    body.spin = body.vx / body.r / 2;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", release);
    target.removeEventListener("pointercancel", release);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", release);
  target.addEventListener("pointercancel", release);
}

/** Timers that a scene owns, all cleared when it goes. With reduced motion each one runs at once. */
function sceneTimers() {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  onSettled(() => () => {
    for (const timer of timers) clearTimeout(timer);
  });
  return {
    later(ms: number, run: () => void): void {
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          run();
        },
        prefersReducedMotion() ? 0 : ms,
      );
      timers.add(timer);
    },
  };
}

/** One plush eye, cut out of its full-body layer, so it can fly on its own. */
function LooseEye(props: { side: "left" | "right" }) {
  return (
    <span
      class="wild-eye"
      data-side={props.side}
      style={{ "background-image": `url(${props.side === "left" ? eyeLeft : eyeRight})` }}
    />
  );
}

const ALL_CREW: readonly PlushCharacterId[] = ["vita", "cloe", "yoshi", "nexo", "malu", "fred"];

function shuffled<T>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, key: Math.random() }))
    .sort((one, other) => one.key - other.key)
    .map((entry) => entry.item);
}

// Crash W1. Exploding plush -----------------------------------------------

const PLUSH_SIZE = 112;
const SHARD_COUNT = 26;

type BoomPhase = "inflate" | "exploded" | "gathering" | "whole";

/**
 * The plush swells, shakes and bursts into felt balls and its two eyes. They bounce around the whole
 * window; any of them can be thrown. Reload pulls every part back, and the plush pops back whole.
 */
function ExplodingScene(props: { onReloaded: () => void }) {
  const reduced = prefersReducedMotion();
  const [phase, setPhase] = createSignal<BoomPhase>(reduced ? "exploded" : "inflate");
  const [face, setFace] = createSignal<PlushMascotFace>("wide");
  const timers = sceneTimers();
  let world: HTMLElement | undefined;
  let panel: HTMLElement | undefined;
  let slot: HTMLElement | undefined;
  let plush: HTMLElement | undefined;
  const elements: (HTMLElement | undefined)[] = [];
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    feltBody({ r: index < 6 ? random(18, 24) : random(7, 16), asleep: true, restAngle: random(-0.4, 0.4) }),
  );
  const eyes = [feltBody({ r: 13, asleep: true }), feltBody({ r: 13, asleep: true })];
  const fluff = Array.from({ length: 14 }, () => feltBody({ r: random(3, 6), kind: "ghost", asleep: true }));
  const bodies = [...shards, ...eyes, ...fluff];
  const fluffBorn: number[] = [];
  const rules: WorldRules = { gravity: 2600, bounce: 0.62, left: 0, right: 0, top: 0, floor: 0, settle: true };

  function centre(): { x: number; y: number } {
    const rect = slot?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.55 } : { x: 0, y: 0 };
  }

  function burst(): void {
    const { x, y } = centre();
    setPhase("exploded");
    bodies.forEach((body, index) => {
      const angle = random(-Math.PI, 0) + random(-0.5, 0.5);
      const speed = body.kind === "ghost" ? random(500, 900) : random(600, 1600);
      Object.assign(body, {
        x: x + random(-24, 24),
        y: y + random(-24, 24),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 300,
        spin: random(-14, 14),
        asleep: false,
        home: null,
      });
      if (body.kind === "ghost") fluffBorn[index] = performance.now();
    });
    // Only the panel shakes. A translate on an ancestor of the fixed world would move every part.
    play(
      panel,
      [
        { translate: "0 0" },
        { translate: "-9px 5px", offset: 0.15 },
        { translate: "8px -6px", offset: 0.3 },
        { translate: "-6px 4px", offset: 0.5 },
        { translate: "4px -2px", offset: 0.7 },
        { translate: "0 0" },
      ],
      { duration: 380, easing: "linear", fill: "none" },
    );
  }

  function inflate(): void {
    setFace("wide");
    const jitter: Keyframe[] = Array.from({ length: 13 }, (_, step) => {
      const grow = step / 12;
      const shake = 1 + grow * 5;
      return {
        scale: `${1 + grow * 0.45} ${1 + grow * 0.38}`,
        translate: step === 12 ? "0 0" : `${(step % 2 ? 1 : -1) * shake}px ${(step % 3) - 1}px`,
      };
    });
    play(plush, jitter, { duration: 1000, easing: "ease-in", fill: "forwards" });
    timers.later(1000, burst);
  }

  function reload(): void {
    if (phase() !== "exploded") return;
    setPhase("gathering");
    const { x, y } = centre();
    bodies.forEach((body, index) => {
      if (body.asleep) return;
      if (body.kind === "ghost") {
        body.asleep = true;
        return;
      }
      timers.later(index * 10, () => {
        body.home = { x: x + random(-8, 8), y: y + random(-8, 8) };
      });
    });
    timers.later(820, () => {
      for (const body of bodies) body.asleep = true;
      setFace("happy");
      setPhase("whole");
      play(
        plush,
        [
          { scale: "0.2 0.2", translate: "0 0", rotate: "-30deg" },
          { scale: "1.3 0.78", rotate: "8deg", offset: 0.45 },
          { scale: "0.9 1.12", rotate: "-3deg", offset: 0.7 },
          { scale: "1 1", translate: "0 0", rotate: "0deg" },
        ],
        { duration: 620, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "forwards" },
      );
    });
    timers.later(1900, props.onReloaded);
  }

  onFrames((dt, now) => {
    if (!world) return;
    rules.right = world.clientWidth;
    rules.floor = world.clientHeight;
    stepWorld(bodies, rules, dt);
    fluff.forEach((body, index) => {
      const born = fluffBorn[shards.length + eyes.length + index] ?? 0;
      const element = elements[shards.length + eyes.length + index];
      if (element) element.style.opacity = String(Math.max(0, 1 - (now - born) / 600));
      if (now - born > 600) body.asleep = true;
    });
    drawBodies(bodies, elements);
  });

  onSettled(() => {
    if (!reduced) inflate();
  });

  return (
    <>
      <div
        ref={(element) => {
          world = element;
        }}
        class="ms-scene wild-world"
        aria-hidden="true"
      >
        <For each={shards}>
          {(body, index) => (
            <img
              ref={(element) => {
                elements[untrack(index)] = element;
              }}
              class="wild-part"
              src={BALLS[index() % BALLS.length]}
              alt=""
              draggable={false}
              style={{ width: `${body.r * 2}px`, height: `${body.r * 2}px` }}
              onPointerDown={(event) => grab(event, body, world)}
            />
          )}
        </For>
        <For each={eyes}>
          {(body, index) => (
            <span
              ref={(element) => {
                elements[shards.length + untrack(index)] = element;
              }}
              class="wild-part wild-part-eye"
              style={{ width: `${body.r * 2}px`, height: `${body.r * 2}px` }}
              onPointerDown={(event) => grab(event, body, world)}
            >
              <LooseEye side={index() === 0 ? "left" : "right"} />
            </span>
          )}
        </For>
        <For each={fluff}>
          {(body, index) => (
            <img
              ref={(element) => {
                elements[shards.length + eyes.length + untrack(index)] = element;
              }}
              class="wild-part wild-part-fluff"
              src={BALLS[0]}
              alt=""
              draggable={false}
              style={{ width: `${body.r * 2}px`, height: `${body.r * 2}px` }}
            />
          )}
        </For>
      </div>
      <div
        ref={(element) => {
          panel = element;
        }}
        class="wild-crash-panel"
      >
        <div
          ref={(element) => {
            slot = element;
          }}
          class="ms-scene wild-crash-slot"
          data-phase={phase()}
          data-reduced={reduced ? "true" : undefined}
          aria-hidden="true"
        >
          <Mascot
            size={PLUSH_SIZE}
            face={face()}
            eyes={reduced ? "closed" : "open"}
            class="wild-crash-plush"
            ref={(element) => {
              plush = element;
            }}
          />
        </div>
        <Heading as="h1" size="md">
          OpenBot stopped working
        </Heading>
        <Text as="p" variant="body-sm" tone="muted">
          Your chats and files are safe on this computer.
        </Text>
        <Button onClick={() => (reduced ? props.onReloaded() : reload())} disabled={phase() !== "exploded"}>
          Reload
        </Button>
      </div>
    </>
  );
}

/** A new screen for a renderer crash. Reload gathers the plush and shows the real app. */
export function CrashExplodingVariant() {
  const [crashed, setCrashed] = createSignal(1);
  return (
    <div class="ms-root wild-crash">
      <Show when={crashed()} keyed fallback={<PrototypeApp />}>
        <ExplodingScene onReloaded={() => setCrashed(0)} />
      </Show>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={crashed() !== 0} onClick={() => setCrashed((count) => count + 1)}>
          Crash again
        </Button>
      </SceneControls>
    </div>
  );
}

// Startup W2. Popcorn crew -------------------------------------------------

const CREW_SIZE = 84;
const LEAD_SIZE = 104;
const POP_WIDTH = 230;

type PopPhase = "heat" | "popping" | "pile" | "exit";

/**
 * The lilac plush heats up like a kernel, then pops: each pop throws out one plush of the crew, and
 * the last pop throws the plush itself, which lands on top of the pile. A different order and
 * different arcs at each run. When the app is ready, the pile jumps out of the screen.
 */
function PopcornSplash(props: { ready: boolean; onExited: () => void }) {
  const { t } = useText();
  const reduced = prefersReducedMotion();
  const timers = sceneTimers();
  const [phase, setPhase] = createSignal<PopPhase>(reduced ? "pile" : "heat");
  const order = shuffled(ALL_CREW);
  const [faces, setFaces] = createSignal<PlushState[]>(order.map(() => "wide"));
  const [leadFace, setLeadFace] = createSignal<PlushMascotFace>("wide");
  let stage: HTMLElement | undefined;
  let leadElement: HTMLElement | undefined;
  const elements: (HTMLElement | undefined)[] = [];
  const crew = order.map(() => feltBody({ r: CREW_SIZE * 0.31, asleep: true, restAngle: random(-0.25, 0.25) }));
  const lead = feltBody({ r: LEAD_SIZE * 0.44, mass: 4000, restAngle: random(-0.12, 0.12) });
  const bodies = [...crew, lead];
  const rules: WorldRules = { gravity: 2900, bounce: 0.38, left: 0, right: 0, top: null, floor: 0 };

  function setFace(index: number, state: PlushState): void {
    setFaces((current) => current.map((value, at) => (at === index ? state : value)));
  }

  function placeLead(): void {
    if (!stage) return;
    lead.x = stage.clientWidth / 2;
    lead.y = stage.clientHeight - lead.r;
    lead.kind = "kinematic";
  }

  function squash(): void {
    play(
      leadElement?.firstElementChild ?? undefined,
      [{ scale: "1 1" }, { scale: "1.22 0.74", offset: 0.3 }, { scale: "0.92 1.1", offset: 0.65 }, { scale: "1 1" }],
      { duration: 260, easing: "ease-out", fill: "none" },
    );
  }

  function pop(index: number): void {
    const body = crew[index];
    if (!body) return;
    squash();
    Object.assign(body, {
      x: lead.x + random(-10, 10),
      y: lead.y - lead.r,
      vx: random(-520, 520),
      vy: random(-1900, -1350),
      spin: random(-16, 16),
      asleep: false,
    });
    timers.later(900, () => setFace(index, "idle"));
  }

  function heat(): void {
    const steps = 16;
    play(
      leadElement,
      Array.from({ length: steps + 1 }, (_, step) => ({
        translate: step === steps ? "0 0" : `${(step % 2 ? 1 : -1) * (1 + step * 0.35)}px 0`,
        rotate: step === steps ? "0deg" : `${(step % 2 ? 1 : -1) * step * 0.5}deg`,
      })),
      { duration: 900, easing: "linear", fill: "none" },
    );
    let at = 900;
    crew.forEach((_, index) => {
      timers.later(at, () => {
        setPhase("popping");
        pop(index);
      });
      at += random(120, 260);
    });
    timers.later(at + 180, () => {
      squash();
      setLeadFace("wide");
      lead.kind = "solid";
      lead.vx = random(-80, 80);
      lead.vy = -2500;
      lead.spin = random(-1, 1) > 0 ? 12.6 : -12.6;
    });
    timers.later(at + 1500, () => {
      setPhase("pile");
      setLeadFace("happy");
    });
  }

  function settleNow(): void {
    // Reduced motion: the pile is built at once, with no flight.
    if (!stage) return;
    const floor = stage.clientHeight;
    const middle = stage.clientWidth / 2;
    crew.forEach((body, index) => {
      const row = index < 3 ? 0 : 1;
      const column = row === 0 ? index - 1 : index - 4 + 0.5;
      Object.assign(body, {
        asleep: false,
        x: middle + column * body.r * 2 - (row === 1 ? body.r : 0),
        y: floor - body.r - row * body.r * 1.7,
      });
    });
    lead.kind = "solid";
    lead.x = middle;
    lead.y = floor - CREW_SIZE * 0.31 * 3.4 - lead.r;
    setFaces(order.map(() => "idle"));
    setLeadFace("happy");
  }

  function leave(): void {
    if (phase() === "exit") return;
    setPhase("exit");
    rules.floor = null;
    rules.left = null;
    rules.right = null;
    setFaces(order.map(() => "wide"));
    for (const body of crew) {
      body.kind = "ghost";
      body.vx = (body.x - lead.x) * 9 + random(-200, 200);
      body.vy = random(-2200, -1500);
      body.spin = random(-18, 18);
    }
    lead.kind = "ghost";
    lead.vx = 0;
    lead.vy = -600;
    timers.later(reduced ? 0 : 720, props.onExited);
  }

  onFrames((dt) => {
    if (!stage) return;
    rules.right = rules.right === null ? null : stage.clientWidth;
    rules.floor = rules.floor === null ? null : stage.clientHeight;
    if (phase() === "heat") placeLead();
    if (phase() !== "exit" || !reduced) stepWorld(bodies, rules, dt);
    drawBodies(crew, elements);
    if (leadElement) {
      const grow = phase() === "exit" ? 1 : 0;
      leadElement.style.transform = `translate(${lead.x - LEAD_SIZE / 2}px, ${lead.y - LEAD_SIZE / 2}px) rotate(${lead.angle}rad)`;
      leadElement.dataset.leaving = grow ? "true" : "";
    }
  });

  onSettled(() => {
    placeLead();
    if (reduced) settleNow();
    else heat();
  });

  // A ready app ends the splash once the pile is done; a fast app cuts the popping short.
  const readyWatch = setInterval(() => {
    if (!props.ready) return;
    if (phase() === "pile" || reduced) {
      clearInterval(readyWatch);
      leave();
    }
  }, 120);
  onSettled(() => () => clearInterval(readyWatch));

  return (
    <main
      class="wild-popcorn-splash"
      data-phase={phase()}
      role="status"
      aria-label={t("app.loading")}
      aria-busy={phase() === "exit" ? "false" : "true"}
    >
      <div
        ref={(element) => {
          stage = element;
        }}
        class="ms-scene wild-popcorn-stage"
        style={{ width: `${POP_WIDTH}px` }}
        aria-hidden="true"
      >
        <For each={order}>
          {(character, index) => (
            <span
              ref={(element) => {
                elements[untrack(index)] = element;
              }}
              class="wild-part wild-popcorn-member"
              style={{ width: `${CREW_SIZE * 0.62}px`, height: `${CREW_SIZE * 0.62}px` }}
              onPointerDown={(event) => {
                const body = crew[index()];
                if (body && phase() === "pile") grab(event, body, stage);
              }}
            >
              <PlushBot
                character={character}
                state={faces()[index()] ?? "idle"}
                size={CREW_SIZE}
                initialPhase={index() * 0.6}
                autoPause={false}
                paused={reduced}
                ariaLabel=""
              />
            </span>
          )}
        </For>
        <span
          ref={(element) => {
            leadElement = element;
          }}
          class="wild-popcorn-lead"
        >
          <Mascot size={LEAD_SIZE} face={leadFace()} />
        </span>
      </div>
    </main>
  );
}

/** The real app on the preview mock, under the popcorn splash. "App ready" sends the pile away. */
export function StartupPopcornVariant() {
  const [run, setRun] = createSignal(1);
  const [ready, setReady] = createSignal(false);
  const [visible, setVisible] = createSignal(true);
  return (
    <div class="ms-root wild-popcorn">
      <PrototypeApp />
      <Show when={visible() && run()} keyed>
        <PopcornSplash ready={ready()} onExited={() => setVisible(false)} />
      </Show>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={ready()} onClick={() => setReady(true)}>
          App ready
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setReady(false);
            setVisible(true);
            setRun((count) => count + 1);
          }}
        >
          Replay
        </Button>
      </SceneControls>
    </div>
  );
}

// Search W1. Ball-pit dive ---------------------------------------------------

/** The stage, the pit in its middle, and the top of the pit walls, in px. */
const PIT = { width: 440, height: 170, left: 110, right: 330, rim: 64, balls: 60 } as const;
const DIVER = 56;
/** How far above the ball surface the plush's centre is when it sits, and when it digs with its head out. */
const SIT_ABOVE = DIVER * 0.42;
const DIG_ABOVE = 4;

/** A point on the plush's path at time `t` of a segment, with an ease. */
interface PathKey {
  at: number;
  x: number;
  y: number;
  turn: number;
}

function along(keys: readonly [PathKey, ...PathKey[]], time: number): PathKey {
  const [first] = keys;
  if (time <= first.at) return first;
  for (let index = 1; index < keys.length; index++) {
    const from = keys[index - 1];
    const to = keys[index];
    if (!from || !to || time > to.at) continue;
    const linear = (time - from.at) / (to.at - from.at || 1);
    const ease = linear < 0.5 ? 2 * linear * linear : 1 - (-2 * linear + 2) ** 2 / 2;
    return {
      at: time,
      x: from.x + (to.x - from.x) * linear,
      y: from.y + (to.y - from.y) * ease,
      turn: from.turn + (to.turn - from.turn) * ease,
    };
  }
  return keys.at(-1) ?? first;
}

/** 0 left of the pit, 1 in the pit, 2 right of it. */
type PitZone = 0 | 1 | 2;
const zoneOf = (x: number): PitZone => (x < PIT.left ? 0 : x > PIT.right ? 2 : 1);
const ZONE_EDGES: Record<PitZone, readonly [number | null, number | null]> = {
  0: [null, PIT.left],
  1: [PIT.left, PIT.right],
  2: [PIT.right, null],
};

/** The speeds that throw a ball from where it is to land at `x`, after it goes up by `rise` px. */
function throwTo(ball: FeltBody, x: number, landY: number, rise: number, gravity: number): void {
  const vy = -Math.sqrt(2 * gravity * Math.max(rise, ball.y - landY + rise));
  const fall = (-vy + Math.sqrt(vy * vy + 2 * gravity * (landY - ball.y))) / gravity;
  ball.vx = (x - ball.x) / fall;
  ball.vy = vy;
  ball.spin = random(-16, 16);
}

/**
 * A pit of felt balls in the empty result. On each search the plush dives in head first and digs
 * with only its head out. It throws ball after ball out over the walls, looks where each one goes,
 * and comes up with nothing. The next search starts with the plush throwing the balls back in.
 */
function BallPitScene(props: { ref?: (element: HTMLElement) => void }) {
  const reduced = prefersReducedMotion();
  const [face, setFace] = createSignal<PlushMascotFace>("idle");
  const [gaze, setGaze] = createSignal<{ x: number; y: number } | null>(null);
  let stage: HTMLElement | undefined;
  let diver: HTMLElement | undefined;
  const elements: (HTMLElement | undefined)[] = [];
  const balls = Array.from({ length: PIT.balls }, (_, index) =>
    feltBody({
      r: random(7, 10),
      x: random(PIT.left + 12, PIT.right - 12),
      y: reduced ? PIT.height - 10 - (index % 4) * 17 : random(-300, -20),
      restAngle: random(-3, 3),
    }),
  );
  const zones: PitZone[] = balls.map(() => 1);
  const plush = feltBody({ r: DIVER * 0.42, kind: "kinematic", x: (PIT.left + PIT.right) / 2, y: PIT.rim });
  const bodies = [...balls, plush];
  const rules: WorldRules = {
    gravity: 2200,
    bounce: 0.42,
    left: 0,
    right: PIT.width,
    top: null,
    floor: PIT.height,
    settle: true,
  };
  let path: [PathKey, ...PathKey[]] = [{ at: 0, x: plush.x, y: plush.y, turn: 0 }];
  /** When the plush is under the balls: from the splash until it comes up. */
  let under: readonly [number, number] = [0, 0];
  let start = performance.now();
  /** The search that runs now. Steps of an older search do nothing. */
  let search = 0;
  const timers = sceneTimers();

  /**
   * The top of the balls in the pit near `x`. The third-highest ball counts, so one ball in the air
   * does not lift the plush. A ball on the plush's head does not count either.
   */
  function surfaceAt(x: number): number {
    const tops = balls
      .filter(
        (ball) =>
          zoneOf(ball.x) === 1 &&
          Math.abs(ball.x - x) < 34 &&
          Math.abs(ball.vy) < 240 &&
          (plush.asleep || ball.y > plush.y),
      )
      .map((ball) => ball.y - ball.r)
      .sort((one, other) => one - other);
    return tops[Math.min(2, tops.length - 1)] ?? PIT.height;
  }

  function spray(x: number, strength: number): void {
    for (const ball of balls) {
      const distance = Math.abs(ball.x - x);
      if (distance > 90 || zoneOf(ball.x) !== 1) continue;
      const push = 1 - distance / 90;
      ball.vy -= strength * push + random(0, 200);
      ball.vx += Math.sign(ball.x - x || random(-1, 1)) * strength * 0.15 * push;
      ball.spin = random(-20, 20);
    }
  }

  /** Throws the ball nearest to the plush's head out of the pit, to the side it is on. */
  function toss(): void {
    const head = { x: plush.x, y: plush.y - DIVER * 0.4 };
    const ball = balls
      .filter((one) => zoneOf(one.x) === 1 && one.y < plush.y + 12 && Math.abs(one.x - plush.x) < 70)
      .sort((one, other) => Math.hypot(one.x - head.x, one.y - head.y) - Math.hypot(other.x - head.x, other.y - head.y))
      .at(0);
    if (!ball) return;
    const left = ball.x < (PIT.left + PIT.right) / 2;
    throwTo(
      ball,
      left ? random(14, PIT.left - 22) : random(PIT.right + 22, PIT.width - 14),
      PIT.height - ball.r,
      random(70, 100),
      rules.gravity,
    );
    setGaze({ x: left ? -1 : 1, y: -0.6 });
  }

  /** Balls that go straight up out of a side zone, and the x where each one lands in the pit. */
  const lifting = new Map<FeltBody, number>();

  /**
   * Throws each ball that is out of the pit back in. Each ball goes straight up first: a ball next
   * to a wall would hit the wall before it is above the rim. Returns how long it takes.
   */
  function tidy(mine: number): number {
    lifting.clear();
    const outside = balls.filter((ball) => zoneOf(ball.x) !== 1);
    outside.forEach((ball, index) => {
      timers.later(index * 45, () => {
        if (mine !== search) return;
        ball.vx = 0;
        ball.vy = -Math.sqrt(2 * rules.gravity * (ball.y - PIT.rim + random(36, 60)));
        ball.spin = random(-16, 16);
        lifting.set(ball, random(PIT.left + 24, PIT.right - 24));
      });
    });
    if (outside.length > 0) setGaze({ x: 0, y: -1 });
    return outside.length === 0 ? 0 : outside.length * 45 + 420;
  }

  function dive(): void {
    if (reduced) return;
    search += 1;
    const mine = search;
    setFace("wide");
    const wait = tidy(mine);
    timers.later(wait, () => {
      if (mine !== search) return;
      const from = { x: plush.x, y: plush.y };
      const into = random(PIT.left + 60, PIT.right - 60);
      const left = PIT.left + 40;
      const right = PIT.right - 40;
      const [first, second] = into < (PIT.left + PIT.right) / 2 ? [right, left] : [left, right];
      const come = random(PIT.left + 70, PIT.right - 70);
      const level = surfaceAt(into);
      start = performance.now();
      under = [0.6, 2.4];
      setGaze(null);
      // The y of the digging keys is only a start: while it digs, the plush rides the ball surface.
      path = [
        { at: 0, x: from.x, y: from.y, turn: 0 },
        { at: 0.3, x: (from.x + into) / 2, y: -10, turn: -0.7 },
        { at: 0.6, x: into, y: level + 12, turn: -3.1 },
        { at: 0.85, x: into, y: level - DIG_ABOVE, turn: -6.28 },
        { at: 1.45, x: first, y: level - DIG_ABOVE, turn: -6.28 },
        { at: 2.05, x: second, y: level - DIG_ABOVE, turn: -6.28 },
        { at: 2.4, x: come, y: level - DIG_ABOVE, turn: -6.28 },
        { at: 2.7, x: come, y: level - SIT_ABOVE - 34, turn: -6.28 },
        { at: 2.95, x: come, y: level - SIT_ABOVE, turn: -6.28 },
      ];
      timers.later(600, () => mine === search && spray(into, 650));
      for (let step = 0; step < 9; step++) timers.later(900 + step * 160, () => mine === search && toss());
      timers.later(2400, () => mine === search && spray(come, 420));
      timers.later(3000, () => {
        if (mine !== search) return;
        setGaze(null);
        setFace("idle");
        shrug();
      });
    });
  }

  function shrug(): void {
    const eyes = diver?.querySelector(".ui-plush-eyes") ?? undefined;
    play(
      eyes,
      [
        { translate: "0 0" },
        { translate: "-4px 0", offset: 0.2 },
        { translate: "4px 0", offset: 0.55 },
        { translate: "0 0" },
      ],
      { duration: 820, easing: "ease-in-out", fill: "none" },
    );
    play(
      diver?.firstElementChild ?? undefined,
      [{ rotate: "0deg" }, { rotate: "-12deg", offset: 0.4 }, { rotate: "-12deg", offset: 0.75 }, { rotate: "0deg" }],
      { duration: 900, delay: 820, fill: "none" },
    );
  }

  /** Keeps each ball on its side of a pit wall while it is lower than the top of the wall. */
  function walls(): void {
    balls.forEach((ball, index) => {
      if (ball.asleep) return;
      if (ball.y + ball.r * 0.5 < PIT.rim) {
        zones[index] = zoneOf(ball.x);
        return;
      }
      const [low, high] = ZONE_EDGES[zones[index] ?? 1];
      if (low !== null && ball.x - ball.r < low) {
        ball.x = low + ball.r;
        if (ball.vx < 0) ball.vx = -ball.vx * rules.bounce;
      }
      if (high !== null && ball.x + ball.r > high) {
        ball.x = high - ball.r;
        if (ball.vx > 0) ball.vx = -ball.vx * rules.bounce;
      }
    });
  }

  onFrames((dt, now) => {
    const time = (now - start) / 1000;
    const point = along(path, time);
    const digging = time > under[0] + 0.25 && time < under[1];
    const done = time > (path.at(-1)?.at ?? 0);
    const wiggle = digging ? Math.sin(time * 18) : 0;
    // Under the balls the plush is out of the world, so the balls close over it and only its head shows.
    plush.asleep = time > under[0] && time < under[1];
    let y = point.y;
    if (digging || done) {
      const target = surfaceAt(point.x) - (digging ? DIG_ABOVE : SIT_ABOVE);
      y = plush.y + (target - plush.y) * Math.min(1, dt * (digging ? 12 : 6));
    }
    plush.vx = (point.x - plush.x) / Math.max(dt, 0.001);
    plush.vy = (y - plush.y) / Math.max(dt, 0.001);
    plush.x = point.x;
    plush.y = y;
    plush.angle = point.turn + wiggle * 0.14;
    stepWorld(bodies, rules, dt);
    walls();
    for (const [ball, x] of lifting) {
      if (ball.y + ball.r < PIT.rim - 6) throwTo(ball, x, PIT.height - 30, 16, rules.gravity);
      if (ball.y + ball.r < PIT.rim - 6 || ball.vy > 0) lifting.delete(ball);
    }
    drawBodies(balls, elements);
    if (diver) {
      const bob = wiggle * 3;
      diver.style.transform = `translate(${plush.x - DIVER / 2}px, ${plush.y + bob - DIVER * 0.5}px) rotate(${plush.angle}rad)`;
    }
  });

  onSettled(() => {
    timers.later(900, dive);
    let typing: ReturnType<typeof setTimeout> | undefined;
    const again = (event: Event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      clearTimeout(typing);
      if (!reduced) setGaze({ x: -0.8, y: -1 });
      typing = setTimeout(dive, 450);
    };
    document.addEventListener("input", again, true);
    return () => {
      clearTimeout(typing);
      document.removeEventListener("input", again, true);
    };
  });

  return (
    <span
      ref={(element) => {
        stage = element;
        props.ref?.(element);
      }}
      class="ms-scene wild-pit"
      style={{ width: `${PIT.width}px`, height: `${PIT.height}px` }}
      aria-hidden="true"
    >
      <span
        ref={(element) => {
          diver = element;
        }}
        class="wild-pit-diver"
      >
        <Mascot size={DIVER} face={face()} gaze={gaze()} />
      </span>
      <For each={balls}>
        {(body, index) => (
          <img
            ref={(element) => {
              elements[untrack(index)] = element;
            }}
            class="wild-part"
            src={BALLS[index() % BALLS.length]}
            alt=""
            draggable={false}
            style={{ width: `${body.r * 2}px`, height: `${body.r * 2}px` }}
            onPointerDown={(event) => grab(event, body, stage)}
          />
        )}
      </For>
      <span
        class="wild-pit-rim"
        style={{ top: `${PIT.rim}px`, left: `${PIT.left - 3}px`, width: `${PIT.right - PIT.left + 6}px` }}
      />
    </span>
  );
}

/**
 * The real search window. Each search finds nothing: type any text, and the plush dives again. The
 * window makes a new empty result for each query, so one scene moves into each new one and keeps
 * its balls.
 */
export function SearchBallPitVariant() {
  let scene: HTMLElement | undefined;
  const empty = useElement(".global-search-empty");
  createEffect(empty, (element) => {
    if (element && scene && scene.parentElement !== element) element.prepend(scene);
  });
  return (
    <div class="ms-root wild-search">
      <GlobalSearch
        open
        agents={STORY_AGENTS}
        channels={[]}
        routines={[]}
        actions={[]}
        onSearchMessages={async () => ({ ...NO_PAGE })}
        onSearchFiles={async () => ({ ...NO_PAGE })}
        onOpenChange={() => {}}
        onSelectAgent={() => {}}
        onSelectChannel={() => {}}
        onSelectMessage={() => {}}
        onSelectRoutine={() => {}}
      />
      <div hidden>
        <BallPitScene
          ref={(element) => {
            scene = element;
          }}
        />
      </div>
    </div>
  );
}

// No agents W1. Magic hat -----------------------------------------------------

const HAT_CREW: readonly PlushCharacterId[] = ["vita", "cloe", "yoshi"];
const HAT_SIZE = 44;
const HAT_LOOP_MS = 7600;
/** How far right of the hat the crew stack their tower, in px. */
const TOWER_X = 76;

/**
 * The plush bonks a felt top hat. Each bonk throws one crew plush out of the hat, and the crew
 * stack into a tower beside it. The tower wobbles and falls, and the crew dive back into the hat.
 */
function MagicHatScene() {
  const reduced = prefersReducedMotion();
  let root: HTMLElement | undefined;

  function show(): void {
    const lead = root?.querySelector(".wild-hat-lead") ?? undefined;
    const hat = root?.querySelector(".wild-hat") ?? undefined;
    const crew = [...(root?.querySelectorAll(".wild-hat-member") ?? [])];
    for (const element of [lead, hat, ...crew]) for (const running of element?.getAnimations() ?? []) running.cancel();
    const tower = (index: number) => `${TOWER_X}px ${-index * 24}px`;
    const wobble = 300 + crew.length * 1250 + 200;
    crew.forEach((member, index) => {
      const bonk = 300 + index * 1250;
      play(
        lead,
        [
          { translate: "0 0", rotate: "0deg" },
          { translate: "26px -44px", rotate: "20deg", offset: 0.45 },
          { translate: "38px -26px", rotate: "28deg", offset: 0.6 },
          { translate: "0 0", rotate: "0deg" },
        ],
        { duration: 600, delay: bonk, easing: "ease-in-out", fill: "none" },
      );
      play(
        hat,
        [{ scale: "1 1" }, { scale: "1.14 0.78", offset: 0.3 }, { scale: "0.94 1.1", offset: 0.6 }, { scale: "1 1" }],
        { duration: 360, delay: bonk + 360, easing: "ease-out", fill: "none" },
      );
      play(
        member,
        [
          { translate: "0 34px", rotate: "0deg", opacity: 0 },
          { translate: "0 8px", rotate: "0deg", opacity: 1, offset: 0.08 },
          { translate: `${TOWER_X * 0.4}px -96px`, rotate: "200deg", offset: 0.45 },
          { translate: `${TOWER_X}px ${-index * 24 - 12}px`, rotate: "360deg", offset: 0.82 },
          { translate: tower(index), rotate: "360deg", scale: "1.2 0.78", offset: 0.9 },
          { translate: tower(index), rotate: "360deg", scale: "1 1", opacity: 1 },
        ],
        { duration: 820, delay: bonk + 400, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)", fill: "both" },
      );
      // The tower sways, more at the top, then each plush dives back into the hat, top first.
      const sway = (index + 1) * 5;
      play(
        member,
        [
          { translate: tower(index), rotate: "360deg" },
          { translate: `${TOWER_X + sway}px ${-index * 24}px`, rotate: `${360 + sway}deg`, offset: 0.25 },
          { translate: `${TOWER_X - sway}px ${-index * 24}px`, rotate: `${360 - sway}deg`, offset: 0.55 },
          { translate: `${TOWER_X + sway * 1.6}px ${-index * 24}px`, rotate: `${360 + sway * 2}deg` },
        ],
        { duration: 900, delay: wobble, easing: "ease-in-out", fill: "forwards" },
      );
      const back = wobble + 900 + (crew.length - 1 - index) * 300;
      play(
        member,
        [
          { translate: `${TOWER_X + sway * 1.6}px ${-index * 24}px`, rotate: `${360 + sway * 2}deg`, opacity: 1 },
          { translate: `${TOWER_X * 0.5}px ${-110 - index * 10}px`, rotate: "560deg", offset: 0.5 },
          { translate: "0 8px", rotate: "720deg", opacity: 1, offset: 0.88 },
          { translate: "0 34px", rotate: "720deg", opacity: 0 },
        ],
        { duration: 680, delay: back, easing: "ease-in", fill: "forwards" },
      );
      play(hat, [{ scale: "1 1" }, { scale: "0.88 1.16", offset: 0.4 }, { scale: "1 1" }], {
        duration: 300,
        delay: back + 600,
        fill: "none",
      });
    });
  }

  onSettled(() => {
    if (reduced) return;
    show();
    const loop = setInterval(show, HAT_LOOP_MS);
    return () => clearInterval(loop);
  });

  return (
    <span
      ref={(element) => {
        root = element;
      }}
      class="ms-scene wild-hat-scene"
      data-reduced={reduced ? "true" : undefined}
      aria-hidden="true"
    >
      <span class="wild-hat-lead">
        <Mascot size={50} face="wide" />
      </span>
      <For each={HAT_CREW}>
        {(character, index) => (
          <span class="wild-hat-member" style={{ "z-index": String(3 - index()) }}>
            <PlushBot
              character={character}
              state="wide"
              size={HAT_SIZE}
              initialPhase={index() * 0.8}
              autoPause={false}
              paused={reduced}
              ariaLabel=""
            />
          </span>
        )}
      </For>
      <svg class="wild-hat" viewBox="0 0 80 70" aria-hidden="true">
        <defs>
          <filter id="wild-hat-felt" filterUnits="userSpaceOnUse" x="-4" y="-4" width="88" height="78">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="2.4" />
          </filter>
        </defs>
        <g filter="url(#wild-hat-felt)">
          <path class="wild-hat-crown" d="M16 8 Q40 0 64 8 L60 52 Q40 58 20 52 Z" />
          <path class="wild-hat-band" d="M19 40 Q40 46 61 40 L60 50 Q40 56 20 50 Z" />
          <ellipse class="wild-hat-brim" cx="40" cy="56" rx="38" ry="9" />
        </g>
      </svg>
    </span>
  );
}

/** The real sidebar of a server with no agents yet. */
export function AgentsMagicHatVariant() {
  let root: HTMLDivElement | undefined;
  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class="ms-root ms-sidebar wild-agents"
    >
      <div class="ms-sidebar-frame">
        <Sidebar {...SIDEBAR_BASE} agents={[]} agentStates={{}} />
      </div>
      <MountInto selector=".empty-search" root={() => root}>
        <MagicHatScene />
      </MountInto>
    </div>
  );
}

// Task done W1. Felt fireworks --------------------------------------------------

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  ball: number;
  angle: number;
  spin: number;
  born: number;
  life: number;
  rocket: boolean;
  apex: number;
  trail: { x: number; y: number }[];
}

const CONGA: readonly (PlushCharacterId | "lead")[] = ["lead", "vita", "cloe", "yoshi", "nexo", "malu", "fred"];
const CONGA_SIZE = 56;
const SHOW_MS = 5600;

/**
 * Felt balls shoot up on yarn trails and burst into rings of small felt balls, while the whole crew
 * hops across the bottom in a conga line, the lilac plush in front.
 */
function FireworksShow(props: { onDone: () => void }) {
  const reduced = prefersReducedMotion();
  let canvas: HTMLCanvasElement | undefined;
  const line: (HTMLElement | undefined)[] = [];
  const images = BALLS.map((src) => {
    const image = new Image();
    image.src = src;
    return image;
  });
  const sparks: Spark[] = [];
  const begin = performance.now();
  const launches = Array.from({ length: 7 }, (_, index) => ({
    at: index * random(380, 560),
    x: random(0.12, 0.88),
    apex: random(0.12, 0.42),
    ball: index % images.length,
    done: false,
  }));

  function burst(rocket: Spark, now: number): void {
    const count = Math.round(random(18, 28));
    const rings = Math.random() > 0.6 ? 2 : 1;
    for (let ring = 0; ring < rings; ring++) {
      for (let index = 0; index < count; index++) {
        const angle = (index / count) * Math.PI * 2 + random(-0.08, 0.08);
        const speed = (ring === 0 ? random(300, 420) : random(140, 200)) * (rocket.size / 22);
        sparks.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: random(9, 15),
          ball: ring === 0 ? rocket.ball : (rocket.ball + 1) % images.length,
          angle: random(0, 6),
          spin: random(-8, 8),
          born: now,
          life: random(1.3, 1.9),
          rocket: false,
          apex: 0,
          trail: [],
        });
      }
    }
  }

  onFrames((dt, now) => {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    const elapsed = now - begin;
    for (const launch of launches) {
      if (launch.done || elapsed < launch.at) continue;
      launch.done = true;
      const apexY = height * launch.apex;
      const startY = height + 20;
      // Speed for the rocket to stop at its apex under the rocket gravity below.
      const rise = Math.sqrt(2 * 900 * (startY - apexY));
      sparks.push({
        x: width * launch.x,
        y: startY,
        vx: random(-60, 60),
        vy: -rise,
        size: 22,
        ball: launch.ball,
        angle: 0,
        spin: random(-10, 10),
        born: now,
        life: 10,
        rocket: true,
        apex: apexY,
        trail: [],
      });
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    for (let index = sparks.length - 1; index >= 0; index--) {
      const spark = sparks[index];
      if (!spark) continue;
      const age = (now - spark.born) / 1000;
      if (spark.rocket) {
        spark.vy += 900 * dt;
        if (spark.vy >= -40) {
          sparks.splice(index, 1);
          burst(spark, now);
          continue;
        }
      } else {
        spark.vy += 520 * dt;
        spark.vx *= 0.985;
        spark.vy *= 0.985;
        if (age > spark.life) {
          sparks.splice(index, 1);
          continue;
        }
      }
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.angle += spark.spin * dt;
      spark.trail.push({ x: spark.x, y: spark.y });
      if (spark.trail.length > (spark.rocket ? 14 : 4)) spark.trail.shift();
      const fade = spark.rocket ? 1 : Math.min(1, (spark.life - age) / (spark.life * 0.4));
      const image = images[spark.ball];
      if (!image?.complete) continue;
      spark.trail.forEach((point, step) => {
        const share = (step + 1) / spark.trail.length;
        const size = spark.size * (spark.rocket ? 0.35 + share * 0.4 : 0.6);
        context.globalAlpha = fade * share * (spark.rocket ? 0.55 : 0.25);
        context.drawImage(image, point.x - size / 2, point.y - size / 2, size, size);
      });
      context.globalAlpha = fade;
      context.save();
      context.translate(spark.x, spark.y);
      context.rotate(spark.angle);
      context.drawImage(image, -spark.size / 2, -spark.size / 2, spark.size, spark.size);
      context.restore();
    }
    context.globalAlpha = 1;
    // The conga line crosses from left to right; each plush hops half a beat after the one in front.
    const progress = elapsed / SHOW_MS;
    const travel = width + CONGA.length * CONGA_SIZE * 1.1 + 80;
    line.forEach((element, index) => {
      if (!element) return;
      const x = -CONGA_SIZE - 40 + progress * travel - index * CONGA_SIZE * 1.05;
      const beat = elapsed / 230 - index * 0.55;
      const hop = Math.abs(Math.sin(beat)) * 26;
      const lean = Math.cos(beat) * 9;
      element.style.transform = `translate(${x}px, ${-hop}px) rotate(${lean}deg)`;
    });
    if (elapsed > SHOW_MS + 400 && sparks.length === 0) props.onDone();
  }, 1);

  onSettled(() => {
    if (!reduced) return;
    const timer = setTimeout(props.onDone, 2400);
    return () => clearTimeout(timer);
  });

  return (
    <div class="ms-scene wild-fireworks" data-reduced={reduced ? "true" : undefined} aria-hidden="true">
      <Show when={!reduced}>
        <canvas
          ref={(element) => {
            canvas = element;
          }}
          class="wild-fireworks-sky"
        />
      </Show>
      <div class="wild-conga">
        <For each={CONGA}>
          {(member, index) => (
            <span
              ref={(element) => {
                line[untrack(index)] = element;
              }}
              class="wild-conga-member"
            >
              {member === "lead" ? (
                <Mascot size={CONGA_SIZE} face="happy" />
              ) : (
                <PlushBot
                  character={member}
                  expression="heureux"
                  size={CONGA_SIZE}
                  initialPhase={index() * 0.5}
                  autoPause={false}
                  paused={reduced}
                  ariaLabel=""
                />
              )}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

/** The real app on the preview mock. "Task done" sets off the fireworks over it. */
export function CelebrateFireworksVariant() {
  const [show, setShow] = createSignal(1);
  return (
    <div class="ms-root wild-celebrate">
      <PrototypeApp />
      <Show when={show()} keyed>
        <FireworksShow onDone={() => setShow(0)} />
      </Show>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={show() !== 0} onClick={() => setShow((count) => count + 1)}>
          Task done
        </Button>
      </SceneControls>
    </div>
  );
}

// Waiting W1. Snoring plush ------------------------------------------------------

const BREATH_MS = 2600;

interface Snore {
  id: number;
  big: boolean;
  drift: number;
}

/**
 * The plush sleeps in a felt sleeping bag while the limit resets. Each breath lets out a felt "z"
 * ball that floats up and pops; every fifth one is a big snore that wakes the plush for a moment.
 * A tap on the plush makes it jump out of the bag.
 */
function SnoringScene() {
  const reduced = prefersReducedMotion();
  const [snores, setSnores] = createSignal<Snore[]>([]);
  const [eyes, setEyes] = createSignal<"open" | "closed">("closed");
  const [face, setFace] = createSignal<PlushMascotFace>("idle");
  const timers = sceneTimers();
  let sleeper: HTMLElement | undefined;
  let bag: HTMLElement | undefined;
  let count = 0;

  function wake(big: boolean): void {
    setEyes("open");
    setFace("wide");
    play(
      sleeper,
      big
        ? [
            { translate: "0 0", rotate: "0deg" },
            { translate: "0 -120px", rotate: "-200deg", offset: 0.45 },
            { translate: "0 -10px", rotate: "-360deg", offset: 0.8 },
            { translate: "0 0", rotate: "-360deg" },
          ]
        : [{ translate: "0 0" }, { translate: "0 -14px", offset: 0.4 }, { translate: "0 0" }],
      { duration: big ? 900 : 380, easing: "ease-out", fill: "none" },
    );
    play(bag, [{ scale: "1 1" }, { scale: "1.08 0.86", offset: 0.4 }, { scale: "1 1" }], {
      duration: 420,
      delay: big ? 700 : 0,
      fill: "none",
    });
    const eyeLayer = sleeper?.querySelector(".ui-plush-eyes") ?? undefined;
    play(
      eyeLayer,
      [
        { translate: "0 0" },
        { translate: "-4px 0", offset: 0.3 },
        { translate: "4px 0", offset: 0.65 },
        { translate: "0 0" },
      ],
      { duration: 900, delay: big ? 900 : 400, easing: "ease-in-out", fill: "none" },
    );
    timers.later(big ? 2000 : 1500, () => {
      setFace("idle");
      setEyes("closed");
    });
  }

  function breathe(): void {
    count += 1;
    const big = count % 5 === 0;
    const id = count;
    setSnores((current) => [...current.slice(-4), { id, big, drift: random(-20, 30) }]);
    timers.later(2800, () => setSnores((current) => current.filter((snore) => snore.id !== id)));
    if (big) timers.later(300, () => wake(false));
  }

  onSettled(() => {
    if (reduced) return;
    breathe();
    const clock = setInterval(breathe, BREATH_MS);
    return () => clearInterval(clock);
  });

  return (
    <div class="ms-scene wild-sleep" data-reduced={reduced ? "true" : undefined} aria-hidden="true">
      <For each={snores()}>
        {(snore) => (
          <span
            class="wild-snore"
            data-big={snore.big ? "true" : undefined}
            style={{ "--wild-drift": `${snore.drift}px` }}
          >
            <img src={BALLS[snore.id % BALLS.length]} alt="" draggable={false} />
            <span class="wild-snore-letter">z</span>
          </span>
        )}
      </For>
      <span
        ref={(element) => {
          sleeper = element;
        }}
        class="wild-sleeper"
        onPointerDown={() => {
          if (!reduced) wake(true);
        }}
      >
        <Mascot size={78} face={face()} eyes={eyes()} />
      </span>
      <span
        ref={(element) => {
          bag = element;
        }}
        class="wild-bag"
      >
        <svg viewBox="0 0 200 80" aria-hidden="true">
          <defs>
            <filter id="wild-bag-felt" filterUnits="userSpaceOnUse" x="-6" y="-6" width="212" height="92">
              <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="9" />
              <feDisplacementMap in="SourceGraphic" scale="3" />
            </filter>
          </defs>
          <g filter="url(#wild-bag-felt)">
            <path class="wild-bag-body" d="M10 22 Q100 6 190 22 Q198 50 186 74 L14 74 Q2 50 10 22 Z" />
            <path class="wild-bag-fold" d="M12 22 Q100 8 188 22 Q186 34 180 36 Q100 24 20 36 Q14 34 12 22 Z" />
            <path class="wild-bag-zip" d="M150 30 Q156 52 150 72" />
          </g>
        </svg>
      </span>
    </div>
  );
}

/** A provider usage limit: the real composer notice, with the plush asleep above it. */
export function WaitingSnoringVariant() {
  const { t } = useText();
  return (
    <div class="ms-root wild-wait">
      <div class="wild-wait-column">
        <SnoringScene />
        <ComposerNotice
          tone="danger"
          title={t("chat.usageLimit.title", { provider: "Claude" })}
          body={t("composer.usageLimit.resets", { provider: "Claude", reset: "in 14 minutes" })}
        />
      </div>
    </div>
  );
}

// Crash W2. Dizzy plush ---------------------------------------------------------

const DIZZY_SIZE = 112;
const DIZZY_STAGE = { width: 280, height: 180 };
const STAR_COUNT = 5;

type DizzyPhase = "spinning" | "down" | "rising";

/** The centre of the felt-ball orbit, in the stage: above the head, then beside the head on the floor. */
const ORBIT = {
  standing: { x: 140, y: DIZZY_STAGE.height - DIZZY_SIZE - 6 },
  lying: { x: 226, y: DIZZY_STAGE.height - 70 },
} as const;

/**
 * The plush spins faster and faster, felt balls start to circle its head like cartoon stars, and it
 * falls flat. Its eyes roll and the balls keep circling. Reload stands it up, it shakes its head, and
 * the balls fly away.
 */
function DizzyScene(props: { onReloaded: () => void }) {
  const reduced = prefersReducedMotion();
  const timers = sceneTimers();
  const [phase, setPhase] = createSignal<DizzyPhase>(reduced ? "down" : "spinning");
  const [face, setFace] = createSignal<PlushMascotFace>("wide");
  let plush: HTMLElement | undefined;
  let rolling: Animation | undefined;
  const stars: (HTMLElement | undefined)[] = [];
  const sizes = Array.from({ length: STAR_COUNT }, () => random(14, 22));
  const flight = sizes.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 }));
  const orbit = { x: 0, y: 0, angle: random(0, Math.PI * 2), shown: reduced ? 1 : 0, flying: false };
  Object.assign(orbit, reduced ? ORBIT.lying : ORBIT.standing);
  let target: { x: number; y: number } = reduced ? ORBIT.lying : ORBIT.standing;

  function spin(): void {
    play(
      plush,
      [
        { rotate: "0deg", translate: "0 0" },
        { rotate: "200deg", translate: "0 -18px", offset: 0.3 },
        { rotate: "560deg", translate: "0 0", offset: 0.6 },
        { rotate: "1080deg", translate: "0 -10px", offset: 0.85 },
        { rotate: "1440deg", translate: "0 0" },
      ],
      { duration: 1700, easing: "ease-in", fill: "none" },
    );
    timers.later(1700, wobble);
  }

  function wobble(): void {
    play(
      plush,
      [
        { rotate: "0deg" },
        { rotate: "-16deg", offset: 0.25 },
        { rotate: "12deg", offset: 0.55 },
        { rotate: "-6deg", offset: 0.8 },
        { rotate: "0deg" },
      ],
      { duration: 700, easing: "ease-in-out", fill: "none" },
    );
    timers.later(700, fall);
  }

  function fall(): void {
    setPhase("down");
    target = ORBIT.lying;
    play(
      plush,
      [
        { rotate: "0deg", translate: "0 0" },
        { rotate: "104deg", translate: "-56px 0", offset: 0.6 },
        { rotate: "84deg", translate: "-56px 0", offset: 0.8 },
        { rotate: "90deg", translate: "-56px 0" },
      ],
      { duration: 520, easing: "ease-in", fill: "none" },
    );
    rolling = play(
      plush?.querySelector(".ui-plush-eyes") ?? undefined,
      [
        { translate: "4px 0" },
        { translate: "0 4px" },
        { translate: "-4px 0" },
        { translate: "0 -4px" },
        { translate: "4px 0" },
      ],
      { duration: 900, delay: 400, iterations: Number.POSITIVE_INFINITY, easing: "linear", fill: "none" },
    );
  }

  function reload(): void {
    if (phase() !== "down") return;
    setPhase("rising");
    rolling?.cancel();
    setFace("happy");
    play(
      plush,
      [
        { rotate: "90deg", translate: "-56px 0" },
        { rotate: "-14deg", translate: "0 -24px", offset: 0.55 },
        { rotate: "6deg", translate: "0 0", offset: 0.8 },
        { rotate: "0deg", translate: "0 0" },
      ],
      { duration: 640, easing: "ease-out", fill: "none" },
    );
    play(
      plush?.querySelector(".ui-plush-eyes") ?? undefined,
      [
        { translate: "0 0" },
        { translate: "-5px 0", offset: 0.25 },
        { translate: "5px 0", offset: 0.5 },
        { translate: "-3px 0", offset: 0.75 },
        { translate: "0 0" },
      ],
      { duration: 560, delay: 640, fill: "none" },
    );
    timers.later(700, () => {
      orbit.flying = true;
      flight.forEach((star, index) => {
        const angle = orbit.angle + (index * Math.PI * 2) / STAR_COUNT;
        Object.assign(star, {
          x: ORBIT.standing.x + Math.cos(angle) * 60,
          y: ORBIT.standing.y + Math.sin(angle) * 16,
          vx: Math.cos(angle) * random(500, 900),
          vy: -random(500, 900),
        });
      });
    });
    timers.later(1700, props.onReloaded);
  }

  onFrames((dt) => {
    if (orbit.flying) {
      flight.forEach((star, index) => {
        star.vy += 2000 * dt;
        star.x += star.vx * dt;
        star.y += star.vy * dt;
        const element = stars[index];
        if (element) element.style.transform = `translate(${star.x}px, ${star.y}px)`;
      });
      return;
    }
    if (!reduced) {
      orbit.angle += dt * (phase() === "spinning" ? 7 : 4);
      orbit.shown = Math.min(1, orbit.shown + dt * 0.8);
      orbit.x += (target.x - orbit.x) * Math.min(1, dt * 5);
      orbit.y += (target.y - orbit.y) * Math.min(1, dt * 5);
    }
    const rx = 58 * orbit.shown;
    const ry = 15 * orbit.shown;
    stars.forEach((element, index) => {
      if (!element) return;
      const angle = orbit.angle + (index * Math.PI * 2) / STAR_COUNT;
      const depth = Math.sin(angle);
      const size = sizes[index] ?? 16;
      element.style.zIndex = depth > 0 ? "3" : "1";
      element.style.opacity = String(orbit.shown);
      element.style.transform = `translate(${orbit.x + Math.cos(angle) * rx - size / 2}px, ${orbit.y + depth * ry - size / 2}px) scale(${0.75 + (depth + 1) * 0.15})`;
    });
  });

  onSettled(() => {
    if (!reduced) spin();
  });

  return (
    <div class="wild-crash-panel">
      <div
        class="ms-scene wild-dizzy"
        data-phase={phase()}
        style={{ width: `${DIZZY_STAGE.width}px`, height: `${DIZZY_STAGE.height}px` }}
        aria-hidden="true"
      >
        <For each={sizes}>
          {(size, index) => (
            <img
              ref={(element) => {
                stars[untrack(index)] = element;
              }}
              class="wild-dizzy-star"
              src={BALLS[(untrack(index) + 1) % BALLS.length]}
              alt=""
              draggable={false}
              style={{ width: `${size}px`, height: `${size}px` }}
            />
          )}
        </For>
        <Mascot
          size={DIZZY_SIZE}
          face={face()}
          class="wild-dizzy-plush"
          ref={(element) => {
            plush = element;
          }}
        />
      </div>
      <Heading as="h1" size="md">
        OpenBot stopped working
      </Heading>
      <Text as="p" variant="body-sm" tone="muted">
        Your chats and files are safe on this computer.
      </Text>
      <Button onClick={() => (reduced ? props.onReloaded() : reload())} disabled={phase() !== "down"}>
        Reload
      </Button>
    </div>
  );
}

/** A new screen for a renderer crash. The plush is dizzy; Reload stands it up and shows the real app. */
export function CrashDizzyVariant() {
  const [crashed, setCrashed] = createSignal(1);
  return (
    <div class="ms-root wild-crash">
      <Show when={crashed()} keyed fallback={<PrototypeApp />}>
        <DizzyScene onReloaded={() => setCrashed(0)} />
      </Show>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={crashed() !== 0} onClick={() => setCrashed((count) => count + 1)}>
          Crash again
        </Button>
      </SceneControls>
    </div>
  );
}

// Search W3. Tumbleweed ---------------------------------------------------------

const WEED = 46;
const PRAIRIE = { width: 360, height: 120 };
const WATCHER = 56;
/** The centre of the plush's eyes, in the prairie. */
const WATCHER_EYES = { x: 24 + WATCHER / 2, y: PRAIRIE.height - WATCHER * 0.55 };

/**
 * A felt tumbleweed rolls across the empty result, hops over the plush, and rolls out. The plush
 * follows it with its eyes, ducks, and shrugs. Each new search sends another one.
 */
function TumbleweedScene() {
  const reduced = prefersReducedMotion();
  const timers = sceneTimers();
  const [gaze, setGaze] = createSignal<{ x: number; y: number } | null>(reduced ? { x: 1, y: 0.2 } : null);
  const [face, setFace] = createSignal<PlushMascotFace>("idle");
  let weed: HTMLElement | undefined;
  let watcher: HTMLElement | undefined;
  const body = feltBody({ r: WEED / 2, x: 190, y: PRAIRIE.height - WEED / 2, asleep: !reduced });
  const rules: WorldRules = { gravity: 1700, bounce: 0.5, left: null, right: null, top: null, floor: PRAIRIE.height };
  let hopped = false;

  function roll(): void {
    if (reduced || !body.asleep) return;
    hopped = false;
    Object.assign(body, {
      x: PRAIRIE.width + WEED,
      y: PRAIRIE.height - WEED,
      vx: -random(170, 240),
      vy: -random(100, 300),
      asleep: false,
    });
    setFace("wide");
  }

  function duck(): void {
    play(
      watcher,
      [{ scale: "1 1" }, { scale: "1.12 0.78", offset: 0.3 }, { scale: "1.12 0.78", offset: 0.6 }, { scale: "1 1" }],
      { duration: 620, easing: "ease-in-out", fill: "none" },
    );
  }

  function shrug(): void {
    setFace("idle");
    play(
      watcher?.querySelector(".ui-plush-eyes") ?? undefined,
      [
        { translate: "0 0" },
        { translate: "-4px 0", offset: 0.25 },
        { translate: "4px 0", offset: 0.6 },
        { translate: "0 0" },
      ],
      { duration: 820, delay: 300, easing: "ease-in-out", fill: "none" },
    );
    play(
      watcher,
      [{ rotate: "0deg" }, { rotate: "-12deg", offset: 0.4 }, { rotate: "-12deg", offset: 0.75 }, { rotate: "0deg" }],
      { duration: 900, delay: 1120, fill: "none" },
    );
  }

  onFrames((dt) => {
    if (!body.asleep && !reduced) {
      body.vx += (-200 - body.vx) * Math.min(1, dt * 1.2);
      const grounded = body.y + body.r >= PRAIRIE.height - 0.5;
      if (grounded && !hopped && body.x < WATCHER_EYES.x + 120) {
        hopped = true;
        body.vy = -640;
        body.vx = -260;
        duck();
      } else if (grounded && Math.random() < dt * 2.4) {
        body.vy = -random(240, 480);
      }
      stepWorld([body], rules, dt);
      if (!grounded) body.spin = body.vx / body.r;
      const dx = body.x - WATCHER_EYES.x;
      const dy = body.y - WATCHER_EYES.y;
      const distance = Math.hypot(dx, dy) || 1;
      setGaze({ x: dx / distance, y: dy / distance });
      if (body.x < -WEED * 2) {
        body.asleep = true;
        setGaze(null);
        shrug();
      }
    }
    if (weed) {
      weed.style.visibility = body.asleep ? "hidden" : "visible";
      weed.style.transform = `translate(${body.x - body.r}px, ${body.y - body.r}px) rotate(${body.angle}rad)`;
    }
  }, 1);

  onSettled(() => {
    timers.later(700, roll);
    let typing: ReturnType<typeof setTimeout> | undefined;
    const again = (event: Event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      clearTimeout(typing);
      typing = setTimeout(roll, 450);
    };
    document.addEventListener("input", again, true);
    return () => {
      clearTimeout(typing);
      document.removeEventListener("input", again, true);
    };
  });

  return (
    <span
      class="ms-scene wild-prairie"
      style={{ width: `${PRAIRIE.width}px`, height: `${PRAIRIE.height}px` }}
      aria-hidden="true"
    >
      <span
        ref={(element) => {
          watcher = element;
        }}
        class="wild-prairie-watcher"
      >
        <Mascot size={WATCHER} face={face()} gaze={gaze()} />
      </span>
      <span
        ref={(element) => {
          weed = element;
        }}
        class="wild-weed"
        style={{ width: `${WEED}px`, height: `${WEED}px` }}
      >
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <filter id="wild-weed-felt" filterUnits="userSpaceOnUse" x="-4" y="-4" width="56" height="56">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
              <feDisplacementMap in="SourceGraphic" scale="2.4" />
            </filter>
          </defs>
          <g filter="url(#wild-weed-felt)">
            <circle class="wild-weed-strand" cx="24" cy="24" r="20" />
            <ellipse class="wild-weed-strand" cx="24" cy="24" rx="20" ry="9" transform="rotate(30 24 24)" />
            <ellipse class="wild-weed-ply" cx="24" cy="24" rx="20" ry="8" transform="rotate(-38 24 24)" />
            <ellipse class="wild-weed-strand" cx="24" cy="24" rx="8" ry="19" transform="rotate(12 24 24)" />
            <path class="wild-weed-ply" d="M8 20 Q24 4 40 26 Q26 44 10 30" />
            <path class="wild-weed-strand" d="M14 10 Q36 18 30 40 Q16 36 12 22" />
          </g>
        </svg>
      </span>
    </span>
  );
}

/** The real search window. Each search finds nothing: type any text. */
export function SearchTumbleweedVariant() {
  return (
    <div class="ms-root wild-search">
      <GlobalSearch
        open
        agents={STORY_AGENTS}
        channels={[]}
        routines={[]}
        actions={[]}
        onSearchMessages={async () => ({ ...NO_PAGE })}
        onSearchFiles={async () => ({ ...NO_PAGE })}
        onOpenChange={() => {}}
        onSelectAgent={() => {}}
        onSelectChannel={() => {}}
        onSelectMessage={() => {}}
        onSelectRoutine={() => {}}
      />
      <MountInto selector=".global-search-empty">
        <TumbleweedScene />
      </MountInto>
    </div>
  );
}

// Offline W1. Space tether ------------------------------------------------------

const ASTRONAUT = 52;
const TETHER_MAX = 190;
const RETRY_SECONDS = 12;

type TetherPhase = "offline" | "online" | "gone";

/**
 * The plush floats away from the server in a bubble helmet, on a yarn tether. It drifts and turns
 * at the end of the yarn; Retry tugs it back a little. When the server is online, the yarn reels the
 * plush home. The plush can be grabbed and thrown; the yarn stops it.
 */
function SpaceTetherScene(props: { phase: TetherPhase; tugs: number }) {
  const reduced = prefersReducedMotion();
  const timers = sceneTimers();
  const [face, setFace] = createSignal<PlushMascotFace>("idle");
  let origin: HTMLElement | undefined;
  let floater: HTMLElement | undefined;
  let yarn: SVGPathElement | undefined;
  let ply: SVGPathElement | undefined;
  const body = feltBody({
    r: ASTRONAUT * 0.6,
    x: reduced ? 40 : 10,
    y: reduced ? 140 : 34,
    vx: 24,
    vy: 70,
    spin: random(-0.6, 0.6),
  });
  let length = TETHER_MAX;
  let online = false;
  let docked = false;
  let clock = 0;

  createEffect(
    () => props.phase,
    (phase) => {
      online = phase === "online";
      if (online) {
        setFace("wide");
        if (reduced) {
          length = 0;
          body.x = 0;
          body.y = 0;
          docked = true;
          setFace("happy");
        }
        return;
      }
      docked = false;
      setFace("idle");
      body.vx += 30;
      body.vy += 80;
    },
  );

  createEffect(
    () => props.tugs,
    (count) => {
      if (count === 0 || online || reduced || body.held) return;
      const distance = Math.hypot(body.x, body.y) || 1;
      body.vx -= (body.x / distance) * 260;
      body.vy -= (body.y / distance) * 260;
      body.spin += random(-2, 2);
      setFace("wide");
      timers.later(900, () => {
        if (!online) setFace("idle");
      });
    },
  );

  onFrames((dt) => {
    clock += dt;
    if (!reduced) {
      length = online ? Math.max(0, length - 300 * dt) : Math.min(TETHER_MAX, length + 120 * dt);
      if (!body.held && !docked) {
        // A soft push away from the server, with a slow wander.
        body.vx += (12 + Math.sin(clock * 0.7) * 36) * dt;
        body.vy += (44 + Math.cos(clock * 0.9) * 20) * dt;
        body.vx *= 1 - dt * 0.15;
        body.vy *= 1 - dt * 0.15;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.angle += body.spin * dt;
        body.spin *= 1 - dt * 0.05;
      }
      if (docked) {
        body.angle += (0 - body.angle) * Math.min(1, dt * 6);
      }
      const distance = Math.hypot(body.x, body.y);
      if (distance > length && distance > 0 && !body.held) {
        const nx = body.x / distance;
        const ny = body.y / distance;
        body.x = nx * length;
        body.y = ny * length;
        const outward = body.vx * nx + body.vy * ny;
        if (outward > 0) {
          body.vx -= outward * 1.3 * nx;
          body.vy -= outward * 1.3 * ny;
          body.spin += (body.vx * ny - body.vy * nx) * 0.004;
        }
      }
      if (online && !docked && distance < 6) {
        docked = true;
        setFace("happy");
        play(floater, [{ scale: "1 1" }, { scale: "1.25 0.8", offset: 0.35 }, { scale: "1 1" }], {
          duration: 420,
          easing: "ease-out",
          fill: "none",
        });
      }
    }
    if (floater) {
      floater.style.transform = `translate(${body.x - ASTRONAUT / 2}px, ${body.y - ASTRONAUT / 2}px) rotate(${body.angle}rad)`;
    }
    const distance = Math.hypot(body.x, body.y) || 1;
    const slack = Math.max(0, length - distance) / TETHER_MAX;
    const wave = Math.sin(clock * 1.6) * 10;
    const bend = slack * 70 + wave * (0.3 + slack);
    const cx = body.x / 2 + (-body.y / distance) * bend;
    const cy = body.y / 2 + (body.x / distance) * bend;
    const d = `M0 0 Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${body.x.toFixed(1)} ${body.y.toFixed(1)}`;
    yarn?.setAttribute("d", d);
    ply?.setAttribute("d", d);
  }, 1);

  return (
    <span class="ms-scene wild-tether" aria-hidden="true">
      <img class="wild-tether-pin" src={BALLS[0]} alt="" draggable={false} />
      <span
        ref={(element) => {
          origin = element;
        }}
        class="wild-tether-origin"
      >
        <svg class="wild-tether-line" width="1" height="1" aria-hidden="true">
          <path
            ref={(element) => {
              yarn = element;
            }}
            class="wild-tether-strand"
          />
          <path
            ref={(element) => {
              ply = element;
            }}
            class="wild-tether-ply"
          />
        </svg>
        <span
          ref={(element) => {
            floater = element;
          }}
          class="wild-tether-floater"
          onPointerDown={(event) => {
            if (!online) grab(event, body, origin);
          }}
        >
          <Mascot size={ASTRONAUT} face={face()} />
          <span class="wild-helmet" />
        </span>
      </span>
    </span>
  );
}

/** The real reconnect notice, with the plush adrift on its tether. "Online" reels it home. */
export function OfflineSpaceTetherVariant() {
  const [phase, setPhase] = createSignal<TetherPhase>("offline");
  const [remaining, setRemaining] = createSignal(RETRY_SECONDS);
  const [tugs, setTugs] = createSignal(0);
  let goneTimer: ReturnType<typeof setTimeout> | undefined;
  let root: HTMLDivElement | undefined;

  function retry(): void {
    setTugs((count) => count + 1);
    setRemaining(RETRY_SECONDS);
  }

  onSettled(() => {
    const clock = setInterval(() => {
      if (phase() !== "offline") return;
      if (remaining() <= 1) retry();
      else setRemaining((seconds) => seconds - 1);
    }, 1000);
    return () => {
      clearInterval(clock);
      clearTimeout(goneTimer);
    };
  });

  function connect(): void {
    setPhase("online");
    goneTimer = setTimeout(() => setPhase("gone"), prefersReducedMotion() ? 600 : 2000);
  }

  function drop(): void {
    clearTimeout(goneTimer);
    setRemaining(RETRY_SECONDS);
    setPhase("offline");
  }

  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class="ms-root wild-offline"
    >
      <Show when={phase() !== "gone"}>
        <ServerConnectionNotice
          name="Research server"
          phase="waiting"
          initial={false}
          remainingSeconds={remaining()}
          onRetry={retry}
          hideDetails
        />
      </Show>
      <MountInto selector=".server-connection-notice" root={() => root}>
        <SpaceTetherScene phase={phase()} tugs={tugs()} />
      </MountInto>
      <SceneControls>
        <Button size="sm" variant="outline" disabled={phase() !== "offline"} onClick={connect}>
          Online
        </Button>
        <Button size="sm" variant="outline" disabled={phase() === "offline"} onClick={drop}>
          Drop connection
        </Button>
      </SceneControls>
    </div>
  );
}
