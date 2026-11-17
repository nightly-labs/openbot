import { sourceText } from "@openbot/i18n/source";

/** No decoded frame for this long means the stream stalled. Sunshine sends at least half the frame rate, also for a still screen. */
const STALL_MS = 20_000;
/** New frames after a stall that count as a picture again: about a second at the lowest frame rate. */
const RECOVERED_FRAMES = 30;
/** How long a viewer keeps the lower quality after a stall, as Selkies keeps a page's rate for a day. */
const LOWER_QUALITY_MS = 24 * 60 * 60 * 1000;
/** The phone app's Data saver rate and frame rate. */
const LOWER_QUALITY = { bitrate: 3_000, fps: 30 };

/**
 * Watches the stream in the viewer page, which the gateway serves with the paste script.
 *
 * Moonlight's viewer says "connected" when the video track arrives, before a frame. Moonlight Web
 * cannot lower its rate during a stream, and Sunshine cannot change it, so on a connection slower
 * than the stream each lost frame makes the streamer wait for a full frame, which the slow
 * connection loses again: the picture stays black or frozen with no message (#11271).
 *
 * The script counts the frames that the browser decodes. When none comes for `STALL_MS` while the
 * page shows, it reports an error with a clear text, and "connected" again when frames come back.
 * In the desktop app and the browser, a stall also makes the next streams of this viewer use the
 * phone app's Data saver rate for a day, so Retry shows a picture. The phone app chooses its own
 * quality in its menu, so the script does not change it there.
 */
export function remoteDesktopStreamWatchScript(): string {
  const tooSlowLowered = sourceText("error.remote.streamTooSlowLowerQuality");
  const tooSlow = sourceText("error.remote.streamTooSlow");
  return `{
const QUALITY_KEY = "openbot-remote-quality";
const sessionId = /\\/sessions\\/([A-Za-z0-9-]+)\\/moonlight(?:\\/|$)/.exec(location.pathname)?.[1];
const phone = "ReactNativeWebView" in window;
let lowered = false;
if (!phone) {
  try {
    const until = Number(localStorage.getItem(QUALITY_KEY));
    const settings = JSON.parse(localStorage.getItem("mlSettings") || "{}");
    lowered = until > Date.now();
    if (lowered) Object.assign(settings, ${JSON.stringify(LOWER_QUALITY)});
    else if (until) {
      delete settings.bitrate;
      delete settings.fps;
      localStorage.removeItem(QUALITY_KEY);
    }
    if (until) localStorage.setItem("mlSettings", JSON.stringify(settings));
  } catch {}
}
const report = (state, message) => {
  const payload = { source: "openbot-moonlight", type: "viewer-state", sessionId, state, ...(message ? { message } : {}) };
  window.parent.postMessage(payload, "*");
  fetch("../viewer-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
};
const peers = new Set();
let timer = 0;
let frames = 0;
let progress = 0;
let stalled = false;
let stalledAt = 0;
let checking = false;
const check = async () => {
  for (const peer of peers) if (peer.connectionState === "closed") peers.delete(peer);
  if (!peers.size) {
    clearInterval(timer);
    timer = 0;
    return;
  }
  if (checking) return;
  checking = true;
  let decoded = 0;
  for (const peer of peers) {
    const stats = await peer.getStats().catch(() => null);
    stats?.forEach((entry) => {
      if (entry.type === "inbound-rtp" && entry.kind === "video") decoded += entry.framesDecoded ?? 0;
    });
  }
  checking = false;
  const now = Date.now();
  if (decoded > frames || document.visibilityState !== "visible") progress = now;
  frames = decoded;
  if (stalled) {
    // A few frames that trickle through do not make a picture: wait for about a second of video.
    stalledAt = Math.min(stalledAt, decoded);
    if (decoded - stalledAt >= ${RECOVERED_FRAMES}) {
      stalled = false;
      report("connected");
    }
    return;
  }
  if (now - progress < ${STALL_MS}) return;
  stalled = true;
  stalledAt = decoded;
  let lower = false;
  if (!phone && !lowered) {
    try {
      localStorage.setItem(QUALITY_KEY, String(now + ${LOWER_QUALITY_MS}));
      lower = true;
    } catch {}
  }
  report("error", lower ? ${JSON.stringify(tooSlowLowered)} : ${JSON.stringify(tooSlow)});
};
if (sessionId && window.RTCPeerConnection) {
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Native {
    constructor(...args) {
      super(...args);
      peers.add(this);
      progress = Date.now();
      if (!timer) timer = setInterval(() => void check(), 1000);
    }
  };
}
}
`;
}
