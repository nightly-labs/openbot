import { html, token } from "./dom";
import { clamp, ease, random, STAGE_HEIGHT, STAGE_WIDTH } from "./timeline";

export interface Burst {
  at: number;
  x: number;
  y: number;
  count: number;
  /** Start speed, in pixels per second. Each particle gets between half and all of it. */
  speed: number;
  life: number;
  size: number;
  color: string;
  seed: number;
  /** Streaks are drawn along their motion, dots are round, stars have four points. */
  shape: "dot" | "streak" | "star";
  /** Pixels per second squared, down. */
  gravity?: number;
  /** How fast the particles slow down. Higher stops them sooner. */
  drag?: number;
  /** Particles fly in from `speed * 0.5` seconds away and land on the point. */
  inward?: boolean;
}

export interface Ring {
  at: number;
  x: number;
  y: number;
  radius: number;
  life: number;
  width: number;
  color: string;
}

interface Particle {
  angle: number;
  speed: number;
  life: number;
  size: number;
  spin: number;
}

/** Particles and rings on a canvas, drawn from their start time only: nothing is stepped. */
export class Effects {
  private readonly context: CanvasRenderingContext2D;
  private readonly particles = new Map<Burst, Particle[]>();

  constructor(
    parent: Element,
    private readonly bursts: Burst[],
    private readonly rings: Ring[],
  ) {
    const canvas = html("canvas", "fx", parent);
    canvas.width = STAGE_WIDTH;
    canvas.height = STAGE_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The effects canvas has no 2D context.");
    this.context = context;
    for (const burst of bursts) {
      const next = random(burst.seed);
      this.particles.set(
        burst,
        Array.from({ length: burst.count }, () => ({
          angle: next() * Math.PI * 2,
          speed: burst.speed * (0.45 + next() * 0.55),
          life: burst.life * (0.55 + next() * 0.45),
          size: burst.size * (0.4 + next() * 0.6),
          spin: (next() - 0.5) * 8,
        })),
      );
    }
  }

  render(t: number, extra?: (context: CanvasRenderingContext2D) => void) {
    const context = this.context;
    context.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    context.globalCompositeOperation = "lighter";
    for (const ring of this.rings) this.drawRing(ring, t);
    for (const burst of this.bursts) this.drawBurst(burst, t);
    context.globalCompositeOperation = "source-over";
    extra?.(context);
  }

  private drawRing(ring: Ring, t: number) {
    const age = t - ring.at;
    if (age < 0 || age > ring.life) return;
    const amount = age / ring.life;
    const context = this.context;
    context.globalAlpha = (1 - amount) ** 2;
    context.strokeStyle = ring.color;
    context.lineWidth = ring.width * (1 - amount * 0.8);
    context.beginPath();
    context.arc(ring.x, ring.y, ring.radius * ease.outExpo(amount), 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
  }

  private drawBurst(burst: Burst, t: number) {
    const age = t - burst.at;
    if (age < 0 || age > burst.life) return;
    const context = this.context;
    const drag = burst.drag ?? 3.2;
    context.fillStyle = burst.color;
    context.strokeStyle = burst.color;
    context.lineCap = "round";
    for (const particle of this.particles.get(burst) ?? []) {
      if (age > particle.life) continue;
      const amount = age / particle.life;
      const travel = burst.inward
        ? particle.speed * 0.5 * (1 - ease.inExpo(amount))
        : (particle.speed * (1 - Math.exp(-drag * age))) / drag;
      const directionX = Math.cos(particle.angle);
      const directionY = Math.sin(particle.angle);
      const x = burst.x + directionX * travel;
      const y = burst.y + directionY * travel + 0.5 * (burst.gravity ?? 0) * age * age;
      const fade = burst.inward ? clamp(amount * 4) : (1 - amount) ** 1.5;
      context.globalAlpha = fade;
      if (burst.shape === "streak") {
        const velocity = burst.inward ? particle.speed : particle.speed * Math.exp(-drag * age);
        const length = Math.max(particle.size * 2, velocity * 0.035);
        context.lineWidth = particle.size;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(
          x - directionX * length * (burst.inward ? -1 : 1),
          y - directionY * length * (burst.inward ? -1 : 1),
        );
        context.stroke();
      } else if (burst.shape === "star") {
        drawStar(context, x, y, particle.size * (1 - amount * 0.6), particle.spin * age);
      } else {
        context.beginPath();
        context.arc(x, y, particle.size * (1 - amount * 0.5), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }
}

export function drawStar(context: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number) {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.beginPath();
  for (let point = 0; point < 8; point += 1) {
    const length = point % 2 === 0 ? radius : radius * 0.22;
    const angle = (point / 8) * Math.PI * 2;
    context.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
  }
  context.closePath();
  context.fill();
  context.restore();
}

/** A soft light, for the pen tips and the glints. */
export function drawGlow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.35, color);
  gradient.addColorStop(1, token("--openbot-transparent"));
  context.globalCompositeOperation = "lighter";
  context.globalAlpha = alpha;
  context.fillStyle = gradient;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
}

const GRAIN_TILE = 256;
const GRAIN_TILES = 6;
/** Film grain changes 24 times a second, as film does, not on every frame. */
const GRAIN_RATE = 24;

/** Film grain from a few seeded noise tiles. Half resolution, so each grain is two pixels. */
export class Grain {
  private readonly context: CanvasRenderingContext2D;
  private readonly patterns: CanvasPattern[] = [];
  private drawn = -1;

  constructor(parent: Element) {
    const canvas = html("canvas", "grain", parent);
    canvas.width = STAGE_WIDTH / 2;
    canvas.height = STAGE_HEIGHT / 2;
    canvas.style.width = `${STAGE_WIDTH}px`;
    canvas.style.height = `${STAGE_HEIGHT}px`;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The grain canvas has no 2D context.");
    this.context = context;
    const next = random(7);
    for (let tile = 0; tile < GRAIN_TILES; tile += 1) {
      const source = document.createElement("canvas");
      source.width = GRAIN_TILE;
      source.height = GRAIN_TILE;
      const sourceContext = source.getContext("2d");
      if (!sourceContext) continue;
      const image = sourceContext.createImageData(GRAIN_TILE, GRAIN_TILE);
      for (let index = 0; index < image.data.length; index += 4) {
        const value = Math.floor(next() * 255);
        image.data[index] = value;
        image.data[index + 1] = value;
        image.data[index + 2] = value;
        image.data[index + 3] = 255;
      }
      sourceContext.putImageData(image, 0, 0);
      const pattern = context.createPattern(source, "repeat");
      if (pattern) this.patterns.push(pattern);
    }
  }

  render(t: number) {
    const step = Math.floor(t * GRAIN_RATE);
    if (step === this.drawn) return;
    this.drawn = step;
    const pattern = this.patterns[step % this.patterns.length];
    if (!pattern) return;
    const offset = random(step + 11);
    const context = this.context;
    context.save();
    context.translate(Math.floor(offset() * GRAIN_TILE), Math.floor(offset() * GRAIN_TILE));
    context.fillStyle = pattern;
    context.fillRect(-GRAIN_TILE, -GRAIN_TILE, STAGE_WIDTH / 2 + GRAIN_TILE, STAGE_HEIGHT / 2 + GRAIN_TILE);
    context.restore();
  }
}
