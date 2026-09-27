// 13-15 s. The landing page's metal "$0", then the platforms, then everything falls into the
// middle for the outro.

import { COPY } from "../copy";
import { CUE, PLATFORM_CHIPS } from "../cues";
import { html, show } from "../dom";
import { drawGlow, drawStar } from "../fx";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../scene";
import { clamp, decay, ease, lerp, progress, spring } from "../timeline";

const PRICE_SIZE = 560;
const CHIP = { y: 820, height: 96, gap: 24 };
const GLINTS = [
  { at: 13.22, x: 770, y: 330 },
  { at: 13.48, x: 1150, y: 600 },
  { at: 13.74, x: 880, y: 640 },
] as const;
const SECOND_SWEEP = 14.2;
/** The rim light of the landing page glyph. */
const BEVEL = "drop-shadow(0 -3px 0 var(--openbot-price-rim)) drop-shadow(0 3px 0 var(--openbot-price-rim-under))";

export function createPrice(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const glow = html("div", "price-glow", root, COPY.price);
  const price = html("div", "price", root, COPY.price);
  for (const element of [glow, price]) element.style.fontSize = `${PRICE_SIZE}px`;
  const caption = html("div", "word", root, COPY.priceLine);
  caption.style.fontSize = "84px";

  const chips = COPY.platforms.map((platform) => {
    const chip = html("div", "glass text pill", root, platform);
    Object.assign(chip.style, {
      height: `${CHIP.height}px`,
      padding: "0 40px",
      borderRadius: "999px",
      fontSize: "44px",
      fontWeight: "650",
      letterSpacing: "-0.02em",
    });
    return chip;
  });
  const widths = chips.map((chip) => chip.offsetWidth);
  const total = widths.reduce((sum, width) => sum + width, 0) + CHIP.gap * (chips.length - 1);
  let cursor = 960 - total / 2;
  const chipX = widths.map((width) => {
    const x = cursor + width / 2;
    cursor += width + CHIP.gap;
    return x;
  });

  context.bursts.push(
    {
      at: CUE.price,
      x: 960,
      y: 480,
      count: 36,
      speed: 1500,
      life: 0.9,
      size: 16,
      color: context.palette.white,
      seed: 61,
      shape: "star",
      drag: 4,
    },
    {
      at: CUE.price,
      x: 960,
      y: 480,
      count: 50,
      speed: 2200,
      life: 0.7,
      size: 5,
      color: context.palette.lilac,
      seed: 62,
      shape: "streak",
    },
    {
      at: CUE.implode,
      x: 960,
      y: 540,
      count: 80,
      speed: 2400,
      life: CUE.outro - CUE.implode,
      size: 6,
      color: context.palette.lilac,
      seed: 63,
      shape: "streak",
      inward: true,
    },
  );
  context.overlays.push((canvas, t) => {
    for (const glint of GLINTS) {
      const strength = decay(t, glint.at, 0.35);
      if (strength <= 0 || t >= CUE.platforms) continue;
      drawGlow(canvas, glint.x, glint.y, 120, context.palette.white, 0.7 * strength);
      canvas.fillStyle = context.palette.white;
      canvas.globalAlpha = strength;
      drawStar(canvas, glint.x, glint.y, 46 * strength + 8, (t - glint.at) * 2);
      canvas.globalAlpha = 1;
    }
  });

  return (t) => {
    if (!show(root, t >= CUE.price && t < CUE.outro)) return;
    const implode = ease.inExpo(progress(t, CUE.implode, CUE.outro - CUE.implode));
    root.style.transform = `scale(${1 - 0.96 * implode})`;
    root.style.transformOrigin = "960px 540px";
    root.style.filter = implode > 0.02 ? `blur(${20 * implode}px)` : "";

    const rise = ease.logo(progress(t, CUE.platforms, 0.32));
    const slam = spring(t, CUE.price, 2.6, 0.45);
    const scale = (1 + 1.6 * (1 - slam)) * lerp(1, 0.62, rise);
    const y = lerp(470, 330, rise);
    const blur = 30 * (1 - clamp(progress(t, CUE.price, 0.12)));
    for (const element of [glow, price]) {
      element.style.transform = `translate(960px, ${y}px) translate(-50%, -50%) scale(${scale})`;
      element.style.opacity = String(clamp(progress(t, CUE.price, 0.05)));
    }
    price.style.filter = `${blur > 0.05 ? `blur(${blur}px) ` : ""}${BEVEL}`;
    // The light band crosses the glyph from bottom to top, as on the landing page, and again
    // when the platforms land.
    const second = t >= SECOND_SWEEP;
    const sweep = ease.inOutCubic(progress(t, second ? SECOND_SWEEP : CUE.price + 0.05, 0.7));
    price.style.backgroundPosition = `0 ${sweep * 100}%, 0 0`;

    punchIn(caption, t, CUE.price + 0.2, 960, lerp(840, 590, rise), { distance: 50 });
    caption.style.transform += ` scale(${lerp(1, 0.8, rise)})`;

    chips.forEach((chip, index) => {
      const at = PLATFORM_CHIPS[index] ?? CUE.platforms;
      if (!show(chip, t >= at)) return;
      const flip = ease.outBack(progress(t, at, 0.26));
      chip.style.transform = `translate(${chipX[index] ?? 960}px, ${CHIP.y}px) translate(-50%, -50%) perspective(800px) rotateX(${90 * (1 - flip)}deg)`;
      chip.style.opacity = String(clamp(progress(t, at, 0.08)));
    });
    context.backdrop.spot("var(--openbot-price-glow)", 0.5);
  };
}
