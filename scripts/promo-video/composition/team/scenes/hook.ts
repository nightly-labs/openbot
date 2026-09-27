// Beats 0-1.5. The part that must stop the scroll: the request fills the frame, tilted, and its
// lines slam in on the beat. When the camera pulls back, it becomes the channel's first message.

import { html, show } from "../../dom";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../../scene";
import { clamp, progress } from "../../timeline";
import { TEAM_COPY } from "../copy";
import { CUE } from "../cues";
import { BUBBLE, bubbleHeight, bubbleLines, cameraTransform, project } from "../shot";

/** How long the bubble takes to turn into the first row. */
export const MORPH = 0.16;

export function createHook(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  root.style.transformOrigin = "0 0";
  const bubble = html("div", "glass", root);
  Object.assign(bubble.style, {
    borderRadius: "28px",
    borderColor: "color-mix(in srgb, var(--promo-lilac) 45%, transparent)",
    boxShadow: "0 0 60px var(--promo-glow), inset 0 2px 0 var(--openbot-glass-highlight)",
  });
  const label = html("div", "text muted", bubble, TEAM_COPY.you);
  Object.assign(label.style, { left: `${BUBBLE.padding}px`, top: "20px", fontSize: "20px", fontWeight: "700" });

  const texts = [...TEAM_COPY.request.lines, TEAM_COPY.request.mention];
  const lines = texts.map((text, index) => {
    const line = html("div", "word", bubble, text);
    line.style.fontSize = `${BUBBLE.font}px`;
    line.style.letterSpacing = "-0.04em";
    if (index === texts.length - 1) line.style.color = "var(--promo-lilac)";
    return line;
  });
  const widths = lines.map((line) => line.offsetWidth);
  const width = Math.max(...widths) + BUBBLE.padding * 2;
  const left = BUBBLE.x - width / 2;
  const starts = [CUE.line, CUE.line2, CUE.mention];

  // The mention lands with a ring and a spray, where it is on the screen at that moment.
  const mention = project(
    left + BUBBLE.padding + (widths[2] ?? 0) / 2,
    BUBBLE.top + BUBBLE.label + 2.5 * BUBBLE.line,
    CUE.mention,
  );
  context.rings.push(
    { at: CUE.mention, x: mention.x, y: mention.y, radius: 900, life: 0.6, width: 18, color: context.palette.white },
    {
      at: CUE.mention + 0.03,
      x: mention.x,
      y: mention.y,
      radius: 1300,
      life: 0.8,
      width: 10,
      color: context.palette.lilac,
    },
  );
  context.bursts.push({
    at: CUE.mention,
    x: mention.x,
    y: mention.y,
    count: 60,
    speed: 2400,
    life: 0.7,
    size: 7,
    color: context.palette.lilac,
    seed: 201,
    shape: "streak",
    drag: 3.6,
  });

  return (t) => {
    if (!show(root, t < CUE.pull + MORPH)) return;
    root.style.transform = cameraTransform(t);
    const morph = progress(t, CUE.pull, MORPH);
    Object.assign(bubble.style, {
      left: `${left}px`,
      top: `${BUBBLE.top}px`,
      width: `${width}px`,
      height: `${bubbleHeight(bubbleLines(t))}px`,
      opacity: String(1 - morph),
      transform: `scale(${1 - 0.3 * morph})`,
      filter: morph > 0 ? `blur(${6 * morph}px)` : "",
    });
    lines.forEach((line, index) => {
      const start = starts[index] ?? 0;
      if (!show(line, t >= start)) return;
      const x = BUBBLE.padding + (widths[index] ?? 0) / 2;
      const y = BUBBLE.label + (index + 0.5) * BUBBLE.line;
      const last = index === lines.length - 1;
      punchIn(line, t, start, x, y, { distance: last ? 0 : 26, scale: last ? 1.7 : 1.35, skew: -16 });
      if (last) line.style.textShadow = `0 0 ${24 * (1 - clamp(progress(t, start, 0.4)))}px var(--promo-lilac)`;
    });
    context.backdrop.spot("var(--promo-lilac)", 0.24);
  };
}
