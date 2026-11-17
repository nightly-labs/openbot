import { sourceText } from "@openbot/i18n/source";

/** No decoded frame for this long means the stream stalled. Sunshine sends at least half the frame rate, also for a still screen. */
const STALL_MS = 20_000;
/** The wait for the first frame, as the viewer's own stream check: the host can start streams queued before this one. */
const FIRST_FRAME_MS = 60_000;
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
 * The script counts the frames that the browser decodes. It judges only while the page shows, a peer
 * connection is up, the browser reports video, and Moonlight reported no error of its own. When no
 * frame comes for `STALL_MS` (`FIRST_FRAME_MS` before the first frame), it reports an error with a
 * clear text, and "connected" again when frames come back.
 * In the desktop app and the browser, a stall also makes the next streams of this server in this
 * viewer use the phone app's Data saver rate for a day, so Retry shows a picture. The phone app
 * chooses its own quality in its menu, so the script does not change it there.
 */
export function remoteDesktopStreamWatchScript(serverId: string): string {
  const tooSlowLowered = sourceText("error.remote.streamTooSlowLowerQuality");
  const tooSlow = sourceText("error.remote.streamTooSlow");
  return `{
// One viewer origin can show several servers, so each server keeps its own quality.
const QUALITY_KEY = ${JSON.stringify(`openbot-remote-quality:${serverId}`)};
const sessionId = /\\/sessions\\/([A-Za-z0-9-]+)\\/moonlight(?:\\/|$)/.exec(location.pathname)?.[1];
// The phone app's page script sets this before the page loads, in every release with remote desktop.
const phone = "__openbotRemote" in window;
let lowered = false;
if (!phone) {
  // The desktop app and the browser set no rate of their own, so Moonlight's defaults apply unless
  // this server stalled in the last day.
  try {
    const until = Number(localStorage.getItem(QUALITY_KEY));
    lowered = until > Date.now();
    if (until && !lowered) localStorage.removeItem(QUALITY_KEY);
    const settings = JSON.parse(localStorage.getItem("mlSettings") || "{}");
    if (lowered) Object.assign(settings, ${JSON.stringify(LOWER_QUALITY)});
    else {
      delete settings.bitrate;
      delete settings.fps;
    }
    localStorage.setItem("mlSettings", JSON.stringify(settings));
  } catch {}
}
// Moonlight posts its own errors here, such as a host that stopped. The watcher then stays quiet, so
// that error keeps its text and does not lower the quality.
const nativeFetch = window.fetch.bind(window);
let moonlightFailed = false;
window.fetch = (input, init) => {
  try {
    if (typeof input === "string" && input.endsWith("/viewer-state") && JSON.parse(init?.body ?? "{}").state === "error") moonlightFailed = true;
  } catch {}
  return nativeFetch(input, init);
};
const report = (state, message) => {
  const payload = { source: "openbot-moonlight", type: "viewer-state", sessionId, state, ...(message ? { message } : {}) };
  window.parent.postMessage(payload, "*");
  nativeFetch("../viewer-state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
};
const peers = new Set();
let timer = 0;
let frames = 0;
let progress = 0;
let started = false;
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
  let video = false;
  let connected = false;
  for (const peer of peers) {
    if (peer.connectionState === "connected") connected = true;
    const stats = await peer.getStats().catch(() => null);
    stats?.forEach((entry) => {
      if (entry.type !== "inbound-rtp" || entry.kind !== "video") return;
      video = true;
      decoded += entry.framesDecoded ?? 0;
    });
  }
  checking = false;
  const now = Date.now();
  if (decoded > frames) started = true;
  // A page that does not show, a connection that is not up, or video that does not come as a track
  // is not a slow stream.
  if (decoded > frames || !video || !connected || document.visibilityState !== "visible") progress = now;
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
  if (moonlightFailed || now - progress < (started ? ${STALL_MS} : ${FIRST_FRAME_MS})) return;
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
