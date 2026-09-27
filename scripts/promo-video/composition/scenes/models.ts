// 6-9 s. One agent card. The provider badge glitches from model to model, and the name and role
// on the card do not change.

import {
  CLAUDE_LOGO_PATH,
  CODEX_LOGO_PATH,
  GEMINI_LOGO_PATH,
  GROK_LOGO_PATHS,
  PROVIDER_LOGO_VIEWBOX,
} from "@openbot/brand/provider-logo-shape";
import { createAvatar } from "../avatar";
import { COPY } from "../copy";
import { CUE, PROVIDER_SWAPS } from "../cues";
import { html, show, svg } from "../dom";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../scene";
import { clamp, decay, ease, noise, progress, spring } from "../timeline";

const CARD = { x: 960, y: 560, width: 1180, height: 390 };
const AVATAR_SIZE = 240;
const GLITCH = 0.12;
const WHIP = { start: 8.86, length: 0.16 };

/** The mark and the light color of each badge, in `COPY.providers` order. */
const BADGES = [
  { viewBox: PROVIDER_LOGO_VIEWBOX.codex, paths: [CODEX_LOGO_PATH], glow: "var(--promo-lilac)" },
  { viewBox: PROVIDER_LOGO_VIEWBOX.claude, paths: [CLAUDE_LOGO_PATH], glow: "var(--openbot-provider-claude)" },
  { viewBox: PROVIDER_LOGO_VIEWBOX.antigravity, paths: [GEMINI_LOGO_PATH], glow: "var(--openbot-accent-text)" },
  { viewBox: PROVIDER_LOGO_VIEWBOX.grok, paths: [...GROK_LOGO_PATHS], glow: "var(--promo-white)" },
  { viewBox: "-12 -12 24 24", paths: [sparkPath()], glow: "var(--openbot-success)" },
] as const;

const MARK_COLORS = [
  "var(--openbot-provider-codex)",
  "var(--openbot-provider-claude)",
  "var(--openbot-accent-text)",
  "var(--openbot-provider-grok)",
  "var(--openbot-success)",
];

export function createModels(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const title = html("div", "word", root, COPY.modelsTitle);
  title.style.fontSize = "150px";
  const lines = [COPY.modelsLine, COPY.modelsKeep].map((text) => {
    const line = html("div", "text secondary", root, text);
    line.style.fontSize = "52px";
    line.style.fontWeight = "600";
    line.style.letterSpacing = "-0.02em";
    return line;
  });

  const card = html("div", "glass", root);
  card.style.width = `${CARD.width}px`;
  card.style.height = `${CARD.height}px`;
  card.style.borderRadius = "76px";
  const avatar = createAvatar(card, "promo-researcher", 245, AVATAR_SIZE);
  avatar.element.style.left = "72px";
  avatar.element.style.top = `${(CARD.height - AVATAR_SIZE) / 2}px`;
  const name = html("div", "text", card, COPY.agentName);
  Object.assign(name.style, {
    left: "364px",
    top: "58px",
    fontSize: "88px",
    fontWeight: "700",
    letterSpacing: "-0.035em",
  });
  const role = html("div", "text muted", card, COPY.agentRole);
  Object.assign(role.style, { left: "366px", top: "164px", fontSize: "44px", fontWeight: "500" });

  const badges = BADGES.map((badge, index) => {
    const pill = html("div", "text pill", card);
    Object.assign(pill.style, {
      left: "362px",
      top: "240px",
      height: "96px",
      padding: "0 40px 0 30px",
      background: "var(--openbot-glass-surface-hover)",
      border: "2px solid var(--openbot-glass-border)",
      fontSize: "50px",
      fontWeight: "700",
      letterSpacing: "-0.02em",
      boxSizing: "border-box",
    });
    const mark = svg("svg", { viewBox: badge.viewBox, width: 54, height: 54 }, pill);
    for (const d of badge.paths) svg("path", { d, style: `fill: ${MARK_COLORS[index]}` }, mark);
    html("span", "", pill, COPY.providers[index]);
    return pill;
  });

  const current = (t: number) => {
    let index = 0;
    PROVIDER_SWAPS.forEach((at, swap) => {
      if (t >= at) index = swap;
    });
    return index;
  };

  return (t) => {
    if (!show(root, t >= CUE.models - 0.001 && t < CUE.team + 0.05)) return;
    const whip = ease.inExpo(progress(t, WHIP.start, WHIP.length));
    root.style.transform = whip > 0 ? `translateX(${-2400 * whip}px) skewX(${12 * whip}deg)` : "";
    root.style.filter = whip > 0.02 ? `blur(${30 * whip}px)` : "";

    punchIn(title, t, CUE.models, 960, 200, { distance: -60 });
    const keep = t >= 7.9;
    lines.forEach((line, index) => {
      const start = index === 0 ? 6.35 : 7.9;
      if (!show(line, (index === 1) === keep && t >= start)) return;
      punchIn(line, t, start, 960, 880, { distance: 40, skew: 0, scale: 1.1 });
    });

    const grow = spring(t, CUE.models + 0.04, 2.2, 0.5);
    const blur = 18 * (1 - clamp(grow));
    card.style.transform = `translate(${CARD.x - CARD.width / 2}px, ${CARD.y - CARD.height / 2 + 60 * (1 - grow)}px) scale(${0.7 + 0.3 * grow})`;
    card.style.opacity = String(clamp(grow * 3));
    card.style.filter = blur > 0.05 ? `blur(${blur}px)` : "";
    avatar.render(t);

    const index = current(t);
    const swapAt = PROVIDER_SWAPS[index] ?? CUE.models;
    const glitch = index > 0 ? decay(t, swapAt, GLITCH) : 0;
    const frame = Math.floor(t * 60);
    // The first frames of a swap flicker between the old and the new badge.
    const shown = glitch > 0.5 && frame % 2 === 0 ? index - 1 : index;
    badges.forEach((badge, badgeIndex) => {
      if (!show(badge, badgeIndex === shown)) return;
      const jitter = glitch * 34 * noise(frame, 0.5);
      const split = glitch * 8;
      badge.style.transform = `translateX(${jitter}px) skewX(${glitch * -18 * noise(frame + 3, 0.5)}deg)`;
      badge.style.filter =
        split > 0.2
          ? `drop-shadow(${split}px 0 0 var(--promo-split-warm)) drop-shadow(${-split}px 0 0 var(--promo-split-cool))`
          : "";
      const band = Math.floor(clamp(0.5 + noise(frame + 9, 0.5) * 0.5) * 60);
      badge.style.clipPath = glitch > 0.2 ? `inset(${band}% 0 ${Math.max(0, 70 - band)}% 0)` : "";
    });
    const glow = BADGES[index]?.glow ?? "var(--promo-lilac)";
    context.backdrop.spot(glow, (0.3 + 0.2 * glitch) * clamp(grow));
  };
}

/** A four-point spark for "Your model", which has no brand mark. */
function sparkPath(): string {
  return "M0 -11 C1.2 -3.5 3.5 -1.2 11 0 C3.5 1.2 1.2 3.5 0 11 C-1.2 3.5 -3.5 1.2 -11 0 C-3.5 -1.2 -1.2 -3.5 0 -11 Z";
}
