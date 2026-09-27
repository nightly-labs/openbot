// Beats 1.5-13. The #launch channel. Each agent types, answers, and throws a lilac baton from its
// @mention to the next agent. The Engineer ships, the chip stamps down, and the panel folds away
// while the four avatars fly into the middle.

import type { AvatarHue } from "@openbot/contracts/ipc";
import { type Avatar, createAvatar } from "../../avatar";
import { html, show } from "../../dom";
import { drawGlow } from "../../fx";
import { type RenderScene, type SceneContext, sceneLayer } from "../../scene";
import { MEMBERS } from "../../scenes/team";
import { clamp, decay, ease, lerp, progress, spring } from "../../timeline";
import { TEAM_COPY } from "../copy";
import { BATONS, BEAT, CUE, TURNS } from "../cues";
import { cameraTransform, PANEL, PANEL_LEFT, PANEL_TOP, project, ROW, rowAvatar } from "../shot";
import { MORPH } from "./hook";

const STACK = { size: 64, top: 42, step: 48 } as const;
const DOT = 14;
const CHIP = { x: 1300, y: 872, rotate: -8 } as const;
/** How long a baton trail is, as a fraction of its path. */
const TRAIL = 0.3;

interface Point {
  x: number;
  y: number;
}

function curve(from: Point, via: Point, to: Point, amount: number): Point {
  const rest = 1 - amount;
  return {
    x: rest * rest * from.x + 2 * rest * amount * via.x + amount * amount * to.x,
    y: rest * rest * from.y + 2 * rest * amount * via.y + amount * amount * to.y,
  };
}

/** Where the avatars fly when the panel folds. They merge into the logo there. */
export const MERGE = { x: 960, y: 540 } as const;

export function createChannel(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  root.style.transformOrigin = "0 0";
  const panel = html("div", "glass", root);
  Object.assign(panel.style, {
    left: `${PANEL_LEFT}px`,
    top: `${PANEL_TOP}px`,
    width: `${PANEL.width}px`,
    height: `${PANEL.height}px`,
    borderRadius: "56px",
  });
  const header = html("div", "text", panel);
  Object.assign(header.style, {
    left: "64px",
    top: "50px",
    fontSize: "52px",
    fontWeight: "700",
    letterSpacing: "-0.03em",
  });
  html("span", "muted", header, "# ");
  html("span", "", header, TEAM_COPY.channel);
  const divider = html("div", "", panel);
  Object.assign(divider.style, {
    position: "absolute",
    left: "0",
    right: "0",
    top: "148px",
    height: "2px",
    background: "var(--openbot-glass-border)",
  });

  const members = TEAM_COPY.messages.map(
    (message): { seed: string; hue: AvatarHue } => MEMBERS[message.name] ?? { seed: message.name, hue: 245 },
  );
  const stack: Avatar[] = members.map((member, index) => {
    const avatar = createAvatar(panel, member.seed, member.hue, STACK.size);
    avatar.element.style.left = `${PANEL.width - 64 - STACK.size - index * STACK.step}px`;
    avatar.element.style.top = `${STACK.top}px`;
    avatar.element.style.transformOrigin = "50% 50%";
    return avatar;
  });

  const rowTop = (index: number) => ROW.top + index * ROW.height;
  const addRow = (index: number, name: string) => {
    const row = html("div", "layer", panel);
    const title = html("div", "text", row, name);
    Object.assign(title.style, {
      left: `${ROW.text}px`,
      top: `${rowTop(index) + 2}px`,
      fontSize: "34px",
      fontWeight: "700",
    });
    const text = html("div", "text secondary", row);
    Object.assign(text.style, {
      left: `${ROW.text}px`,
      top: `${rowTop(index) + 50}px`,
      fontSize: "40px",
      fontWeight: "500",
    });
    return { row, text };
  };
  const addMention = (text: HTMLElement, mention: string) => {
    const span = html("span", "", text, ` ${mention}`);
    span.style.color = "var(--promo-lilac)";
    span.style.fontWeight = "650";
    return span;
  };
  /** The middle of a mention, in shot coordinates. */
  const mentionPoint = (index: number, span: HTMLElement): Point => ({
    x: PANEL_LEFT + ROW.text + span.offsetLeft + span.offsetWidth / 2,
    y: PANEL_TOP + rowTop(index) + 50 + span.offsetHeight / 2,
  });

  // Row 0: the request, which the hook's bubble turns into.
  const request = addRow(0, TEAM_COPY.you);
  const initial = html("div", "text", request.row, TEAM_COPY.youInitial);
  Object.assign(initial.style, {
    left: "64px",
    top: `${rowTop(0)}px`,
    width: `${ROW.avatar}px`,
    height: `${ROW.avatar}px`,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "38px",
    fontWeight: "700",
    background: "var(--openbot-glass-border)",
  });
  html("span", "", request.text, TEAM_COPY.request.lines.join(" "));
  const requestMention = addMention(request.text, TEAM_COPY.request.mention);

  const turns = TEAM_COPY.messages.map((message, index) => {
    const member = members[index] ?? { seed: message.name, hue: 245 as const };
    const { row, text } = addRow(index + 1, message.name);
    const avatar = createAvatar(row, member.seed, member.hue, ROW.avatar);
    avatar.element.style.left = "64px";
    avatar.element.style.top = `${rowTop(index + 1)}px`;
    avatar.element.style.transformOrigin = "50% 50%";
    html("span", "", text, message.text);
    const mention = message.mention ? addMention(text, message.mention) : undefined;
    if (message.after) html("span", "", text, ` ${message.after}`);
    const dots = [0, 1, 2].map((dot) => {
      const element = html("div", "", row);
      Object.assign(element.style, {
        position: "absolute",
        left: `${ROW.text + 4 + dot * (DOT + 12)}px`,
        top: `${rowTop(index + 1) + 68}px`,
        width: `${DOT}px`,
        height: `${DOT}px`,
        borderRadius: "50%",
        background: "var(--openbot-text-secondary)",
      });
      return element;
    });
    return { row, text, avatar, mention, dots, cue: TURNS[index] ?? { typing: 0, message: 0 } };
  });

  // Each baton flies from a mention to the next row's avatar, over the top.
  const sources = [requestMention, ...turns.map((turn) => turn.mention)];
  const batons = BATONS.map((baton, index) => {
    const span = sources[index];
    const from = span ? mentionPoint(index, span) : rowAvatar(index);
    const to = rowAvatar(index + 1);
    const via = { x: lerp(from.x, to.x, 0.35), y: Math.min(from.y, to.y) - 150 };
    return { ...baton, from, via, to };
  });

  for (const [index, baton] of batons.entries()) {
    const land = project(baton.to.x, baton.to.y, baton.land);
    context.bursts.push({
      at: baton.land,
      x: land.x,
      y: land.y,
      count: 22,
      speed: 900,
      life: 0.5,
      size: 5,
      color: context.palette.lilac,
      seed: 220 + index,
      shape: "streak",
    });
    context.rings.push({
      at: baton.land,
      x: land.x,
      y: land.y,
      radius: 150,
      life: 0.4,
      width: 6,
      color: context.palette.lilac,
    });
  }

  const chip = html("div", "text pill", root);
  Object.assign(chip.style, {
    left: "0",
    top: "0",
    height: "120px",
    padding: "0 52px 0 40px",
    background: "var(--openbot-success)",
    color: "var(--openbot-text-on-status)",
    fontSize: "60px",
    fontWeight: "800",
    letterSpacing: "-0.03em",
    boxShadow: "0 0 90px color-mix(in srgb, var(--openbot-success) 55%, transparent)",
  });
  const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  check.setAttribute("viewBox", "0 0 24 24");
  check.setAttribute("width", "54");
  check.setAttribute("height", "54");
  const tick = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  tick.setAttribute("points", "4 12.5 9.5 18 20 6.5");
  Object.assign(tick.style, {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3.4px",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  });
  check.append(tick);
  chip.append(check);
  html("span", "", chip, TEAM_COPY.shipped);
  const chipWidth = chip.offsetWidth;
  context.rings.push(
    { at: CUE.shipped, x: CHIP.x, y: CHIP.y, radius: 700, life: 0.6, width: 16, color: context.palette.white },
    {
      at: CUE.shipped + 0.03,
      x: CHIP.x,
      y: CHIP.y,
      radius: 1000,
      life: 0.8,
      width: 10,
      color: context.palette.success,
    },
  );
  context.bursts.push(
    {
      at: CUE.shipped,
      x: CHIP.x,
      y: CHIP.y,
      count: 30,
      speed: 1500,
      life: 0.8,
      size: 14,
      color: context.palette.success,
      seed: 231,
      shape: "star",
      drag: 4,
    },
    {
      at: CUE.shipped,
      x: CHIP.x,
      y: CHIP.y,
      count: 50,
      speed: 2000,
      life: 0.6,
      size: 5,
      color: context.palette.white,
      seed: 232,
      shape: "streak",
    },
  );

  // The four avatars leave the panel on arcs when it folds.
  const flyers = members.map((member, index) => {
    const avatar = createAvatar(root, member.seed, member.hue, ROW.avatar);
    avatar.element.style.transformOrigin = "50% 50%";
    const from = rowAvatar(index + 1);
    const side = index % 2 === 0 ? 1 : -1;
    const via = { x: MERGE.x + side * (380 + 90 * index), y: lerp(from.y, MERGE.y, 0.5) - 260 };
    return { avatar, from, via };
  });
  const flight = (t: number) => ease.inCubic(progress(t, CUE.fold, CUE.logo - CUE.fold));

  context.overlays.push((canvas, t) => {
    for (const baton of batons) {
      if (t < baton.start || t > baton.land + 0.1) continue;
      const head = ease.inOutCubic(progress(t, baton.start, baton.land - baton.start));
      const fade = 1 - progress(t, baton.land, 0.1);
      for (let step = 10; step >= 0; step -= 1) {
        const along = head - (step / 10) * TRAIL;
        if (along < 0) continue;
        const local = curve(baton.from, baton.via, baton.to, along);
        const point = project(local.x, local.y, t);
        const strength = (1 - step / 10) * fade;
        drawGlow(canvas, point.x, point.y, 18 + 40 * strength, context.palette.lilac, 0.55 * strength);
      }
      const local = curve(baton.from, baton.via, baton.to, head);
      const point = project(local.x, local.y, t);
      drawGlow(canvas, point.x, point.y, 110, context.palette.lilac, 0.6 * fade);
      drawGlow(canvas, point.x, point.y, 28, context.palette.white, fade);
    }
    // The flyers leave a lilac trail too.
    const amount = flight(t);
    if (amount <= 0 || t >= CUE.logo) return;
    for (const flyer of flyers) {
      for (let step = 6; step >= 1; step -= 1) {
        const point = curve(flyer.from, flyer.via, MERGE, Math.max(0, amount - step * 0.05));
        drawGlow(canvas, point.x, point.y, 50, context.palette.lilac, 0.35 * (1 - step / 7) * amount);
      }
    }
  });

  return (t) => {
    if (!show(root, t >= CUE.pull && t < CUE.logo)) return;
    root.style.transform = cameraTransform(t);
    const appear = clamp(progress(t, CUE.pull, MORPH));
    const fold = ease.inCubic(progress(t, CUE.fold, CUE.logo - CUE.fold));
    panel.style.opacity = String(appear * (1 - fold));
    panel.style.transform = `perspective(1600px) rotateX(${55 * fold}deg) scale(${1 - 0.8 * fold})`;
    panel.style.filter = fold > 0.01 ? `blur(${14 * fold}px)` : "";

    stack.forEach((avatar, index) => {
      const at = CUE.stack[index] ?? CUE.pull;
      const pop = spring(t, at, 2.6, 0.45);
      const called = decay(t, batons[index]?.land ?? 0, 0.4);
      avatar.element.style.opacity = String(clamp(pop * 3));
      avatar.element.style.transform = `scale(${pop * (1 + 0.35 * called)})`;
      avatar.render(t);
    });

    request.row.style.opacity = String(appear);
    request.row.style.filter = appear < 1 ? `blur(${8 * (1 - appear)}px)` : "";

    for (const turn of turns) {
      if (!show(turn.row, t >= turn.cue.typing)) continue;
      const pop = spring(t, turn.cue.typing, 2.6, 0.45);
      turn.avatar.element.style.transform = `scale(${pop})`;
      turn.avatar.element.style.opacity = t >= CUE.fold ? "0" : "1";
      turn.avatar.render(t);
      turn.row.style.opacity = String(clamp(pop * 3));
      const answered = t >= turn.cue.message;
      for (const [index, dot] of turn.dots.entries()) {
        show(dot, !answered);
        const hop = Math.max(0, Math.sin(Math.PI * 2 * ((t - turn.cue.typing) / (BEAT / 2) - index * 0.18)));
        dot.style.transform = `translateY(${-12 * hop}px)`;
        dot.style.opacity = String(0.5 + 0.5 * hop);
      }
      if (!show(turn.text, answered)) continue;
      const land = spring(t, turn.cue.message, 2.8, 0.5);
      turn.text.style.transform = `translateY(${30 * (1 - land)}px) scale(${0.94 + 0.06 * land})`;
      turn.text.style.transformOrigin = "0 50%";
      turn.text.style.opacity = String(clamp(land * 2.5));
    }
    for (const [index, span] of sources.entries()) {
      if (!span) continue;
      const glow = decay(t, batons[index]?.start ?? 0, 0.4);
      span.style.textShadow = glow > 0.01 ? `0 0 ${30 * glow}px var(--promo-lilac)` : "";
    }

    if (show(chip, t >= CUE.shipped)) {
      const stamp = ease.outExpo(progress(t, CUE.shipped, 0.14));
      const settle = spring(t, CUE.shipped, 3, 0.4);
      const scale = (2.6 - 1.6 * stamp) * (0.9 + 0.1 * settle) * (1 - 0.8 * fold);
      chip.style.transform = `translate(${CHIP.x - chipWidth / 2}px, ${CHIP.y - 60}px) rotate(${CHIP.rotate}deg) scale(${scale})`;
      chip.style.opacity = String(clamp(progress(t, CUE.shipped, 0.05)) * (1 - fold));
    }

    const amount = flight(t);
    for (const [index, flyer] of flyers.entries()) {
      if (!show(flyer.avatar.element, t >= CUE.fold)) continue;
      const point = curve(flyer.from, flyer.via, MERGE, amount);
      const scale = lerp(1, 0.3, amount);
      flyer.avatar.element.style.transform = `translate(${point.x - ROW.avatar / 2}px, ${point.y - ROW.avatar / 2}px) rotate(${(index % 2 === 0 ? 1 : -1) * 300 * amount}deg) scale(${scale})`;
      flyer.avatar.render(t);
    }
    context.backdrop.spot(
      t >= CUE.shipped && t < CUE.fold ? "var(--openbot-success)" : "var(--promo-lilac)",
      t >= CUE.shipped && t < CUE.fold ? 0.26 : 0.2,
    );
  };
}
