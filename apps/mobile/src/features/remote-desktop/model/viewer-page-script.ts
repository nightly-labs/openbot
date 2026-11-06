import type { RemoteDesktopDisplay } from "./remote-desktop-api";

// The app's own script in the viewer page. The page is the host's Moonlight Web viewer (2.10, with
// OpenBot's patch). The script runs at the start of each page load and only sets values in the
// page: it has no way to call the app. The app calls it with `injectJavaScript`.
//
// - Settings: Moonlight reads `mlSettings` from local storage when its stream page starts.
// - Keys: Moonlight reads `keydown` and `keyup` on the document, as the host's paste script uses
//   them. Typed text goes as key presses of a US keyboard: Sunshine on macOS does not type text
//   ("Unicode input not yet implemented for MacOS"). Only a character with no key goes as text,
//   which Sunshine types on Windows and Linux.
// - Zoom: a transform of Moonlight's video element. It is `position: fixed`, so a transform of a
//   parent would move it. Moonlight's page animates every transform for 0.25 s, so the video's
//   transition is turned off: a pan reads the video's place, and a place in mid-animation is wrong.
//   Moonlight maps a touch through the video's bounding box, which includes the transform.
// - Trackpad mode is Moonlight's `localCursor` mode: the finger moves the pointer as with
//   `mouseRelative`, but the page knows where the pointer is and sends it as a position. While zoomed
//   in, the view follows the pointer. Moonlight's own drawing of that pointer is hidden, because the
//   computer's pointer is in the video.
// - A two-finger pinch zooms, and moves the view with the fingers. Three fingers move the view.
//   Moonlight keeps the other gestures at any zoom: a two-finger drag scrolls, and a two-finger tap
//   right-clicks.

/**
 * `fast` for a computer display of 120 Hz or more: Sunshine captures no faster than the display, so
 * on a 60 Hz display it sends what `smooth` sends. `saver` for a mobile network. The member chooses.
 */
export type ViewerQuality = "fast" | "smooth" | "saver";
/** `trackpad`: the finger moves the pointer, as on a laptop. `direct`: the pointer goes to the finger. */
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

/** Sunshine encodes at the size the viewer asks for. A phone needs no more than this. */
function streamSize(display: RemoteDesktopDisplay | undefined, maxWidth: number): { width: number; height: number } {
  if (!display || display.width <= 0 || display.height <= 0) return { width: maxWidth, height: (maxWidth * 9) / 16 };
  const scale = Math.min(1, maxWidth / display.width);
  // Encoders need even sizes.
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even(display.width * scale), height: even(display.height * scale) };
}

/** The keys of a US keyboard for each printable ASCII character: the key code, and Shift. */
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

/** Only the characters of a CSS colour value, so the value cannot end the style rule. */
function cssColor(value: string): string {
  return /^[#A-Za-z0-9(),.%\s-]{1,64}$/u.test(value) ? value : "black";
}

export function viewerPageScript(
  quality: ViewerQuality,
  touchMode: ViewerTouchMode,
  display: RemoteDesktopDisplay | undefined,
  background: string,
  /** The space that the app's bars cover at the top and the bottom of the page. */
  covered: { top: number; bottom: number },
): string {
  const preset = QUALITY[quality];
  const settings = {
    fps: preset.fps,
    bitrate: preset.bitrate,
    videoSize: "custom",
    videoSizeCustom: streamSize(display, preset.maxWidth),
    // Every phone decodes H.264 in hardware.
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
// The app's background around the video, in place of Moonlight's blue page: its gradient is a layer
// of its own (\`body::before\`). Moonlight's stats overlay does not show; the app shows the stats.
try {
  const background = ${JSON.stringify(cssColor(background))};
  const style = document.createElement("style");
  style.textContent = "html,body,#root,.video-stream{background:" + background + " !important}body::before{display:none !important}.video-stats{display:none !important}.video-stream{transition:none !important}.local-touch-cursor{display:none !important}";
  (document.head || document.documentElement).appendChild(style);
} catch {}
if (window.__openbotRemote) return;
const KEYS = ${JSON.stringify(usKeyboard())};
// Beside Moonlight's stream page in the viewer's \`moonlight/\` path.
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
// The video's centre and size at full size. Its transform keeps the centre at (x, y) from there.
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
      // Moonlight counts characters, and the host counts code points: a surrogate pair is not sent.
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
  // Moonlight's stats, once a second while the app's stats sheet is open. The sample goes to the
  // app's loopback proxy, which keeps this one path for itself and sends it to no host.
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
// A gesture that the view owns from its start to its last lift: a pinch, or three fingers. Moonlight
// forgets the touches it had, so a finger it saw first does not click or stay down.
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
    // A pinch, not a scroll: the fingers move apart or together by an eighth.
    if (Math.abs(now.d / pending.d - 1) > 0.12) own(event.touches, pending);
  }
  if (!gesture) return;
  swallow(event);
  if (event.touches.length < 2) return;
  const now = measure(event.touches);
  // A change of fingers starts the count again, so the view does not jump.
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
// While zoomed in, the view follows the pointer: a pointer that moves near an edge, or under the
// app's bars, moves the view until the pointer is in view again. Only a move of the pointer does
// this, so a view that the fingers moved away from the pointer stays where they left it.
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

/** The file name that the page posts its stats to. The proxy answers it and sends it to no host. */
export const VIEWER_STATS_FILE = "openbot-phone-stats";

/** A call into the page's script. Each value is JSON, so no value can end the call early. */
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
