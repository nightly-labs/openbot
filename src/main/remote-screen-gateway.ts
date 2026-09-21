import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createRequire } from "node:module";
import { hostname, userInfo } from "node:os";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import type {
  RemoteDesktopCapabilities,
  RemoteDesktopDisplay,
  RemoteDesktopIceServer,
  RemoteDesktopSession,
  RemoteDesktopSetupStatus,
  RemoteDesktopTestStatus,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type * as Ws from "ws";
import { z } from "zod";
import { recordRestartActivity } from "../backend/restart-activity";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";
import {
  SunshineApiError,
  SunshineMoonlightRuntime,
  type SunshineMoonlightRuntimeState,
} from "./sunshine-moonlight-runtime";

const GRANT_TTL_MS = 60_000;
export const REMOTE_DESKTOP_MAX_SESSIONS = 4;
const VIEWER_COOKIE = "openbotRemoteViewer";
const MAX_PENDING_STREAM_FRAMES = 32;
const MAX_PENDING_STREAM_BYTES = 1_048_576;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const viewerGrantSchema = z.object({ grant: z.string().min(1).max(256) });
const viewerStateSchema = z.object({
  source: z.literal("openbot-moonlight"),
  type: z.literal("viewer-state"),
  sessionId: z.string().min(1).max(128),
  state: z.enum(["connecting", "connected", "error"]),
  transport: z.enum(["p2p", "relay"]).optional(),
  message: z.string().max(1_000).optional(),
});
const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));

export type RemoteScreenGatewayCreateRuntime = (
  options: ConstructorParameters<typeof SunshineMoonlightRuntime>[0],
) => RemoteScreenRuntime;

interface RemoteScreenGatewayOptions {
  platform: "darwin" | "win32" | "linux";
  unattended: boolean;
  runtimePaths: RemoteDesktopRuntimePaths | null;
  runtimeStateDirectory: string;
  getRuntimeCredentials: () => Promise<{ username: string; password: string }>;
  getDisplays?: () => RemoteDesktopDisplay[];
  getIceServers: () => Promise<RemoteDesktopIceServer[]>;
  createRuntime?: RemoteScreenGatewayCreateRuntime;
  audit?: (event: RemoteScreenAuditEvent) => void;
  now?: () => number;
  onDiagnostic?: (source: "sunshine" | "moonlight", message: string) => void;
  // Called only when the answer changes, so the host owner's screen can show the one refusal a
  // member cannot act on themselves -- and stop showing it once a member gets through.
  onScreenRecordingDenied?: (denied: boolean) => void;
}

export interface RemoteScreenRuntime {
  start(): Promise<SunshineMoonlightRuntimeState>;
  selectDisplay(displayId: string): Promise<void>;
  stop(): Promise<void>;
  // Optional: only the real runtime reads the operating system's answer.
  screenCaptureDenied?(): boolean;
  checkSetup?: SunshineMoonlightRuntime["checkSetup"];
  test?: SunshineMoonlightRuntime["test"];
}

export interface RemoteScreenAuditEvent {
  event: "started" | "transport" | "ended" | "error";
  sessionId: string;
  memberId: string;
  transport: "unknown" | "p2p" | "relay";
  monitorId: string | null;
  reason?: string;
  timestamp: string;
}

interface ManagedRemoteScreenSession {
  snapshot: RemoteDesktopSession;
  memberId: string;
  teamSessionId: string;
  grantExpirationTimer: CancellableTimer | null;
  teamSessionExpirationTimer: CancellableTimer;
  streamerSlot: number;
  viewerGrantHash: Buffer;
  viewerGrantUsed: boolean;
  viewerCookieHash: Buffer | null;
  clientSocket: Ws.WebSocket | null;
  upstreamSocket: Ws.WebSocket | null;
}

interface CancellableTimer {
  cancel: () => void;
}

export class RemoteScreenGateway {
  readonly #options: Required<Pick<RemoteScreenGatewayOptions, "createRuntime" | "audit" | "now">> &
    Omit<RemoteScreenGatewayOptions, "createRuntime" | "audit" | "now">;
  readonly #webSockets = new webSockets.WebSocketServer({ noServer: true });
  readonly #localTestServers = new Map<string, Server>();
  readonly #sessions = new Map<string, ManagedRemoteScreenSession>();
  readonly #pendingStreamStarts: Array<{ sessionId: string; start: () => void }> = [];
  #runtime: RemoteScreenRuntime | null = null;
  #runtimeState: SunshineMoonlightRuntimeState | null = null;
  #runtimeStarting: Promise<SunshineMoonlightRuntimeState> | null = null;
  #runtimeStopping: Promise<void> | null = null;
  #setupCheck: Promise<RemoteDesktopSetupStatus> | null = null;
  #startingSessions = 0;
  #testSessionId: string | null = null;
  #selectedDisplayId: string | null = null;
  #displaySwitching = false;
  // Sticky, unlike the runtime's own answer: the refusal below drops the runtime that reported it, so
  // nothing would be left to ask by the time the host owner looks.
  #screenRecordingDenied = false;
  #activeStreamStart: { sessionId: string; timeout: ReturnType<typeof setTimeout> } | null = null;

  constructor(options: RemoteScreenGatewayOptions) {
    this.#options = {
      ...options,
      createRuntime: options.createRuntime ?? ((runtimeOptions) => new SunshineMoonlightRuntime(runtimeOptions)),
      audit: options.audit ?? (() => undefined),
      now: options.now ?? Date.now,
    };
    const displays = this.#options.getDisplays?.() ?? [];
    this.#selectedDisplayId = displays.find((display) => display.primary)?.id ?? displays[0]?.id ?? null;
  }

  // Whether the last attempt to start a stream was refused screen recording by the operating system.
  screenRecordingDenied(): boolean {
    return this.#screenRecordingDenied;
  }

  /**
   * Reads the operating system's answer again, without opening a session.
   *
   * The refusal is sticky because the runtime that reported it is dropped, so a member's attempt was
   * the only thing that could clear it. That is the wrong computer: the grant is given here, and the
   * host owner who gives it has to be able to see it take effect. Starting the runtime is the answer
   * itself -- Sunshine reads the grant when it starts -- so this leaves the host as it found it, and
   * a runtime a live session owns is asked rather than replaced.
   */
  async recheckScreenRecording(): Promise<boolean> {
    if (this.#options.platform === "linux" || !this.#options.runtimePaths) return this.#screenRecordingDenied;
    await this.#ensureRuntime();
    const denied = Boolean(this.#runtime?.screenCaptureDenied?.());
    this.#reportScreenRecordingDenied(denied);
    if (this.#sessions.size === 0 && !this.#setupCheck && this.#startingSessions === 0) await this.#stopRuntime();
    return denied;
  }

  checkSetup(): Promise<RemoteDesktopSetupStatus> {
    if (this.#setupCheck) return this.#setupCheck;
    this.#setupCheck = this.#checkSetup().finally(() => {
      this.#setupCheck = null;
    });
    return this.#setupCheck;
  }

  async #checkSetup(): Promise<RemoteDesktopSetupStatus> {
    const result: RemoteDesktopSetupStatus = {
      platform: this.#options.platform,
      hostName: hostname(),
      username: userInfo().username,
      checkedAt: new Date(this.#options.now()).toISOString(),
      screenRecording: "unavailable",
      accessibility: "unavailable",
      service: "unavailable",
      displays: "unavailable",
      guiSession: "unavailable",
      restartRequired: false,
      activeSessions: this.#sessions.size,
      message: null,
    };
    if (this.#options.platform !== "darwin" || !this.#options.runtimePaths) {
      result.message =
        this.#options.platform !== "darwin"
          ? "Permission setup is available on macOS."
          : "Install the remote desktop host component, then check again.";
      return result;
    }
    try {
      await this.#ensureRuntime();
      result.service = "allowed";
      if (!this.#runtime?.checkSetup) {
        result.message = "Update the remote desktop runtime to check macOS permissions.";
        return result;
      }
      try {
        Object.assign(result, await this.#runtime.checkSetup());
        this.#reportScreenRecordingDenied(result.screenRecording === "blocked");
      } catch (error) {
        const unavailable = error instanceof SunshineApiError && error.status === 404;
        result.screenRecording =
          result.accessibility =
          result.guiSession =
          result.displays =
            unavailable ? "unavailable" : "failed";
        result.message = unavailable
          ? "Update the remote desktop runtime to check macOS permissions."
          : "Sunshine could not complete the permission check. Check the host session, then try again.";
      }
    } catch {
      result.service = "failed";
      result.message =
        "The remote desktop service could not start. Check that this macOS user has an active GUI session.";
    } finally {
      result.activeSessions = this.#sessions.size;
      if (this.#sessions.size === 0 && this.#startingSessions === 0) await this.#stopRuntime();
    }
    return result;
  }

  async test(
    sessionId: string,
    memberId: string,
    action: "start" | "status" | "stop",
  ): Promise<RemoteDesktopTestStatus> {
    const session = this.#sessions.get(sessionId);
    if (!session || session.memberId !== memberId)
      throw new RemoteScreenError(404, "session_expired", "Remote control session not found.");
    if (this.#options.platform !== "darwin" || !this.#runtime?.test)
      throw new RemoteScreenError(503, "host_unavailable", "Update the macOS remote desktop runtime to run this test.");
    if (action === "start") {
      if (this.#sessions.size !== 1 || this.#startingSessions > 0 || this.#displaySwitching || this.#testSessionId)
        throw new RemoteScreenError(
          409,
          "session_capacity_reached",
          "End other remote desktop sessions before you start a test.",
        );
      this.#testSessionId = sessionId;
      try {
        const permissions = await this.#runtime.checkSetup?.();
        if (
          permissions?.screenRecording !== "allowed" ||
          permissions.accessibility !== "allowed" ||
          permissions.guiSession !== "allowed" ||
          permissions.displays !== "allowed" ||
          permissions.restartRequired
        ) {
          throw new RemoteScreenError(
            503,
            "host_permissions_required",
            "Check permissions and the GUI session on the host before starting the test.",
          );
        }
        const status = await this.#runtime?.test?.("start");
        if (!status) throw new RemoteScreenError(404, "session_expired", "Remote control session ended.");
        if (!status.active)
          throw new RemoteScreenError(503, "host_unavailable", "The host could not open the test panel.");
        if (!this.#sessions.has(sessionId)) {
          await this.#runtime?.test?.("stop");
          this.#testSessionId = null;
          throw new RemoteScreenError(404, "session_expired", "Remote control session ended.");
        }
        return status;
      } catch (error) {
        // The request can fail after the panel opened. Keep input contained until cleanup succeeds.
        await this.#runtime?.test?.("stop").then(() => {
          this.#testSessionId = null;
        });
        throw error;
      }
    }
    if (this.#testSessionId !== sessionId) return { active: false, mouse: false, keyboard: false, code: "" };
    const result = await this.#runtime.test(action);
    if (action === "stop") this.#testSessionId = null;
    return result;
  }

  capabilities(): RemoteDesktopCapabilities {
    const displays = this.#availableDisplays();
    return {
      ready: this.#options.platform !== "linux" && Boolean(this.#options.runtimePaths),
      platform: this.#options.platform,
      unattended: this.#options.unattended,
      runtime: "sunshine-moonlight",
      protocolVersion: 2,
      displays: structuredClone(displays),
      selectedDisplayId: this.#selectedDisplayId,
      activeSessions: this.#sessions.size,
      maxSessions: REMOTE_DESKTOP_MAX_SESSIONS,
    };
  }

  list(): RemoteDesktopSession[] {
    return [...this.#sessions.values()].map((session) => structuredClone(session.snapshot));
  }

  async createLocalTestSession(): Promise<RemoteDesktopSession> {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (!this.handlesHttp(url)) {
        response.writeHead(404);
        response.end();
        return;
      }
      void this.handleHttp(request, response, url).catch(() => {
        response.destroy();
      });
    });
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      this.handleUpgrade(request, socket, head, url);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("The local test listener is unavailable.");
      const session = await this.createSession({
        serverId: "local",
        memberId: "local-setup",
        teamSessionId: randomUUID(),
        teamSessionExpiresAt: new Date(Date.now() + 180_000).toISOString(),
        publicHttpBaseUrl: `http://127.0.0.1:${address.port}`,
      });
      this.#localTestServers.set(session.id, server);
      return session;
    } catch (error) {
      server.close();
      throw error;
    }
  }

  testLocalSession(sessionId: string, action: "start" | "status" | "stop") {
    if (!this.#localTestServers.has(sessionId)) throw new Error("Local test session not found.");
    return this.test(sessionId, "local-setup", action);
  }

  async closeLocalTestSession(sessionId: string): Promise<void> {
    if (!this.#localTestServers.has(sessionId)) return;
    await this.closeSession(sessionId);
  }

  async createSession(input: {
    serverId: string;
    memberId: string;
    teamSessionId: string;
    teamSessionExpiresAt: string;
    publicHttpBaseUrl: string;
  }): Promise<RemoteDesktopSession> {
    this.#startingSessions += 1;
    try {
      return await this.#createSession(input);
    } finally {
      this.#startingSessions -= 1;
      if (this.#sessions.size === 0 && !this.#setupCheck && this.#startingSessions === 0) await this.#stopRuntime();
    }
  }

  async #createSession(input: {
    serverId: string;
    memberId: string;
    teamSessionId: string;
    teamSessionExpiresAt: string;
    publicHttpBaseUrl: string;
  }): Promise<RemoteDesktopSession> {
    this.#pruneExpiredGrants();
    if (this.#sessions.size >= REMOTE_DESKTOP_MAX_SESSIONS) {
      throw new RemoteScreenError(429, "session_capacity_reached", "The host already has four active sessions.");
    }
    if (this.#options.platform === "linux") {
      throw new RemoteScreenError(503, "host_unavailable", "Remote desktop hosting is not supported on Linux.");
    }
    if (!this.#options.runtimePaths) {
      throw new RemoteScreenError(
        503,
        "host_unavailable",
        "The Sunshine and Moonlight Web runtime is missing or is not supported on this host. Install the full OpenBot release on an Apple silicon Mac or Windows x64 host, then restart OpenBot.",
      );
    }
    if (this.#testSessionId)
      throw new RemoteScreenError(
        409,
        "session_capacity_reached",
        "A remote desktop test is active. Try again when it ends.",
      );
    await this.#ensureRuntime();
    if (this.#testSessionId)
      throw new RemoteScreenError(
        409,
        "session_capacity_reached",
        "A remote desktop test is active. Try again when it ends.",
      );
    // The runtime starts and answers either way, so this is the only place the refusal can become a
    // failure the member sees. Without it the session is created, the stream never starts, and the
    // viewer sits at "connecting" until the member gives up.
    if (this.#runtime?.screenCaptureDenied?.()) {
      // The createSession lease releases an idle runtime after pending creates settle, so a new
      // grant is read by the next process without stopping an existing member's session.
      this.#reportScreenRecordingDenied(true);
      throw new RemoteScreenError(
        503,
        "host_permissions_required",
        "The host has not allowed OpenBot to record its screen. Grant screen recording on the host, then try again.",
      );
    }
    this.#reportScreenRecordingDenied(false);
    const id = randomUUID();
    const usedStreamerSlots = new Set([...this.#sessions.values()].map((session) => session.streamerSlot));
    const streamerSlot = [1, 2, 3, 4].find((slot) => !usedStreamerSlots.has(slot));
    if (!streamerSlot) {
      throw new RemoteScreenError(429, "session_capacity_reached", "The host already has four active sessions.");
    }
    const viewerGrant = randomBytes(32).toString("base64url");
    const now = this.#options.now();
    const teamSessionExpiresAt = Date.parse(input.teamSessionExpiresAt);
    if (!Number.isFinite(teamSessionExpiresAt) || teamSessionExpiresAt <= now) {
      throw new RemoteScreenError(401, "session_expired", "The team session has expired.");
    }
    const createdAt = new Date(now).toISOString();
    const snapshot: RemoteDesktopSession = {
      id,
      serverId: input.serverId,
      viewerUrl: `${input.publicHttpBaseUrl}${TEAM_API_ROUTES.remoteScreen.viewer(id)}`,
      viewerGrant,
      displays: structuredClone(this.#availableDisplays()),
      selectedDisplayId: this.#selectedDisplayId,
      phase: "connecting",
      transport: "unknown",
      errorCode: null,
      message: "Connecting through Sunshine…",
      createdAt,
      grantExpiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
    };
    const grantExpirationTimer = scheduleDeadline(now + GRANT_TTL_MS, this.#options.now, () => {
      const session = this.#sessions.get(id);
      if (session && !session.viewerGrantUsed) void this.closeSession(id, "session_expired");
    });
    const teamSessionExpirationTimer = scheduleDeadline(
      teamSessionExpiresAt,
      this.#options.now,
      () => void this.closeSession(id, "session_expired"),
    );
    this.#sessions.set(id, {
      snapshot,
      memberId: input.memberId,
      teamSessionId: input.teamSessionId,
      grantExpirationTimer,
      teamSessionExpirationTimer,
      streamerSlot,
      viewerGrantHash: secretHash(viewerGrant),
      viewerGrantUsed: false,
      viewerCookieHash: null,
      clientSocket: null,
      upstreamSocket: null,
    });
    return structuredClone(snapshot);
  }

  async selectDisplay(displayId: string): Promise<void> {
    if (this.#testSessionId)
      throw new RemoteScreenError(
        409,
        "connection_failed",
        "Finish the remote desktop test before switching displays.",
      );
    if (!this.#availableDisplays().some((display) => display.id === displayId)) {
      throw new RemoteScreenError(400, "host_unavailable", "Remote display not found.");
    }
    if (this.#displaySwitching)
      throw new RemoteScreenError(409, "connection_failed", "A display switch is in progress.");
    if (displayId === this.#selectedDisplayId) return;
    this.#displaySwitching = true;
    try {
      for (const session of this.#sessions.values()) {
        session.snapshot.phase = "connecting";
        session.snapshot.message = "Switching the shared monitor…";
      }
      await this.#runtime?.selectDisplay(displayId);
      this.#selectedDisplayId = displayId;
      for (const session of this.#sessions.values()) {
        session.snapshot.selectedDisplayId = displayId;
        session.clientSocket?.close(4410, "display changed");
      }
    } finally {
      this.#displaySwitching = false;
    }
  }

  handlesHttp(url: URL): boolean {
    return /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/(?:viewer|authorize|viewer-state|moonlight(?:\/.*)?)$/.test(
      url.pathname,
    );
  }

  async handleHttp(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const match =
      /^\/v1\/remote-screen\/sessions\/([A-Za-z0-9-]+)\/(viewer|authorize|viewer-state|moonlight(?:\/.*)?)$/.exec(
        url.pathname,
      );
    const session = match ? this.#sessions.get(match[1]) : null;
    if (!session || !match) return sendText(response, 404, "Remote session not found.");
    const route = match[2];
    if (request.method === "GET" && route === "viewer") {
      if (!this.#runtimeState) return sendText(response, 503, "Moonlight runtime is unavailable.");
      return sendViewer(response, session.snapshot.id, session.streamerSlot, this.#runtimeState);
    }
    if (request.method === "POST" && route === "viewer-state") {
      if (!this.#viewerAuthorized(request, session)) return sendText(response, 401, "Remote viewer is not authorized.");
      const update = await readSmallJson(request, viewerStateSchema);
      if (!update || update.sessionId !== session.snapshot.id) {
        return sendText(response, 400, "Remote viewer state is invalid.");
      }
      if (update.state === "connected") recordRestartActivity();
      session.snapshot.phase = update.state;
      session.snapshot.message =
        update.message ??
        (update.state === "connected"
          ? "Remote control connected."
          : update.state === "connecting"
            ? "Connecting through Sunshine…"
            : "Remote control failed.");
      if (update.transport && update.transport !== session.snapshot.transport) {
        session.snapshot.transport = update.transport;
        this.#audit(session, "transport");
      }
      if (update.state === "connected" || update.state === "error") this.#finishStreamStart(session.snapshot.id);
      response.writeHead(204, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (request.method === "POST" && route === "authorize") {
      const body = await readSmallJson(request, viewerGrantSchema);
      const grant = body?.grant ?? "";
      if (
        session.viewerGrantUsed ||
        this.#options.now() >= Date.parse(session.snapshot.grantExpiresAt) ||
        !safeHashEqual(secretHash(grant), session.viewerGrantHash)
      ) {
        return sendText(response, 401, "Remote viewer grant is invalid.");
      }
      const cookie = randomBytes(32).toString("base64url");
      session.viewerGrantUsed = true;
      session.grantExpirationTimer?.cancel();
      session.grantExpirationTimer = null;
      session.viewerCookieHash = secretHash(cookie);
      const cookiePolicy =
        this.#localTestServers.has(session.snapshot.id) || request.headers["x-forwarded-proto"] === "https"
          ? "; Secure; SameSite=None"
          : "; SameSite=Strict";
      response.writeHead(204, {
        "Set-Cookie": `${VIEWER_COOKIE}=${cookie}; HttpOnly${cookiePolicy}; Path=${TEAM_API_ROUTES.remoteScreen.session(session.snapshot.id)}/; Max-Age=86400`,
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    if (!this.#viewerAuthorized(request, session)) return sendText(response, 401, "Remote viewer is not authorized.");
    if (!route.startsWith("moonlight")) return sendText(response, 404, "Remote route not found.");
    const upstreamPath = route.slice("moonlight".length) || "/";
    if (!allowedMoonlightPath(upstreamPath)) return sendText(response, 404, "Moonlight route is not exposed.");
    await this.#proxyHttp(request, response, session, upstreamPath, url.search);
  }

  handlesUpgrade(url: URL): boolean {
    return /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/stream$/.test(url.pathname);
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const match = /^\/v1\/remote-screen\/sessions\/([A-Za-z0-9-]+)\/stream$/.exec(url.pathname);
    const session = match ? this.#sessions.get(match[1]) : null;
    if (!session || !this.#viewerAuthorized(request, session) || !this.#runtimeState || !match) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const authHeader = this.#runtimeState.authHeader;
    this.#webSockets.handleUpgrade(request, socket, head, (client) => {
      const upstreamUrl = new URL("/api/host/stream", this.#runtimeState?.baseUrl);
      upstreamUrl.protocol = "ws:";
      const upstream = new webSockets.WebSocket(upstreamUrl, {
        headers: { [authHeader]: moonlightRuntimeUser(session) },
      });
      const pendingClientFrames: Array<{ data: Ws.RawData; binary: boolean }> = [];
      let pendingClientBytes = 0;
      let streamStartAllowed = false;
      session.clientSocket?.close(4409, "viewer replaced");
      session.upstreamSocket?.close();
      session.clientSocket = client;
      session.upstreamSocket = upstream;
      upstream.once("open", () => {
        this.#queueStreamStart(session.snapshot.id, () => {
          if (
            client.readyState !== webSockets.WebSocket.OPEN ||
            upstream.readyState !== webSockets.WebSocket.OPEN ||
            session.clientSocket !== client
          ) {
            this.#finishStreamStart(session.snapshot.id);
            upstream.close();
            return;
          }
          streamStartAllowed = true;
          for (const frame of pendingClientFrames.splice(0)) upstream.send(frame.data, { binary: frame.binary });
          pendingClientBytes = 0;
          recordRestartActivity();
          session.snapshot.phase = "connected";
          session.snapshot.message = "Remote control connected.";
          this.#audit(session, "started");
        });
      });
      client.on("message", (data, binary) => {
        if (upstream.readyState === webSockets.WebSocket.OPEN && streamStartAllowed) {
          upstream.send(data, { binary });
          return;
        }
        if (
          upstream.readyState !== webSockets.WebSocket.CONNECTING &&
          !(upstream.readyState === webSockets.WebSocket.OPEN && !streamStartAllowed)
        ) {
          return;
        }
        const frameBytes = rawDataSize(data);
        if (
          pendingClientFrames.length >= MAX_PENDING_STREAM_FRAMES ||
          pendingClientBytes + frameBytes > MAX_PENDING_STREAM_BYTES
        ) {
          client.close(1009, "Moonlight stream initialization is too large");
          upstream.close();
          return;
        }
        pendingClientFrames.push({ data, binary });
        pendingClientBytes += frameBytes;
      });
      upstream.on("message", (data, binary) => {
        if (!binary) {
          const message = rawDataText(data);
          if (message.includes("FatalDescription")) {
            this.#options.onDiagnostic?.(
              "moonlight",
              `OpenBot: Moonlight rejected remote session ${session.snapshot.id}: ${message.slice(0, 500)}\n`,
            );
            this.#audit(session, "error", "moonlight_stream_rejected");
          }
        }
        if (client.readyState === webSockets.WebSocket.OPEN) client.send(data, { binary });
      });
      const close = () => {
        this.#finishStreamStart(session.snapshot.id);
        if (session.clientSocket === client) session.clientSocket = null;
        if (session.upstreamSocket === upstream) session.upstreamSocket = null;
        client.close();
        upstream.close();
        if (this.#testSessionId === session.snapshot.id)
          void this.closeSession(session.snapshot.id, "connection_failed");
      };
      client.once("close", close);
      upstream.once("close", close);
      upstream.once("error", () => client.close(1011, "Moonlight stream failed"));
    });
  }

  async closeSession(
    id: string,
    reason: "session_revoked" | "session_expired" | "connection_failed" = "session_revoked",
  ): Promise<void> {
    const session = this.#sessions.get(id);
    if (!session) return;
    this.#sessions.delete(id);
    const localServer = this.#localTestServers.get(id);
    this.#localTestServers.delete(id);
    localServer?.close();
    localServer?.closeAllConnections();
    if (this.#testSessionId === id) {
      await this.#runtime?.test?.("stop").catch(() => undefined);
      this.#testSessionId = null;
    }
    this.#finishStreamStart(id);
    session.grantExpirationTimer?.cancel();
    session.teamSessionExpirationTimer.cancel();
    session.snapshot.phase = "disconnecting";
    session.clientSocket?.close(4403, reason);
    session.upstreamSocket?.close();
    this.#audit(session, "ended", reason);
    if (this.#sessions.size === 0 && !this.#setupCheck && this.#startingSessions === 0) await this.#stopRuntime();
  }

  async closeMemberSession(id: string, memberId: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session || session.memberId !== memberId) return false;
    await this.closeSession(id, "session_revoked");
    return true;
  }

  async revokeTeamSession(teamSessionId: string): Promise<void> {
    await Promise.all(
      [...this.#sessions.entries()]
        .filter(([, session]) => session.teamSessionId === teamSessionId)
        .map(([id]) => this.closeSession(id, "session_revoked")),
    );
  }

  async revokeMember(memberId: string): Promise<void> {
    await Promise.all(
      [...this.#sessions.entries()]
        .filter(([, session]) => session.memberId === memberId)
        .map(([id]) => this.closeSession(id, "session_revoked")),
    );
  }

  async stop(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((id) => this.closeSession(id, "session_revoked")));
    await this.#stopRuntime();
    this.#pendingStreamStarts.splice(0);
    if (this.#activeStreamStart) clearTimeout(this.#activeStreamStart.timeout);
    this.#activeStreamStart = null;
  }

  #queueStreamStart(sessionId: string, start: () => void): void {
    const existing = this.#pendingStreamStarts.findIndex((entry) => entry.sessionId === sessionId);
    if (existing >= 0) this.#pendingStreamStarts.splice(existing, 1);
    this.#pendingStreamStarts.push({ sessionId, start });
    this.#drainStreamStarts();
  }

  #finishStreamStart(sessionId: string): void {
    for (let index = this.#pendingStreamStarts.length - 1; index >= 0; index -= 1) {
      if (this.#pendingStreamStarts[index]?.sessionId === sessionId) this.#pendingStreamStarts.splice(index, 1);
    }
    if (this.#activeStreamStart?.sessionId !== sessionId) return;
    clearTimeout(this.#activeStreamStart.timeout);
    this.#activeStreamStart = null;
    this.#drainStreamStarts();
  }

  #drainStreamStarts(): void {
    if (this.#activeStreamStart) return;
    const next = this.#pendingStreamStarts.shift();
    if (!next) return;
    const timeout = setTimeout(() => this.#finishStreamStart(next.sessionId), 10_000);
    this.#activeStreamStart = { sessionId: next.sessionId, timeout };
    next.start();
  }

  // Both halves together, always: a cleared `#runtimeState` beside a live `#runtime` is what latched
  // the screen capture refusal past the grant that fixed it.
  async #stopRuntime(): Promise<void> {
    if (this.#runtimeStopping) return this.#runtimeStopping;
    const runtime = this.#runtime;
    this.#runtime = null;
    this.#runtimeState = null;
    this.#testSessionId = null;
    this.#runtimeStopping = runtime?.stop() ?? Promise.resolve();
    try {
      await this.#runtimeStopping;
    } finally {
      this.#runtimeStopping = null;
    }
  }

  async #ensureRuntime(): Promise<SunshineMoonlightRuntimeState> {
    if (this.#runtimeStarting) return this.#runtimeStarting;
    this.#runtimeStarting = this.#startRuntime();
    try {
      return await this.#runtimeStarting;
    } finally {
      this.#runtimeStarting = null;
    }
  }

  async #startRuntime(): Promise<SunshineMoonlightRuntimeState> {
    if (this.#runtimeStopping) await this.#runtimeStopping;
    if (this.#runtimeState) return this.#runtimeState;
    const paths = this.#options.runtimePaths;
    if (!paths || this.#options.platform === "linux") throw new Error("Remote desktop runtime is not available.");
    this.#runtime ??= this.#options.createRuntime({
      paths,
      stateDirectory: this.#options.runtimeStateDirectory,
      platform: this.#options.platform,
      credentials: await this.#options.getRuntimeCredentials(),
      getDisplays: () => this.#options.getDisplays?.() ?? [],
      getIceServers: async () => {
        // Loopback tests need no account or Signal service. Keep remote ICE configuration
        // whenever a remote session shares this runtime.
        if (this.#sessions.size > 0 && [...this.#sessions.keys()].every((id) => this.#localTestServers.has(id)))
          return [];
        return this.#options.getIceServers();
      },
      onDiagnostic: this.#options.onDiagnostic,
    });
    this.#runtimeState = await this.#runtime.start();
    this.#selectedDisplayId = this.#runtimeState.selectedDisplayId;
    return this.#runtimeState;
  }

  #reportScreenRecordingDenied(denied: boolean): void {
    if (this.#screenRecordingDenied === denied) return;
    this.#screenRecordingDenied = denied;
    this.#options.onScreenRecordingDenied?.(denied);
  }

  #availableDisplays(): RemoteDesktopDisplay[] {
    return this.#runtimeState?.displays ?? this.#options.getDisplays?.() ?? [];
  }

  async #proxyHttp(
    request: IncomingMessage,
    response: ServerResponse,
    session: ManagedRemoteScreenSession,
    upstreamPath: string,
    search: string,
  ): Promise<void> {
    if (!this.#runtimeState) return sendText(response, 503, "Moonlight runtime is unavailable.");
    if (upstreamPath === "/config.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(
        `export default ${JSON.stringify({ path_prefix: `${TEAM_API_ROUTES.remoteScreen.session(session.snapshot.id)}/moonlight` })}`,
      );
      return;
    }
    const target = new URL(`${upstreamPath}${search}`, this.#runtimeState.baseUrl);
    const authHeader = this.#runtimeState.authHeader;
    await new Promise<void>((resolve) => {
      const upstream = httpRequest(
        target,
        {
          method: request.method,
          headers: {
            accept: request.headers.accept ?? "*/*",
            "content-type": request.headers["content-type"] ?? "application/octet-stream",
            [authHeader]: moonlightRuntimeUser(session),
          },
        },
        (upstreamResponse) => {
          const headers = { ...upstreamResponse.headers };
          delete headers["set-cookie"];
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          upstreamResponse.pipe(response);
          upstreamResponse.once("end", resolve);
        },
      );
      upstream.once("error", () => {
        sendText(response, 502, "Moonlight runtime request failed.");
        resolve();
      });
      request.pipe(upstream);
    });
  }

  #viewerAuthorized(request: IncomingMessage, session: ManagedRemoteScreenSession): boolean {
    const remoteSession = request.headers["x-openbot-webrtc-session"];
    if (remoteSession === session.teamSessionId) return true;
    const cookie = parseCookie(request.headers.cookie, VIEWER_COOKIE);
    return Boolean(cookie && session.viewerCookieHash && safeHashEqual(secretHash(cookie), session.viewerCookieHash));
  }

  #audit(session: ManagedRemoteScreenSession, event: RemoteScreenAuditEvent["event"], reason?: string): void {
    this.#options.audit({
      event,
      sessionId: session.snapshot.id,
      memberId: session.memberId,
      transport: session.snapshot.transport,
      monitorId: session.snapshot.selectedDisplayId,
      ...(reason ? { reason } : {}),
      timestamp: new Date(this.#options.now()).toISOString(),
    });
  }

  #pruneExpiredGrants(): void {
    const now = this.#options.now();
    for (const [id, session] of this.#sessions) {
      if (!session.viewerGrantUsed && now >= Date.parse(session.snapshot.grantExpiresAt)) {
        void this.closeSession(id, "session_expired");
      }
    }
  }
}

export class RemoteScreenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function sendViewer(
  response: ServerResponse,
  sessionId: string,
  streamerSlot: number,
  runtime: SunshineMoonlightRuntimeState,
): void {
  const sessionPath = TEAM_API_ROUTES.remoteScreen.session(sessionId);
  const hostId = runtime.hostIds[streamerSlot - 1] ?? runtime.hostId;
  const target = `${sessionPath}/moonlight/stream.html?hostId=${hostId}&appId=${runtime.desktopAppId}`;
  const html = `<!doctype html><meta charset="utf-8"><title>OpenBot Moonlight Remote</title><meta name="color-scheme" content="dark"><style>html,body{margin:0;width:100%;height:100%;background:#090b0c;color:#fff;font:14px system-ui}main{display:grid;place-items:center;height:100%}</style><main>Connecting…</main><script type="module">const grant=new URL(location.href).hash.slice(1);history.replaceState(null,"",location.pathname);const response=await fetch(${JSON.stringify(`${sessionPath}/authorize`)},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grant})});if(!response.ok){document.querySelector("main").textContent="Remote access expired";throw new Error("grant rejected")}location.replace(${JSON.stringify(target)});</script>`;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function allowedMoonlightPath(path: string): boolean {
  if (path === "/api/authenticate" || path === "/api/role") return true;
  if (
    path === "/" ||
    path === "/index.html" ||
    path === "/index.js" ||
    path === "/admin.html" ||
    path === "/admin.js"
  ) {
    return false;
  }
  return !path.startsWith("/api/") && !path.includes("..") && /^\/[A-Za-z0-9_./-]*$/.test(path);
}

function rawDataSize(data: Ws.RawData): number {
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0);
  return data.byteLength;
}

function rawDataText(data: Ws.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}

function moonlightRuntimeUser(session: ManagedRemoteScreenSession): string {
  return `openbot-remote-slot-${session.streamerSlot}`;
}

async function readSmallJson<T>(request: IncomingMessage, schema: z.ZodType<T>): Promise<T | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) throw new RemoteScreenError(413, "connection_failed", "Viewer authorization is too large.");
    chunks.push(bytes);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    return null;
  }
}

function sendText(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(message);
}

function parseCookie(header: string | undefined, name: string): string | null {
  for (const item of header?.split(";") ?? []) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function secretHash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeHashEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function scheduleDeadline(deadline: number, now: () => number, onExpire: () => void): CancellableTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const schedule = () => {
    if (cancelled) return;
    const remaining = deadline - now();
    if (remaining <= 0) {
      onExpire();
      return;
    }
    timer = setTimeout(schedule, Math.min(remaining, MAX_TIMER_DELAY_MS));
    timer.unref?.();
  };
  schedule();
  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
