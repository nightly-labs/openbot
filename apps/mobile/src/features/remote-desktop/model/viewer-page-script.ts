import type { RemoteDesktopDisplay } from "./remote-desktop-api";

export type ViewerQuality = "fast" | "smooth" | "saver";
export type ViewerTouchMode = "trackpad" | "direct";

const QUALITY = {
  fast: { fps: 120, bitrate: 20_000, maxWidth: 1920 },
  smooth: { fps: 60, bitrate: 10_000, maxWidth: 1920 },
  saver: { fps: 30, bitrate: 3_000, maxWidth: 1280 },
} as const satisfies Record<ViewerQuality, { fps: number; bitrate: number; maxWidth: number }>;

const TOUCH_MODE = { trackpad: "localCursor", direct: "pointAndDrag" } as const satisfies Record<
  ViewerTouchMode,
  string
>;

function streamSize(display: RemoteDesktopDisplay | undefined, maxWidth: number): { width: number; height: number } {
  if (!display || display.width <= 0 || display.height <= 0) return { width: maxWidth, height: (maxWidth * 9) / 16 };
  const scale = Math.min(1, maxWidth / display.width);
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even(display.width * scale), height: even(display.height * scale) };
}

function usKeyboard(): Record<string, [string, boolean]> {
  const keys: Record<string, [string, boolean]> = {
    " ": ["Space", false],
    "\n": ["Enter", false],
    "\t": ["Tab", false],
  };
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    keys[letter] = [`Key${letter.toUpperCase()}`, false];
    keys[letter.toUpperCase()] = [`Key${letter.toUpperCase()}`, true];
  }
  "0123456789".split("").forEach((digit) => {
    keys[digit] = [`Digit${digit}`, false];
  });
  ")!@#$%^&*(".split("").forEach((symbol, digit) => {
    keys[symbol] = [`Digit${digit}`, true];
  });
  const pairs: Array<[string, string, string]> = [
    ["-", "_", "Minus"],
    ["=", "+", "Equal"],
    ["[", "{", "BracketLeft"],
    ["]", "}", "BracketRight"],
    ["\\", "|", "Backslash"],
    [";", ":", "Semicolon"],
    ["'", '"', "Quote"],
    [",", "<", "Comma"],
    [".", ">", "Period"],
    ["/", "?", "Slash"],
    ["`", "~", "Backquote"],
  ];
  for (const [plain, shifted, code] of pairs) {
    keys[plain] = [code, false];
    keys[shifted] = [code, true];
  }
  return keys;
}

export function viewerQualityFps(quality: ViewerQuality): number {
  return QUALITY[quality].fps;
}

function cssColor(value: string): string {
  return /^[#A-Za-z0-9(),.%\s-]{1,64}$/u.test(value) ? value : "black";
}

export function viewerPageScript(
  quality: ViewerQuality,
  touchMode: ViewerTouchMode,
  display: RemoteDesktopDisplay | undefined,
  background: string,
  covered: { top: number; bottom: number },
): string {
  const preset = QUALITY[quality];
  const settings = {
    fps: preset.fps,
    bitrate: preset.bitrate,
    videoSize: "custom",
    videoSizeCustom: streamSize(display, preset.maxWidth),
    videoCodec: "h264",
    touchMode: TOUCH_MODE[touchMode],
    mouseMode: "follow",
  };
  return `(() => {
try {
  const raw = localStorage.getItem("mlSettings");
  const current = raw ? JSON.parse(raw) : {};
  localStorage.setItem("mlSettings", JSON.stringify(Object.assign({}, current, ${JSON.stringify(settings)})));
} catch {}
try {
  const background = ${JSON.stringify(cssColor(background))};
  const style = document.createElement("style");
  style.textContent = "html,body,#root,.video-stream{background:" + background + " !important}body::before{display:none !important}.video-stats{display:none !important}.video-stream{transition:none !important}.local-touch-cursor{display:none !important}";
  (document.head || document.documentElement).appendChild(style);
} catch {}
if (window.__openbotRemote) return;
const KEYS = ${JSON.stringify(usKeyboard())};
const STATS_PATH = ${JSON.stringify(VIEWER_STATS_FILE)};
let statsTimer = null;
const FLAGS = { ShiftLeft: "shiftKey", ControlLeft: "ctrlKey", AltLeft: "altKey", MetaLeft: "metaKey" };
const held = new Set();
const flags = (extra) => { const value = {}; for (const code of held) value[FLAGS[code]] = true; if (extra) value.shiftKey = true; return value; };
const press = (type, code, key, shift) => document.dispatchEvent(new KeyboardEvent(type, Object.assign({ code, key, bubbles: true, cancelable: true }, flags(shift))));
const tap = (code, key, shift) => {
  const addShift = shift && !held.has("ShiftLeft");
  if (addShift) press("keydown", "ShiftLeft", "Shift", true);
  press("keydown", code, key, shift);
  press("keyup", code, key, shift);
  if (addShift) press("keyup", "ShiftLeft", "Shift", false);
};
const input = () => { const app = window.app; return app && app.stream && app.stream.getInput ? app.stream.getInput() : null; };
const view = { scale: 1, x: 0, y: 0 };
const COVERED = ${JSON.stringify({ top: Math.max(0, Math.round(covered.top)), bottom: Math.max(0, Math.round(covered.bottom)) })};
const videos = () => Array.from(document.querySelectorAll(".video-stream"));
const apply = () => {
  for (const video of videos())
    video.style.transform = view.scale === 1 ? "" : "translate(" + view.x + "px," + view.y + "px) translate(-50%,-50%) scale(" + view.scale + ")";
};
const base = () => {
  const video = videos().find((element) => element.getBoundingClientRect().width > 0);
  if (!video) return null;
  const rect = video.getBoundingClientRect();
  return { cx: rect.left + rect.width / 2 - view.x, cy: rect.top + rect.height / 2 - view.y, w: rect.width / view.scale, h: rect.height / view.scale };
};
const clampAxis = (offset, center, size, viewport) => {
  if (size <= viewport) return viewport / 2 - center;
  const half = size / 2;
  return Math.min(half - center, Math.max(viewport - half - center, offset));
};
const zoomAt = (scale, ax, ay, dx, dy) => {
  const box = base();
  if (!box) return;
  const next = Math.min(5, Math.max(1, scale));
  const k = next / view.scale;
  const cx = box.cx + view.x;
  const cy = box.cy + view.y;
  let x = ax + (cx - ax) * k - box.cx + (dx || 0);
  let y = ay + (cy - ay) * k - box.cy + (dy || 0);
  if (next <= 1.02) { view.scale = 1; view.x = 0; view.y = 0; apply(); return; }
  x = clampAxis(x, box.cx, box.w * next, innerWidth);
  y = clampAxis(y, box.cy, box.h * next, innerHeight);
  view.scale = next; view.x = x; view.y = y;
  apply();
};
window.__openbotRemote = {
  key(code, key) { tap(code, key, false); },
  modifier(code, down) {
    if (!(code in FLAGS)) return;
    if (down) { held.add(code); press("keydown", code, code.replace(/Left$/, ""), false); }
    else { held.delete(code); press("keyup", code, code.replace(/Left$/, ""), false); }
  },
  type(value) {
    let text = "";
    const flush = () => {
      const target = input();
      if (target && text) target.sendText(text);
      text = "";
    };
    for (const character of Array.from(String(value))) {
      const known = KEYS[character];
      if (known) { flush(); tap(known[0], character, known[1]); }
      else if (character.length === 1) { text += character; if (text.length >= 64) flush(); }
    }
    flush();
  },
  touchMode(mode) {
    const app = window.app;
    if (app && app.getInputConfig && app.setInputConfig) app.setInputConfig(Object.assign({}, app.getInputConfig(), { touchMode: mode }));
  },
  fit() { view.scale = 1; view.x = 0; view.y = 0; apply(); },
  stats(on) {
    const stream = window.app && window.app.getStream && window.app.getStream();
    const stats = stream && stream.getStats && stream.getStats();
    clearInterval(statsTimer);
    statsTimer = null;
    if (!stats || !stats.setEnabled) return;
    stats.setEnabled(Boolean(on));
    if (!on) return;
    const send = () => {
      try {
        fetch(STATS_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stats.getCurrentStats()) }).catch(() => undefined);
      } catch {}
    };
    statsTimer = setInterval(send, 1000);
  },
};
let gesture = null;
let pending = null;
const measure = (touches) => {
  let x = 0;
  let y = 0;
  for (const touch of touches) { x += touch.clientX; y += touch.clientY; }
  return {
    count: touches.length,
    x: x / touches.length,
    y: y / touches.length,
    d: touches.length < 2 ? 1 : Math.max(1, Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)),
  };
};
const own = (touches, from) => {
  pending = null;
  gesture = { last: from || measure(touches) };
  const target = input();
  const app = window.app;
  if (target && app && app.getStreamRect) target.onTouchCancel({ changedTouches: [] }, app.getStreamRect());
};
const swallow = (event) => { event.stopImmediatePropagation(); if (event.cancelable) event.preventDefault(); };
addEventListener("touchstart", (event) => {
  if (gesture) { gesture.last = measure(event.touches); return swallow(event); }
  if (event.touches.length >= 3) { own(event.touches); return swallow(event); }
  pending = event.touches.length === 2 ? measure(event.touches) : null;
}, { capture: true, passive: false });
addEventListener("touchmove", (event) => {
  if (!gesture && pending && event.touches.length === 2) {
    const now = measure(event.touches);
    if (Math.abs(now.d / pending.d - 1) > 0.12) own(event.touches, pending);
  }
  if (!gesture) return;
  swallow(event);
  if (event.touches.length < 2) return;
  const now = measure(event.touches);
  if (now.count !== gesture.last.count) { gesture.last = now; return; }
  const scale = now.count === 2 ? view.scale * (now.d / gesture.last.d) : view.scale;
  zoomAt(scale, now.x, now.y, now.x - gesture.last.x, now.y - gesture.last.y);
  gesture.last = now;
}, { capture: true, passive: false });
const lift = (event) => {
  if (event.touches.length < 2) pending = null;
  if (!gesture) return;
  swallow(event);
  if (event.touches.length === 0) gesture = null;
  else gesture.last = measure(event.touches);
};
addEventListener("touchend", lift, { capture: true, passive: false });
addEventListener("touchcancel", lift, { capture: true, passive: false });
const EDGE = 40;
let lastCursor = null;
const follow = () => {
  requestAnimationFrame(follow);
  const target = input();
  const app = window.app;
  if (!target || !target.getLocalCursorState || !app || !app.getStreamRect) return;
  const cursor = target.getLocalCursorState();
  if (!cursor || !cursor.visible) return;
  const moved = !lastCursor || lastCursor.x !== cursor.x || lastCursor.y !== cursor.y;
  lastCursor = { x: cursor.x, y: cursor.y };
  if (!moved || view.scale === 1 || gesture) return;
  const rect = app.getStreamRect();
  if (!rect || rect.width <= 0) return;
  const px = rect.left + cursor.x * rect.width;
  const py = rect.top + cursor.y * rect.height;
  const left = EDGE;
  const right = innerWidth - EDGE;
  const top = COVERED.top + EDGE;
  const bottom = innerHeight - COVERED.bottom - EDGE;
  const dx = px < left ? left - px : px > right ? right - px : 0;
  const dy = py < top ? top - py : py > bottom ? bottom - py : 0;
  if (dx !== 0 || dy !== 0) zoomAt(view.scale, 0, 0, dx, dy);
};
requestAnimationFrame(follow);
})();
true;`;
}

export const VIEWER_STATS_FILE = "openbot-phone-stats";

export function viewerCall(
  method: "key" | "modifier" | "type" | "touchMode" | "fit" | "stats",
  ...values: unknown[]
): string {
  const args = values.map((value) => JSON.stringify(value)).join(",");
  return `window.__openbotRemote && window.__openbotRemote.${method}(${args});true;`;
}

export function viewerTouchModeValue(mode: ViewerTouchMode): string {
  return TOUCH_MODE[mode];
}
