import { sourceText } from "@openbot/i18n/source";

const STALL_MS = 20_000;
const FIRST_FRAME_MS = 60_000;
const RECOVERED_FRAMES = 30;
const LOWER_QUALITY_MS = 24 * 60 * 60 * 1000;
const LOWER_QUALITY = { bitrate: 3_000, fps: 30 };

export function remoteDesktopStreamWatchScript(serverId: string, switchesEncoder: boolean): string {
  const tooSlowLowered = sourceText("error.remote.streamTooSlowLowerQuality");
  const tooSlow = sourceText("error.remote.streamTooSlow");
  const noPicture = sourceText("error.remote.noPictureSwitchEncoder");
  return `{
const QUALITY_KEY = ${JSON.stringify(`openbot-remote-quality:${serverId}`)};
const sessionId = /\\/sessions\\/([A-Za-z0-9-]+)\\/moonlight(?:\\/|$)/.exec(location.pathname)?.[1];
const phone = "__openbotRemote" in window;
let lowered = false;
if (!phone) {
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
const nativeFetch = window.fetch.bind(window);
let moonlightFailed = false;
window.fetch = (input, init) => {
  try {
    if (typeof input === "string" && input.endsWith("/viewer-state") && JSON.parse(init?.body ?? "{}").state === "error") moonlightFailed = true;
  } catch {}
  return nativeFetch(input, init);
};
const report = (state, message, noPicture) => {
  const payload = { source: "openbot-moonlight", type: "viewer-state", sessionId, state, ...(message ? { message } : {}), ...(noPicture ? { noPicture: true } : {}) };
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
  if (decoded > frames || !video || !connected || document.visibilityState !== "visible") progress = now;
  frames = decoded;
  if (stalled) {
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
  const message = !started && ${switchesEncoder} ? ${JSON.stringify(noPicture)} : lower ? ${JSON.stringify(tooSlowLowered)} : ${JSON.stringify(tooSlow)};
  report("error", message, !started);
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
