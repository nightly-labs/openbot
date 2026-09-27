// 12-13 s. A laptop, a lock, and particles that bounce off the edges of the screen and never leave.

import { COPY } from "../copy";
import { CUE } from "../cues";
import { html, show, svg } from "../dom";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../scene";
import { clamp, ease, progress, random, spring } from "../timeline";

const SCREEN = { x: 960, y: 470, width: 820, height: 520 };
const INSET = 36;
const DOTS = 40;

export function createLocal(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const drawing = svg("svg", { width: 1920, height: 1080, viewBox: "0 0 1920 1080" }, root);
  drawing.style.position = "absolute";
  const left = SCREEN.x - SCREEN.width / 2;
  const top = SCREEN.y - SCREEN.height / 2;
  const outline = [
    svg("rect", { x: left, y: top, width: SCREEN.width, height: SCREEN.height, rx: 34, pathLength: 1 }, drawing),
    svg(
      "path",
      {
        d: `M${left - 110} ${top + SCREEN.height + 44} H${left + SCREEN.width + 110} L${left + SCREEN.width + 60} ${top + SCREEN.height + 8} H${left - 60} Z`,
        pathLength: 1,
      },
      drawing,
    ),
  ];
  for (const line of outline) {
    line.setAttribute("style", "fill: none; stroke: var(--promo-white); stroke-width: 8; stroke-linejoin: round");
    line.setAttribute("stroke-dasharray", "1 1");
  }

  const next = random(41);
  const dots = Array.from({ length: DOTS }, (_, index) => {
    const angle = next() * Math.PI * 2;
    const speed = 500 + next() * 900;
    const dot = svg("circle", { r: 5 + next() * 7 }, drawing);
    dot.setAttribute("style", `fill: ${index % 3 === 0 ? "var(--promo-white)" : "var(--promo-lilac)"}`);
    return { dot, velocityX: Math.cos(angle) * speed, velocityY: Math.sin(angle) * speed };
  });

  const lock = svg("g", {}, drawing);
  const shackle = svg(
    "path",
    { d: "M-42 0 V-48 A42 42 0 0 1 42 -48 V0", style: "fill: none; stroke: var(--promo-lilac); stroke-width: 18" },
    lock,
  );
  svg("rect", { x: -74, y: -12, width: 148, height: 120, rx: 26, style: "fill: var(--promo-lilac)" }, lock);
  svg("circle", { cx: 0, cy: 36, r: 14, style: "fill: var(--promo-eye)" }, lock);
  svg("rect", { x: -6, y: 40, width: 12, height: 34, rx: 6, style: "fill: var(--promo-eye)" }, lock);

  const caption = html("div", "word", root, COPY.local);
  caption.style.fontSize = "92px";

  context.rings.push({
    at: CUE.lock,
    x: SCREEN.x,
    y: SCREEN.y,
    radius: 360,
    life: 0.5,
    width: 10,
    color: context.palette.lilac,
  });

  return (t) => {
    if (!show(root, t >= CUE.local && t < CUE.price)) return;
    const enter = spring(t, CUE.local, 2.2, 0.5);
    root.style.transform = `scale(${0.6 + 0.4 * enter})`;
    root.style.transformOrigin = `${SCREEN.x}px ${SCREEN.y}px`;
    root.style.opacity = String(clamp(enter * 3));

    const drawn = ease.outCubic(progress(t, CUE.local, 0.3));
    for (const line of outline) line.setAttribute("stroke-dashoffset", String(1 - drawn));

    const age = Math.max(0, t - CUE.local);
    for (const { dot, velocityX, velocityY } of dots) {
      dot.setAttribute(
        "cx",
        String(bounce(SCREEN.x - left - INSET + velocityX * age, SCREEN.width - 2 * INSET) + left + INSET),
      );
      dot.setAttribute(
        "cy",
        String(bounce(SCREEN.y - top - INSET + velocityY * age, SCREEN.height - 2 * INSET) + top + INSET),
      );
      dot.style.opacity = String(0.85 * clamp(age * 6));
    }

    const pop = spring(t, CUE.local + 0.15, 2.8, 0.42);
    const close = ease.outBack(progress(t, CUE.lock, 0.12));
    lock.setAttribute("transform", `translate(${SCREEN.x} ${SCREEN.y - 10}) scale(${pop})`);
    shackle.setAttribute("transform", `translate(0 ${-34 * (1 - close)})`);

    punchIn(caption, t, CUE.local + 0.12, 960, 900, { distance: 50 });
    context.backdrop.spot("var(--promo-lilac)", 0.22);
  };
}

/** Where a point that moves `position` along a line of `length` lands if it bounces off both ends. */
function bounce(position: number, length: number): number {
  const period = length * 2;
  const wrapped = ((position % period) + period) % period;
  return wrapped > length ? period - wrapped : wrapped;
}
