import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { base64ToBytes, bytesToBase64 } from "@openbot/team-client/base64";
import * as Crypto from "expo-crypto";
import type {
  RemoteDesktopConnection,
  RemoteDesktopStream,
} from "@/features/workspace/components/remote-team-transport";
import { currentText } from "@/shared/lib/text";
import { remoteViewerProxyNative, type ViewerProxyRequest } from "./remote-viewer-proxy-native";
import { VIEWER_STATS_FILE } from "./viewer-page-script";

// The phone's copy of the desktop app's `RemoteViewerProxy`. The host's Moonlight viewer loads in a
// web view from a loopback address with a random token. The native module only reads HTTP and
// WebSocket frames; this file sends each request to the host as a Team API request and each socket
// over the peer's desktop channel. The viewer's video goes over its own WebRTC connection.

type ViewerState = "connecting" | "connected" | "error";
/** How the video reaches the phone: straight from the computer, or through a TURN relay. */
export type ViewerRoute = "p2p" | "relay";

export interface ViewerReport {
  state: ViewerState;
  route: ViewerRoute | null;
  message: string | null;
}

export interface ViewerProxy {
  /** The viewer page for the session. The grant is in the fragment, so no request carries it. */
  viewerUrl(grant: string): string;
  stop(): Promise<void>;
}

/** The host's file answers and the attachment limit allow a few files at a time. */
const REQUESTS_IN_FLIGHT = 4;
/** The native server answers 504 after this, so a request that takes longer frees its place. */
const REQUEST_DEADLINE_MS = 60_000;
/** As the desktop proxy: what a socket can hold before the host opens it. */
const MAX_PENDING_SIGNAL_BYTES = 1024 * 1024;
// The desktop proxy sends the same policy for the viewer's pages.
const VIEWER_PAGE_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:";

interface ViewerSocket {
  stream: RemoteDesktopStream | null;
  opened: boolean;
  pending: Array<{ text?: string; binaryBase64?: string }>;
  pendingBytes: number;
}

function sendableCloseCode(code: number): number {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 && code !== 1015
    ? code
    : 1011;
}

function utf8Base64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Hermes has no `TextDecoder`. A request body here is a small JSON text. */
function utf8Text(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index] ?? 0;
    const size = first < 0x80 ? 1 : first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 1;
    let point = size === 1 ? first : first & (0xff >> (size + 1));
    for (let next = 1; next < size; next += 1) point = (point << 6) | ((bytes[index + next] ?? 0) & 0x3f);
    text += String.fromCodePoint(point);
    index += size;
  }
  return text;
}

/**
 * The viewer's own files name `/v1/remote-screen`, in plain form and with escaped slashes. Both get
 * the proxy's token first, as on desktop. The names are ASCII, and an ASCII byte is never part of a
 * longer UTF-8 character, so the change is made on the bytes without decoding them.
 */
function rewriteNamespace(base64: string, prefix: string): string {
  const namespace = TEAM_API_ROUTES.remoteScreen.prefix;
  const escapedNamespace = namespace.replaceAll("/", "\\/");
  const bytes = atob(base64)
    .replaceAll(escapedNamespace, `${prefix.replaceAll("/", "\\/")}${escapedNamespace}`)
    .replaceAll(namespace, `${prefix}${namespace}`);
  return btoa(bytes);
}

function decodeViewerState(body: string): ViewerReport | null {
  try {
    const value = JSON.parse(body);
    if (!isDynamicRecord(value) || value.source !== "openbot-moonlight" || value.type !== "viewer-state") return null;
    const state = value.state;
    if (state !== "connecting" && state !== "connected" && state !== "error") return null;
    const route = value.transport === "p2p" || value.transport === "relay" ? value.transport : null;
    return { state, route, message: isString(value.message) ? value.message.slice(0, 512) : null };
  } catch {
    return null;
  }
}

function createLimiter(limit: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

/** Null in a build without the native module. */
export async function startViewerProxy(
  connection: RemoteDesktopConnection,
  sessionId: string,
  onViewerReport: (report: ViewerReport) => void,
  onStats: (stats: unknown) => void,
): Promise<ViewerProxy | null> {
  const native = remoteViewerProxyNative;
  if (!native) return null;
  const token = Array.from(Crypto.getRandomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const prefix = `/${token}`;
  const sessionPath = TEAM_API_ROUTES.remoteScreen.session(sessionId);
  // Only this session's viewer routes and its stream. The host checks them again.
  const viewerRoute = new RegExp(
    `^${sessionPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/(?:viewer|authorize|viewer-state|moonlight(?:/[A-Za-z0-9_./-]*)?)$`,
    "u",
  );
  const streamPath = `${sessionPath}/stream`;
  // The page's stats for the app's stats sheet. Moonlight serves no file of this name.
  const statsPath = `${sessionPath}/moonlight/${VIEWER_STATS_FILE}`;
  const limit = createLimiter(REQUESTS_IN_FLIGHT);
  const sockets = new Map<string, ViewerSocket>();
  let stopped = false;

  const upstream = (target: string): { path: string; pathname: string } | null => {
    if (!target.startsWith(`${prefix}/`)) return null;
    const path = target.slice(prefix.length);
    const pathname = path.split("?")[0] ?? "";
    return pathname.includes("..") ? null : { path, pathname };
  };

  const respond = (requestId: string, status: number, headers: Record<string, string>, base64 = "") =>
    void native
      .respond(
        requestId,
        status,
        { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
        base64,
      )
      .catch(() => undefined);
  const respondText = (requestId: string, status: number, text: string) =>
    respond(requestId, status, { "Content-Type": "text/plain; charset=utf-8" }, utf8Base64(text));

  const forward = async (request: ViewerProxyRequest) => {
    const route = upstream(request.target);
    // A request of a proxy that a newer session started: that proxy answers it.
    if (!route) return;
    if (!viewerRoute.test(route.pathname)) return respondText(request.requestId, 404, "Not found");
    if (route.pathname === statsPath) {
      if (request.method === "POST" && request.bodyBase64) {
        try {
          onStats(JSON.parse(utf8Text(base64ToBytes(request.bodyBase64))));
        } catch {
          // A sample that is not JSON is dropped.
        }
      }
      return respond(request.requestId, 204, {});
    }
    const method = request.method === "HEAD" ? "GET" : request.method;
    const contentType = request.headers["content-type"] ?? "application/octet-stream";
    let body: TeamProtocolV2Json = {};
    let upload: { name: string; mimeType: string; base64: string } | undefined;
    if (method !== "GET" && request.bodyBase64) {
      if (contentType.includes("json")) {
        const text = utf8Text(base64ToBytes(request.bodyBase64));
        if (route.pathname === `${sessionPath}/viewer-state`) {
          const update = decodeViewerState(text);
          if (update) onViewerReport(update);
        }
        try {
          body = decodeTeamProtocolV2Json(JSON.parse(text));
        } catch {
          return respondText(request.requestId, 400, "Invalid JSON");
        }
      } else {
        upload = { name: "viewer-request", mimeType: contentType, base64: request.bodyBase64 };
      }
    }
    try {
      const answer = await limit(async () => {
        // A request that waited for its place after the stop does not go to the host.
        if (stopped) throw new Error("The viewer proxy stopped.");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("The host did not answer in time.")), REQUEST_DEADLINE_MS);
        });
        return Promise.race([connection.fetchRaw(method, route.path, body, upload), deadline]).finally(() =>
          clearTimeout(timer),
        );
      });
      if (stopped) return;
      if (answer.status === 204) return respond(request.requestId, 204, {});
      const file = answer.body;
      if (isDynamicRecord(file) && isString(file.mimeType) && isString(file.base64) && isString(file.name)) {
        const page = file.mimeType.includes("text/html");
        const content =
          page || file.mimeType.includes("javascript") ? rewriteNamespace(file.base64, prefix) : file.base64;
        return respond(
          request.requestId,
          answer.status,
          { "Content-Type": file.mimeType, ...(page ? { "Content-Security-Policy": VIEWER_PAGE_POLICY } : {}) },
          request.method === "HEAD" ? "" : content,
        );
      }
      const json = JSON.stringify(answer.body ?? null);
      return respond(
        request.requestId,
        answer.status,
        { "Content-Type": "application/json" },
        request.method === "HEAD" ? "" : utf8Base64(json),
      );
    } catch {
      if (!stopped) respondText(request.requestId, 502, "Remote viewer resource unavailable");
    }
  };

  const closeSocket = (socketId: string, code: number, reason: string) => {
    if (!sockets.delete(socketId)) return;
    void native.socketClose(socketId, sendableCloseCode(code), reason.slice(0, 123)).catch(() => undefined);
  };

  const sendToHost = (socket: ViewerSocket, message: { text?: string; binaryBase64?: string }) => {
    if (message.text !== undefined) socket.stream?.sendText(message.text);
    else if (message.binaryBase64 !== undefined) socket.stream?.sendBinary(message.binaryBase64);
  };

  const subscriptions = [
    native.addListener("onRequest", (request) => void forward(request)),
    native.addListener("onSocketOpen", ({ socketId, target }) => {
      const route = upstream(target);
      // A socket of a proxy that a newer session started: that proxy takes it.
      if (!route) return;
      if (route.path !== streamPath) {
        void native.socketClose(socketId, 1008, "").catch(() => undefined);
        return;
      }
      const socket: ViewerSocket = { stream: null, opened: false, pending: [], pendingBytes: 0 };
      sockets.set(socketId, socket);
      socket.stream = connection.openRemoteDesktopStream(route.path, (event) => {
        if (sockets.get(socketId) !== socket) return;
        if (event.type === "opened") {
          socket.opened = true;
          for (const message of socket.pending.splice(0)) sendToHost(socket, message);
          socket.pendingBytes = 0;
        } else if (event.type === "text") {
          void native.socketSend(socketId, event.data, null).catch(() => undefined);
        } else if (event.type === "binary") {
          void native.socketSend(socketId, null, event.base64).catch(() => undefined);
        } else {
          closeSocket(socketId, event.code, event.reason);
        }
      });
      if (!socket.stream) closeSocket(socketId, 1011, "");
    }),
    native.addListener("onSocketMessage", ({ socketId, text, binaryBase64 }) => {
      const socket = sockets.get(socketId);
      if (!socket) return;
      const message = text !== undefined ? { text } : binaryBase64 !== undefined ? { binaryBase64 } : null;
      if (!message) return;
      if (socket.opened) return sendToHost(socket, message);
      socket.pendingBytes += (text ?? binaryBase64 ?? "").length;
      if (socket.pendingBytes > MAX_PENDING_SIGNAL_BYTES) {
        socket.stream?.close(1009, "");
        closeSocket(socketId, 1009, "");
        return;
      }
      socket.pending.push(message);
    }),
    native.addListener("onSocketClose", ({ socketId, code, reason }) => {
      const socket = sockets.get(socketId);
      if (!socket) return;
      sockets.delete(socketId);
      socket.stream?.close(sendableCloseCode(code), reason);
    }),
  ];

  let port: number;
  try {
    port = await native.start(token);
  } catch {
    for (const subscription of subscriptions) subscription.remove();
    // The native reason is English: the screen shows the app's own text.
    throw new Error(currentText().t("mobile.server.remoteDesktop.failed"));
  }

  return {
    viewerUrl: (grant) => `http://127.0.0.1:${port}${prefix}${TEAM_API_ROUTES.remoteScreen.viewer(sessionId)}#${grant}`,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      for (const subscription of subscriptions) subscription.remove();
      for (const socket of sockets.values()) socket.stream?.close(1001, "");
      sockets.clear();
      await native.stop().catch(() => undefined);
    },
  };
}
