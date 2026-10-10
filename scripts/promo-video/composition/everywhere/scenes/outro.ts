// Beats 20-28. The phone lands as the logo, the two lines come in under it, and the URL holds.

import { html, show } from "../../dom";
import { createLogo, RESTING_POSE } from "../../logo";
import { impact, lilacPill, punchIn, type RenderScene, type SceneContext, sceneLayer } from "../../scene";
import { bump, clamp, ease, keys, lerp, progress, spring } from "../../timeline";
import { EVERYWHERE_COPY as COPY } from "../copy";
import { at, CUE } from "../cues";

const LOGO_SIZE = 380;
const LOCKUP = { size: 250, y: 310 } as const;

export function createOutro(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const logo = createLogo(root);
  const tagline = html("div", "word hero", root, COPY.tagline);
  tagline.style.fontSize = "108px";
  const line = html("div", "text secondary", root, COPY.line);
  Object.assign(line.style, { fontSize: "50px", fontWeight: "500", letterSpacing: "-0.02em" });
  const url = lilacPill(root, 50, 60, COPY.site);

  impact(context, CUE.logo, 960, 540, 381);

  const look = at(24);
  return (t) => {
    if (!show(root, t >= CUE.logo)) return;
    const land = spring(t, CUE.logo, 2.6, 0.42);
    const rise = ease.logo(progress(t, CUE.tagline, 0.4));
    const blink = 1 - 0.92 * bump(t, CUE.blink, 0.16);
    logo.render({
      ...RESTING_POSE,
      x: 960,
      y: lerp(540, LOCKUP.y, rise),
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
      punchIn(tagline, t, CUE.tagline, 960, 590, { distance: 40, scale: 1.2 });
    }
    if (show(line, t >= CUE.line)) {
      punchIn(line, t, CUE.line, 960, 705, { distance: 30, scale: 1.1, skew: -8 });
    }
    if (show(url, t >= CUE.url)) {
      const pop = spring(t, CUE.url, 2.4, 0.4);
      url.style.transform = `translate(960px, 850px) translate(-50%, -50%) scale(${pop})`;
      url.style.opacity = String(clamp(pop * 3));
    }
    context.backdrop.spot("var(--promo-lilac)", 0.28);
  };
}
