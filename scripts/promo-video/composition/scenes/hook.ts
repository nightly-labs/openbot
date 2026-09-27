// 0-3 s. The part that must stop the scroll: the eyes draw themselves from frame 0, blink, look
// around, and the lilac square slams in behind them on the first downbeat. Then "Meet OpenBot",
// and the camera dives into the left eye.

import { COPY } from "../copy";
import { CUE } from "../cues";
import { html, show } from "../dom";
import { drawGlow } from "../fx";
import { createLogo, type LogoPose, RESTING_POSE } from "../logo";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../scene";
import { beatPulse, bump, clamp, ease, keys, lerp, progress, spring } from "../timeline";

const START_SIZE = 1900;
const LOCKUP_SIZE = 300;
const WORD_SIZE = 200;
const GAP = 56;
/** The zoom-out before the slam ends at this size, and the spring takes it down to rest. */
const WIND_UP_SIZE = 1150;
const DIVE_ZOOM = 60;

export function createHook(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const meet = html("div", "word hero", root, COPY.meet);
  const name = html("div", "word hero", root, COPY.name);
  meet.style.fontSize = `${WORD_SIZE}px`;
  name.style.fontSize = `${WORD_SIZE}px`;
  const logo = createLogo(root);
  const cover = html("div", "layer", root);
  cover.style.background = "var(--promo-eye)";

  // "Meet [mark] OpenBot", centered as one line.
  const total = meet.offsetWidth + GAP + LOCKUP_SIZE + GAP + name.offsetWidth;
  const left = 960 - total / 2;
  const meetX = left + meet.offsetWidth / 2;
  const logoX = left + meet.offsetWidth + GAP + LOCKUP_SIZE / 2;
  const nameX = logoX + LOCKUP_SIZE / 2 + GAP + name.offsetWidth / 2;

  const lockupPose = (t: number): LogoPose => {
    const settle = ease.logo(progress(t, CUE.meet, 0.3));
    const breathe = 1 + 0.05 * beatPulse(t, 1.5, CUE.openBot, 0.2);
    const slamSize = RESTING_POSE.size + (WIND_UP_SIZE - RESTING_POSE.size) * (1 - spring(t, CUE.slam, 2.4, 0.5));
    return {
      ...RESTING_POSE,
      x: lerp(960, logoX, settle),
      size: lerp(slamSize, LOCKUP_SIZE, settle) * breathe,
      // The square stamps down from larger than the frame onto the eyes.
      square: 1 + 0.6 * (1 - spring(t, CUE.slam, 2.8, 0.4)),
      blink: [1 - 0.9 * bump(t, 1.75, 0.13), 1 - 0.9 * bump(t, 1.75, 0.13)],
      lookX: keys(t, [
        [0, 0],
        [1.55, 0.02],
        [1.9, 0],
        [2.05, -0.035],
        [CUE.openBot, 0.035],
      ]),
      lookY: keys(t, [
        [0, 0],
        [1.55, -0.02],
        [1.9, 0],
      ]),
      sheen: t >= 1.3 && t < 1.85 ? progress(t, 1.3, 0.55) : -1,
    };
  };

  const pose = (t: number): LogoPose => {
    if (t >= CUE.slam) return lockupPose(t);
    const push = START_SIZE * (1 + 0.1 * t);
    const windUp = ease.inCubic(progress(t, 0.84, CUE.slam - 0.84));
    const blink = 1 - 0.92 * bump(t, CUE.blink, 0.13);
    const [lookLeft, lookRight, lookBack] = CUE.looks;
    return {
      ...RESTING_POSE,
      size: lerp(push, WIND_UP_SIZE, windUp),
      square: 0,
      draw: [
        ease.outQuart(progress(t, CUE.drawLeft - 0.03, CUE.drawLength)),
        ease.outQuart(progress(t, CUE.drawRight - 0.05, CUE.drawLength)),
      ],
      blink: [blink, blink],
      lookX: keys(t, [
        [0, 0],
        [lookLeft, -0.045],
        [lookRight, 0.045],
        [lookBack, 0],
      ]),
      eyeColor: "var(--promo-white)",
      glow: 40,
    };
  };

  // The dive holds one point of the left eye stroke still on screen, and zooms around it.
  const diveStart = lockupPose(CUE.dive);
  const anchor = logo.eyePoint(0, 0.52);
  const anchorOffset = {
    x: (anchor.x - 0.5) * diveStart.size,
    y: (anchor.y - 0.5) * diveStart.size,
  };

  const divePose = (t: number): LogoPose => {
    const amount = progress(t, CUE.dive, CUE.promise - CUE.dive);
    const zoom = Math.exp(Math.log(DIVE_ZOOM) * ease.inCubic(amount));
    const focus = ease.inOutCubic(amount);
    const focusX = lerp(diveStart.x + anchorOffset.x, 960, focus);
    const focusY = lerp(diveStart.y + anchorOffset.y, 540, focus);
    return {
      ...lockupPose(t),
      x: focusX - anchorOffset.x * zoom,
      y: focusY - anchorOffset.y * zoom,
      size: diveStart.size * zoom,
    };
  };

  // Sparks come off the pen tips while the eyes draw.
  for (let step = 0; step <= 14; step += 1) {
    const at = step * 0.025;
    logo.penTips(pose(at)).forEach((tip, index) => {
      context.bursts.push({
        at,
        x: tip.x,
        y: tip.y,
        count: 5,
        speed: 900,
        life: 0.45,
        size: 5,
        color: index === 0 ? context.palette.white : context.palette.lilac,
        seed: 100 + step * 2 + index,
        shape: "streak",
        gravity: 1400,
      });
    });
  }
  context.rings.push(
    { at: CUE.slam, x: 960, y: 540, radius: 1100, life: 0.7, width: 26, color: context.palette.white },
    { at: CUE.slam + 0.04, x: 960, y: 540, radius: 1500, life: 0.9, width: 12, color: context.palette.lilac },
  );
  context.bursts.push(
    {
      at: CUE.slam,
      x: 960,
      y: 540,
      count: 90,
      speed: 2600,
      life: 0.9,
      size: 7,
      color: context.palette.lilac,
      seed: 11,
      shape: "streak",
      drag: 3.5,
    },
    {
      at: CUE.slam,
      x: 960,
      y: 540,
      count: 40,
      speed: 1600,
      life: 0.8,
      size: 6,
      color: context.palette.white,
      seed: 12,
      shape: "dot",
    },
  );
  context.overlays.push((canvas, t) => {
    if (t >= CUE.blink) return;
    const current = pose(t);
    logo.penTips(current).forEach((tip, index) => {
      const drawn = current.draw[index] ?? 1;
      if (drawn <= 0.01 || drawn >= 0.995) return;
      const strength = 1 - drawn;
      drawGlow(canvas, tip.x, tip.y, 260, context.palette.lilac, 0.5 * strength);
      drawGlow(canvas, tip.x, tip.y, 80, context.palette.white, 0.9 * strength);
    });
  });

  return (t) => {
    if (!show(root, t < CUE.promise)) return;
    const diving = t >= CUE.dive;
    const current = diving ? divePose(t) : pose(t);
    logo.render(current);
    const dive = progress(t, CUE.dive, CUE.promise - CUE.dive);
    logo.element.style.filter = dive > 0 ? `blur(${10 * dive}px)` : "";

    if (show(meet, t >= CUE.meet)) {
      punchIn(meet, t, CUE.meet, meetX - 1800 * ease.inCubic(dive), 540, { distance: -120, axis: "x", skew: 14 });
    }
    if (show(name, t >= CUE.openBot)) {
      punchIn(name, t, CUE.openBot, nameX + 1800 * ease.inCubic(dive), 540, { distance: 120, axis: "x" });
    }
    cover.style.opacity = String(ease.inCubic(progress(t, 2.86, CUE.promise - 2.86)));
    context.backdrop.spot(context.palette.lilac, 0.18 * clamp((t - CUE.slam) * 4));
  };
}
