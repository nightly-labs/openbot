// 9-12 s. A channel where the agents hand work to each other, one message per beat pair.

import type { AvatarHue } from "@openbot/contracts/ipc";
import { type Avatar, createAvatar } from "../avatar";
import { COPY } from "../copy";
import { CUE, TEAM_MESSAGES } from "../cues";
import { html, show } from "../dom";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../scene";
import { clamp, ease, lerp, progress, spring } from "../timeline";

const PANEL = { x: 1330, y: 545, width: 920, height: 740 };
const ROW = { top: 172, height: 136, avatar: 80 };
const WHIP_IN = { start: 8.92, length: 0.2 };
const PUNCH_OUT = { start: 11.88, length: 0.12 };

export const MEMBERS: Readonly<Record<string, { seed: string; hue: AvatarHue }>> = {
  Researcher: { seed: "promo-researcher", hue: 245 },
  Writer: { seed: "promo-writer", hue: 30 },
  Designer: { seed: "promo-designer", hue: 320 },
  Engineer: { seed: "promo-engineer", hue: 185 },
};

export function createTeam(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  const captions = COPY.team.map((text, index) => {
    const line = html("div", "word", root, text);
    line.style.fontSize = "132px";
    if (index === COPY.team.length - 1) line.style.color = "var(--promo-lilac)";
    return line;
  });
  const captionWidths = captions.map((caption) => caption.offsetWidth);

  const panel = html("div", "glass", root);
  Object.assign(panel.style, {
    width: `${PANEL.width}px`,
    height: `${PANEL.height}px`,
    borderRadius: "56px",
    transformOrigin: "30% 50%",
  });
  const header = html("div", "text", panel);
  Object.assign(header.style, {
    left: "56px",
    top: "52px",
    fontSize: "48px",
    fontWeight: "700",
    letterSpacing: "-0.03em",
  });
  html("span", "muted", header, "# ");
  html("span", "", header, COPY.channel);
  const divider = html("div", "", panel);
  Object.assign(divider.style, {
    position: "absolute",
    left: "0",
    right: "0",
    top: "136px",
    height: "2px",
    background: "var(--openbot-glass-border)",
  });

  const stack: Avatar[] = Object.values(MEMBERS).map((member, index) => {
    const avatar = createAvatar(panel, member.seed, member.hue, 64);
    avatar.element.style.left = `${PANEL.width - 56 - 64 - index * 44}px`;
    avatar.element.style.top = "38px";
    return avatar;
  });

  const rows = COPY.messages.map((message, index) => {
    const row = html("div", "layer", panel);
    const member = MEMBERS[message.name] ?? { seed: message.name, hue: 245 };
    const avatar = createAvatar(row, member.seed, member.hue, ROW.avatar);
    avatar.element.style.left = "56px";
    avatar.element.style.top = `${ROW.top + index * ROW.height}px`;
    const name = html("div", "text", row, message.name);
    Object.assign(name.style, {
      left: "164px",
      top: `${ROW.top + index * ROW.height + 4}px`,
      fontSize: "32px",
      fontWeight: "700",
    });
    const text = html("div", "text secondary", row);
    Object.assign(text.style, {
      left: "164px",
      top: `${ROW.top + index * ROW.height + 50}px`,
      fontSize: "36px",
      fontWeight: "500",
    });
    html("span", "", text, message.text);
    if (message.mention) {
      const mention = html("span", "", text, ` ${message.mention}`);
      mention.style.color = "var(--promo-lilac)";
      mention.style.fontWeight = "650";
    }
    if (message.after) html("span", "", text, ` ${message.after}`);
    return { row, avatar };
  });

  return (t) => {
    if (!show(root, t >= WHIP_IN.start && t < CUE.local)) return;
    const whip = 1 - ease.outExpo(progress(t, WHIP_IN.start, WHIP_IN.length));
    const punch = ease.inExpo(progress(t, PUNCH_OUT.start, PUNCH_OUT.length));
    root.style.transform = `translateX(${2400 * whip}px) skewX(${12 * whip}deg) scale(${1 + 0.6 * punch})`;
    root.style.opacity = String(1 - punch);
    const blur = 30 * whip + 24 * punch;
    root.style.filter = blur > 0.05 ? `blur(${blur}px)` : "";

    const dolly = ease.inOutCubic(progress(t, CUE.team, CUE.local - CUE.team));
    captions.forEach((caption, index) => {
      // Left-aligned: `punchIn` places by the center.
      const x = 150 - 30 * dolly + (captionWidths[index] ?? 0) / 2;
      punchIn(caption, t, CUE.team + 0.12 * (index + 1), x, 400 + index * 150, { distance: 60 });
    });

    const enter = spring(t, CUE.team + 0.05, 1.8, 0.55);
    const rotate = lerp(-18, -6, dolly);
    panel.style.transform = `translate(${PANEL.x - PANEL.width / 2 + 40 * (1 - dolly)}px, ${PANEL.y - PANEL.height / 2}px) perspective(1800px) rotateY(${rotate}deg) scale(${0.85 + 0.15 * enter})`;
    for (const avatar of stack) avatar.render(t);

    rows.forEach(({ row, avatar }, index) => {
      const at = TEAM_MESSAGES[index] ?? CUE.team;
      if (!show(row, t >= at)) return;
      const pop = spring(t, at, 2.6, 0.5);
      row.style.transform = `translateY(${36 * (1 - pop)}px) scale(${0.92 + 0.08 * pop})`;
      row.style.transformOrigin = `0 ${ROW.top + index * ROW.height}px`;
      row.style.opacity = String(clamp(pop * 2.5));
      avatar.render(t);
    });
    context.backdrop.spot("var(--promo-lilac)", 0.2);
  };
}
