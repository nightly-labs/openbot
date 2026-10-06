// Beats 20.5-25. "Any model." The Researcher stands in the middle, and the provider marks pop out
// of it as coins that circle it. The agent stays the same whichever coin is in front.

import {
  CLAUDE_LOGO_PATH,
  CODEX_LOGO_PATH,
  GEMINI_LOGO_PATH,
  GROK_LOGO_PATHS,
  PROVIDER_LOGO_VIEWBOX,
} from "@openbot/brand/provider-logo-shape";
import { createAvatar } from "../../avatar";
import { html, svg } from "../../dom";
import type { RenderScene } from "../../scene";
import { clamp, ease, lerp, progress } from "../../timeline";
import { PASTEL_COPY } from "../copy";
import { CUE } from "../cues";
import { float, hop, placePose, pop } from "../motion";
import { createWord, memberOf } from "../parts";
import { createFloaters, type PastelContext } from "../stage";

export const HERO = { x: 960, y: 690, avatar: 270, base: 360 } as const;
const ORBIT = { radiusX: 560, radiusY: 150, speed: 0.9, coin: 160 } as const;

const COINS = [
  { viewBox: PROVIDER_LOGO_VIEWBOX.codex, paths: [CODEX_LOGO_PATH], color: "var(--pastel-ink)" },
  { viewBox: PROVIDER_LOGO_VIEWBOX.claude, paths: [CLAUDE_LOGO_PATH], color: "var(--openbot-provider-claude)" },
  { viewBox: PROVIDER_LOGO_VIEWBOX.antigravity, paths: [GEMINI_LOGO_PATH], color: "var(--openbot-accent)" },
  { viewBox: PROVIDER_LOGO_VIEWBOX.grok, paths: [...GROK_LOGO_PATHS], color: "var(--pastel-ink)" },
] as const;

export function createModels(context: PastelContext): RenderScene {
  const { layer } = context;
  const floaters = createFloaters(layer, {
    seed: 53,
    start: CUE.wipeModels,
    colors: ["var(--pastel-white)", "var(--pastel-sky)", "var(--pastel-lilac)"],
    count: 7,
  });
  const title = createWord(layer, PASTEL_COPY.modelsTitle, 150);
  const line = createWord(layer, PASTEL_COPY.modelsLine, 54, "var(--pastel-ink-soft)");
  line.element.style.fontWeight = "600";
  line.element.style.letterSpacing = "-0.02em";

  const base = html("div", "pastel-shape", layer);
  Object.assign(base.style, {
    width: `${HERO.base}px`,
    height: `${HERO.base * 0.28}px`,
    borderRadius: "50%",
    background: "var(--pastel-white)",
    boxShadow: "0 20px 50px var(--pastel-shadow)",
  });
  const behind = html("div", "layer", layer);
  const researcher = memberOf("Researcher");
  const hero = createAvatar(layer, researcher.seed, researcher.hue, HERO.avatar);
  const front = html("div", "layer", layer);

  const coins = COINS.map((coin, index) => {
    const element = html("div", "pastel-pill", front);
    Object.assign(element.style, {
      width: `${ORBIT.coin}px`,
      height: `${ORBIT.coin}px`,
      background: "var(--pastel-white)",
      boxShadow: "0 18px 40px var(--pastel-shadow), inset 0 -10px 0 var(--pastel-mist)",
    });
    const mark = svg("svg", { viewBox: coin.viewBox, width: 84, height: 84 }, element);
    for (const d of coin.paths) svg("path", { d, style: `fill: ${coin.color}` }, mark);
    return { element, start: CUE.coins[index] ?? 0, phase: (index / COINS.length) * Math.PI * 2 };
  });

  return (t) => {
    floaters(t);
    title.render(t, CUE.modelsTitle, 960, 200);
    line.render(t, CUE.modelsLine, 960, 310);

    const arrive = CUE.wipeModels + 0.25;
    const { scaleX, scaleY } = pop(t, arrive, 2.2, 0.4);
    placePose(base, {
      x: HERO.x,
      y: HERO.y + HERO.avatar * 0.46,
      scaleX,
      scaleY,
      rotate: 0,
      opacity: clamp((t - arrive) * 8),
    });
    // The agent hops each time a coin pops out of it.
    let lift = 0;
    let squashX = 1;
    let squashY = 1;
    for (const coin of coins) {
      const jump = hop(t, coin.start - 0.05, 0.3, 34);
      lift += jump.lift;
      squashX *= jump.scaleX;
      squashY *= jump.scaleY;
    }
    const drift = float(t, 7, 6);
    placePose(
      hero.element,
      {
        x: HERO.x,
        y: HERO.y - lift + drift.y,
        scaleX: scaleX * squashX,
        scaleY: scaleY * squashY,
        rotate: drift.rotate,
        opacity: clamp((t - arrive) * 8),
      },
      "50% 100%",
    );
    hero.render(t);

    for (const coin of coins) {
      // A coin flies out from the agent to its place on the orbit, then goes round.
      const out = ease.outCubic(progress(t, coin.start, 0.45));
      const angle = coin.phase + (t - CUE.coins[0]) * ORBIT.speed;
      const depth = Math.sin(angle);
      const x = lerp(HERO.x, HERO.x + Math.cos(angle) * ORBIT.radiusX, out);
      const y = lerp(HERO.y - 40, HERO.y + depth * ORBIT.radiusY, out);
      const coinPop = pop(t, coin.start, 2.6, 0.4);
      const near = 0.82 + (0.22 * (depth + 1)) / 2;
      // Behind the agent while it is on the far side of the orbit.
      const parent = depth < 0 && out > 0.5 ? behind : front;
      if (coin.element.parentElement !== parent) parent.append(coin.element);
      placePose(coin.element, {
        x,
        y,
        scaleX: coinPop.scaleX * near,
        scaleY: coinPop.scaleY * near,
        rotate: 10 * Math.cos(angle),
        opacity: clamp((t - coin.start) * 10),
      });
    }
  };
}
