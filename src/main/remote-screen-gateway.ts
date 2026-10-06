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
import { sourceText } from "@openbot/i18n/source";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Result, Schema, Scope } from "effect";
import type * as Ws from "ws";
import { z } from "zod";
import { runCauseEffect } from "../backend/effect-boundary";
import { recordRestartActivity } from "../backend/restart-activity";
import { readBodyWithin } from "./http-body";
import { RemoteDesktopOperationError } from "./remote-desktop-effects";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import {
  RemoteRuntimeStartError,
  type RemoteRuntimeStartStage,
  SunshineApiError,
  SunshineMoonlightRuntime,
  type SunshineMoonlightRuntimeState,
} from "./sunshine-moonlight-runtime";
import { rawDataSize, rawDataText } from "./ws-raw-data";

const GRANT_TTL_MS = 60_000;
const REMOTE_DESKTOP_MAX_SESSIONS = 4;
const VIEWER_COOKIE = "openbotRemoteViewer";
const MAX_PENDING_STREAM_FRAMES = 32;
const MAX_PENDING_STREAM_BYTES = 1_048_576;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const RUNTIME_START_FAILURE = {
  sunshine: "error.remote.sunshineStartFailed",
  moonlight: "error.remote.moonlightStartFailed",
  pairing: "error.remote.pairingFailed",
} as const satisfies Record<RemoteRuntimeStartStage, string>;
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
  // Read for a Linux host only. Defaults to the environment of this process.
  sessionEnvironment?: Readonly<Record<string, string | undefined>>;
  unattended: boolean;
  runtimePaths: RemoteDesktopRuntimePaths | null;
  runtimeStateDirectory: string;
  getRuntimeCredentials: () => Effect.Effect<{ username: string; password: string }, RemoteWorkflowError>;
  getDisplays?: () => RemoteDesktopDisplay[];
  getIceServers: () => Effect.Effect<RemoteDesktopIceServer[], RemoteWorkflowError>;
  createRuntime?: RemoteScreenGatewayCreateRuntime;
  audit?: (event: RemoteScreenAuditEvent) => void;
  now?: () => number;
  onDiagnostic?: (source: "sunshine" | "moonlight", message: string) => void;
  // Called only when the answer changes, so the host owner's screen can show the one refusal a
  // member cannot act on themselves -- and stop showing it once a member gets through.
  onScreenRecordingDenied?: (denied: boolean) => void;
}

export interface RemoteScreenRuntime {
  start: SunshineMoonlightRuntime["start"];
  selectDisplay: SunshineMoonlightRuntime["selectDisplay"];
  stop: SunshineMoonlightRuntime["stop"];
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

class ScreenDependencies extends Context.Service<
  ScreenDependencies,
  {
    credentials(): Effect.Effect<{ username: string; password: string }, RemoteWorkflowError>;
    iceServers(): Effect.Effect<RemoteDesktopIceServer[], RemoteWorkflowError>;
  }
>()("openbot/main/ScreenDependencies") {
  static layer(options: RemoteScreenGatewayOptions) {
    return Layer.succeed(
      ScreenDependencies,
      ScreenDependencies.of({
        credentials: options.getRuntimeCredentials,
        iceServers: options.getIceServers,
      }),
    );
  }
}

export class RemoteScreenGateway {
  readonly #options: Required<Pick<RemoteScreenGatewayOptions, "createRuntime" | "audit" | "now">> &
    Omit<RemoteScreenGatewayOptions, "createRuntime" | "audit" | "now">;
  readonly #webSockets = new webSockets.WebSocketServer({ noServer: true });
  readonly #localTestServers = new Map<string, Server>();
  readonly #sessions = new Map<string, ManagedRemoteScreenSession>();
  readonly #pendingStreamStarts: Array<{ sessionId: string; start: () => void }> = [];
  readonly #layer: Layer.Layer<ScreenDependencies>;
  #scope = Scope.makeUnsafe();
  readonly #operations = new Set<Deferred.Deferred<void>>();
  readonly #httpRequests = new Set<IncomingMessage>();
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  #runtime: RemoteScreenRuntime | null = null;
  #runtimeState: SunshineMoonlightRuntimeState | null = null;
  #runtimeStarting: Fiber.Fiber<SunshineMoonlightRuntimeState, RemoteWorkflowError> | null = null;
  #runtimeStopping: Fiber.Fiber<void, RemoteWorkflowError> | null = null;
  #setupCheck: Fiber.Fiber<RemoteDesktopSetupStatus, RemoteWorkflowError> | null = null;
  #startingSessions = 0;
  #testSessionId: string | null = null;
  #selectedDisplayId: string | null = null;
  #displaySwitching = false;
  // Sticky, unlike the runtime's own answer: the refusal below drops the runtime that reported it, so
  // nothing would be left to ask by the time the host owner looks.
  #screenRecordingDenied = false;
  #activeStreamStart: { sessionId: string; timeout: ReturnType<typeof setTimeout> } | null = null;
  #linuxWithoutX11: boolean;

  constructor(options: RemoteScreenGatewayOptions) {
    this.#options = {
      ...options,
      createRuntime: options.createRuntime ?? ((runtimeOptions) => new SunshineMoonlightRuntime(runtimeOptions)),
      audit: options.audit ?? (() => undefined),
      now: options.now ?? Date.now,
    };
    this.#layer = ScreenDependencies.layer(options);
    this.#linuxWithoutX11 = options.platform === "linux" && !isX11Session(options.sessionEnvironment ?? process.env);
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

  readonly recheckScreenRecording = Effect.fn("RemoteScreenGateway.recheckScreenRecording")(
    function* (this: RemoteScreenGateway): Effect.fn.Return<boolean, RemoteWorkflowError> {
      if (this.#linuxWithoutX11 || !this.#options.runtimePaths) return this.#screenRecordingDenied;
      yield* this.#ensureRuntime();
      const denied = Boolean(this.#runtime?.screenCaptureDenied?.());
      this.#reportScreenRecordingDenied(denied);
      if (this.#sessions.size === 0 && !this.#setupCheck && this.#startingSessions === 0) yield* this.#stopRuntime();
      return denied;
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly checkSetup = Effect.fn("RemoteScreenGateway.checkSetup")(
    function* (this: RemoteScreenGateway) {
      if (this.#setupCheck) return yield* Fiber.join(this.#setupCheck);
      const fiber = yield* Effect.forkIn(this.#performSetup(), this.#scope, { startImmediately: false });
      this.#setupCheck = fiber;
      fiber.addObserver(() => {
        if (this.#setupCheck === fiber) this.#setupCheck = null;
      });
      return yield* Fiber.join(fiber);
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly #performSetup = Effect.fn("RemoteScreenGateway.checkSetup")(function* (
    this: RemoteScreenGateway,
  ): Effect.fn.Return<RemoteDesktopSetupStatus, RemoteWorkflowError> {
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
          ? sourceText("status.remote.setupMacOnly")
          : sourceText("status.remote.setupInstallHost");
      return result;
    }
    yield* Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen({ self: this }, function* () {
          const attempt0 = yield* Effect.gen({ self: this }, function* () {
            yield* this.#ensureRuntime();
            result.service = "allowed";
            if (!this.#runtime?.checkSetup) {
              result.message = sourceText("status.remote.setupUpdateRuntime");
              return result;
            }
            const attempt1 = yield* Effect.gen({ self: this }, function* () {
              const runtime = this.#runtime;
              const check = runtime?.checkSetup;
              if (check)
                Object.assign(
                  result,
                  yield* check
                    .call(runtime)
                    .pipe(
                      Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })),
                    ),
                );
              this.#reportScreenRecordingDenied(result.screenRecording === "blocked");
            }).pipe(Effect.result);
            if (Result.isFailure(attempt1)) {
              const error = attempt1.failure.cause;
              const unavailable = error instanceof SunshineApiError && error.status === 404;
              result.screenRecording =
                result.accessibility =
                result.guiSession =
                result.displays =
                  unavailable ? "unavailable" : "failed";
              result.message = unavailable
                ? sourceText("status.remote.setupUpdateRuntime")
                : sourceText("status.remote.setupCheckFailed");
            }
          }).pipe(Effect.result);
          if (Result.isFailure(attempt0)) {
            result.service = "failed";
            result.message = sourceText("status.remote.setupServiceFailed");
          } else if (attempt0.success !== undefined) return attempt0.success;
        }),
      () =>
        Effect.gen({ self: this }, function* () {
          result.activeSessions = this.#sessions.size;
          if (this.#sessions.size === 0 && this.#startingSessions === 0) yield* this.#stopRuntime();
        }),
    );
    return result;
  });

  readonly test = Effect.fn("RemoteScreenGateway.test")(
    function* (
      this: RemoteScreenGateway,
      sessionId: string,
      memberId: string,
      action: "start" | "status" | "stop",
    ): Effect.fn.Return<RemoteDesktopTestStatus, RemoteWorkflowError> {
      const session = this.#sessions.get(sessionId);
      if (!session || session.memberId !== memberId)
        return yield* new RemoteWorkflowError({
          cause: new RemoteScreenError(404, "session_expired", sourceText("error.remote.controlSessionNotFound")),
        });
      if (this.#options.platform !== "darwin" || !this.#runtime?.test)
        return yield* new RemoteWorkflowError({
          cause: new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.testRuntimeUpdate")),
        });
      if (action === "start") {
        if (this.#sessions.size !== 1 || this.#startingSessions > 0 || this.#displaySwitching || this.#testSessionId)
          return yield* new RemoteWorkflowError({
            cause: new RemoteScreenError(409, "session_capacity_reached", sourceText("error.remote.testOtherSessions")),
          });
        this.#testSessionId = sessionId;
        const attempt2 = yield* Effect.gen({ self: this }, function* () {
          const permissions = yield* (this.#runtime?.checkSetup?.() ?? Effect.succeed(undefined)).pipe(
            Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })),
          );
          if (
            permissions?.screenRecording !== "allowed" ||
            permissions.accessibility !== "allowed" ||
            permissions.guiSession !== "allowed" ||
            permissions.displays !== "allowed" ||
            permissions.restartRequired
          ) {
            return yield* new RemoteWorkflowError({
              cause: new RemoteScreenError(
                503,
                "host_permissions_required",
                sourceText("error.remote.testPermissions"),
              ),
            });
          }
          const status = yield* (this.#runtime?.test?.("start") ?? Effect.succeed(undefined)).pipe(
            Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })),
          );
          if (!status)
            return yield* new RemoteWorkflowError({
              cause: new RemoteScreenError(404, "session_expired", sourceText("error.remote.controlSessionEnded")),
            });
          if (!status.active)
            return yield* new RemoteWorkflowError({
              cause: new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.testPanelFailed")),
            });
          if (!this.#sessions.has(sessionId)) {
            yield* (this.#runtime?.test?.("stop") ?? Effect.succeed(undefined)).pipe(
              Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })),
            );
            this.#testSessionId = null;
            return yield* new RemoteWorkflowError({
              cause: new RemoteScreenError(404, "session_expired", sourceText("error.remote.controlSessionEnded")),
            });
          }
          return status;
        }).pipe(Effect.result);
        if (Result.isFailure(attempt2)) {
          const error = attempt2.failure.cause;
          // The request can fail after the panel opened. Keep input contained until cleanup succeeds.
          yield* (this.#runtime?.test?.("stop") ?? Effect.succeed(undefined))
            .pipe(Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })))
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  this.#testSessionId = null;
                }),
              ),
            );
          return yield* new RemoteWorkflowError({ cause: error });
        } else if (attempt2.success !== undefined) return attempt2.success;
      }
      if (this.#testSessionId !== sessionId) return { active: false, mouse: false, keyboard: false, code: "" };
      const runtime = this.#runtime;
      const test = runtime?.test;
      if (!test)
        return yield* new RemoteWorkflowError({
          cause: new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.testRuntimeUpdate")),
        });
      const result = yield* test
        .call(runtime, action)
        .pipe(Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })));
      if (action === "stop") this.#testSessionId = null;
      return result;
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  capabilities(): RemoteDesktopCapabilities {
    const displays = this.#availableDisplays();
    return {
      ready: !this.#linuxWithoutX11 && Boolean(this.#options.runtimePaths),
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

  readonly createLocalTestSession = Effect.fn("RemoteScreenGateway.createLocalTestSession")(
    function* (this: RemoteScreenGateway): Effect.fn.Return<RemoteDesktopSession, RemoteWorkflowError> {
      const server = createServer((request, response) => {
        let url: URL;
        try {
          url = new URL(request.url ?? "/", "http://127.0.0.1");
        } catch {
          response.writeHead(400).end();
          return;
        }
        if (!this.handlesHttp(url)) {
          response.writeHead(404);
          response.end();
          return;
        }
        void runCauseEffect(this.handleHttp(request, response, url)).catch(() => {
          response.destroy();
        });
      });
      server.on("upgrade", (request, socket, head) => {
        let url: URL;
        try {
          url = new URL(request.url ?? "/", "http://127.0.0.1");
        } catch {
          socket.destroy();
          return;
        }
        this.handleUpgrade(request, socket, head, url);
      });
      return yield* Effect.gen({ self: this }, function* () {
        yield* remoteCall(
          () =>
            new Promise<void>((resolve, reject) => {
              server.once("error", reject);
              server.listen(0, "127.0.0.1", resolve);
            }),
        );
        const address = server.address();
        if (!address || typeof address === "string")
          return yield* new RemoteWorkflowError({
            cause: new Error(sourceText("error.remote.localTestListenerUnavailable")),
          });
        const session = yield* this.createSession({
          serverId: "local",
          memberId: "local-setup",
          teamSessionId: randomUUID(),
          teamSessionExpiresAt: new Date(Date.now() + 180_000).toISOString(),
          publicHttpBaseUrl: `http://127.0.0.1:${address.port}`,
        });
        this.#localTestServers.set(session.id, server);
        return session;
      }).pipe(
        Effect.catch(({ cause: error }) =>
          Effect.gen({ self: this }, function* () {
            server.close();
            return yield* new RemoteWorkflowError({ cause: error });
          }),
        ),
      );
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly testLocalSession = Effect.fn("RemoteScreenGateway.testLocalSession")(function* (
    this: RemoteScreenGateway,
    sessionId: string,
    action: "start" | "status" | "stop",
  ) {
    if (!this.#localTestServers.has(sessionId))
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.localTestNotFound")) });
    return yield* this.test(sessionId, "local-setup", action);
  }).bind(this);

  readonly closeLocalTestSession = Effect.fn("RemoteScreenGateway.closeLocalTestSession")(
    function* (this: RemoteScreenGateway, sessionId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      if (!this.#localTestServers.has(sessionId)) return;
      yield* this.closeSession(sessionId);
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly createSession = Effect.fn("RemoteScreenGateway.createSession")(
    function* (
      this: RemoteScreenGateway,
      input: {
        serverId: string;
        memberId: string;
        teamSessionId: string;
        teamSessionExpiresAt: string;
        publicHttpBaseUrl: string;
      },
    ): Effect.fn.Return<RemoteDesktopSession, RemoteWorkflowError> {
      if (this.#stopping)
        return yield* new RemoteWorkflowError({
          cause: new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.runtimeUnavailable")),
        });
      this.#startingSessions += 1;
      return yield* Effect.acquireUseRelease(
        Effect.void,
        () =>
          Effect.gen({ self: this }, function* () {
            return yield* this.#createSession(input);
          }),
        () =>
          Effect.gen({ self: this }, function* () {
            this.#startingSessions -= 1;
            if (this.#sessions.size === 0 && !this.#setupCheck && this.#startingSessions === 0)
              yield* this.#stopRuntime();
          }),
      );
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly #createSession = Effect.fn("RemoteScreenGateway.createSession")(function* (
    this: RemoteScreenGateway,
    input: {
      serverId: string;
      memberId: string;
      teamSessionId: string;
      teamSessionExpiresAt: string;
      publicHttpBaseUrl: string;
    },
  ): Effect.fn.Return<RemoteDesktopSession, RemoteWorkflowError> {
    this.#pruneExpiredGrants();
    if (this.#sessions.size >= REMOTE_DESKTOP_MAX_SESSIONS) {
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(429, "session_capacity_reached", sourceText("error.remote.sessionCapacity")),
      });
    }
    if (this.#linuxWithoutX11) {
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.linuxNeedsX11")),
      });
    }
    if (!this.#options.runtimePaths) {
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.runtimeMissing")),
      });
    }
    if (this.#testSessionId)
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(409, "session_capacity_reached", sourceText("error.remote.testActive")),
      });
    yield* this.#ensureRuntime().pipe(
      Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause: this.#runtimeStartRefusal(cause) })),
    );
    if (this.#testSessionId)
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(409, "session_capacity_reached", sourceText("error.remote.testActive")),
      });
    // The runtime starts and answers either way, so this is the only place the refusal can become a
    // failure the member sees. Without it the session is created, the stream never starts, and the
    // viewer sits at "connecting" until the member gives up.
    if (this.#runtime?.screenCaptureDenied?.()) {
      // The createSession lease releases an idle runtime after pending creates settle, so a new
      // grant is read by the next process without stopping an existing member's session.
      this.#reportScreenRecordingDenied(true);
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(
          503,
          "host_permissions_required",
          sourceText("error.remote.screenRecordingDenied"),
        ),
      });
    }
    this.#reportScreenRecordingDenied(false);
    const id = randomUUID();
    const usedStreamerSlots = new Set([...this.#sessions.values()].map((session) => session.streamerSlot));
    const streamerSlot = [1, 2, 3, 4].find((slot) => !usedStreamerSlots.has(slot));
    if (!streamerSlot) {
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(429, "session_capacity_reached", sourceText("error.remote.sessionCapacity")),
      });
    }
    const viewerGrant = randomBytes(32).toString("base64url");
    const now = this.#options.now();
    const teamSessionExpiresAt = Date.parse(input.teamSessionExpiresAt);
    if (!Number.isFinite(teamSessionExpiresAt) || teamSessionExpiresAt <= now) {
      return yield* new RemoteWorkflowError({
        cause: new RemoteScreenError(401, "session_expired", sourceText("error.remote.teamSessionExpired")),
      });
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
      message: sourceText("status.remote.connectingSunshine"),
      createdAt,
      grantExpiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
    };
    const grantExpirationTimer = scheduleDeadline(now + GRANT_TTL_MS, this.#options.now, () => {
      const session = this.#sessions.get(id);
      if (session && !session.viewerGrantUsed) Effect.runFork(this.closeSession(id, "session_expired"));
    });
    const teamSessionExpirationTimer = scheduleDeadline(teamSessionExpiresAt, this.#options.now, () =>
      Effect.runFork(this.closeSession(id, "session_expired")),
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
  });

  readonly selectDisplay = Effect.fn("RemoteScreenGateway.selectDisplay")(
    function* (this: RemoteScreenGateway, displayId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      if (this.#testSessionId)
        return yield* new RemoteWorkflowError({
          cause: new RemoteScreenError(409, "connection_failed", sourceText("error.remote.finishTestBeforeSwitch")),
        });
      if (!this.#availableDisplays().some((display) => display.id === displayId)) {
        return yield* new RemoteWorkflowError({
          cause: new RemoteScreenError(400, "host_unavailable", sourceText("error.remote.displayNotFound")),
        });
      }
      if (this.#displaySwitching)
        return yield* new RemoteWorkflowError({
          cause: new RemoteScreenError(409, "connection_failed", sourceText("error.remote.displaySwitchInProgress")),
        });
      if (displayId === this.#selectedDisplayId) return;
      this.#displaySwitching = true;
      return yield* Effect.acquireUseRelease(
        Effect.void,
        () =>
          Effect.gen({ self: this }, function* () {
            for (const session of this.#sessions.values()) {
              session.snapshot.phase = "connecting";
              session.snapshot.message = sourceText("status.remote.switchingMonitor");
            }
            yield* (this.#runtime?.selectDisplay(displayId) ?? Effect.void).pipe(
              Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })),
            );
            this.#selectedDisplayId = displayId;
            for (const session of this.#sessions.values()) {
              session.snapshot.selectedDisplayId = displayId;
              session.clientSocket?.close(4410, "display changed");
            }
          }),
        () =>
          Effect.sync(() => {
            this.#displaySwitching = false;
          }),
      );
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  handlesHttp(url: URL): boolean {
    return /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/(?:viewer|authorize|viewer-state|moonlight(?:\/.*)?)$/.test(
      url.pathname,
    );
  }

  readonly handleHttp = Effect.fn("RemoteScreenGateway.handleHttp")(
    function* (
      this: RemoteScreenGateway,
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
    ): Effect.fn.Return<void, RemoteWorkflowError> {
      const [, sessionId, route] =
        /^\/v1\/remote-screen\/sessions\/([A-Za-z0-9-]+)\/(viewer|authorize|viewer-state|moonlight(?:\/.*)?)$/.exec(
          url.pathname,
        ) ?? [];
      const session = sessionId === undefined ? null : this.#sessions.get(sessionId);
      if (!session || route === undefined) return sendText(response, 404, "Remote session not found.");
      if (request.method === "GET" && route === "viewer") {
        if (!this.#runtimeState) return sendText(response, 503, "Moonlight runtime is unavailable.");
        return sendViewer(response, session.snapshot.id, session.streamerSlot, this.#runtimeState);
      }
      if (request.method === "POST" && route === "viewer-state") {
        if (!this.#viewerAuthorized(request, session))
          return sendText(response, 401, "Remote viewer is not authorized.");
        const update = yield* remoteCall(() => readSmallJson(request, viewerStateSchema));
        if (!update || update.sessionId !== session.snapshot.id) {
          return sendText(response, 400, "Remote viewer state is invalid.");
        }
        if (update.state === "connected") recordRestartActivity();
        session.snapshot.phase = update.state;
        session.snapshot.message =
          update.message ??
          (update.state === "connected"
            ? sourceText("status.remote.controlConnected")
            : update.state === "connecting"
              ? sourceText("status.remote.connectingSunshine")
              : sourceText("status.remote.controlFailed"));
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
        const body = yield* remoteCall(() => readSmallJson(request, viewerGrantSchema));
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
      yield* this.#proxyHttpEffect(request, response, session, upstreamPath, url.search);
    },
    (operation, request) =>
      Effect.suspend(() => {
        this.#httpRequests.add(request);
        return this.#provide(operation).pipe(Effect.ensuring(Effect.sync(() => this.#httpRequests.delete(request))));
      }),
  ).bind(this);

  handlesUpgrade(url: URL): boolean {
    return /^\/v1\/remote-screen\/sessions\/[A-Za-z0-9-]+\/stream$/.test(url.pathname);
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const [, sessionId] = /^\/v1\/remote-screen\/sessions\/([A-Za-z0-9-]+)\/stream$/.exec(url.pathname) ?? [];
    const session = sessionId === undefined ? null : this.#sessions.get(sessionId);
    if (!session || !this.#viewerAuthorized(request, session) || !this.#runtimeState) {
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
          session.snapshot.message = sourceText("status.remote.controlConnected");
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
          Effect.runFork(this.closeSession(session.snapshot.id, "connection_failed"));
      };
      client.once("close", close);
      upstream.once("close", close);
      upstream.once("error", () => client.close(1011, "Moonlight stream failed"));
    });
  }

  readonly closeSession = Effect.fn("RemoteScreenGateway.closeSession")(
    function* (
      this: RemoteScreenGateway,
      id: string,
      reason: "session_revoked" | "session_expired" | "connection_failed" = "session_revoked",
    ): Effect.fn.Return<void, RemoteWorkflowError> {
      const session = this.#sessions.get(id);
      if (!session) return;
      this.#sessions.delete(id);
      const localServer = this.#localTestServers.get(id);
      this.#localTestServers.delete(id);
      localServer?.close();
      localServer?.closeAllConnections();
      if (this.#testSessionId === id) {
        yield* (this.#runtime?.test?.("stop") ?? Effect.succeed(undefined))
          .pipe(Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })))
          .pipe(Effect.catch(() => Effect.void));
        this.#testSessionId = null;
      }
      this.#finishStreamStart(id);
      session.grantExpirationTimer?.cancel();
      session.teamSessionExpirationTimer.cancel();
      session.snapshot.phase = "disconnecting";
      session.clientSocket?.close(4403, reason);
      session.upstreamSocket?.close();
      this.#audit(session, "ended", reason);
      if (this.#sessions.size === 0 && !this.#setupCheck && this.#startingSessions === 0) yield* this.#stopRuntime();
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly closeMemberSession = Effect.fn("RemoteScreenGateway.closeMemberSession")(
    function* (
      this: RemoteScreenGateway,
      id: string,
      memberId: string,
    ): Effect.fn.Return<boolean, RemoteWorkflowError> {
      const session = this.#sessions.get(id);
      if (!session || session.memberId !== memberId) return false;
      yield* this.closeSession(id, "session_revoked");
      return true;
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly revokeTeamSession = Effect.fn("RemoteScreenGateway.revokeTeamSession")(
    function* (this: RemoteScreenGateway, teamSessionId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* Effect.all(
        [...this.#sessions.entries()]
          .filter(([, session]) => session.teamSessionId === teamSessionId)
          .map(([id]) => this.closeSession(id, "session_revoked")),
        { concurrency: "unbounded" },
      );
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly revokeMember = Effect.fn("RemoteScreenGateway.revokeMember")(
    function* (this: RemoteScreenGateway, memberId: string): Effect.fn.Return<void, RemoteWorkflowError> {
      yield* Effect.all(
        [...this.#sessions.entries()]
          .filter(([, session]) => session.memberId === memberId)
          .map(([id]) => this.closeSession(id, "session_revoked")),
        { concurrency: "unbounded" },
      );
    },
    (operation) => this.#provide(operation),
  ).bind(this);

  readonly stop = Effect.fn("RemoteScreenGateway.stop")(function* (this: RemoteScreenGateway) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const stopped = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = stopped;
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#stopSessions();
      for (const request of this.#httpRequests) request.destroy();
      while (this.#operations.size > 0) {
        yield* Effect.all([...this.#operations].map(Deferred.await), { concurrency: "unbounded" });
      }
      yield* Fiber.awaitAll(
        [this.#setupCheck, this.#runtimeStarting, this.#runtimeStopping].filter((fiber) => fiber !== null),
      );
      yield* this.#stopSessions();
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          yield* Scope.close(this.#scope, Exit.void);
          this.#scope = Scope.makeUnsafe();
        }),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          Deferred.doneUnsafe(stopped, exit);
          this.#stopping = null;
        }),
      ),
    );
  }, Effect.uninterruptible).bind(this);

  readonly #stopSessions = Effect.fn("RemoteScreenGateway.stop")(function* (
    this: RemoteScreenGateway,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    yield* Effect.all(
      [...this.#sessions.keys()].map((id) => this.closeSession(id, "session_revoked")),
      { concurrency: "unbounded" },
    );
    yield* this.#stopRuntime();
    this.#pendingStreamStarts.splice(0);
    if (this.#activeStreamStart) clearTimeout(this.#activeStreamStart.timeout);
    this.#activeStreamStart = null;
  });

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
  readonly #stopRuntime = Effect.fn("RemoteScreenGateway.stopRuntime")(function* (this: RemoteScreenGateway) {
    if (this.#runtimeStopping) return yield* Fiber.join(this.#runtimeStopping);
    const runtime = this.#runtime;
    this.#runtime = null;
    this.#runtimeState = null;
    this.#testSessionId = null;
    if (!runtime) return;
    const fiber = yield* Effect.forkIn(
      runtime
        .stop()
        .pipe(Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause }))),
      this.#scope,
      { startImmediately: false },
    );
    this.#runtimeStopping = fiber;
    fiber.addObserver(() => {
      if (this.#runtimeStopping === fiber) this.#runtimeStopping = null;
    });
    yield* Fiber.join(fiber);
  });

  readonly #ensureRuntime = Effect.fn("RemoteScreenGateway.ensureRuntime")(function* (this: RemoteScreenGateway) {
    if (this.#runtimeStarting) return yield* Fiber.join(this.#runtimeStarting);
    const fiber = yield* Effect.forkIn(this.#startRuntime().pipe(Effect.provide(this.#layer)), this.#scope, {
      startImmediately: false,
    });
    this.#runtimeStarting = fiber;
    fiber.addObserver(() => {
      if (this.#runtimeStarting === fiber) this.#runtimeStarting = null;
    });
    return yield* Fiber.join(fiber);
  });

  readonly #startRuntime = Effect.fn("RemoteScreenGateway.startRuntime")(function* (
    this: RemoteScreenGateway,
  ): Effect.fn.Return<SunshineMoonlightRuntimeState, RemoteWorkflowError, ScreenDependencies> {
    const stopping = this.#runtimeStopping;
    if (stopping) yield* Fiber.join(stopping);
    if (this.#runtimeState) return this.#runtimeState;
    const paths = this.#options.runtimePaths;
    if (!paths || this.#linuxWithoutX11)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.runtimeUnavailable")) });
    const dependencies = yield* ScreenDependencies;
    if (!this.#runtime) {
      const runtime: RemoteScreenRuntime = this.#options.createRuntime({
        paths,
        stateDirectory: this.#options.runtimeStateDirectory,
        platform: this.#options.platform,
        credentials: yield* dependencies.credentials(),
        getDisplays: () => this.#options.getDisplays?.() ?? [],
        getIceServers: () =>
          Effect.gen({ self: this }, function* () {
            // Loopback tests need no account or Signal service. Keep remote ICE configuration
            // whenever a remote session shares this runtime.
            if (this.#sessions.size > 0 && [...this.#sessions.keys()].every((id) => this.#localTestServers.has(id)))
              return [];
            return yield* dependencies.iceServers();
          }).pipe(Effect.mapError(({ cause }) => new RemoteDesktopOperationError({ cause }))),
        onDiagnostic: this.#options.onDiagnostic,
        onExit: () => {
          if (this.#runtime === runtime) Effect.runFork(this.#provide(this.#runtimeExited()));
        },
      });
      this.#runtime = runtime;
    }
    const runtime = this.#runtime;
    this.#runtimeState = yield* runtime
      .start()
      .pipe(Effect.mapError(({ cause }: RemoteDesktopOperationError) => new RemoteWorkflowError({ cause })));
    this.#selectedDisplayId = this.#runtimeState.selectedDisplayId;
    return this.#runtimeState;
  });

  // A start failure is the host's answer to the member, so it names the part that failed. The cause
  // can hold local paths and ports, so it goes to the host's diagnostics only.
  #runtimeStartRefusal(error: unknown): RemoteScreenError {
    if (error instanceof RemoteScreenError) return error;
    const stage = error instanceof RemoteRuntimeStartError ? error.stage : null;
    const cause = error instanceof RemoteRuntimeStartError ? error.cause : error;
    this.#options.onDiagnostic?.(
      stage === "sunshine" ? "sunshine" : "moonlight",
      `OpenBot: the remote desktop runtime did not start (${stage ?? "runtime"}): ${describeCause(cause)}\n`,
    );
    return new RemoteScreenError(
      503,
      "host_unavailable",
      sourceText(stage ? RUNTIME_START_FAILURE[stage] : "error.remote.runtimeStartFailed"),
    );
  }

  // The runtime's processes are gone, so no session it served can stream again. End them and stop
  // what is left of it; the next session starts a new runtime, and a start that fails names its reason.
  readonly #runtimeExited = Effect.fn("RemoteScreenGateway.runtimeExited")(function* (this: RemoteScreenGateway) {
    yield* Effect.all(
      [...this.#sessions.keys()].map((id) => this.closeSession(id, "connection_failed")),
      { concurrency: "unbounded" },
    );
    yield* this.#stopRuntime();
  });

  #reportScreenRecordingDenied(denied: boolean): void {
    if (this.#screenRecordingDenied === denied) return;
    this.#screenRecordingDenied = denied;
    this.#options.onScreenRecordingDenied?.(denied);
  }

  #availableDisplays(): RemoteDesktopDisplay[] {
    return this.#runtimeState?.displays ?? this.#options.getDisplays?.() ?? [];
  }

  readonly #proxyHttpEffect = Effect.fn("RemoteScreenGateway.proxyHttp")(function* (
    this: RemoteScreenGateway,
    request: IncomingMessage,
    response: ServerResponse,
    session: ManagedRemoteScreenSession,
    upstreamPath: string,
    search: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
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
    yield* Effect.callback<void>((resume) => {
      const resolve = () => resume(Effect.void);
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
          upstreamResponse.once("error", () => {
            response.destroy();
            resolve();
          });
        },
      );
      upstream.once("error", () => {
        sendText(response, 502, "Moonlight runtime request failed.");
        resolve();
      });
      const closed = () => {
        upstream.destroy();
        resolve();
      };
      request.once("aborted", closed);
      response.once("close", closed);
      request.pipe(upstream);
      return Effect.sync(() => {
        request.off("aborted", closed);
        response.off("close", closed);
        request.unpipe(upstream);
        upstream.destroy();
      });
    });
  });

  #provide<A>(
    operation: Effect.Effect<A, RemoteWorkflowError, ScreenDependencies>,
  ): Effect.Effect<A, RemoteWorkflowError> {
    return Effect.suspend(() => {
      const completed = Deferred.makeUnsafe<void>();
      this.#operations.add(completed);
      return operation.pipe(
        Effect.provide(this.#layer),
        Effect.ensuring(
          Effect.sync(() => {
            this.#operations.delete(completed);
            Deferred.doneUnsafe(completed, Effect.void);
          }),
        ),
      );
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
        Effect.runFork(this.closeSession(id, "session_expired"));
      }
    }
  }
}

export class RemoteScreenError extends Schema.TaggedError<RemoteScreenError>()("RemoteScreenError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

// Sunshine captures and sends input through X11 only. Under Wayland, X11 reaches only the windows
// of XWayland clients, so the stream would show an empty screen.
// The runtime wraps a cause, such as "Sunshine did not start on a reserved port family", around the
// reason it did not start: an exit, or no answer.
function describeCause(cause: unknown): string {
  const parts: string[] = [];
  for (
    let next = cause;
    next !== undefined && parts.length < 3;
    next = next instanceof Error ? next.cause : undefined
  ) {
    parts.push(next instanceof Error ? next.message : String(next));
  }
  return parts.join(": ");
}

function isX11Session(environment: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(environment.DISPLAY) && !environment.WAYLAND_DISPLAY && environment.XDG_SESSION_TYPE !== "wayland";
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
  const html = `<!doctype html><meta charset="utf-8"><title>OpenBot Moonlight Remote</title><meta name="color-scheme" content="dark"><style>html,body{margin:0;width:100%;height:100%;background:#090b0c;color:#fff;font:14px system-ui}main{display:grid;place-items:center;height:100%}</style><main>Connecting…</main><script type="module">const grant=new URL(location.href).hash.slice(1);history.replaceState(null,"",location.pathname);const response=await fetch(${JSON.stringify(`${sessionPath}/authorize`)},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grant})});if(!response.ok){document.querySelector("main").textContent="Remote access expired";const refused=()=>parent.postMessage(${JSON.stringify({ source: "openbot-moonlight", type: "viewer-state", sessionId, state: "error" })},"*");document.readyState==="complete"?refused():addEventListener("load",refused);throw new Error("grant rejected")}location.replace(${JSON.stringify(target)});</script>`;
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

function moonlightRuntimeUser(session: ManagedRemoteScreenSession): string {
  return `openbot-remote-slot-${session.streamerSlot}`;
}

async function readSmallJson<T>(request: IncomingMessage, schema: z.ZodType<T>): Promise<T | null> {
  const body = await readBodyWithin(request, 4096);
  if (body === null) throw new RemoteScreenError(413, "connection_failed", "Viewer authorization is too large.");
  try {
    return schema.parse(JSON.parse(body.toString("utf8")));
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
