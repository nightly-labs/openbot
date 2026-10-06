// Beats 12-20.5. "A team that works with you." The #launch window springs up, you ask, each agent
// types and answers on its beat, and a "Shipped" sticker stamps down with confetti.

import { createAvatar } from "../../avatar";
import { html, show, svg } from "../../dom";
import type { RenderScene } from "../../scene";
import { clamp, ease, progress, spring } from "../../timeline";
import { PASTEL_COPY } from "../copy";
import { CUE } from "../cues";
import { float, placePose, pop } from "../motion";
import { createWord, memberOf } from "../parts";
import { createFloaters, type PastelContext } from "../stage";

export const WINDOW = { x: 1290, y: 560, width: 960, height: 820 } as const;
const ROW = { top: 140, height: 122, avatar: 76, left: 48, text: 148 } as const;
const TITLE = { left: 130, top: 360, step: 130, size: 120 } as const;
/** The sticker, in stage pixels. The models wipe starts from it. */
export const STICKER = { x: 1520, y: 905, tilt: -8 } as const;
const TYPING = 0.38;

export function createChat(context: PastelContext): RenderScene {
  const { layer } = context;
  const floaters = createFloaters(layer, {
    seed: 37,
    start: CUE.wipeChat,
    colors: ["var(--pastel-white)", "var(--pastel-green)", "var(--pastel-aqua)"],
    count: 6,
    keepOut: [
      {
        left: TITLE.left,
        top: TITLE.top - 100,
        right: WINDOW.x - WINDOW.width / 2,
        bottom: TITLE.top + 2 * TITLE.step + 60,
      },
      {
        left: WINDOW.x - WINDOW.width / 2,
        top: WINDOW.y - WINDOW.height / 2,
        right: WINDOW.x + WINDOW.width / 2,
        bottom: WINDOW.y + WINDOW.height / 2,
      },
    ],
  });
  const lines = PASTEL_COPY.chatTitle.map((text) => createWord(layer, text, TITLE.size));

  const panel = html("div", "pastel-card", layer);
  Object.assign(panel.style, {
    width: `${WINDOW.width}px`,
    height: `${WINDOW.height}px`,
    background: "var(--pastel-white)",
    borderRadius: "48px",
    overflow: "hidden",
  });
  const header = html("div", "pastel-text", panel);
  Object.assign(header.style, {
    left: `${ROW.left}px`,
    top: "40px",
    fontSize: "46px",
    fontWeight: "800",
    letterSpacing: "-0.03em",
  });
  html("span", "", header, "# ").style.color = "var(--pastel-ink-soft)";
  html("span", "", header, PASTEL_COPY.channel);
  const divider = html("div", "", panel);
  Object.assign(divider.style, {
    position: "absolute",
    left: "0",
    right: "0",
    top: "118px",
    height: "3px",
    background: "var(--pastel-lavender)",
  });

  const people = PASTEL_COPY.messages.map((message) => memberOf(message.name));
  const stack = people.map((person, index) => {
    const avatar = createAvatar(panel, person.seed, person.hue, 60);
    Object.assign(avatar.element.style, { left: `${WINDOW.width - ROW.left - 60 - index * 44}px`, top: "30px" });
    return avatar;
  });

  const rowTop = (index: number) => ROW.top + index * ROW.height;
  const addRow = (index: number, name: string) => {
    const row = html("div", "layer", panel);
    const title = html("div", "pastel-text", row, name);
    Object.assign(title.style, {
      left: `${ROW.text}px`,
      top: `${rowTop(index) + 4}px`,
      fontSize: "30px",
      fontWeight: "800",
    });
    const body = html("div", "pastel-text", row);
    Object.assign(body.style, {
      left: `${ROW.text}px`,
      top: `${rowTop(index) + 46}px`,
      fontSize: "30px",
      fontWeight: "500",
    });
    return { row, body };
  };

  // Your request: an ink circle with your initial.
  const request = addRow(0, PASTEL_COPY.you);
  html("span", "", request.body, `${PASTEL_COPY.request} `);
  html("span", "pastel-mention", request.body, PASTEL_COPY.requestMention);
  const you = html("div", "pastel-pill", request.row, "Y");
  Object.assign(you.style, {
    left: `${ROW.left}px`,
    top: `${rowTop(0)}px`,
    width: `${ROW.avatar}px`,
    height: `${ROW.avatar}px`,
    background: "var(--pastel-ink)",
    color: "var(--pastel-white)",
    fontSize: "34px",
  });

  const replies = PASTEL_COPY.messages.map((message, index) => {
    const person = people[index] ?? memberOf(message.name);
    const row = addRow(index + 1, message.name);
    html("span", "", row.body, message.text);
    if (message.mention) {
      html("span", "", row.body, " ");
      html("span", "pastel-mention", row.body, message.mention);
    }
    const avatar = createAvatar(row.row, person.seed, person.hue, ROW.avatar);
    Object.assign(avatar.element.style, { left: `${ROW.left}px`, top: `${rowTop(index + 1)}px` });
    // Three dots while the agent types.
    const dots = html("div", "pastel-pill", panel);
    Object.assign(dots.style, {
      left: `${ROW.text + 60}px`,
      top: `${rowTop(index + 1) + 52}px`,
      width: "120px",
      height: "52px",
      gap: "10px",
      background: "var(--pastel-lavender)",
    });
    const dot = [0, 1, 2].map(() => {
      const element = html("div", "", dots);
      Object.assign(element.style, {
        width: "14px",
        height: "14px",
        borderRadius: "50%",
        background: "var(--pastel-ink-soft)",
      });
      return element;
    });
    return { ...row, avatar, dots, dot, at: CUE.messages[index] ?? 0 };
  });
  const rows = [{ ...request, avatar: undefined, at: CUE.request }, ...replies];

  const sticker = html("div", "pastel-pill", layer);
  Object.assign(sticker.style, {
    height: "116px",
    padding: "0 48px 0 34px",
    background: "var(--pastel-green)",
    color: "var(--pastel-white)",
    fontSize: "56px",
    fontWeight: "800",
    letterSpacing: "-0.03em",
    boxShadow: "0 24px 60px var(--pastel-shadow), inset 0 0 0 8px var(--pastel-white)",
  });
  const check = svg("svg", { viewBox: "0 0 24 24", width: 54, height: 54 }, sticker);
  svg(
    "path",
    {
      d: "M5 12.5l4.5 4.5L19 7.5",
      style: "fill: none; stroke: currentColor; stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round",
    },
    check,
  );
  html("span", "", sticker, PASTEL_COPY.shipped);

  context.poppers.push({
    at: CUE.shipped + 0.05,
    x: STICKER.x,
    y: STICKER.y,
    count: 90,
    speed: 2400,
    direction: -10,
    spread: 140,
    life: 1.4,
    seed: 431,
    colors: context.confetti,
  });

  return (t) => {
    floaters(t);
    lines.forEach((line, index) => {
      line.render(t, CUE.chatTitle[index] ?? 0, TITLE.left + line.width / 2, TITLE.top + index * TITLE.step);
    });

    // The window comes up from below the frame on a soft spring, then floats.
    const rise = spring(t, CUE.window, 1.6, 0.55);
    const drift = float(t, 3, 6);
    placePose(panel, {
      x: WINDOW.x + drift.x,
      y: WINDOW.y + 900 * (1 - rise) + drift.y,
      scaleX: 1,
      scaleY: 1,
      rotate: 6 * (1 - rise) + drift.rotate * 0.4,
      opacity: t >= CUE.window ? 1 : 0,
    });
    stack.forEach((avatar, index) => {
      const { scaleX, scaleY } = pop(t, CUE.window + 0.3 + index * 0.06);
      avatar.element.style.transform = `scale(${scaleX}, ${scaleY})`;
      avatar.render(t);
    });

    for (const row of rows) {
      if (!show(row.row, t >= row.at)) continue;
      const { scaleX, scaleY } = pop(t, row.at, 2.6, 0.45);
      row.row.style.transformOrigin = `${ROW.left}px ${rowTop(rows.indexOf(row))}px`;
      row.row.style.transform = `translateY(${30 * (1 - ease.outCubic(progress(t, row.at, 0.3)))}px) scale(${scaleX}, ${scaleY})`;
      row.row.style.opacity = String(clamp((t - row.at) * 8));
      row.avatar?.render(t);
    }
    for (const reply of replies) {
      const typing = t >= reply.at - TYPING && t < reply.at;
      if (!show(reply.dots, typing)) continue;
      reply.dots.style.transform = `scale(${pop(t, reply.at - TYPING, 3, 0.5).scaleX})`;
      reply.dot.forEach((dot, index) => {
        dot.style.transform = `translateY(${-8 * Math.max(0, Math.sin((t - reply.at) * 18 - index * 1.1))}px)`;
      });
    }

    // The sticker stamps down from large, with a squash.
    if (show(sticker, t >= CUE.shipped)) {
      const stamp = spring(t, CUE.shipped, 2.8, 0.42);
      const scale = 2.4 - 1.4 * stamp;
      placePose(sticker, {
        x: STICKER.x,
        y: STICKER.y,
        scaleX: scale * (1 + 0.08 * (stamp - 1)),
        scaleY: scale * (1 - 0.12 * (stamp - 1)),
        rotate: STICKER.tilt - 10 * (1 - stamp),
        opacity: clamp((t - CUE.shipped) * 14),
      });
    }
  };
}
