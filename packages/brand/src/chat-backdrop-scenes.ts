import type { AvatarColor } from "@openbot/contracts/ipc";

export const CHAT_BACKDROP_SCENES = ["pond", "jellyfish", "sunset", "snowfall", "fireflies", "coast"] as const;
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
  coast: { light: "#fdf0ec", dark: "#1a1030" },
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
type Rgb = readonly [number, number, number];

function mix(from: Rgb, to: Rgb, share: number): string {
  const amount = clamp01(share);
  return `rgb(${from.map((value, channel) => Math.round(value + ((to[channel] ?? value) - value) * amount)).join(" ")})`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

const COAST_CAR = ["...RRRRR....", "..RWWRWWR...", "LRRRRRRRRRRH", ".KK.....KK.."] as const;
const POLICE_CAR = ["....AB......", "...WWWWW....", "..WGGWGGW...", "LKKKWWWKKKKH", ".TT.....TT.."] as const;
const HELI_ROTOR = ["RRRRRRRRRRRR.", "...RRRRRR...."] as const;
const HELI_BODY = [
  "......M......",
  "...BBBBB.....",
  "..GBBBBBBBBBB",
  "...BBBBB...BB",
  "...S...S.....",
  "..SSSSSSS....",
] as const;
const SPEEDBOAT = ["....GW...", "PWWWWWWWW", ".WWWWWWW."] as const;
const YACHT = [
  "..............M.............",
  ".............MMM............",
  "..........WWWWWWWW..........",
  ".........WGGGGGGGGW.........",
  "......WWWWWWWWWWWWWWW.......",
  ".....WGGGGGGGGGGGGGGGW......",
  "WWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  "WPPPPPPPPPPPPPPPPPPPPPPPPPP.",
  ".HHHHHHHHHHHHHHHHHHHHHHHH...",
  "..HHHHHHHHHHHHHHHHHHHHHH....",
] as const;
const FLAMINGO = [
  "..PPB",
  "..P..",
  ".P...",
  ".P...",
  "..P..",
  "PPPP.",
  "PPPPP",
  ".PPP.",
  "..L..",
  "..L..",
  "..L..",
  ".LL..",
] as const;
const PARTY_COLORS = ["#ff4fb8", "#4ff0e0", "#ffd27a", "#ff7a3c", "#b08cff"] as const;
const FLAMES = ["#ff3b1f", "#ff8a1f", "#ffd24a"] as const;
const CHASE_SPEED = 18;
const BURN_SECONDS = 9;
const ROAD_HEIGHT = 14;

interface CoastLayout {
  horizon: number;
  shore: number;
  roadTop: number;
  roadBottom: number;
  lane: number;
  crashX: number;
  crashAt: number;
  after: number;
  fade: number;
}

function coastLayout(frame: ChatBackdropFrame): CoastLayout {
  const { width: w, height: h, time: t } = frame;
  const shore = Math.floor(h * 0.58);
  const roadTop = shore + Math.max(1, Math.round(h * 0.03));
  const crashX = Math.round(w * 0.8);
  const crashAt = (crashX + 28) / CHASE_SPEED;
  const cycle = crashAt + BURN_SECONDS;
  const local = wrap(t, cycle);
  return {
    horizon: Math.floor(h * 0.45),
    shore,
    roadTop,
    roadBottom: roadTop + ROAD_HEIGHT,
    lane: roadTop + ROAD_HEIGHT / 2,
    crashX,
    crashAt,
    after: local - crashAt,
    fade: clamp01((cycle - local) / 1.5),
  };
}

function flame(t: number, seed: number): string {
  return FLAMES[Math.floor(hash(seed + Math.floor(t * 10)) * FLAMES.length)] ?? FLAMES[0];
}

function partyColor(index: number): string {
  return PARTY_COLORS[wrap(Math.floor(index), PARTY_COLORS.length)] ?? PARTY_COLORS[0];
}

function headlights(cells: ChatBackdropCells, front: number, y: number, direction: number): void {
  for (let step = 0; step < 7; step += 1) {
    const beamX = front + step * direction;
    cell(cells, beamX, y, "#fff3b0", 0.35 - step * 0.045);
    if (step > 2) cell(cells, beamX, y + 1, "#fff3b0", 0.2 - step * 0.02);
  }
}

function palm(
  cells: ChatBackdropCells,
  frame: ChatBackdropFrame,
  base: { x: number; y: number; height: number; lean: number; seed: number },
  burning: number,
): void {
  const { time: t, dark } = frame;
  const trunk = dark ? "#3a2433" : "#b98d6e";
  const frond = dark ? "#1d4a45" : "#4f9f7a";
  const frondTip = dark ? "#2a6359" : "#73bd92";
  let topX = base.x;
  for (let step = 0; step <= base.height; step += 1) {
    const share = step / base.height;
    const x = base.x + base.lean * share * share * base.height * 0.35;
    cell(cells, x, base.y - step, trunk);
    cell(cells, x + 1, base.y - step, trunk, step % 3 === 0 ? 0.6 : 1);
    topX = x;
  }
  const topY = base.y - base.height;
  const sway = Math.sin(t * 1.1 + base.seed) * (0.08 + burning * 0.1);
  const angles = [-2.9, -2.4, -1.9, -1.2, -0.7, -0.2] as const;
  angles.forEach((angle, index) => {
    const length = base.height * (0.45 + hash(base.seed + index) * 0.2);
    for (let step = 0; step < length; step += 1) {
      const bend = angle + sway * (step / length);
      const x = topX + 0.5 + Math.cos(bend) * step;
      const y = topY + Math.sin(bend) * step * 0.55 + step * step * 0.035;
      cell(cells, x, y, step > length * 0.7 ? frondTip : frond);
      if (step % 2 === 0 && step > 2) cell(cells, x, y + 1, frond, 0.7);
      const spark = base.seed + index * 40 + step;
      if (burning > 0 && hash(spark) > 0.3) cell(cells, x, y - 1, flame(t, spark), burning);
    }
  });
  disc(cells, topX + 0.5, topY + 1, 1.3, trunk);
  if (burning <= 0) return;
  for (let ember = 0; ember < 10; ember += 1) {
    const age = wrap(t * 0.8 + hash(base.seed + ember + 300), 1);
    const x = topX + (hash(base.seed + ember + 301) - 0.5) * 12 + age * 4;
    cell(cells, x, topY - 2 - age * 12, flame(t, base.seed + ember), burning * (1 - age));
  }
}

function coastSky(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, time: t, dark } = frame;
  const { horizon } = layout;
  const glow = dark ? "#ff5c8c" : "#ffbaa0";
  const glowStart = Math.floor(horizon * 0.3);
  if (dark) twinklingStars(cells, frame, "#ffd9f0", horizon * 0.45, 800);
  for (let y = glowStart; y < horizon; y += 1) {
    const share = (y - glowStart) / (horizon - glowStart);
    cells.fill(0, y, w, 1, glow, share * share * (dark ? 0.75 : 0.8));
  }
  const bird = dark ? "#f4c3dc" : "#7a5168";
  for (let index = 0; index < 3; index += 1) {
    const x = wrap(hash(index + 810) * (w + 20) + t * (1.2 + hash(index + 811)), w + 20) - 10;
    const y = horizon * (0.18 + hash(index + 812) * 0.3) + Math.sin(t * 0.6 + index) * 1.5;
    const flap = Math.floor(t * 3 + index) % 2 === 0 ? -1 : 0;
    cell(cells, x - 1, y + flap, bird, 0.8);
    cell(cells, x, y, bird, 0.8);
    cell(cells, x + 1, y + flap, bird, 0.8);
  }
}

function sunColors(dark: boolean): { top: Rgb; bottom: Rgb } {
  return dark ? { top: [255, 208, 96], bottom: [255, 70, 130] } : { top: [255, 214, 130], bottom: [255, 120, 110] };
}

function coastSun(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, height: h, time: t, dark } = frame;
  const { horizon, shore } = layout;
  const radius = Math.max(5, Math.min(18, Math.min(w, h) * 0.14));
  const sx = w * 0.2;
  const sun = sunColors(dark);
  disc(cells, sx, horizon, radius + 4, mix(sun.top, sun.bottom, 0.6), dark ? 0.12 : 0.16);
  for (let dy = -Math.ceil(radius); dy <= 0; dy += 1) {
    const half = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    line(cells, sx - half, horizon + dy, sx + half, horizon + dy, mix(sun.top, sun.bottom, (dy + radius) / radius));
  }
  const waterTop: Rgb = dark ? [70, 32, 96] : [247, 200, 196];
  const waterBottom: Rgb = dark ? [18, 44, 74] : [143, 211, 208];
  for (let y = horizon + 1; y < shore; y += 1) {
    cells.fill(0, y, w, 1, mix(waterTop, waterBottom, (y - horizon) / (shore - horizon)), 1);
  }
  for (let y = horizon + 1; y < shore; y += 2) {
    const depth = (y - horizon) / (shore - horizon);
    const length = radius * (1 - depth * 0.6) * (0.5 + 0.5 * hash(y + Math.floor(t * 3)));
    const drift = Math.sin(t * 1.6 + y * 0.7) * 1.5;
    line(cells, sx - length + drift, y, sx + length + drift, y, mix(sun.top, sun.bottom, depth), 0.7 - depth * 0.4);
  }
  const glints = countFor(frame, 220, 8, 60);
  for (let index = 0; index < glints; index += 1) {
    const shine = Math.sin(t * (0.7 + hash(index + 830)) + hash(index + 831) * 6.28);
    if (shine <= 0.3) continue;
    const x = wrap(hash(index + 832) * w + t * 0.5, w);
    const y = horizon + 1 + hash(index + 833) * (shore - horizon - 2);
    line(cells, x, y, x + 1, y, "#ffffff", shine * (dark ? 0.5 : 0.7));
  }
}

function coastSkyline(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, height: h, time: t, dark } = frame;
  const { horizon } = layout;
  const skylineStart = Math.floor(w * 0.68);
  const skylineEnd = Math.floor(w * 0.98);
  const building = dark ? "#2b1745" : "#e6b3c0";
  const windowLights = dark
    ? (["#ffd27a", "#4ff0e0", "#ff7ad1"] as const)
    : (["#fff4e6", "#fff4e6", "#ffe0ec"] as const);
  for (let x = skylineStart; x <= skylineEnd; x += 1) {
    const block = Math.floor((x - skylineStart) / 4);
    const tall = hash(block + 820);
    const height = Math.round(h * (0.04 + tall * tall * 0.16));
    line(cells, x, horizon - height, x, horizon, building);
    if ((x - skylineStart) % 4 === 3) continue;
    for (let y = horizon - height + 2; y < horizon - 1; y += 2) {
      const lit = hash(x * 31 + y * 7 + Math.floor(t * 0.25 + hash(x + y)));
      if (lit < 0.55) continue;
      const light = windowLights[Math.floor(lit * 10) % windowLights.length] ?? windowLights[0];
      cell(cells, x, y, light, dark ? 0.9 : 0.8);
    }
  }
  const towerX = Math.round(skylineStart + (skylineEnd - skylineStart) * 0.55);
  const towerTop = horizon - Math.round(h * 0.24);
  line(cells, towerX, towerTop, towerX, horizon, building);
  line(cells, towerX + 1, towerTop + 3, towerX + 1, horizon, building);
  if (Math.sin(t * 3) > 0) cell(cells, towerX, towerTop - 1, "#ff3b5c");
}

function coastYacht(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, time: t, dark } = frame;
  const { horizon, shore } = layout;
  const length = YACHT[0].length;
  const span = w + length * 2;
  const x = wrap(hash(870) * span - t * 2, span) - length;
  const y = horizon + Math.round((shore - horizon) * 0.3) - YACHT.length + 2;
  const bottom = y + YACHT.length;
  const mastX = x + length - 1 - YACHT[0].indexOf("M");
  const blink = Math.floor(t * 4);
  [x, x + length - 1].forEach((end) => {
    const steps = Math.max(Math.abs(end - mastX), 6);
    for (let step = 0; step <= steps; step += 2) {
      const share = step / steps;
      cell(cells, lerp(mastX, end, share), lerp(y, y + 6, share), partyColor(step / 2 + blink), 0.9);
    }
  });
  sprite(
    cells,
    YACHT,
    x,
    y,
    {
      M: dark ? "#c9c0d8" : "#9a86a0",
      W: dark ? "#e9e4f0" : "#ffffff",
      G: dark ? "#ffd27a" : "#bfe9f0",
      P: dark ? "#ff4fb8" : "#f0609e",
      H: dark ? "#2a2050" : "#3a4a7a",
    },
    true,
  );
  for (let index = 0; index < 12; index += 1) {
    const ripple = Math.sin(t * 2 + index * 1.7);
    if (ripple <= 0) continue;
    cell(
      cells,
      x + hash(index + 871) * length,
      bottom + 1 + hash(index + 872) * 3,
      partyColor(index + blink),
      ripple * 0.45,
    );
  }
  for (let shot = 0; shot < 3; shot += 1) {
    const clock = t + shot * 0.9;
    const round = Math.floor(clock / 2.7);
    const phase = wrap(clock, 2.7);
    const launchX = x + 4 + hash(round * 5 + shot) * (length - 8);
    const burstY = Math.max(4, horizon * (0.15 + hash(round * 5 + shot + 1) * 0.35));
    const color = partyColor(hash(round * 5 + shot + 2) * PARTY_COLORS.length);
    if (phase < 0.8) {
      const rocketY = lerp(y, burstY, phase / 0.8);
      cell(cells, launchX, rocketY, "#fff3b0");
      cell(cells, launchX, rocketY + 1, color, 0.6);
      cell(cells, launchX, rocketY + 2, color, 0.3);
      continue;
    }
    const burst = phase - 0.8;
    const alpha = clamp01(1 - burst / 1.6);
    if (burst < 0.15) disc(cells, launchX, burstY, 3, "#ffffff", 0.5);
    for (let spark = 0; spark < 24; spark += 1) {
      const angle = (spark / 24) * Math.PI * 2;
      const reach = burst * (spark % 2 === 0 ? 13 : 8);
      const sparkX = launchX + Math.cos(angle) * reach;
      const sparkY = burstY + Math.sin(angle) * reach * 0.85 + burst * burst * 5;
      cell(cells, sparkX, sparkY, color, alpha);
      cell(cells, sparkX - Math.cos(angle), sparkY - Math.sin(angle), color, alpha * 0.4);
    }
  }
}

function coastHelicopter(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, height: h, time: t, dark } = frame;
  const { horizon, shore, lane, crashX, after, fade } = layout;
  const track = clamp01(after / 2) * fade;
  const patrolX = w * 0.78 + Math.sin(t * 0.25) * w * 0.07;
  const x = lerp(patrolX, crashX - 16, track);
  const y = Math.max(3, horizon - h * 0.42) + Math.sin(t * 0.9) * 1.2;
  const flip = track > 0.5 || Math.cos(t * 0.25) > 0;
  if (dark) {
    const beamX = x + 6.5;
    const beamTop = y + 6;
    const targetY = lerp(horizon + (shore - horizon) * 0.5, lane - 3, track);
    const beamLength = Math.max(1, targetY - beamTop);
    const targetX = lerp(beamX + Math.sin(t * 0.7) * 0.45 * beamLength, crashX, track);
    for (let step = 0; step < beamLength; step += 1) {
      const half = 0.5 + step * 0.16;
      const center = lerp(beamX, targetX, step / beamLength);
      cells.fill(
        Math.round(center - half),
        Math.round(beamTop + step),
        Math.max(1, Math.round(half * 2)),
        1,
        "#fff6d8",
        0.16 - (step / beamLength) * 0.08,
      );
    }
  }
  const body = dark ? "#0d0816" : "#6b5270";
  sprite(
    cells,
    [HELI_ROTOR[Math.floor(t * 12) % 2] ?? HELI_ROTOR[0], ...HELI_BODY],
    x,
    y,
    { R: dark ? "#4a3a5a" : "#9a86a0", M: body, B: body, S: body, G: dark ? "#4ff0e0" : "#bfe9f0" },
    flip,
  );
  if (Math.sin(t * 4) > 0.6) cell(cells, flip ? x : x + 12, y + 3, "#ff3b5c");
}

function coastSpeedboat(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, time: t, dark } = frame;
  const { horizon, shore } = layout;
  const span = w + 40;
  const x = wrap(hash(860) * span + t * 5, span) - 20;
  const y = horizon + Math.round((shore - horizon) * 0.55) + (Math.sin(t * 3) > 0.5 ? 1 : 0);
  for (let step = 1; step < 16; step += 1) {
    const spread = step * 0.22;
    cell(cells, x - step, y + 2 - spread, "#ffffff", 0.6 - step * 0.035);
    cell(cells, x - step, y + 2 + spread, "#ffffff", 0.6 - step * 0.035);
  }
  sprite(cells, SPEEDBOAT, x, y, {
    W: dark ? "#e9e4f0" : "#ffffff",
    P: dark ? "#ff4fb8" : "#f0609e",
    G: dark ? "#4ff0e0" : "#9fd8ff",
  });
}

function coastBeach(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, height: h, time: t, dark } = frame;
  const { shore, roadTop, roadBottom, lane } = layout;
  const sand = dark ? "#3a2440" : "#f6dcb4";
  const curb = dark ? "#ff4fb8" : "#f39ac0";
  cells.fill(0, shore, w, roadTop - shore, sand, 1);
  const flamingo = { P: dark ? "#ff7ab8" : "#f58bb4", B: "#2a1a2a", L: dark ? "#d0628f" : "#e07aa3" };
  sprite(cells, FLAMINGO, w * 0.25, roadTop - FLAMINGO.length, flamingo);
  sprite(cells, FLAMINGO, w * 0.25 + 6, roadTop - FLAMINGO.length + (Math.sin(t * 0.8) > 0.7 ? 1 : 0), flamingo, true);
  cells.fill(0, roadTop, w, ROAD_HEIGHT, dark ? "#16101f" : "#c4b4c8", 1);
  cells.fill(0, roadBottom, w, h - roadBottom, sand, 1);
  line(cells, 0, roadTop, w, roadTop, curb, dark ? 0.8 : 0.9);
  line(cells, 0, roadBottom, w, roadBottom, curb, dark ? 0.8 : 0.9);
  for (let x = 0; x < w; x += 8) line(cells, x, lane, x + 3, lane, dark ? "#ffd27a" : "#fff6e0", 0.7);
}

function coastChase(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { time: t, dark } = frame;
  const { lane, crashX, crashAt, after, fade } = layout;
  const local = crashAt + after;
  const crashed = after > 0;
  const recoil = Math.min(Math.max(after, 0), 0.2) * 10;
  const leadX = -20 + CHASE_SPEED * local;
  const policeX = crashed ? crashX - 12 - recoil : -40 + CHASE_SPEED * local;
  const policeY = Math.round(lane - 6 * clamp01((local - crashAt + 0.7) / 0.7));
  const oncomingX = crashed ? crashX + recoil : crashX + 12 * (crashAt - local);
  const glass = dark ? "#9fd8ff" : "#e9f6ff";
  const wheels = "#140c18";
  const burnt = dark ? "#5a4048" : "#5a4a50";
  const wreck = { R: burnt, W: burnt, K: wheels, L: burnt, H: burnt, A: burnt, B: burnt, G: burnt, T: wheels };
  const flash = Math.floor(t * 6) % 2 === 0;

  sprite(
    cells,
    COAST_CAR,
    oncomingX,
    lane - 5,
    crashed ? wreck : { R: dark ? "#3fd9d0" : "#3aaeb8", W: glass, L: "#ff3b3b", H: "#fff3b0", K: wheels },
    true,
    crashed ? fade : 1,
  );
  sprite(cells, COAST_CAR, leadX, lane + 1, {
    R: dark ? "#ff4fb8" : "#f0609e",
    W: glass,
    L: "#ff3b3b",
    H: "#fff3b0",
    K: wheels,
  });
  if (dark) {
    headlights(cells, leadX + COAST_CAR[0].length, lane + 3, 1);
    if (!crashed) {
      disc(cells, policeX + 4.5, policeY, 4, flash ? "#ff2a4a" : "#3a6aff", 0.2);
      headlights(cells, oncomingX - 1, lane - 3, -1);
      headlights(cells, policeX + POLICE_CAR[0].length, policeY + 4, 1);
    }
  }
  sprite(
    cells,
    POLICE_CAR,
    policeX,
    policeY,
    crashed
      ? wreck
      : {
          A: flash ? "#ff2a4a" : "#5a1020",
          B: flash ? "#1c2a6a" : "#3a6aff",
          W: dark ? "#e9e4f0" : "#ffffff",
          G: glass,
          K: dark ? "#1a1a2e" : "#2a2a40",
          L: "#ff3b3b",
          H: "#fff3b0",
          T: wheels,
        },
    false,
    crashed ? fade : 1,
  );
}

function coastExplosion(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { time: t, dark } = frame;
  const { lane, crashX, after, fade } = layout;
  if (after <= 0) return;
  const x = crashX;
  const y = lane - 4;
  if (after < 0.25) disc(cells, x, y, 4 + after * 60, "#fff6d8", 0.8 * (1 - after / 0.25));
  if (after > 0.4) disc(cells, x, y - 1, 12 + Math.sin(t * 9) * 1.5, "#ff8a1f", (dark ? 0.16 : 0.1) * fade);
  if (after < 1.6) {
    const shrink = clamp01((1.6 - after) / 1.2);
    const radius = 13 * Math.min(1, after / 0.4) * shrink + 1;
    disc(cells, x, y - 1, radius + 2, "#ff3b1f", 0.55 * shrink);
    disc(cells, x, y - 1, radius, "#ff8a1f", 0.85 * shrink);
    disc(cells, x, y - 1, radius * 0.55, "#ffe14a", shrink);
  }
  if (after > 0.4) {
    for (let index = 0; index < 14; index += 1) {
      const fireX = x - 10 + hash(index + 890) * 20;
      const height = 1 + hash(index + Math.floor(t * 10)) * 4;
      for (let step = 0; step < height; step += 1) {
        cell(cells, fireX, y - 1 - step, FLAMES[2 - Math.min(2, step)] ?? FLAMES[0], fade * (1 - step / 6));
      }
    }
  }
  const debris = dark ? "#7a5a60" : "#5a4a50";
  for (let piece = 0; piece < 16; piece += 1) {
    const vx = (hash(piece + 880) - 0.5) * 36;
    const vy = -(8 + hash(piece + 881) * 18);
    const ground = lane - 2 + hash(piece + 882) * 6;
    const landing = (-vy + Math.sqrt(vy * vy + 80 * (ground - y))) / 40;
    const flight = Math.min(after, landing);
    const color = piece % 3 === 0 && after < landing ? flame(t, piece) : debris;
    cell(cells, x + vx * flight, y + vy * flight + 20 * flight * flight, color, fade);
  }
  if (after < 0.3) return;
  const smoke = dark ? "#8a7a90" : "#8a8290";
  for (let puff = 0; puff < 18; puff += 1) {
    const age = wrap(after * 0.9 + (puff / 18) * 4, 4);
    if (age > after) continue;
    const puffX = x + Math.sin(age * 1.5 + puff) * 2 + age * 4;
    disc(cells, puffX, y - 4 - age * 8, 1.5 + age * 1.5, smoke, 0.45 * (1 - age / 4) * fade);
  }
}

function coastPalms(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): void {
  const { width: w, height: h } = frame;
  const { roadBottom, after, fade } = layout;
  const ground = roadBottom + Math.round((h - roadBottom) * 0.35);
  const burning = clamp01((after - 1.2) / 0.5) * fade;
  const palms = [
    [0.035, 0.34, 0.6],
    [0.1, 0.25, -0.4],
    [0.9, 0.27, 0.5],
    [0.965, 0.36, -0.6],
  ] as const;
  palms.forEach(([px, size, lean], index) => {
    const base = {
      x: px * w,
      y: ground,
      height: Math.max(8, Math.round(Math.min(h, w * 0.75) * size)),
      lean,
      seed: 850 + index * 7,
    };
    palm(cells, frame, base, index === 2 ? burning : 0);
  });
}

function crashShake(cells: ChatBackdropCells, frame: ChatBackdropFrame, layout: CoastLayout): ChatBackdropCells {
  const strength = layout.after > 0 && layout.after < 0.7 ? (1 - layout.after / 0.7) * 2.5 : 0;
  if (strength === 0) return cells;
  const dx = Math.round(Math.sin(frame.time * 90) * strength);
  const dy = Math.round(Math.cos(frame.time * 77) * strength);
  return { fill: (x, y, width, height, color, alpha) => cells.fill(x + dx, y + dy, width, height, color, alpha) };
}

function coast(base: ChatBackdropCells, frame: ChatBackdropFrame): void {
  const layout = coastLayout(frame);
  const cells = crashShake(base, frame, layout);
  coastSky(cells, frame, layout);
  coastSun(cells, frame, layout);
  coastSkyline(cells, frame, layout);
  coastYacht(cells, frame, layout);
  coastHelicopter(cells, frame, layout);
  coastSpeedboat(cells, frame, layout);
  coastBeach(cells, frame, layout);
  coastChase(cells, frame, layout);
  coastPalms(cells, frame, layout);
  coastExplosion(cells, frame, layout);
}

const PAINTERS: Record<ChatBackdropScene, (cells: ChatBackdropCells, frame: ChatBackdropFrame) => void> = {
  pond,
  jellyfish,
  sunset,
  snowfall,
  fireflies,
  coast,
};

export function paintChatBackdropScene(cells: ChatBackdropCells, frame: ChatBackdropFrame): void {
  cells.fill(0, 0, frame.width, frame.height, CHAT_BACKDROP_BASE[frame.scene][frame.dark ? "dark" : "light"], 1);
  PAINTERS[frame.scene](cells, frame);
}
