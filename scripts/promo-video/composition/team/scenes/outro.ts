// Beats 13-18. The avatars land as the logo, the line comes in under it, and the URL holds.

import { html, show } from "../../dom";
import { createLogo, RESTING_POSE } from "../../logo";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../../scene";
import { bump, clamp, ease, keys, lerp, progress, spring } from "../../timeline";
import { TEAM_COPY } from "../copy";
import { at, CUE } from "../cues";
import { MERGE } from "./channel";

const LOGO_SIZE = 380;
const LOCKUP = { size: 280, y: 370 } as const;

export function createOutro(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const logo = createLogo(root);
  const tagline = html("div", "word hero", root, TEAM_COPY.tagline);
  tagline.style.fontSize = "112px";
  const url = html("div", "text pill", root, TEAM_COPY.url);
  Object.assign(url.style, {
    height: "112px",
    padding: "0 60px",
    background: "var(--promo-lilac)",
    color: "var(--promo-eye)",
    fontSize: "50px",
    fontWeight: "700",
    letterSpacing: "-0.02em",
    boxShadow: "0 0 80px var(--promo-glow)",
  });

  context.rings.push(
    { at: CUE.logo, x: MERGE.x, y: MERGE.y, radius: 1200, life: 0.8, width: 22, color: context.palette.white },
    { at: CUE.logo + 0.05, x: MERGE.x, y: MERGE.y, radius: 1600, life: 1, width: 10, color: context.palette.lilac },
  );
  context.bursts.push(
    {
      at: CUE.logo,
      x: MERGE.x,
      y: MERGE.y,
      count: 80,
      speed: 2400,
      life: 1,
      size: 7,
      color: context.palette.lilac,
      seed: 281,
      shape: "streak",
      drag: 3.4,
    },
    {
      at: CUE.logo,
      x: MERGE.x,
      y: MERGE.y,
      count: 30,
      speed: 1400,
      life: 0.9,
      size: 5,
      color: context.palette.white,
      seed: 282,
      shape: "dot",
    },
  );

  const look = at(15);
  return (t) => {
    if (!show(root, t >= CUE.logo)) return;
    const land = spring(t, CUE.logo, 2.6, 0.42);
    const rise = ease.logo(progress(t, CUE.tagline, 0.4));
    const blink = 1 - 0.92 * bump(t, CUE.blink, 0.16);
    logo.render({
      ...RESTING_POSE,
      x: MERGE.x,
      y: lerp(MERGE.y, LOCKUP.y, rise),
      size: lerp(LOGO_SIZE + 600 * (1 - land), LOCKUP.size, rise),
      square: 1 + 0.5 * (1 - spring(t, CUE.logo, 2.8, 0.4)),
      blink: [blink, blink],
      lookX: keys(t, [
        [0, 0],
        [look, -0.03],
        [look + 0.4, 0.03],
        [CUE.blink, 0],
      ]),
      lookY: keys(t, [
        [0, 0],
        [look, 0.02],
        [CUE.blink, 0],
      ]),
      sheen: t >= CUE.url && t < CUE.url + 0.6 ? progress(t, CUE.url, 0.6) : -1,
    });

    if (show(tagline, t >= CUE.tagline)) {
      punchIn(tagline, t, CUE.tagline, 960, 660, { distance: 40, scale: 1.2 });
    }
    if (show(url, t >= CUE.url)) {
      const pop = spring(t, CUE.url, 2.4, 0.4);
      url.style.transform = `translate(960px, 850px) translate(-50%, -50%) scale(${pop})`;
      url.style.opacity = String(clamp(pop * 3));
    }
    context.backdrop.spot("var(--promo-lilac)", 0.28);
  };
}
