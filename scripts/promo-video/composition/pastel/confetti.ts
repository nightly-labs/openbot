// Confetti on a canvas over the scenes. Each piece has a closed-form path from its start time
// (drag toward a fall speed), so any frame can be drawn in any order. Pieces are drawn opaque, as
// paper is, not as light.

import { html } from "../dom";
import { random, STAGE_HEIGHT, STAGE_WIDTH } from "../timeline";

export interface Popper {
  at: number;
  x: number;
  y: number;
  count: number;
  /** Start speed, in pixels per second. */
  speed: number;
  /** Direction of the spray in degrees, 0 is up, and how wide it is. */
  direction?: number;
  spread?: number;
  life: number;
  seed: number;
  colors: readonly string[];
  /** Largest piece, in pixels. */
  size?: number;
}

interface Piece {
  angle: number;
  speed: number;
  life: number;
  size: number;
  color: string;
  round: boolean;
  spin: number;
  flip: number;
}

const GRAVITY = 2600;
const DRAG = 3;

export class Confetti {
  private readonly context: CanvasRenderingContext2D;
  private readonly pieces = new Map<Popper, Piece[]>();

  constructor(
    parent: Element,
    private readonly poppers: readonly Popper[],
  ) {
    const canvas = html("canvas", "pastel-confetti", parent);
    canvas.width = STAGE_WIDTH;
    canvas.height = STAGE_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The confetti canvas has no 2D context.");
    this.context = context;
    for (const popper of poppers) {
      const next = random(popper.seed);
      const direction = ((popper.direction ?? 0) - 90) * (Math.PI / 180);
      const spread = (popper.spread ?? 360) * (Math.PI / 180);
      this.pieces.set(
        popper,
        Array.from({ length: popper.count }, (_, index) => ({
          angle: direction + (next() - 0.5) * spread,
          speed: popper.speed * (0.35 + next() * 0.65),
          life: popper.life * (0.6 + next() * 0.4),
          size: (popper.size ?? 18) * (0.5 + next() * 0.5),
          color: popper.colors[index % popper.colors.length] ?? "",
          round: next() < 0.35,
          spin: (next() - 0.5) * 14,
          flip: 6 + next() * 10,
        })),
      );
    }
  }

  render(t: number) {
    const context = this.context;
    context.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    for (const popper of this.poppers) {
      const age = t - popper.at;
      if (age < 0 || age > popper.life) continue;
      for (const piece of this.pieces.get(popper) ?? []) this.drawPiece(popper, piece, age);
    }
    context.globalAlpha = 1;
  }

  private drawPiece(popper: Popper, piece: Piece, age: number) {
    if (age > piece.life) return;
    const context = this.context;
    const slow = (1 - Math.exp(-DRAG * age)) / DRAG;
    const x = popper.x + Math.cos(piece.angle) * piece.speed * slow;
    const y = popper.y + Math.sin(piece.angle) * piece.speed * slow + (GRAVITY / DRAG) * age - (GRAVITY / DRAG) * slow;
    const amount = age / piece.life;
    // In for the first frames, out over the last fifth.
    context.globalAlpha = Math.min(1, age * 30, (1 - amount) * 5);
    context.fillStyle = piece.color;
    context.save();
    context.translate(x, y);
    context.rotate(piece.spin * age);
    if (piece.round) {
      context.beginPath();
      context.arc(0, 0, piece.size * 0.4, 0, Math.PI * 2);
      context.fill();
    } else {
      // Paper that turns over: its height follows a cosine.
      const height = piece.size * 0.55 * Math.cos(piece.flip * age);
      context.beginPath();
      context.roundRect(-piece.size / 2, -height / 2, piece.size, height, 3);
      context.fill();
    }
    context.restore();
  }
}
