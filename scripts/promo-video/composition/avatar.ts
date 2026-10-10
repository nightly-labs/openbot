import { BotEngine, COLOR_BY_ID, DEMI_VIEWBOX, EXPRESSION_BY_ID, RAYON, SHAPE_BY_ID } from "@norbert_bodziony/bloub";
import { bloubAvatarProfile } from "@openbot/brand/bloub-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { nextId, svg } from "./dom";

export interface Avatar {
  element: SVGSVGElement;
  /** The body color. The iPhone app tints the agent's Live Activity with it (`getBloubAvatarColor`). */
  color: string;
  /** Draws the idle motion at time `t`. The engine is pure, so any `t` gives the same frame. */
  render(t: number): void;
}

/**
 * The same SVG that `BloubBot` draws: the body is paper under a colored rect, and the eyes are
 * holes in the rect's mask. `BloubBot` is a Solid component, so the video builds the markup itself
 * from `BotEngine.sample`.
 */
export function createAvatar(parent: Element, seed: string, hue: AvatarHue, size: number): Avatar {
  const profile = bloubAvatarProfile(seed, hue);
  const engine = new BotEngine(
    RAYON,
    "idle",
    SHAPE_BY_ID.get(profile.shape)?.radii ?? null,
    EXPRESSION_BY_ID.get(profile.expression) ?? null,
  );
  const color = COLOR_BY_ID.get(profile.color)?.hex ?? "currentColor";
  const span = DEMI_VIEWBOX * 2;
  const box = { x: -DEMI_VIEWBOX, y: -DEMI_VIEWBOX, width: span, height: span };

  const element = svg(
    "svg",
    { class: "avatar", viewBox: `${box.x} ${box.y} ${span} ${span}`, width: size, height: size },
    parent,
  );
  const maskId = nextId("avatar-mask");
  const mask = svg("mask", { id: maskId, maskUnits: "userSpaceOnUse", ...box }, svg("defs", {}, element));
  const maskBody = svg("path", { fill: "white" }, mask);
  const maskEyes = [0, 1].map(() => svg("path", { fill: "black" }, mask));
  const maskNotch = svg("circle", { fill: "black" }, mask);

  const body = svg("g", {}, element);
  const paper = svg("path", { style: "fill: var(--promo-white)" }, body);
  svg("rect", { ...box, fill: color }, svg("g", { mask: `url(#${maskId})` }, body));

  // Each avatar starts at its own point in the idle loop, so the team does not blink together.
  const offset = (seed.length * 1.37) % 5;

  const render = (t: number) => {
    const frame = engine.sample(t + offset);
    maskBody.setAttribute("d", frame.bodyPath);
    paper.setAttribute("d", frame.bodyPath);
    body.setAttribute("opacity", String(frame.bodyAlpha));
    maskEyes.forEach((path, index) => {
      const eye = frame.eyes[index];
      path.style.display = eye ? "" : "none";
      if (!eye) return;
      path.setAttribute("d", eye.d);
      path.setAttribute("transform", eye.matrix);
      path.setAttribute("opacity", String(eye.alpha));
    });
    maskNotch.style.display = frame.notch ? "" : "none";
    if (frame.notch) {
      maskNotch.setAttribute("cx", String(frame.notch.x));
      maskNotch.setAttribute("cy", String(frame.notch.y));
      maskNotch.setAttribute("r", String(frame.notch.r));
    }
  };

  return { element, color, render };
}
