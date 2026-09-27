// 3-6 s. One word of the pitch on every beat, full frame, with the background flipping between
// black and lilac.

import { createAvatar } from "../avatar";
import { COPY } from "../copy";
import { CUE, PROMISE_WORDS } from "../cues";
import { html, show } from "../dom";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../scene";
import { ease, progress, spring } from "../timeline";

interface WordStyle {
  size: number;
  lilac: boolean;
  outline?: boolean;
  y?: number;
}

const STYLES: readonly WordStyle[] = [
  { size: 300 },
  { size: 700, lilac: true },
  { size: 280, y: 620 },
  { size: 460, outline: true },
  { size: 460 },
  { size: 330, lilac: true },
].map((style) => ({ lilac: false, ...style }));

const ECHOES = 4;
const TEAM = [
  { seed: "promo-researcher", hue: 245 },
  { seed: "promo-writer", hue: 30 },
  { seed: "promo-designer", hue: 320 },
  { seed: "promo-engineer", hue: 185 },
  { seed: "promo-analyst", hue: 150 },
] as const;
const AVATAR_SIZE = 150;

export function createPromise(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const background = html("div", "layer", root);
  const echoes = Array.from({ length: ECHOES }, () => html("div", "word outline", root, COPY.promise[0]));
  const words = COPY.promise.map((text, index) => {
    const style = STYLES[index] ?? { size: 300, lilac: false };
    const word = html("div", style.outline ? "word outline" : "word", root, text);
    word.style.fontSize = `${style.size}px`;
    if (style.outline) word.style.webkitTextStroke = "6px var(--promo-lilac)";
    word.style.color = style.lilac ? "var(--promo-eye)" : "";
    return word;
  });
  for (const echo of echoes) echo.style.fontSize = `${STYLES[0]?.size ?? 300}px`;
  const avatars = TEAM.map((member) => createAvatar(root, member.seed, member.hue, AVATAR_SIZE));

  return (t) => {
    if (!show(root, t >= CUE.promise && t < CUE.models)) return;
    let current = 0;
    PROMISE_WORDS.forEach((start, index) => {
      if (t >= start) current = index;
    });
    const start = PROMISE_WORDS[current] ?? CUE.promise;
    const style = STYLES[current] ?? { size: 300, lilac: false };
    background.style.background = style.lilac ? "var(--promo-lilac)" : "var(--promo-black)";

    words.forEach((word, index) => {
      if (show(word, index === current)) punchIn(word, t, start, 960, style.y ?? 540, { drift: 0.05 });
    });

    echoes.forEach((echo, index) => {
      const amount = progress(t, CUE.promise + 0.03 * index, 0.5);
      if (!show(echo, current === 0 && amount > 0 && amount < 1)) return;
      const scale = 1 + 0.16 * (index + 1) * ease.outExpo(amount);
      echo.style.transform = `translate(960px, 540px) translate(-50%, -50%) scale(${scale})`;
      echo.style.opacity = String(0.7 * (1 - index / ECHOES) * (1 - amount));
    });

    avatars.forEach((avatar, index) => {
      const pop = PROMISE_WORDS[2] + 0.05 * index;
      if (!show(avatar.element, current === 2 && t >= pop)) return;
      const grow = spring(t, pop, 2.8, 0.45);
      const x = 960 + (index - (avatars.length - 1) / 2) * (AVATAR_SIZE + 40);
      avatar.element.style.transform = `translate(${x - AVATAR_SIZE / 2}px, ${300 - AVATAR_SIZE / 2 + 40 * (1 - grow)}px) scale(${grow})`;
      avatar.render(t);
    });
  };
}
