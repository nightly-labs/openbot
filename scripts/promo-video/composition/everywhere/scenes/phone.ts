// The iPhone parts of the device: the status bar, the home screen and the Dynamic Island. The
// island follows the agent Live Activity in apps/mobile/src/features/live-activity/
// agent-live-activity-widgets.ios.tsx: compact, the avatar and the state in the agent color;
// expanded, the state beside the camera, then the avatar, the agent's name and the task. A reply
// changes the state to "Message", with the unread count.

import type { AvatarHue } from "@openbot/contracts/ipc";
import { createAvatar } from "../../avatar";
import { show } from "../../dom";
import { createLogo, RESTING_POSE } from "../../logo";
import type { SceneContext } from "../../scene";
import { clamp, decay, ease, progress, spring } from "../../timeline";
import { EVERYWHERE_COPY as COPY } from "../copy";
import { CUE } from "../cues";
import { devicePose, onDevice, type Pose, project } from "../device";
import { box, icon, label, mix, put, SYMBOLS } from "../parts";

const REST = { width: 124, height: 36, radius: 18 } as const;
const COMPACT = { width: 220, height: 40, radius: 20 } as const;
const EXPANDED = { width: 358, height: 150, radius: 46 } as const;
const ISLAND_TOP = 12;

const ICON = { size: 64, columns: [30, 115, 201, 286], top: 96, step: 92 } as const;
/** The OpenBot icon on the home screen: second row, second column. The app shrinks into it. */
export const APP_ICON = {
  x: ICON.columns[1] + ICON.size / 2,
  y: ICON.top + ICON.step + ICON.size / 2,
  size: ICON.size,
} as const;

function island(t: number): { width: number; height: number; radius: number } {
  const compact = spring(t, CUE.compact, 2.6, 0.55);
  const expand = spring(t, CUE.expand, 2.2, 0.6);
  const size = (key: "width" | "height" | "radius") =>
    REST[key] + (COMPACT[key] - REST[key]) * compact + (EXPANDED[key] - COMPACT[key]) * expand;
  return { width: size("width"), height: size("height"), radius: size("radius") };
}

export function createPhone(
  home: HTMLElement,
  overlay: HTMLElement,
  context: SceneContext,
  agent: { seed: string; hue: AvatarHue },
  color: string,
): (t: number, pose: Pose) => void {
  // The home screen, under the app.
  home.style.background = [
    "radial-gradient(120% 60% at 50% 0%, color-mix(in srgb, var(--promo-lilac) 26%, transparent), transparent 70%)",
    "var(--openbot-bg-native-canvas)",
  ].join(", ");
  const grid = box(home, { inset: "0", transformOrigin: "50% 40%" });
  ICON.columns.forEach((x, column) => {
    for (let row = 0; row < 5; row += 1) {
      if (row === 1 && column === 1) continue;
      box(grid, {
        left: `${x}px`,
        top: `${ICON.top + row * ICON.step}px`,
        width: `${ICON.size}px`,
        height: `${ICON.size}px`,
        borderRadius: "16px",
        background: (row + column) % 2 === 0 ? "var(--openbot-glass-surface)" : "var(--openbot-glass-surface-hover)",
        border: "1px solid var(--openbot-glass-border)",
      });
    }
  });
  const dock = box(grid, {
    left: "14px",
    width: "352px",
    height: "92px",
    borderRadius: "34px",
    background: "var(--openbot-glass-surface)",
  });
  for (const x of ICON.columns) {
    box(dock, {
      left: `${x - 14}px`,
      top: "14px",
      width: `${ICON.size}px`,
      height: `${ICON.size}px`,
      borderRadius: "16px",
      background: "var(--openbot-glass-surface-hover)",
    });
  }
  const appIcon = createLogo(grid);

  // The status bar and the home indicator, over the app.
  const status = box(overlay, { inset: "0" });
  label(status, COPY.time, { left: "34px", top: "20px", fontSize: "17px", fontWeight: "650" });
  [5, 8, 11, 14].forEach((height, index) => {
    box(status, {
      left: `${308 + index * 6}px`,
      top: `${34 - height}px`,
      width: "4px",
      height: `${height}px`,
      borderRadius: "1px",
      background: "var(--openbot-text-primary)",
    });
  });
  const battery = box(status, {
    left: "336px",
    top: "20px",
    width: "27px",
    height: "14px",
    borderRadius: "4px",
    border: "1.5px solid var(--openbot-text-muted)",
    padding: "1.5px",
  });
  box(battery, {
    position: "static",
    width: "80%",
    height: "100%",
    borderRadius: "2px",
    background: "var(--openbot-text-primary)",
  });
  const indicator = box(overlay, {
    width: "134px",
    height: "5px",
    borderRadius: "3px",
    background: "var(--openbot-text-primary)",
  });

  // The Dynamic Island and the Live Activity in it.
  const pill = box(overlay, { background: "var(--promo-black)", overflow: "hidden" });
  const compact = box(pill, { inset: "0" });
  const compactAvatar = createAvatar(compact, agent.seed, agent.hue, 34);
  const compactText = label(compact, COPY.island.working, {
    left: "auto",
    right: "16px",
    top: "10px",
    fontSize: "17px",
    fontWeight: "650",
    color,
  });

  const expanded = box(pill, { width: `${EXPANDED.width}px`, height: `${EXPANDED.height}px` });
  const states = [
    { symbol: SYMBOLS.sparkles, text: COPY.island.working },
    { symbol: SYMBOLS.message, text: COPY.island.message },
  ].map((state) => {
    const row = box(expanded, { left: "24px", top: "18px", display: "flex", alignItems: "center", gap: "7px", color });
    icon(row, 17, state.symbol, true);
    label(row, state.text, { position: "static", fontSize: "16px", fontWeight: "650" }, "");
    return row;
  });
  const unread = label(
    expanded,
    COPY.island.unread,
    { left: "auto", right: "24px", top: "19px", fontSize: "15px", fontWeight: "500" },
    "text muted",
  );
  const expandedAvatar = createAvatar(expanded, agent.seed, agent.hue, 64);
  Object.assign(expandedAvatar.element.style, { left: "15px", top: "55px" });
  label(expanded, COPY.agent, { left: "88px", top: "66px", fontSize: "19px", fontWeight: "650" });
  const details = [COPY.request.join(" "), COPY.island.reply].map((text) =>
    label(expanded, text, { left: "88px", top: "93px", fontSize: "17px", fontWeight: "500" }, "text secondary"),
  );

  // The reply lands on the island with a ring and a spray in the agent color.
  {
    const pose = devicePose(CUE.message);
    const middle = onDevice(pose, pose.width / 2, ISLAND_TOP + EXPANDED.height / 2);
    const point = project(middle.x, middle.y, CUE.message);
    context.rings.push(
      { at: CUE.message, x: point.x, y: point.y, radius: 700, life: 0.6, width: 14, color: context.palette.white },
      { at: CUE.message + 0.04, x: point.x, y: point.y, radius: 950, life: 0.8, width: 8, color },
    );
    context.bursts.push({
      at: CUE.message,
      x: point.x,
      y: point.y,
      count: 46,
      speed: 1800,
      life: 0.7,
      size: 6,
      color,
      seed: 341,
      shape: "streak",
      drag: 3.6,
    });
  }

  return (t, pose) => {
    const phone = clamp((pose.phone - 0.55) / 0.35);
    show(overlay, phone > 0);
    show(home, pose.home > 0);
    if (phone <= 0) return;

    put(indicator, (pose.width - 134) / 2, pose.height - 14);
    indicator.style.opacity = String(0.85 * phone);

    if (pose.home > 0) {
      const settle = 1 - pose.home;
      grid.style.transform = `scale(${1 + 0.08 * settle})`;
      grid.style.opacity = String(clamp(pose.home * 2));
      put(dock, 14, pose.height - 116);
      // The icon swells as the app lands in it.
      const landed = decay(t, CUE.home + 0.45, 0.35);
      appIcon.render({
        ...RESTING_POSE,
        x: APP_ICON.x,
        y: APP_ICON.y,
        size: ICON.size * (1 + 0.25 * landed),
        blink: [1 - 0.9 * decay(t, CUE.expand + 0.2, 0.2), 1 - 0.9 * decay(t, CUE.expand + 0.2, 0.2)],
      });
    }

    const size = island(t);
    // The expanded island covers the status bar, as on iOS.
    status.style.opacity = String(phone * (1 - clamp((size.height - COMPACT.height) / 40)));
    const bounce = 1 + 0.06 * decay(t, CUE.message, 0.3);
    put(pill, (pose.width - size.width) / 2, ISLAND_TOP, size.width, size.height);
    Object.assign(pill.style, {
      borderRadius: `${size.radius}px`,
      opacity: String(phone),
      transform: `scale(${bounce})`,
      boxShadow: mix("transparent", `0 0 60px ${color}`, decay(t, CUE.message, 0.6)),
    });

    const compactShown = clamp((size.width - REST.width) / 90) * (1 - clamp((size.height - COMPACT.height) / 30));
    if (show(compact, compactShown > 0.01)) {
      compact.style.opacity = String(compactShown);
      Object.assign(compactAvatar.element.style, { left: "5px", top: `${(size.height - 34) / 2}px` });
      compactText.style.top = `${(size.height - 19) / 2}px`;
      compactAvatar.render(t);
    }

    const expandedShown = clamp((size.height - 90) / 50);
    if (show(expanded, expandedShown > 0.01)) {
      expanded.style.opacity = String(expandedShown);
      expanded.style.left = `${(size.width - EXPANDED.width) / 2}px`;
      const replied = ease.outCubic(progress(t, CUE.message, 0.14));
      states[0]?.style.setProperty("opacity", String(1 - replied));
      states[1]?.style.setProperty("opacity", String(replied));
      details[0]?.style.setProperty("opacity", String(1 - replied));
      details[1]?.style.setProperty("opacity", String(replied));
      unread.style.opacity = String(replied);
      expandedAvatar.element.style.transform = `scale(${1 + 0.18 * decay(t, CUE.message, 0.35)})`;
      expandedAvatar.render(t);
    }
  };
}
