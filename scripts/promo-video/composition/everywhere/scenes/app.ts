// Beats 0-20. One conversation on one device. The request is typed into the desktop composer and
// sent; the Researcher starts work. The window becomes a browser at openbot.run/app, then an
// iPhone, and one task ticks on each. On the phone the app goes home and the Live Activity takes
// over, and at the end the phone flies into the logo.

import { createAvatar } from "../../avatar";
import { html, show } from "../../dom";
import { createLogo, RESTING_POSE } from "../../logo";
import { punchIn, type RenderScene, type SceneContext, sceneLayer } from "../../scene";
import { MEMBERS } from "../../scenes/team";
import { clamp, decay, ease, lerp, progress, spring } from "../../timeline";
import { EVERYWHERE_COPY as COPY } from "../copy";
import { BEAT, CUE, TASK_TICKS } from "../cues";
import {
  CARD,
  COMPOSER_HEIGHT,
  cameraTransform,
  devicePose,
  INDENT,
  layout,
  onDevice,
  project,
  RAIL,
  SIDEBAR,
  TAB_STRIP,
  TOOLBAR,
  taskCheck,
} from "../device";
import { box, ICONS, icon, label, mix, placeIcon, put } from "../parts";
import { APP_ICON, createPhone } from "./phone";

const CHROME = TAB_STRIP + TOOLBAR;
const HEADER = { height: 52, avatar: 44 } as const;
const BUBBLE = { height: 52, padding: 22 } as const;
const WORD_GAP = 6;
const TYPED_LEFT = 24;

export function createApp(context: SceneContext): RenderScene {
  const root = sceneLayer(context);
  root.style.transformOrigin = "0 0";
  const agent = MEMBERS[COPY.agent] ?? { seed: COPY.agent, hue: 245 as const };

  const device = box(root, { overflow: "hidden", transformOrigin: "50% 50%" });
  const home = box(device, { inset: "0" });
  const screen = box(device, { overflow: "hidden", transformOrigin: "50% 50%" });
  const overlay = box(device, { inset: "0" });

  // The rail.
  const rail = box(screen, { overflow: "hidden", background: "var(--openbot-bg-native-canvas)" });
  const railItems = box(rail, { width: `${RAIL}px`, height: "400px" });
  createLogo(railItems).render({ ...RESTING_POSE, x: RAIL / 2, y: 22, size: 44 });
  for (let index = 0; index < 3; index += 1) {
    box(railItems, {
      left: `${(RAIL - 40) / 2}px`,
      top: `${74 + index * 56}px`,
      width: "40px",
      height: "40px",
      borderRadius: "12px",
      background: "var(--openbot-glass-surface)",
    });
  }

  // The sidebar: search, the team, and on the web the account shelf.
  const sidebar = box(screen, { overflow: "hidden", borderRight: "2px solid var(--openbot-border-grouped)" });
  const sidebarItems = box(sidebar, { width: `${SIDEBAR}px` });
  const search = box(sidebarItems, {
    left: "16px",
    width: `${SIDEBAR - 32}px`,
    height: "44px",
    borderRadius: "12px",
    background: "var(--openbot-bg-control)",
    color: "var(--openbot-text-muted)",
  });
  placeIcon(icon(search, 20, ICONS.search), 14, 12);
  label(search, COPY.search, { left: "44px", top: "12px", fontSize: "18px", fontWeight: "500" }, "text muted");
  const rows = COPY.team.map((name, index) => {
    const member = MEMBERS[name] ?? agent;
    const row = box(sidebarItems, {
      left: "8px",
      width: `${SIDEBAR - 16}px`,
      height: "58px",
      borderRadius: "12px",
      background: index === 0 ? "var(--openbot-bg-control-active)" : "",
    });
    const avatar = createAvatar(row, member.seed, member.hue, 48);
    Object.assign(avatar.element.style, { left: "6px", top: "5px" });
    const title = label(row, name, { left: "60px", top: "18px", fontSize: "19px", fontWeight: "600" });
    if (index > 0) title.style.color = "var(--openbot-text-secondary)";
    // Only the Researcher works in this video.
    const state =
      index === 0
        ? label(row, COPY.thinking, { left: "60px", top: "32px", fontSize: "16px", fontWeight: "500" }, "text muted")
        : undefined;
    return { row, avatar, title, state };
  });
  const shelf = box(sidebarItems, { left: "16px", width: `${SIDEBAR - 32}px`, height: "52px" });
  label(shelf, COPY.you, {
    top: "8px",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "17px",
    fontWeight: "700",
    background: "var(--openbot-glass-border)",
  });
  label(shelf, COPY.youName, { left: "50px", top: "16px", fontSize: "18px", fontWeight: "600" });

  // The pane: header, messages, task list and composer.
  const header = box(screen, {
    height: `${HEADER.height}px`,
    borderRadius: `${HEADER.height / 2}px`,
    borderStyle: "solid",
    borderWidth: "2px",
  });
  const headerAvatar = createAvatar(header, agent.seed, agent.hue, HEADER.avatar);
  Object.assign(headerAvatar.element.style, { left: "2px", top: "2px" });
  const headerName = label(header, COPY.agent, { left: "50px", top: "13px", fontSize: "20px", fontWeight: "650" });
  const headerWidth = 50 + headerName.offsetWidth + 20;
  header.style.width = `${headerWidth}px`;
  const headerLine = box(screen, { height: "2px", background: "var(--openbot-border-grouped)" });

  const bubble = box(
    screen,
    {
      height: `${BUBBLE.height}px`,
      borderRadius: "24px",
      padding: `0 ${BUBBLE.padding}px`,
      lineHeight: `${BUBBLE.height}px`,
      fontSize: "21px",
      fontWeight: "500",
      whiteSpace: "nowrap",
    },
    COPY.request.join(" "),
  );
  const bubbleWidth = bubble.offsetWidth;

  const reply = box(screen);
  const replyAvatar = createAvatar(reply, agent.seed, agent.hue, 54);
  Object.assign(replyAvatar.element.style, { left: "-7px", top: "-7px" });
  label(reply, COPY.agent, { left: `${INDENT}px`, top: "-2px", fontSize: "19px", fontWeight: "650" });
  const working = label(reply, COPY.working, {
    left: `${INDENT}px`,
    top: "26px",
    fontSize: "19px",
    fontWeight: "500",
    color: "transparent",
    backgroundImage:
      "linear-gradient(90deg, var(--openbot-text-muted) 35%, var(--openbot-text-primary) 50%, var(--openbot-text-muted) 65%)",
    backgroundSize: "300% 100%",
    backgroundClip: "text",
  });

  const card = box(screen, {
    height: `${CARD.header + COPY.steps.length * CARD.row + CARD.bottom}px`,
    borderRadius: "18px",
    background: "var(--openbot-bg-surface)",
    border: "2px solid var(--openbot-border-grouped)",
    transformOrigin: "0 0",
  });
  label(card, COPY.tasks, { left: "20px", top: "17px", fontSize: "19px", fontWeight: "650" });
  const count = label(
    card,
    COPY.count(0, COPY.steps.length),
    { left: "auto", right: "20px", top: "18px", fontSize: "18px", fontWeight: "600", transformOrigin: "100% 50%" },
    "text muted",
  );
  const steps = COPY.steps.map((step, index) => {
    const y = CARD.header + index * CARD.row;
    const circle = box(card, {
      left: "20px",
      top: `${y + 11}px`,
      width: "24px",
      height: "24px",
      borderRadius: "50%",
      border: "2px solid var(--openbot-text-dim)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--openbot-text-on-status)",
    });
    const check = icon(circle, 16, ICONS.check);
    const name = label(
      card,
      step,
      { left: "56px", top: `${y + 12}px`, fontSize: "19px", fontWeight: "500" },
      "text secondary",
    );
    return { circle, check, name };
  });

  const composer = box(screen, {
    background: "var(--openbot-bg-surface)",
    border: "2px solid var(--openbot-border-grouped)",
  });
  const placeholders = [COPY.composer, COPY.phoneComposer].map((text) =>
    label(composer, text, { left: `${TYPED_LEFT}px`, fontSize: "19px", fontWeight: "500" }, "text muted"),
  );
  const typed = COPY.request.map((word) => {
    const element = html("div", "word", composer, word);
    Object.assign(element.style, { fontSize: "21px", fontWeight: "500", letterSpacing: "0" });
    return element;
  });
  const typedWidths = typed.map((word) => word.offsetWidth);
  const typedLefts = typedWidths.map(
    (_, index) => TYPED_LEFT + typedWidths.slice(0, index).reduce((total, width) => total + width + WORD_GAP, 0),
  );
  const caret = box(composer, { width: "3px", height: "28px", borderRadius: "2px", background: "var(--promo-lilac)" });
  const send = box(composer, {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--openbot-text-primary)",
  });
  icon(send, 22, ICONS.send);

  // The browser chrome, over the pane: tab strip and toolbar.
  const chrome = box(screen, { overflow: "hidden", height: `${CHROME}px` });
  const strip = box(chrome, { width: "100%", height: `${TAB_STRIP}px`, background: "var(--openbot-bg-native-canvas)" });
  const tab = box(strip, {
    left: "104px",
    top: "8px",
    width: "270px",
    height: "40px",
    borderRadius: "12px 12px 0 0",
    background: "var(--openbot-bg-surface)",
    color: "var(--openbot-text-muted)",
  });
  createLogo(tab).render({ ...RESTING_POSE, x: 26, y: 20, size: 22 });
  label(tab, COPY.tab, { left: "46px", top: "10px", fontSize: "17px", fontWeight: "500" }, "text secondary");
  placeIcon(icon(tab, 18, ICONS.close), 238, 11);
  const toolbar = box(chrome, {
    top: `${TAB_STRIP}px`,
    width: "100%",
    height: `${TOOLBAR}px`,
    background: "var(--openbot-bg-surface)",
    borderBottom: "2px solid var(--openbot-border-grouped)",
    color: "var(--openbot-text-muted)",
  });
  for (const [path, x] of [
    [ICONS.back, 16],
    [ICONS.forward, 50],
    [ICONS.reload, 84],
  ] as const) {
    placeIcon(icon(toolbar, 22, path), x, 16);
  }
  const field = box(toolbar, {
    left: "124px",
    top: "9px",
    height: "38px",
    borderRadius: "19px",
    background: "var(--openbot-bg-canvas)",
  });
  placeIcon(icon(field, 18, ICONS.lock), 15, 10);
  const url = label(field, "", { left: "42px", top: "9px", fontSize: "18px", fontWeight: "500" }, "text secondary");
  const urlWidths = Array.from({ length: COPY.url.length + 1 }, (_, length) => {
    url.textContent = COPY.url.slice(0, length);
    return url.offsetWidth;
  });
  const urlCaret = box(field, { top: "8px", width: "2px", height: "22px", background: "var(--promo-lilac)" });

  // The window controls stay at the top left, in the window and then in the tab strip.
  const lights = ["danger", "warning", "success"].map((name, index) =>
    box(screen, {
      left: `${22 + index * 24}px`,
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      background: `var(--openbot-${name})`,
    }),
  );

  const phone = createPhone(home, overlay, context, agent, replyAvatar.color);

  // A spray from the send button, and a green star burst on each task.
  {
    const pose = devicePose(CUE.send);
    const parts = layout(pose);
    const text = onDevice(pose, parts.columnX + TYPED_LEFT + bubbleWidth / 2, parts.composerY + COMPOSER_HEIGHT / 2);
    const point = project(text.x, text.y, CUE.send);
    context.bursts.push({
      at: CUE.send,
      x: point.x,
      y: point.y,
      count: 40,
      speed: 2200,
      life: 0.6,
      size: 7,
      color: context.palette.lilac,
      seed: 311,
      shape: "streak",
      drag: 3.6,
    });
  }
  TASK_TICKS.forEach((tick, index) => {
    const pose = devicePose(tick);
    const check = taskCheck(layout(pose), index);
    const local = onDevice(pose, check.x, check.y);
    const point = project(local.x, local.y, tick);
    context.rings.push({
      at: tick,
      x: point.x,
      y: point.y,
      radius: 130,
      life: 0.45,
      width: 6,
      color: context.palette.success,
    });
    context.bursts.push({
      at: tick,
      x: point.x,
      y: point.y,
      count: 16,
      speed: 760,
      life: 0.55,
      size: 10,
      color: context.palette.success,
      seed: 321 + index,
      shape: "star",
      drag: 4,
    });
  });

  return (t) => {
    if (!show(root, t < CUE.logo)) return;
    root.style.transform = cameraTransform(t);
    context.backdrop.spot("var(--promo-lilac)", 0.22);
    const pose = devicePose(t);
    const parts = layout(pose);
    const computer = 1 - pose.phone;
    const inPhone = pose.phone;

    // The device, and at the end its flight into the logo.
    put(device, pose.x - pose.width / 2, pose.y - pose.height / 2, pose.width, pose.height);
    const bezel = lerp(0, 9, inPhone);
    const canvas = mix("var(--openbot-bg-canvas)", "var(--openbot-bg-native-canvas)", inPhone);
    Object.assign(device.style, {
      borderRadius: `${pose.radius}px`,
      background: canvas,
      boxShadow: [
        `0 0 0 ${bezel}px var(--openbot-bg-control-active)`,
        `0 0 0 ${bezel + 2}px var(--openbot-glass-border)`,
        "0 50px 140px var(--openbot-glass-shadow)",
      ].join(", "),
      transform: `translate(${(960 - pose.x) * pose.fly}px, ${(540 - pose.y) * pose.fly}px) rotate(${-24 * pose.fly}deg) scale(${lerp(1, 0.06, pose.fly)})`,
      filter: pose.fly > 0.01 ? `blur(${10 * pose.fly}px)` : "",
      opacity: String(1 - progress(t, CUE.logo - 0.06, 0.06)),
    });

    // On the phone the app shrinks into its icon on the home screen, cropped to a square.
    put(screen, 0, 0, pose.width, pose.height);
    const scale = lerp(1, APP_ICON.size / pose.width, pose.home);
    const crop = ((pose.height - pose.width) / 2) * pose.home;
    Object.assign(screen.style, {
      background: canvas,
      clipPath: pose.home > 0 ? `inset(${crop}px 0 round ${lerp(pose.radius, 16 / scale, pose.home)}px)` : "",
      transform: `translate(${(APP_ICON.x - pose.width / 2) * pose.home}px, ${(APP_ICON.y - pose.height / 2) * pose.home}px) scale(${scale})`,
      opacity: String(1 - clamp((pose.home - 0.45) / 0.55)),
    });
    if (!show(screen, pose.home < 1)) {
      phone(t, pose);
      return;
    }

    const sideOpacity = String(clamp(1 - inPhone * 1.6));
    put(rail, 0, parts.chrome, parts.rail, pose.height - parts.chrome);
    rail.style.opacity = sideOpacity;
    railItems.style.top = `${lerp(48, 14, pose.browser)}px`;
    put(sidebar, parts.rail, parts.chrome, parts.sidebar, pose.height - parts.chrome);
    sidebar.style.opacity = sideOpacity;
    const searchTop = lerp(60, 16, pose.browser);
    search.style.top = `${searchTop}px`;
    const started = ease.outCubic(progress(t, CUE.reply, 0.2));
    for (const [index, row] of rows.entries()) {
      row.row.style.top = `${searchTop + 64 + index * 64}px`;
      row.avatar.render(t);
      if (!row.state) continue;
      row.title.style.top = `${lerp(18, 7, started)}px`;
      row.state.style.opacity = String(started);
    }
    shelf.style.top = `${pose.height - parts.chrome - 68}px`;
    shelf.style.opacity = String(clamp(pose.browser));

    // The header is a line on a computer and a glass pill on the phone.
    put(
      header,
      lerp(parts.paneX + 20, parts.paneX + (parts.paneWidth - headerWidth) / 2, inPhone),
      parts.top + lerp(8, 4, inPhone),
    );
    header.style.background = mix("transparent", "var(--openbot-glass-surface)", inPhone);
    header.style.borderColor = mix("transparent", "var(--openbot-glass-border)", inPhone);
    headerAvatar.render(t);
    put(headerLine, parts.paneX, parts.top + 68, parts.paneWidth);
    headerLine.style.opacity = String(computer);

    // The request leaves the composer and lands as a message. On the phone it takes the agent color.
    if (show(bubble, t >= CUE.send)) {
      // The same spring as the camera's pull back, so the bubble stays in the frame.
      const flight = spring(t, CUE.send, 1.5, 0.62);
      const toX = parts.columnX + parts.columnWidth - bubbleWidth;
      put(
        bubble,
        lerp(parts.columnX + TYPED_LEFT - BUBBLE.padding, toX, flight),
        lerp(parts.composerY + (COMPOSER_HEIGHT - BUBBLE.height) / 2, parts.bubbleY, flight),
      );
      bubble.style.background = mix(
        "transparent",
        mix("var(--openbot-bg-control-active)", replyAvatar.color, inPhone),
        clamp((t - CUE.send) * 10),
      );
      bubble.style.color = mix("var(--openbot-text-primary)", "var(--openbot-text-on-light)", inPhone);
      const glow = decay(t, CUE.send, 0.6);
      bubble.style.boxShadow = glow > 0.01 ? `0 0 ${50 * glow}px var(--promo-glow)` : "";
    }

    if (show(reply, t >= CUE.reply)) {
      const land = spring(t, CUE.reply, 2.8, 0.5);
      put(reply, parts.columnX, parts.replyY);
      reply.style.transform = `translateY(${24 * (1 - land)}px)`;
      reply.style.opacity = String(clamp(land * 2.5));
      replyAvatar.render(t);
      const sweep = ((t - CUE.reply) / 1.3) % 1;
      working.style.backgroundPosition = `${100 - sweep * 100}% 0`;
    }

    if (show(card, t >= CUE.tasks)) {
      const pop = spring(t, CUE.tasks, 2.6, 0.5);
      put(card, parts.cardX, parts.cardY, parts.cardWidth);
      card.style.transform = `translateY(${30 * (1 - pop)}px) scale(${0.96 + 0.04 * pop})`;
      card.style.opacity = String(clamp(pop * 2.5));
      const done = TASK_TICKS.filter((tick) => t >= tick).length;
      const text = COPY.count(done, COPY.steps.length);
      if (count.textContent !== text) count.textContent = text;
      count.style.transform = `scale(${1 + 0.4 * decay(t, TASK_TICKS[done - 1] ?? -1, 0.3)})`;
      count.style.color = done > 0 ? "var(--openbot-text-secondary)" : "";
      for (const [index, step] of steps.entries()) {
        const tick = TASK_TICKS[index];
        const complete = tick !== undefined && t >= tick;
        const hit = tick === undefined ? 0 : decay(t, tick, 0.35);
        Object.assign(step.circle.style, {
          background: complete ? "var(--openbot-success)" : "transparent",
          borderColor: complete ? "var(--openbot-success)" : "var(--openbot-text-dim)",
          transform: `scale(${1 + 0.6 * hit})`,
          boxShadow: hit > 0.01 ? `0 0 ${30 * hit}px var(--openbot-success)` : "",
        });
        show(step.check, complete);
        step.name.style.color = complete ? "var(--openbot-text-muted)" : "";
      }
    }

    // The composer: the request lands in it word by word, then the placeholder comes back.
    const composerHeight = lerp(COMPOSER_HEIGHT, 56, inPhone);
    const inner = composerHeight - 4;
    put(composer, parts.columnX, parts.composerY, parts.columnWidth, composerHeight);
    composer.style.borderRadius = `${lerp(18, composerHeight / 2, inPhone)}px`;
    const sent = t >= CUE.send;
    for (const [index, placeholder] of placeholders.entries()) {
      if (!show(placeholder, sent)) continue;
      placeholder.style.top = `${(inner - 21) / 2}px`;
      const shown = index === 0 ? computer : inPhone;
      placeholder.style.opacity = String(shown * clamp(progress(t, CUE.send + 0.1, 0.2)));
    }
    let typedEnd = TYPED_LEFT;
    for (const [index, word] of typed.entries()) {
      const start = CUE.words[index] ?? 0;
      if (!show(word, t >= start && !sent)) continue;
      const width = typedWidths[index] ?? 0;
      const left = typedLefts[index] ?? TYPED_LEFT;
      punchIn(word, t, start, left + width / 2, inner / 2, { distance: 18, scale: 1.7, skew: -14 });
      typedEnd = left + width;
    }
    if (show(caret, !sent)) {
      put(caret, typedEnd + 4, (inner - 28) / 2);
      caret.style.opacity = (t / (BEAT / 2)) % 2 < 1.2 ? "1" : "0";
    }
    put(send, parts.columnWidth - 4 - 10 - 40, (inner - 40) / 2);
    const press = decay(t, CUE.send, 0.4);
    send.style.background = mix("var(--openbot-bg-control-active)", "var(--promo-lilac)", press);
    send.style.color = mix("var(--openbot-text-primary)", "var(--promo-eye)", press);
    send.style.transform = `scale(${1 + 0.3 * press})`;

    // The browser chrome comes down from the top and goes back up on the phone.
    if (show(chrome, pose.browser > 0.001 && inPhone < 1)) {
      put(chrome, 0, parts.chrome - CHROME, pose.width);
      put(field, 124, 9, pose.width - 124 - 20);
      const typedCount = Math.round(clamp(progress(t, CUE.typeUrl, CUE.typedUrl - CUE.typeUrl)) * COPY.url.length);
      const text = COPY.url.slice(0, typedCount);
      if (url.textContent !== text) url.textContent = text;
      const typing = t >= CUE.typeUrl && t < CUE.typedUrl;
      if (show(urlCaret, t < CUE.typedUrl + 2 * BEAT)) {
        urlCaret.style.left = `${42 + (urlWidths[typedCount] ?? 0) + 2}px`;
        urlCaret.style.opacity = typing || (t / (BEAT / 2)) % 2 < 1.2 ? "1" : "0";
      }
    }
    for (const light of lights) {
      light.style.top = `${lerp(17, (TAB_STRIP - 14) / 2 + 3, pose.browser)}px`;
      light.style.opacity = String(clamp(1 - inPhone * 2.5));
    }

    phone(t, pose);
  };
}
