import type { AvatarColor } from "@openbot/contracts/ipc";

export const CHAT_BACKDROP_SCENES = ["pond", "jellyfish", "sunset", "snowfall", "fireflies"] as const;
export type ChatBackdropScene = (typeof CHAT_BACKDROP_SCENES)[number];

export function isChatBackdropScene(value: unknown): value is ChatBackdropScene {
  return CHAT_BACKDROP_SCENES.some((scene) => scene === value);
}

type Scheme = "light" | "dark";

export const CHAT_BACKDROP_BASE = {
  pond: { light: "#e8f6f3", dark: "#0f2426" },
  jellyfish: { light: "#ebf3fa", dark: "#0e1a2b" },
  sunset: { light: "#fbf0f3", dark: "#1d1528" },
  snowfall: { light: "#eef3f7", dark: "#111a26" },
  fireflies: { light: "#f2f5ea", dark: "#121a14" },
} as const satisfies Record<ChatBackdropScene, Record<Scheme, AvatarColor>>;

export interface ChatBackdropCells {
  fill(x: number, y: number, width: number, height: number, color: string, alpha: number): void;
}

export interface ChatBackdropFrame {
  scene: ChatBackdropScene;
  width: number;
  height: number;
  time: number;
  dark: boolean;
}

function hash(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43_758.545_3;
  return x - Math.floor(x);
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function cell(cells: ChatBackdropCells, x: number, y: number, color: string, alpha = 1): void {
  cells.fill(Math.round(x), Math.round(y), 1, 1, color, alpha);
}

function disc(cells: ChatBackdropCells, cx: number, cy: number, radius: number, color: string, alpha = 1): void {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius)
        cells.fill(Math.round(cx + dx), Math.round(cy + dy), 1, 1, color, alpha);
    }
  }
}

function sprite(
  cells: ChatBackdropCells,
  rows: readonly string[],
  x: number,
  y: number,
  colors: Readonly<Record<string, string>>,
  flip = false,
  alpha = 1,
): void {
  const left = Math.round(x);
  const top = Math.round(y);
  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < row.length; column += 1) {
      const color = colors[row.charAt(column)];
      if (color === undefined) continue;
      cells.fill(left + (flip ? row.length - 1 - column : column), top + rowIndex, 1, 1, color, alpha);
    }
  });
}

function line(
  cells: ChatBackdropCells,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  alpha = 1,
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let step = 0; step <= steps; step += 1) {
    cell(cells, x0 + ((x1 - x0) * step) / steps, y0 + ((y1 - y0) * step) / steps, color, alpha);
  }
}

function countFor(frame: ChatBackdropFrame, cellsEach: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round((frame.width * frame.height) / cellsEach)));
}

function twinklingStars(
  cells: ChatBackdropCells,
  frame: ChatBackdropFrame,
  color: string,
  top: number,
  seed: number,
): void {
  const count = countFor(frame, 260, 12, 90);
  for (let index = 0; index < count; index += 1) {
    const light = Math.sin(frame.time * (0.6 + hash(seed + index) * 1.4) + hash(seed + index + 50) * 6.28);
    cell(
      cells,
      hash(seed + index + 100) * frame.width,
      hash(seed + index + 200) * top,
      color,
      0.25 + 0.6 * Math.max(0, light),
    );
  }
}

const KOI_FRAMES = [
  ["T....FF.....", "TT.BBOOWWO..", ".TBOOWWOOEOO", "TT.BOOOWWO..", "T....FF....."],
  ["............", "TT.BBOOWWO..", "TTBOOWWOOEOO", "TT.BOOOWWO..", "......FF...."],
] as const;

function pond(cells: ChatBackdropCells, frame: ChatBackdropFrame): void {
  const { width: w, height: h, time: t, dark } = frame;
  const water = dark ? "#1c4245" : "#bfe6e0";
  const pad = dark ? "#2d6847" : "#7cc48a";
  const padDark = dark ? "#21503a" : "#5ea96d";
  const flower = dark ? "#e7a3c4" : "#f39ac0";
  const koi = {
    B: dark ? "#e9eef0" : "#ffffff",
    W: dark ? "#e9eef0" : "#ffffff",
    O: dark ? "#e8823a" : "#f28a3c",
    F: dark ? "#c96f33" : "#f6ad74",
    T: dark ? "#c96f33" : "#f6ad74",
    E: "#1f1f1f",
  };

  const glints = countFor(frame, 140, 16, 120);
  for (let index = 0; index < glints; index += 1) {
    const glow = Math.sin(t * (0.5 + hash(index) * 0.8) + hash(index + 1) * 6.28);
    if (glow <= 0.2) continue;
    const x = wrap(hash(index + 2) * w + t * 0.4, w);
    cell(cells, x, hash(index + 3) * h, water, glow);
    cell(cells, x + 1, hash(index + 3) * h, water, glow * 0.6);
  }

  const period = 7;
  for (let index = 0; index < 4; index += 1) {
    const clock = t + (index * period) / 4;
    const round = Math.floor(clock / period);
    const progress = wrap(clock, period) / period;
    const cx = hash(round * 13 + index) * w;
    const cy = hash(round * 17 + index + 5) * h;
    const radius = 1 + progress * 7;
    for (let angle = 0; angle < 6.28; angle += 1 / radius) {
      cell(cells, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.6, water, 1 - progress);
    }
  }

  const fish = countFor(frame, 1_100, 3, 8);
  const span = w + 30;
  for (let index = 0; index < fish; index += 1) {
    const direction = hash(index + 20) > 0.5 ? 1 : -1;
    const speed = 2 + hash(index + 10) * 2.5;
    const x = wrap(hash(index + 30) * span + t * speed * direction, span) - 15;
    const y = hash(index + 40) * (h - 6) + Math.sin(t * 0.7 + index) * 2;
    const tail = KOI_FRAMES[Math.floor(t * 4 + index) % 2] ?? KOI_FRAMES[0];
    sprite(cells, tail, x, y, koi, direction < 0);
  }

  const pads = [
    [0.07, 0.16, 4.5],
    [0.92, 0.82, 5.5],
    [0.12, 0.86, 3.5],
    [0.88, 0.2, 3.5],
    [0.95, 0.5, 2.5],
  ] as const;
  pads.forEach(([px, py, radius], index) => {
    const cx = px * w;
    const cy = py * h + Math.sin(t * 0.5 + index) * 0.6;
    disc(cells, cx, cy, radius, pad);
    disc(cells, cx + 1, cy + 1, radius - 1.5, padDark, 0.5);
    for (let notch = 0; notch <= radius; notch += 1)
      cell(cells, cx + notch, cy - notch * 0.4, CHAT_BACKDROP_BASE.pond[dark ? "dark" : "light"]);
    if (index === 1) disc(cells, cx - 1, cy - 1, 1.2, flower);
  });
}

const JELLY_FRAMES = [
  ["..XXX..", ".XXXXX.", "XXHXXXX", "X.X.X.X"],
  ["..XXX..", ".XXXXX.", ".XHXXX.", ".X.X.X."],
] as const;

function jellyfish(cells: ChatBackdropCells, frame: ChatBackdropFrame): void {
  const { width: w, height: h, time: t, dark } = frame;
  const kelp = dark ? "#1f5a47" : "#86c9a1";
  const bubble = dark ? "#35598a" : "#a9cbe8";
  const tones = dark ? (["#ff8fc6", "#a493ff", "#6fd3ff"] as const) : (["#f29cc3", "#ad97ee", "#79c3ea"] as const);

  const bubbles = countFor(frame, 200, 10, 70);
  for (let index = 0; index < bubbles; index += 1) {
    const y = h - wrap(hash(index) * h + t * (2 + hash(index + 1) * 3), h + 4);
    const x = hash(index + 2) * w + Math.sin(t * 2 + index) * 0.8;
    cell(cells, x, y, bubble, 0.8);
  }

  const stalks = Math.max(4, Math.round(w / 30));
  for (let index = 0; index < stalks; index += 1) {
    const side = index % 2 === 0;
    const base = side ? hash(index + 60) * w * 0.14 : w - 1 - hash(index + 60) * w * 0.14;
    const height = h * (0.22 + hash(index + 61) * 0.25);
    for (let step = 0; step < height; step += 1) {
      const sway = Math.sin(t * 0.8 + step * 0.15 + index) * (step / height) * 3;
      cell(cells, base + sway, h - 1 - step, kelp);
      if (step % 5 === 2) cell(cells, base + sway + (step % 10 === 2 ? 1 : -1), h - 1 - step, kelp, 0.8);
    }
  }

  const jellies = countFor(frame, 1_500, 3, 7);
  const span = h + 24;
  for (let index = 0; index < jellies; index += 1) {
    const tone = tones[index % tones.length] ?? tones[0];
    const pulse = Math.floor(t * 1.5 + index) % 2;
    const rise = Math.sin(t * 1.5 * Math.PI + index) > 0 ? 1.6 : 0.8;
    const y = h + 8 - wrap(hash(index + 70) * span + t * rise, span);
    const x = hash(index + 71) * (w - 8) + Math.sin(t * 0.35 + index * 2) * 3;
    if (dark) disc(cells, x + 3, y + 2, 5, tone, 0.1);
    sprite(cells, JELLY_FRAMES[pulse] ?? JELLY_FRAMES[0], x, y, { X: tone, H: dark ? "#ffffff" : "#fff6fb" });
    for (let strand = 0; strand < 3; strand += 1) {
      const length = 5 + Math.round(hash(index * 3 + strand) * 4);
      for (let step = 0; step < length; step += 1) {
        const sway = Math.sin(t * 2 + step * 0.6 + strand + index) * Math.min(1, step / 3);
        cell(cells, x + 1 + strand * 2 + sway, y + 4 + step, tone, 0.75 - step * 0.06);
      }
    }
  }
}

function sunset(cells: ChatBackdropCells, frame: ChatBackdropFrame): void {
  const { width: w, height: h, time: t, dark } = frame;
  const horizon = Math.floor(h * 0.68);
  const grid = dark ? "#ff4fb8" : "#f4bdd9";
  const ridge = dark ? "#3b2160" : "#ecc9e2";
  const ridgeFar = dark ? "#2a1a45" : "#f3dbea";

  if (dark) twinklingStars(cells, frame, "#ffffff", horizon * 0.8, 400);
  else {
    for (let index = 0; index < 4; index += 1) {
      const length = 8 + hash(index + 300) * 10;
      const x = wrap(hash(index + 301) * (w + 30) + t * 0.6, w + 30) - 20;
      const y = 3 + hash(index + 302) * horizon * 0.5;
      line(cells, x, y, x + length, y, "#ffffff", 0.9);
      line(cells, x + 2, y - 1, x + length - 3, y - 1, "#ffffff", 0.9);
    }
  }

  const radius = Math.max(6, Math.min(22, Math.min(w, h) * 0.18));
  const sx = w * 0.74;
  const sy = horizon - 2;
  const top = dark ? [255, 214, 92] : [255, 196, 120];
  const bottom = dark ? [255, 79, 139] : [255, 120, 170];
  for (let dy = -Math.ceil(radius); dy <= 0; dy += 1) {
    const share = (dy + radius) / radius;
    if (dy > -radius * 0.55) {
      const band = wrap(dy + t * 1.5, 5);
      if (band < 1 + share * 1.5) continue;
    }
    const color = `rgb(${top.map((value, channel) => Math.round(value + ((bottom[channel] ?? value) - value) * share)).join(" ")})`;
    const half = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    line(cells, sx - half, sy + dy, sx + half, sy + dy, color);
  }

  for (let x = 0; x < w; x += 1) {
    const far = (Math.sin(x * 0.09 + 2) + Math.sin(x * 0.033)) * h * 0.04 + h * 0.06;
    const near =
      Math.max(0, (Math.sin(x * 0.14) + Math.sin(x * 0.05 + 1)) * h * 0.05 + h * 0.03) * (x < w * 0.5 ? 1 : 0.4);
    line(cells, x, horizon - far, x, horizon, ridgeFar);
    line(cells, x, horizon - near, x, horizon, ridge);
  }

  const depth = h - horizon;
  const rows = 8;
  for (let row = 0; row < rows; row += 1) {
    const z = wrap(row + t * 0.6, rows) / rows;
    const y = horizon + depth * z * z;
    line(cells, 0, y, w, y, grid, 0.2 + 0.35 * z);
  }
  const vanish = w * 0.5;
  for (let column = -12; column <= 12; column += 1) {
    line(cells, vanish + column * 2, horizon, vanish + column * w * 0.12, h + 2, grid, 0.3);
  }
  line(cells, 0, horizon, w, horizon, grid, 0.7);
}

function snowfall(cells: ChatBackdropCells, frame: ChatBackdropFrame): void {
  const { width: w, height: h, time: t, dark } = frame;
  const tree = dark ? "#1f3b35" : "#8db7a6";
  const treeShade = dark ? "#18302b" : "#73a08e";
  const snow = dark ? "#dfe8f5" : "#ffffff";
  const flake = dark ? "#dfe8f5" : "#a7bed3";

  if (dark) {
    twinklingStars(cells, frame, "#c9d6ff", h * 0.5, 500);
    const mx = w * 0.84;
    const my = h * 0.16;
    disc(cells, mx, my, 4.5, "#f3ecd2");
    cell(cells, mx - 1, my - 1, "#d9cfae");
    cell(cells, mx + 2, my + 1, "#d9cfae");
  }

  const ground = Math.max(2, Math.round(h * 0.03));
  cells.fill(0, h - ground, w, ground, snow, 1);

  const pines = Math.max(6, Math.round(w / 18));
  for (let index = 0; index < pines; index += 1) {
    const side = index % 2 === 0;
    const offset = hash(index + 80) * w * 0.2;
    const x = side ? offset : w - 1 - offset;
    const height = Math.round(10 + hash(index + 81) * 14);
    const bottom = h - ground;
    line(cells, x, bottom - 2, x, bottom, dark ? "#2d2420" : "#9a8676");
    for (let step = 0; step < height; step += 1) {
      const y = bottom - 2 - step;
      const tier = step % Math.max(4, Math.round(height / 3));
      const half = Math.max(0, Math.round(((height - step) / height) * 6 - tier * 0.6));
      line(cells, x - half, y, x + half, y, step % 2 === 0 ? tree : treeShade);
      if (tier === 0 && half > 0) {
        cell(cells, x - half, y, snow);
        cell(cells, x + half, y, snow);
      }
    }
    cell(cells, x, bottom - 2 - height, snow);
  }

  const flakes = countFor(frame, 70, 30, 260);
  for (let index = 0; index < flakes; index += 1) {
    const near = hash(index + 90);
    const y = wrap(hash(index + 91) * h + t * (1.5 + near * 3), h);
    const x = wrap(hash(index + 92) * w + Math.sin(t * (0.5 + near) + index) * 1.5 + t * 0.4, w);
    cell(cells, x, y, flake, 0.35 + near * 0.6);
  }
}

function fireflies(cells: ChatBackdropCells, frame: ChatBackdropFrame): void {
  const { width: w, height: h, time: t, dark } = frame;
  const grass = dark ? "#1f3a22" : "#a6cf88";
  const grassTip = dark ? "#2a4d2c" : "#88bb67";
  const glow = dark ? "#e9ff8a" : "#e3b23c";

  if (dark) twinklingStars(cells, frame, "#d8e2c0", h * 0.4, 600);

  for (let x = 0; x < w; x += 1) {
    const edge = Math.abs(x / w - 0.5) * 2;
    const height = Math.round((2 + hash(x + 700) * 5) * (0.6 + edge * 1.2));
    for (let step = 0; step < height; step += 1) {
      const sway = step > height * 0.5 ? Math.round(Math.sin(t * 1.2 + x * 0.3) * (step / height)) : 0;
      cell(cells, x + sway, h - 1 - step, step > height - 2 ? grassTip : grass);
    }
  }

  const flies = countFor(frame, 500, 8, 28);
  for (let index = 0; index < flies; index += 1) {
    const x = wrap(hash(index + 710) * w + Math.sin(t * 0.25 * (1 + hash(index + 711)) + index) * w * 0.06, w);
    const y = h * 0.3 + hash(index + 712) * h * 0.62 + Math.sin(t * 0.45 * (1 + hash(index + 713)) + index * 2) * 4;
    const blink = Math.max(0, Math.sin(t * (0.8 + hash(index + 714)) + index * 1.7));
    if (blink <= 0.05) continue;
    disc(cells, x, y, 2.2, glow, blink * (dark ? 0.12 : 0.18));
    cell(cells, x - 1, y, glow, blink * 0.35);
    cell(cells, x + 1, y, glow, blink * 0.35);
    cell(cells, x, y - 1, glow, blink * 0.35);
    cell(cells, x, y + 1, glow, blink * 0.35);
    cell(cells, x, y, glow, blink);
  }
}
const PAINTERS: Record<ChatBackdropScene, (cells: ChatBackdropCells, frame: ChatBackdropFrame) => void> = {
  pond,
  jellyfish,
  sunset,
  snowfall,
  fireflies,
};

export function paintChatBackdropScene(cells: ChatBackdropCells, frame: ChatBackdropFrame): void {
  cells.fill(0, 0, frame.width, frame.height, CHAT_BACKDROP_BASE[frame.scene][frame.dark ? "dark" : "light"], 1);
  PAINTERS[frame.scene](cells, frame);
}
