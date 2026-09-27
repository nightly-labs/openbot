// 15-18 s. The logo lands, the lockup builds, and the call to action holds long enough to read.

import { COPY } from "../copy";
import { CUE } from "../cues";
import { html, show } from "../dom";
import { createLogo, RESTING_POSE } from "../logo";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../scene";
import { bump, clamp, ease, keys, lerp, progress, spring } from "../timeline";

const LOGO_SIZE = 360;
const LOCKUP_SIZE = 250;
const WORDMARK_SIZE = 220;
const GAP = 52;
const LOCKUP_Y = 450;

export function createOutro(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  // The wordmark is under the logo, so that it can slide out from behind it.
  const wordmark = html("div", "word hero", root, COPY.name);
  wordmark.style.fontSize = `${WORDMARK_SIZE}px`;
  const logo = createLogo(root);
  const tagline = html("div", "text secondary", root, COPY.tagline);
  Object.assign(tagline.style, { fontSize: "54px", fontWeight: "500", letterSpacing: "-0.025em" });

  const cta = html("div", "text pill", root);
  Object.assign(cta.style, {
    height: "112px",
    padding: "0 56px",
    background: "var(--promo-lilac)",
    color: "var(--promo-eye)",
    fontSize: "46px",
    fontWeight: "700",
    letterSpacing: "-0.02em",
    boxShadow: "0 0 80px var(--promo-glow)",
  });
  html("span", "", cta, COPY.cta);
  const dot = html("span", "", cta, "·");
  dot.style.opacity = "0.5";
  html("span", "", cta, COPY.url);

  const total = LOCKUP_SIZE + GAP + wordmark.offsetWidth;
  const logoX = 960 - total / 2 + LOCKUP_SIZE / 2;
  const wordmarkX = 960 - total / 2 + LOCKUP_SIZE + GAP + wordmark.offsetWidth / 2;

  context.rings.push(
    { at: CUE.outro, x: 960, y: 540, radius: 1200, life: 0.8, width: 22, color: context.palette.white },
    { at: CUE.outro + 0.05, x: 960, y: 540, radius: 1600, life: 1, width: 10, color: context.palette.lilac },
  );
  context.bursts.push(
    {
      at: CUE.outro,
      x: 960,
      y: 540,
      count: 80,
      speed: 2400,
      life: 1,
      size: 7,
      color: context.palette.lilac,
      seed: 81,
      shape: "streak",
      drag: 3.4,
    },
    {
      at: CUE.outro,
      x: 960,
      y: 540,
      count: 30,
      speed: 1400,
      life: 0.9,
      size: 5,
      color: context.palette.white,
      seed: 82,
      shape: "dot",
    },
  );

  return (t) => {
    if (!show(root, t >= CUE.outro)) return;
    const land = spring(t, CUE.outro, 2.6, 0.42);
    const move = ease.logo(progress(t, CUE.wordmark, 0.42));
    const wink = 1 - 0.92 * bump(t, CUE.wink, 0.2);
    const blink = 1 - 0.92 * bump(t, CUE.blinkEnd, 0.14);
    const x = lerp(960, logoX, move);
    const size = lerp(LOGO_SIZE + 700 * (1 - land), LOCKUP_SIZE, move);
    logo.render({
      ...RESTING_POSE,
      x,
      y: lerp(540, LOCKUP_Y, move),
      size,
      blink: [blink, Math.min(wink, blink)],
      lookX: keys(t, [
        [0, 0],
        [16.1, 0.02],
        [16.9, 0],
      ]),
      lookY: keys(t, [
        [0, 0],
        [16.1, 0.03],
        [16.9, 0],
      ]),
      sheen: t >= 16.25 && t < 16.85 ? progress(t, 16.25, 0.6) : -1,
    });

    if (show(wordmark, t >= CUE.wordmark)) {
      const reveal = ease.outExpo(progress(t, CUE.wordmark + 0.1, 0.5));
      const center = wordmarkX - 220 * (1 - reveal);
      // Cut the wordmark at the right edge of the logo while the logo moves over it.
      const hidden = Math.max(0, x + size / 2 - (center - wordmark.offsetWidth / 2));
      wordmark.style.transform = `translate(${center}px, ${LOCKUP_Y}px) translate(-50%, -50%)`;
      wordmark.style.clipPath = `inset(-20% -5% -20% ${hidden}px)`;
      wordmark.style.opacity = String(clamp(reveal * 3));
    }
    if (show(tagline, t >= CUE.tagline)) {
      punchIn(tagline, t, CUE.tagline, 960, 690, { distance: 30, skew: 0, scale: 1.08 });
    }
    if (show(cta, t >= CUE.cta)) {
      const pop = spring(t, CUE.cta, 2.4, 0.4);
      cta.style.transform = `translate(960px, 850px) translate(-50%, -50%) scale(${pop})`;
    }
    context.backdrop.spot("var(--promo-lilac)", 0.28);
  };
}
