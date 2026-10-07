import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { createSocket } from "node:dgram";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import https from "node:https";
import { createServer as createTcpServer } from "node:net";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { PeerCertificate } from "node:tls";
import type {
  RemoteDesktopDisplay,
  RemoteDesktopIceServer,
  RemoteDesktopSetupStatus,
  RemoteDesktopTestStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import { LifecycleGate } from "./lifecycle-gate";
import { listenLoopback } from "./listen-loopback";
import { desktopCall, desktopFailure, desktopSync, type RemoteDesktopOperationError } from "./remote-desktop-effects";
import type { RemoteDesktopRuntimePaths } from "./remote-desktop-runtime-artifact";
import { forwardDiagnosticLines, stopRemoteProcess } from "./remote-diagnostics";

export class SunshineApiError extends Schema.TaggedError<SunshineApiError>()("SunshineApiError", {
  status: Schema.Int,
  message: Schema.String,
}) {
  constructor(status: number) {
    super({ status, message: sourceText("error.backend.sunshineApiHttp", { status }) });
  }
}

export type RemoteRuntimeStartStage = "sunshine" | "moonlight" | "pairing";

/**
 * A start that failed, with the part that failed. The gateway turns the stage into the reason a
 * member reads; the cause stays in the host's diagnostics.
 */
export class RemoteRuntimeStartError extends Error {
  constructor(
    readonly stage: RemoteRuntimeStartStage,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "RemoteRuntimeStartError";
  }
}

const MOONLIGHT_STREAMER_SLOTS = 4;
// First candidate for Sunshine's base port. Sunshine derives its whole port family from this one
// `port` value, so every OpenBot instance must claim a disjoint family: two macOS users share one
// network namespace, and a second Sunshine bound to the same ports fails to start.
export const SUNSHINE_DEFAULT_BASE_PORT = 47_989;
// Offsets Sunshine applies to the base port (GameStream HTTPS, HTTP, Web UI HTTPS, video, control,
// audio, RTSP setup). The family spans base - 5 through base + 21; allocations stay clear of each
// other by that whole span, not just the two API ports.
const SUNSHINE_PORT_FAMILY_OFFSETS = [-5, 0, 1, 9, 10, 11, 21];
const SUNSHINE_PORT_FAMILY_MIN_OFFSET = -5;
const SUNSHINE_PORT_FAMILY_MAX_OFFSET = 21;
const SUNSHINE_PORT_FAMILY_SPAN = SUNSHINE_PORT_FAMILY_MAX_OFFSET - SUNSHINE_PORT_FAMILY_MIN_OFFSET + 1;
const SUNSHINE_BASE_PORT_STEP = SUNSHINE_PORT_FAMILY_SPAN + 5;
const SUNSHINE_BASE_PORT_CEILING = 65_535 - SUNSHINE_PORT_FAMILY_MAX_OFFSET;
const SUNSHINE_ALLOCATION_ATTEMPTS = 64;
const READINESS_ATTEMPT_TIMEOUT_MS = 5_000;
const SUNSHINE_START_ATTEMPTS = 3;
const MOONLIGHT_WEBRTC_RANGE_SIZE = 32;
const MOONLIGHT_WEBRTC_RANGE_START = 40_000;
// Sunshine keeps running when the operating system refuses it screen capture: it prints this, fails
// to find a display or an encoder, and then serves its API normally. Nothing else distinguishes a
// host that will never produce a frame from one that is about to, so watching its own output is what
// turns a member's session hanging at "connecting" into an error naming what the host owner must do.
const SUNSHINE_SCREEN_CAPTURE_DENIED = "No screen capture permission";
// Enough of what a stream has already printed to keep the marker findable when reads split it.
const SUNSHINE_DIAGNOSTIC_OVERLAP = SUNSHINE_SCREEN_CAPTURE_DENIED.length;

// One watcher per stream, because a chunk boundary falls wherever the pipe happened to fill and the
// marker is longer than some of Sunshine's lines. Carrying the accumulated end forward -- rather
// than the last chunk -- is what survives a marker spread over three reads.
export function createScreenCaptureDenialWatcher(): (message: string) => boolean {
  let printed = "";
  return (message) => {
    printed = `${printed}${message}`;
    const denied = printed.includes(SUNSHINE_SCREEN_CAPTURE_DENIED);
    printed = printed.slice(-SUNSHINE_DIAGNOSTIC_OVERLAP);
    return denied;
  };
}

export function sunshineHttpPortForBase(basePort: number): number {
  return basePort;
}

export function sunshineHttpsPortForBase(basePort: number): number {
  return basePort + 1;
}

function sunshinePortFamilyForBase(basePort: number): { min: number; max: number } {
  return {
    min: basePort + SUNSHINE_PORT_FAMILY_MIN_OFFSET,
    max: basePort + SUNSHINE_PORT_FAMILY_MAX_OFFSET,
  };
}

export function sunshinePortFamiliesOverlap(first: number, second: number): boolean {
  const a = sunshinePortFamilyForBase(first);
  const b = sunshinePortFamilyForBase(second);
  return a.min <= b.max && b.min <= a.max;
}

export interface MoonlightWebRtcPortRange {
  min: number;
  max: number;
}

// Base ports claimed by live runtimes in this process. Two runtimes started together would both
// probe the same free ports before either Sunshine binds, so the registry is what keeps their
// allocations apart; the bind probes below are what keeps them apart from other processes and
// other macOS users.
const claimedSunshineBasePorts = new Set<number>();
// Hold one TCP listener at the first port of each fixed UDP range for its whole lifetime.
// The kernel makes this reservation exclusive across processes and macOS users. Media uses UDP.
const webRtcReservations = new Map<number, ReturnType<typeof createTcpServer>>();

/** Reserve a Sunshine base port whose whole port family is free on loopback. */
export const allocateSunshineBasePort = Effect.fn("RemoteDesktop.allocateSunshineBasePort")(function* () {
  let candidate = SUNSHINE_DEFAULT_BASE_PORT;
  for (
    let attempt = 0;
    attempt < SUNSHINE_ALLOCATION_ATTEMPTS && candidate <= SUNSHINE_BASE_PORT_CEILING;
    attempt += 1
  ) {
    const port = candidate;
    if (![...claimedSunshineBasePorts].some((active) => sunshinePortFamiliesOverlap(port, active))) {
      let retained = false;
      const available = yield* Effect.acquireUseRelease(
        desktopSync(() => claimedSunshineBasePorts.add(port)),
        () =>
          sunshinePortFamilyFreeEffect(port).pipe(
            Effect.tap((free) =>
              Effect.sync(() => {
                retained = free;
              }),
            ),
          ),
        () =>
          Effect.sync(() => {
            if (!retained) claimedSunshineBasePorts.delete(port);
          }),
      );
      if (available) return port;
    }
    candidate += SUNSHINE_BASE_PORT_STEP;
  }
  return yield* desktopFailure(new Error(sourceText("error.backend.sunshinePortsUnavailable")));
});

export function releaseSunshineBasePort(basePort: number): void {
  claimedSunshineBasePorts.delete(basePort);
}

/** Reserve a block of consecutive UDP ports for one Moonlight WebRTC streamer. */
export const allocateWebRtcPortRange = Effect.fn("RemoteDesktop.allocateWebRtcPortRange")(function* () {
  const size = MOONLIGHT_WEBRTC_RANGE_SIZE;
  for (let min = MOONLIGHT_WEBRTC_RANGE_START; min + size - 1 <= 65_535; min += size) {
    const range = { min, max: min + size - 1 };
    let retained = false;
    const result = yield* Effect.result(
      Effect.acquireUseRelease(
        listenTcpEffect(min),
        (reservation) =>
          Effect.gen(function* () {
            reservation.on("connection", (socket) => socket.destroy());
            if (!(yield* udpRangeFreeEffect(range))) return null;
            webRtcReservations.set(range.min, reservation);
            retained = true;
            return range;
          }),
        (reservation) => (retained ? Effect.void : closeSocketEffect(reservation).pipe(Effect.orDie)),
      ),
    );
    if (Result.isSuccess(result) && result.success) return result.success;
  }
  return yield* desktopFailure(new Error(sourceText("error.backend.moonlightPortsUnavailable")));
});

export function releaseWebRtcPortRange(range: MoonlightWebRtcPortRange): void {
  webRtcReservations.get(range.min)?.close();
  webRtcReservations.delete(range.min);
}

const sunshinePortFamilyFreeEffect = Effect.fn("RemoteDesktop.sunshinePortFamilyFree")((basePort: number) =>
  Effect.gen(function* () {
    for (const offset of SUNSHINE_PORT_FAMILY_OFFSETS) {
      yield* Effect.acquireRelease(listenTcpEffect(basePort + offset), (socket) =>
        closeSocketEffect(socket).pipe(Effect.orDie),
      );
      yield* Effect.acquireRelease(bindUdpEffect(basePort + offset), (socket) =>
        closeSocketEffect(socket).pipe(Effect.orDie),
      );
    }
    return true;
  }).pipe(
    Effect.scoped,
    Effect.catch(() => Effect.succeed(false)),
  ),
);

const udpRangeFreeEffect = Effect.fn("RemoteDesktop.udpRangeFree")((range: MoonlightWebRtcPortRange) =>
  Effect.gen(function* () {
    for (let port = range.min; port <= range.max; port += 1) {
      yield* Effect.acquireRelease(bindUdpEffect(port), (socket) => closeSocketEffect(socket).pipe(Effect.orDie));
    }
    return true;
  }).pipe(
    Effect.scoped,
    Effect.catch(() => Effect.succeed(false)),
  ),
);

const closeSocketEffect = Effect.fn("RemoteDesktop.closeSocket")((socket: { close(callback: () => void): unknown }) =>
  Effect.callback<void, RemoteDesktopOperationError>((resume) => {
    try {
      socket.close(() => resume(Effect.void));
    } catch (cause) {
      resume(Effect.fail(desktopFailure(cause)));
    }
  }),
);

const listenTcpEffect = Effect.fn("RemoteDesktop.listenTcp")((port: number) =>
  Effect.callback<ReturnType<typeof createTcpServer>, RemoteDesktopOperationError>((resume) => {
    const server = createTcpServer();
    let retained = false;
    const failed = (cause: Error) => resume(Effect.fail(desktopFailure(cause)));
    server.once("error", failed);
    server.listen(port, "127.0.0.1", () => {
      retained = true;
      resume(Effect.succeed(server));
    });
    return Effect.sync(() => {
      server.removeListener("error", failed);
      if (!retained) server.close();
    });
  }),
);

const bindUdpEffect = Effect.fn("RemoteDesktop.bindUdp")((port: number) =>
  Effect.callback<ReturnType<typeof createSocket>, RemoteDesktopOperationError>((resume) => {
    const socket = createSocket("udp4");
    let retained = false;
    let closed = false;
    const failed = (cause: Error) => {
      closed = true;
      socket.close(() => resume(Effect.fail(desktopFailure(cause))));
    };
    socket.once("error", failed);
    socket.bind(port, "127.0.0.1", () => {
      retained = true;
      resume(Effect.succeed(socket));
    });
    return Effect.sync(() => {
      socket.removeListener("error", failed);
      if (!retained && !closed) socket.close();
    });
  }),
);

const localAddressSchema = Schema.Struct({ address: Schema.String, family: Schema.String, port: Schema.Int });
const moonlightHostSchema = Schema.Struct({ host_id: Schema.Int, paired: Schema.Literals(["Paired", "NotPaired"]) });
const moonlightHostsSchema = Schema.Struct({ hosts: Schema.Array(moonlightHostSchema) });
const moonlightCreatedHostSchema = Schema.Struct({ host: moonlightHostSchema });
const moonlightAppsSchema = Schema.Struct({
  apps: Schema.Array(Schema.Struct({ app_id: Schema.Int, title: Schema.String })),
});
const moonlightRoleSchema = Schema.Struct({
  role: Schema.Struct({
    permissions: Schema.Struct({ allow_transport_webrtc: Schema.Boolean, allow_transport_websockets: Schema.Boolean }),
  }),
});
const moonlightPairMessageSchema = Schema.Union([
  Schema.Struct({ Pin: Schema.NonEmptyString }),
  Schema.Struct({ Paired: Schema.Struct({ host_id: Schema.Int }) }),
  Schema.Literals(["PairError", "InternalServerError"]),
]);
const sunshineSetupSchema = Schema.Struct({
  hostName: Schema.String.check(Schema.isMaxLength(255)),
  username: Schema.String.check(Schema.isMaxLength(255)),
  screenRecording: Schema.Literals(["allowed", "blocked"]),
  accessibility: Schema.Literals(["allowed", "blocked"]),
  guiSession: Schema.Literals(["allowed", "blocked"]),
  displays: Schema.Literals(["allowed", "unavailable", "failed"]),
  restartRequired: Schema.Boolean,
});
const sunshineTestSchema = Schema.Struct({
  active: Schema.Boolean,
  mouse: Schema.Boolean,
  keyboard: Schema.Boolean,
  code: Schema.String.check(Schema.isPattern(/^(?:[0-9]{4})?$/u)),
});
const sunshineDisplaysSchema = Schema.Struct({
  displays: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, name: Schema.NonEmptyString })),
});
const sunshinePairingsSchema = Schema.Struct({
  pairings: Schema.Array(
    Schema.Struct({
      id: Schema.String.check(Schema.isPattern(/^[a-fA-F0-9]{32}$/)),
      name: Schema.String,
      address: Schema.String,
    }),
  ),
});
const endpointSchema = Schema.Struct({ port: Schema.Int });

interface MoonlightRequestInit {
  method?: "GET" | "POST" | "DELETE";
  body?: string;
}

export interface SunshineMoonlightRuntimeState {
  /** Private local credential; never send it to clients or diagnostics. */
  authHeader: string;
  baseUrl: string;
  hostId: number;
  hostIds: number[];
  desktopAppId: number;
  displays: RemoteDesktopDisplay[];
  selectedDisplayId: string | null;
}

export type RemoteRuntimeSpawn = (executable: string, args: string[], options: SpawnOptions) => ChildProcess;

interface SunshineMoonlightRuntimeOptions {
  paths: RemoteDesktopRuntimePaths;
  stateDirectory: string;
  platform: "darwin" | "win32" | "linux";
  credentials: { username: string; password: string };
  getDisplays: () => RemoteDesktopDisplay[];
  getIceServers: () => Effect.Effect<RemoteDesktopIceServer[], RemoteDesktopOperationError>;
  spawnProcess?: RemoteRuntimeSpawn;
  onDiagnostic?: (source: "sunshine" | "moonlight", message: string) => void;
  /** Called when Sunshine or Moonlight Web exits after the runtime started. */
  onExit?: (source: "sunshine" | "moonlight") => void;
  allocateSunshineBasePort?: () => Effect.Effect<number, RemoteDesktopOperationError>;
  allocateMoonlightPort?: () => Effect.Effect<number, RemoteDesktopOperationError>;
  allocateWebRtcPortRange?: () => Effect.Effect<MoonlightWebRtcPortRange, RemoteDesktopOperationError>;
}

export class SunshineMoonlightRuntime {
  readonly #options: SunshineMoonlightRuntimeOptions;
  readonly #spawn: RemoteRuntimeSpawn;
  #sunshine: ChildProcess | null = null;
  #moonlight: ChildProcess | null = null;
  #iceServer: Server | null = null;
  #iceToken = "";
  readonly #pairingName = `openbot-remote-${randomBytes(16).toString("hex")}`;
  #state: SunshineMoonlightRuntimeState | null = null;
  #screenCaptureDenied = false;
  readonly #moonlightHeader = `X-OpenBot-Remote-${randomBytes(32).toString("hex")}`;
  #selectedDisplayId: string | null = null;
  readonly #lifecycle = new LifecycleGate<SunshineMoonlightRuntimeState, RemoteDesktopOperationError>();
  /** Set by a stop that arrives while a start runs. The start then opens nothing more and fails. */
  #stopRequested = false;
  #sunshineBasePort: number | null = null;
  #ownsSunshineAllocation = false;
  #moonlightPort: number | null = null;
  #webRtcRange: MoonlightWebRtcPortRange | null = null;
  #ownsWebRtcRange = false;

  constructor(options: SunshineMoonlightRuntimeOptions) {
    this.#options = options;
    this.#spawn = options.spawnProcess ?? nodeSpawn;
  }

  get sunshineBasePort(): number | null {
    return this.#sunshineBasePort;
  }

  get sunshineHttpPort(): number | null {
    return this.#sunshineBasePort === null ? null : sunshineHttpPortForBase(this.#sunshineBasePort);
  }

  get sunshineHttpsPort(): number | null {
    return this.#sunshineBasePort === null ? null : sunshineHttpsPortForBase(this.#sunshineBasePort);
  }

  get moonlightPort(): number | null {
    return this.#moonlightPort;
  }

  get webRtcPortRange(): MoonlightWebRtcPortRange | null {
    return this.#webRtcRange ? { ...this.#webRtcRange } : null;
  }

  get state(): SunshineMoonlightRuntimeState | null {
    return this.#state ? { ...this.#state } : null;
  }

  /** Whether Sunshine has said, since it was last started, that it may not record this screen. */
  screenCaptureDenied(): boolean {
    return this.#screenCaptureDenied;
  }

  readonly start = Effect.fn("SunshineMoonlightRuntime.start")(() =>
    this.#lifecycle.start(() =>
      Effect.gen({ self: this }, function* () {
        return this.#state ? { ...this.#state } : yield* this.#startEffect();
      }),
    ),
  );

  readonly checkSetup = Effect.fn("SunshineMoonlightRuntime.checkSetup")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<
    Pick<
      RemoteDesktopSetupStatus,
      "hostName" | "username" | "screenRecording" | "accessibility" | "guiSession" | "displays" | "restartRequired"
    >,
    RemoteDesktopOperationError
  > {
    return yield* sunshineJsonEffect(
      yield* desktopSync(() => this.#requireSunshineHttpsPort()),
      "/api/openbot/setup",
      this.#options.credentials,
      join(this.#options.stateDirectory, "sunshine-cert.pem"),
      sunshineSetupSchema,
    );
  }).bind(this);

  readonly test = Effect.fn("SunshineMoonlightRuntime.test")(function* (
    this: SunshineMoonlightRuntime,
    action: "start" | "status" | "stop",
  ): Effect.fn.Return<RemoteDesktopTestStatus, RemoteDesktopOperationError> {
    const port = yield* desktopSync(() => this.#requireSunshineHttpsPort());
    const certificate = join(this.#options.stateDirectory, "sunshine-cert.pem");
    if (action !== "status")
      yield* sunshineRequestEffect(
        port,
        "/api/openbot/test",
        this.#options.credentials,
        certificate,
        JSON.stringify({ action, displayId: this.#selectedDisplayId ?? "" }),
      );
    return yield* sunshineJsonEffect(
      port,
      "/api/openbot/test",
      this.#options.credentials,
      certificate,
      sunshineTestSchema,
    );
  }).bind(this);

  readonly selectDisplay = Effect.fn("SunshineMoonlightRuntime.selectDisplay")(function* (
    this: SunshineMoonlightRuntime,
    displayId: string,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    this.#selectedDisplayId = displayId;
    if (!this.#state) return;
    yield* this.#writeSunshineConfigEffect();
    const sunshine = this.#sunshine;
    // Clear before waiting so the exit watcher recognizes an intended stop.
    this.#sunshine = null;
    if (sunshine) yield* stopRemoteProcess(sunshine);
    // Reuse the already allocated ports: Moonlight paired against this Sunshine HTTP port, so a
    // reallocation here would orphan every existing pairing.
    yield* this.#startSunshineOnceEffect();
    if (this.#state) this.#state = { ...this.#state, selectedDisplayId: displayId };
  }).bind(this);

  readonly stop = Effect.fn("SunshineMoonlightRuntime.stop")(() =>
    this.#lifecycle.stop(
      () => this.#stopEffect(),
      () =>
        Effect.gen({ self: this }, function* () {
          this.#stopRequested = true;
          yield* this.#stopChildrenEffect();
        }),
    ),
  );

  readonly #stopEffect = Effect.fn("SunshineMoonlightRuntime.stop")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    this.#state = null;
    yield* this.#stopChildrenEffect().pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          const iceServer = this.#iceServer;
          this.#iceServer = null;
          if (iceServer) yield* closeSocketEffect(iceServer).pipe(Effect.orDie);
          this.#iceToken = "";
          this.#releasePortClaims();
        }),
      ),
    );
  });

  #releasePortClaims(): void {
    if (this.#ownsSunshineAllocation && this.#sunshineBasePort !== null) {
      releaseSunshineBasePort(this.#sunshineBasePort);
    }
    if (this.#ownsWebRtcRange && this.#webRtcRange !== null) releaseWebRtcPortRange(this.#webRtcRange);
    this.#sunshineBasePort = null;
    this.#ownsSunshineAllocation = false;
    this.#moonlightPort = null;
    this.#webRtcRange = null;
    this.#ownsWebRtcRange = false;
  }

  #requireSunshineHttpPort(): number {
    const port = this.sunshineHttpPort;
    if (port === null) throw new Error("Sunshine ports have not been allocated yet.");
    return port;
  }

  #requireSunshineHttpsPort(): number {
    const port = this.sunshineHttpsPort;
    if (port === null) throw new Error("Sunshine ports have not been allocated yet.");
    return port;
  }

  // A stop that interrupts the start is not a start failure. A process that has already ended names
  // the stage, because a pairing call to a Sunshine that has exited fails too.
  #failStart(stage: RemoteRuntimeStartStage): (error: RemoteDesktopOperationError) => RemoteDesktopOperationError {
    return (error) => {
      if (this.#stopRequested) return error;
      const ended = childEnded(this.#sunshine) ? "sunshine" : childEnded(this.#moonlight) ? "moonlight" : null;
      return desktopFailure(new RemoteRuntimeStartError(ended ?? stage, error.cause));
    };
  }

  #throwIfStopRequested(): void {
    if (this.#stopRequested) throw new Error(sourceText("error.backend.remoteDesktopStoppedWhileStarting"));
  }

  readonly #startEffect = Effect.fn("SunshineMoonlightRuntime.start")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<SunshineMoonlightRuntimeState, RemoteDesktopOperationError> {
    this.#stopRequested = false;
    yield* desktopCall(() => mkdir(this.#options.stateDirectory, { recursive: true, mode: 0o700 }));
    let completed = false;
    return yield* Effect.gen({ self: this }, function* () {
      try {
        if (this.#sunshineBasePort === null) {
          const allocateSunshine = this.#options.allocateSunshineBasePort;
          if (allocateSunshine) {
            this.#sunshineBasePort = yield* allocateSunshine();
          } else {
            this.#sunshineBasePort = yield* allocateSunshineBasePort();
            this.#ownsSunshineAllocation = true;
          }
        }
        yield* this.#writeSunshineConfigEffect();
        const iceEndpoint = yield* this.#startIceServerEffect();
        yield* desktopSync(() => this.#throwIfStopRequested());
        if (this.#moonlightPort === null) {
          this.#moonlightPort = yield* (this.#options.allocateMoonlightPort ?? reservePort)();
        }
        if (this.#webRtcRange === null) {
          const allocateWebRtc = this.#options.allocateWebRtcPortRange;
          if (allocateWebRtc) {
            this.#webRtcRange = yield* allocateWebRtc();
          } else {
            this.#webRtcRange = yield* allocateWebRtcPortRange();
            this.#ownsWebRtcRange = true;
          }
        }
        yield* this.#writeIceHelperEffect();
        yield* this.#setSunshineCredentialsEffect();
        yield* this.#startSunshineWithRetryEffect().pipe(Effect.mapError(this.#failStart("sunshine")));
        yield* this.#writeMoonlightConfigEffect();
        const displays = yield* this.#getSunshineDisplaysEffect();
        if (!this.#selectedDisplayId || !displays.some((display) => display.id === this.#selectedDisplayId)) {
          this.#selectedDisplayId = displays.find((display) => display.primary)?.id ?? displays[0]?.id ?? null;
        }
        const moonlightPort = this.#moonlightPort;
        if (moonlightPort === null) throw new Error("Moonlight port has not been allocated yet.");
        yield* desktopSync(() => this.#throwIfStopRequested());
        yield* desktopSync(() => this.#startMoonlight(moonlightPort, iceEndpoint));
        yield* waitForHttpEffect(
          `http://127.0.0.1:${moonlightPort}/api/authenticate`,
          {
            headers: { [this.#moonlightHeader]: moonlightSlotUser(1) },
          },
          this.#moonlight,
        ).pipe(Effect.mapError(this.#failStart("moonlight")));
        this.#options.onDiagnostic?.("moonlight", "OpenBot: Moonlight Web is ready.\n");
        const paired = yield* this.#bootstrapMoonlightEffect(moonlightPort).pipe(
          Effect.mapError(this.#failStart("pairing")),
        );
        yield* desktopSync(() => this.#throwIfStopRequested());
        // An exit during pairing precedes the exit watcher becoming active.
        if (childEnded(this.#sunshine) || childEnded(this.#moonlight)) {
          return yield* this.#failStart("pairing")(
            desktopFailure(new Error("A remote desktop process exited during pairing.")),
          );
        }
        this.#state = {
          baseUrl: `http://127.0.0.1:${moonlightPort}`,
          authHeader: this.#moonlightHeader,
          ...paired,
          displays,
          selectedDisplayId: this.#selectedDisplayId,
        };
        completed = true;
        return { ...this.#state };
      } catch (error) {
        return yield* desktopFailure(error);
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          if (completed) return;
          yield* this.#stopChildrenEffect();
          this.#releasePortClaims();
        }).pipe(Effect.orDie),
      ),
    );
  });

  // The fields are cleared before the wait: a start that is still running can spawn a process during
  // it, and clearing them after would lose that process without stopping it.

  readonly #stopChildrenEffect = Effect.fn("SunshineMoonlightRuntime.stopChildren")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    const moonlight = this.#moonlight;
    const sunshine = this.#sunshine;
    this.#moonlight = null;
    this.#sunshine = null;
    yield* Effect.all(
      [moonlight ? stopRemoteProcess(moonlight) : Effect.void, sunshine ? stopRemoteProcess(sunshine) : Effect.void],
      { concurrency: "unbounded" },
    );
  });

  readonly #writeSunshineConfigEffect = Effect.fn("SunshineMoonlightRuntime.writeSunshineConfig")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    const basePort = this.#sunshineBasePort;
    if (basePort === null) return yield* desktopFailure(new Error("Sunshine ports have not been allocated yet."));
    const values = [
      "sunshine_name = OpenBot Remote Desktop",
      // The base port: every other Sunshine port (GameStream HTTP/HTTPS, Web UI HTTPS, video,
      // audio, control, RTSP setup) is offset from this one, so a per-instance base keeps the
      // whole family disjoint from other OpenBot instances on this machine.
      `port = ${basePort}`,
      "upnp = disabled",
      "stream_audio = disabled",
      "origin_web_ui_allowed = pc",
      "address_family = ipv4",
      "bind_address = 127.0.0.1",
      `credentials_file = ${join(this.#options.stateDirectory, "sunshine-credentials.json")}`,
      `file_state = ${join(this.#options.stateDirectory, "sunshine-state.json")}`,
      `file_apps = ${join(this.#options.stateDirectory, "sunshine-apps.json")}`,
      `pkey = ${join(this.#options.stateDirectory, "sunshine-key.pem")}`,
      `cert = ${join(this.#options.stateDirectory, "sunshine-cert.pem")}`,
      `log_path = ${join(this.#options.stateDirectory, "sunshine.log")}`,
      ...(this.#selectedDisplayId ? [`output_name = ${this.#selectedDisplayId}`] : []),
      // The Linux runtime is built with X11 capture and no hardware encoder, so Sunshine does not
      // probe the others.
      ...(this.#options.platform === "linux" ? ["capture = x11", "encoder = software"] : []),
    ];
    yield* desktopCall(() =>
      Promise.all([
        writeFile(join(this.#options.stateDirectory, "sunshine.conf"), `${values.join("\n")}\n`, { mode: 0o600 }),
        writeFile(
          join(this.#options.stateDirectory, "sunshine-apps.json"),
          `${JSON.stringify({ env: {}, apps: [{ name: "Desktop", image_path: "desktop.png" }] }, null, 2)}\n`,
          { mode: 0o600 },
        ),
      ]),
    );
  });

  readonly #writeMoonlightConfigEffect = Effect.fn("SunshineMoonlightRuntime.writeMoonlightConfig")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    const moonlightPort = this.#moonlightPort;
    const webRtcRange = this.#webRtcRange;
    if (moonlightPort === null || webRtcRange === null) {
      return yield* desktopFailure(new Error("Moonlight ports have not been allocated yet."));
    }
    const config = {
      data_storage: {
        type: "json",
        path: join(this.#options.stateDirectory, "moonlight-data.json"),
        session_expiration_check_interval: { secs: 300, nanos: 0 },
      },
      webrtc: {
        ice_servers: [],
        ice_server_script: join(
          this.#options.stateDirectory,
          this.#options.platform === "win32" ? "openbot-ice-helper.cmd" : "openbot-ice-helper.sh",
        ),
        port_range: { min: webRtcRange.min, max: webRtcRange.max },
        nat_1to1: null,
        network_types: ["udp4", "udp6", "tcp4", "tcp6"],
        include_loopback_candidates: false,
      },
      web_server: {
        bind_address: `127.0.0.1:${moonlightPort}`,
        certificate: null,
        url_path_prefix: "",
        session_cookie_secure: false,
        forwarded_header: { username_header: this.#moonlightHeader, auto_create_missing_user: true },
        first_login_create_admin: false,
        first_login_assign_global_hosts: true,
        default_user_id: null,
        default_role_id: null,
        session_cookie_expiration: { secs: 3600, nanos: 0 },
      },
      moonlight: {
        default_http_port: yield* desktopSync(() => this.#requireSunshineHttpPort()),
        pair_device_name: this.#pairingName,
      },
      streamer_path: this.#options.paths.moonlightStreamer,
      log: { level_filter: "Info", file_path: join(this.#options.stateDirectory, "moonlight.log"), dev_venator: false },
      default_settings: null,
    };
    yield* desktopCall(() =>
      writeFile(join(this.#options.stateDirectory, "moonlight-config.json"), `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
      }),
    );
  });

  readonly #writeIceHelperEffect = Effect.fn("SunshineMoonlightRuntime.writeIceHelper")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    const path = join(
      this.#options.stateDirectory,
      this.#options.platform === "win32" ? "openbot-ice-helper.cmd" : "openbot-ice-helper.sh",
    );
    const contents =
      this.#options.platform === "win32"
        ? "@powershell.exe -NoProfile -NonInteractive -Command \"Invoke-RestMethod -Headers @{Authorization=('Bearer ' + $env:OPENBOT_ICE_HELPER_TOKEN)} -Uri $env:OPENBOT_ICE_HELPER_URL | ConvertTo-Json -Compress\"\r\n"
        : `#!/bin/sh\nprintf 'header = "Authorization: Bearer %s"\\nurl = "%s"\\n' "$OPENBOT_ICE_HELPER_TOKEN" "$OPENBOT_ICE_HELPER_URL" | /usr/bin/curl --fail --silent --show-error --config -\n`;
    yield* desktopCall(() => writeFile(path, contents, { mode: 0o700 }));
    if (this.#options.platform !== "win32") yield* desktopCall(() => chmod(path, 0o700));
  });

  readonly #setSunshineCredentialsEffect = Effect.fn("SunshineMoonlightRuntime.setSunshineCredentials")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    // Matches pinned Sunshine http::save_user_creds and util::Hex (reversed SHA-256,
    // uppercase). Do not pass the plaintext password through globally visible argv.
    const salt = randomBytes(16).toString("hex");
    const password = sunshinePasswordHash(this.#options.credentials.password, salt);
    const path = join(this.#options.stateDirectory, "sunshine-credentials.json");
    yield* desktopCall(() =>
      writeFile(path, JSON.stringify({ username: this.#options.credentials.username, salt, password }), {
        mode: 0o600,
      }),
    );
    if (this.#options.platform !== "win32") yield* desktopCall(() => chmod(path, 0o600));
  });

  // Probing a free family and starting Sunshine cannot be atomic, so a rival process can take
  // the ports in between. On failure the claim is released and the next disjoint family is tried;
  // Moonlight only starts after this succeeds, so reallocating here never orphans a pairing.

  readonly #startSunshineWithRetryEffect = Effect.fn("SunshineMoonlightRuntime.startSunshineWithRetry")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    let lastError: unknown;
    for (let attempt = 0; attempt < SUNSHINE_START_ATTEMPTS; attempt += 1) {
      yield* desktopSync(() => this.#throwIfStopRequested());
      const result = yield* Effect.result(this.#startSunshineOnceEffect());
      if (Result.isSuccess(result)) return;
      lastError = result.failure.cause;
      const sunshine = this.#sunshine;
      if (sunshine) {
        yield* stopRemoteProcess(sunshine).pipe(Effect.catch(() => Effect.void));
        this.#sunshine = null;
      }
      if (attempt + 1 >= SUNSHINE_START_ATTEMPTS) break;
      if (this.#ownsSunshineAllocation && this.#sunshineBasePort !== null) {
        releaseSunshineBasePort(this.#sunshineBasePort);
        this.#sunshineBasePort = yield* allocateSunshineBasePort();
      }
      yield* this.#writeSunshineConfigEffect();
    }
    return yield* desktopFailure(new Error(sourceText("error.backend.sunshineNotStarted"), { cause: lastError }));
  });

  readonly #startSunshineOnceEffect = Effect.fn("SunshineMoonlightRuntime.startSunshineOnce")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    // A restart is how a newly granted permission takes effect, so the verdict is this process's
    // alone -- carrying the previous one over would keep reporting a grant the user has already made.
    this.#screenCaptureDenied = false;
    this.#sunshine = yield* desktopSync(() =>
      this.#spawn(this.#options.paths.sunshine, [join(this.#options.stateDirectory, "sunshine.conf")], {
        cwd: dirname(this.#options.paths.sunshine),
        env: { ...process.env, OPENBOT_REMOTE_SETUP: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }),
    );
    this.#pipeDiagnostics(this.#sunshine, "sunshine");
    this.#watchExit(this.#sunshine, "sunshine");
    yield* waitForHttpsEffect(
      yield* desktopSync(() => this.#requireSunshineHttpsPort()),
      join(this.#options.stateDirectory, "sunshine-cert.pem"),
      this.#sunshine,
    );
  });

  #startMoonlight(port: number, iceEndpoint: string): void {
    this.#moonlight = this.#spawn(
      this.#options.paths.moonlightWebServer,
      [
        "--config-path",
        join(this.#options.stateDirectory, "moonlight-config.json"),
        "--bind-address",
        `127.0.0.1:${port}`,
        "--streamer-path",
        this.#options.paths.moonlightStreamer,
        "run",
      ],
      {
        cwd: dirname(this.#options.paths.moonlightWebServer),
        env: {
          ...process.env,
          OPENBOT_ICE_HELPER_URL: iceEndpoint,
          OPENBOT_ICE_HELPER_TOKEN: this.#iceToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.#pipeDiagnostics(this.#moonlight, "moonlight");
    this.#watchExit(this.#moonlight, "moonlight");
  }

  readonly #bootstrapMoonlightEffect = Effect.fn("SunshineMoonlightRuntime.bootstrapMoonlight")(function* (
    this: SunshineMoonlightRuntime,
    port: number,
  ): Effect.fn.Return<{ hostId: number; hostIds: number[]; desktopAppId: number }, RemoteDesktopOperationError> {
    const baseUrl = `http://127.0.0.1:${port}`;
    const endpointPath = join(this.#options.stateDirectory, "moonlight-endpoint.json");
    const endpoint = yield* Effect.gen(function* () {
      const text = yield* desktopCall(() => readFile(endpointPath, "utf8"));
      const data = yield* desktopSync(() => JSON.parse(text));
      return yield* Schema.decodeUnknownEffect(endpointSchema)(data);
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    const endpointChanged = endpoint?.port !== (yield* desktopSync(() => this.#requireSunshineHttpPort()));
    const hostIds: number[] = [];
    for (let slot = 1; slot <= MOONLIGHT_STREAMER_SLOTS; slot += 1) {
      const user = moonlightSlotUser(slot);
      const hosts = (yield* moonlightJsonEffect(
        baseUrl,
        "/api/hosts",
        moonlightHostsSchema,
        this.#moonlightHeader,
        {},
        user,
      )).hosts;
      this.#options.onDiagnostic?.(
        "moonlight",
        `OpenBot: found ${hosts.length} local Moonlight hosts for streamer slot ${slot}.\n`,
      );
      // Stored hosts keep their original port. Recreate the managed endpoint before pairing,
      // including when another user claimed this runtime's previous port after restart.
      for (const previous of endpointChanged ? hosts : []) {
        const deleted = yield* moonlightHttpResponseEffect(
          baseUrl,
          `/api/host?host_id=${previous.host_id}`,
          { method: "DELETE" },
          user,
          this.#moonlightHeader,
        );
        deleted.resume();
      }
      let host = endpointChanged ? undefined : hosts[0];
      if (!host) {
        const created = yield* moonlightJsonEffect(
          baseUrl,
          "/api/host",
          moonlightCreatedHostSchema,
          this.#moonlightHeader,
          {
            method: "POST",
            body: JSON.stringify({
              address: "127.0.0.1",
              http_port: yield* desktopSync(() => this.#requireSunshineHttpPort()),
            }),
          },
          user,
        );
        host = created.host;
      }
      if (host.paired !== "Paired") {
        this.#options.onDiagnostic?.(
          "moonlight",
          `OpenBot: pairing local host ${host.host_id} for streamer slot ${slot}.\n`,
        );
        yield* this.#pairMoonlightEffect(baseUrl, host.host_id, user);
      }
      yield* this.#assertEmbeddedPermissionsEffect(baseUrl, user);
      hostIds.push(host.host_id);
    }
    const [hostId] = hostIds;
    if (hostId === undefined) return yield* desktopFailure(new Error(sourceText("error.backend.moonlightNoHost")));
    const apps = (yield* moonlightJsonEffect(
      baseUrl,
      `/api/apps?host_id=${hostId}`,
      moonlightAppsSchema,
      this.#moonlightHeader,
      {},
      moonlightSlotUser(1),
    )).apps;
    const desktop = apps.find((app) => app.title.toLowerCase() === "desktop") ?? apps[0];
    if (!desktop) return yield* desktopFailure(new Error(sourceText("error.backend.sunshineNoDesktop")));
    yield* desktopCall(() =>
      writeFile(endpointPath, JSON.stringify({ port: this.#requireSunshineHttpPort() }), { mode: 0o600 }),
    );
    return { hostId, hostIds, desktopAppId: desktop.app_id };
  });

  readonly #getSunshineDisplaysEffect = Effect.fn("SunshineMoonlightRuntime.getSunshineDisplays")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<RemoteDesktopDisplay[], RemoteDesktopOperationError> {
    const native = yield* sunshineJsonEffect(
      yield* desktopSync(() => this.#requireSunshineHttpsPort()),
      "/api/openbot/displays",
      this.#options.credentials,
      join(this.#options.stateDirectory, "sunshine-cert.pem"),
      sunshineDisplaysSchema,
    );
    const local = this.#options.getDisplays();
    // Sunshine also lists outputs that have no monitor: an X server with a dummy driver has 16, and
    // only one is connected. Electron lists only connected monitors, so an output with no match is
    // not a screen to show, and its size is unknown.
    const displays = native.displays.flatMap((display, index) => {
      const metadata = local.find((candidate) => candidate.id === display.id) ?? local[index];
      if (!metadata) return [];
      return [
        {
          id: display.id,
          label: metadata.label,
          width: metadata.width,
          height: metadata.height,
          primary: metadata.primary,
        },
      ];
    });
    return yield* desktopCall(() => (displays.length === 0 ? structuredClone(local) : displays));
  });

  readonly #waitForPairingRequestEffect = Effect.fn("SunshineMoonlightRuntime.waitForPairingRequest")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<string, RemoteDesktopOperationError> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const pending = yield* sunshineJsonEffect(
        yield* desktopSync(() => this.#requireSunshineHttpsPort()),
        "/api/pin",
        this.#options.credentials,
        join(this.#options.stateDirectory, "sunshine-cert.pem"),
        sunshinePairingsSchema,
      );
      const matches = pending.pairings.filter(
        (pairing) =>
          pairing.name === this.#pairingName && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(pairing.address),
      );
      const [match, ...others] = matches;
      if (others.length > 0)
        return yield* desktopFailure(new Error(sourceText("error.backend.sunshineAmbiguousPairing")));
      if (match) return yield* desktopCall(() => match.id);
      yield* Effect.sleep(200);
    }
    return yield* desktopFailure(new Error(sourceText("error.backend.sunshineNoPairingRequest")));
  });

  readonly #pairMoonlightEffect = Effect.fn("SunshineMoonlightRuntime.pairMoonlight")(function* (
    this: SunshineMoonlightRuntime,
    baseUrl: string,
    hostId: number,
    user: string,
  ): Effect.fn.Return<void, RemoteDesktopOperationError> {
    const body = JSON.stringify({ host_id: hostId });
    return yield* Effect.acquireUseRelease(
      requestStreamEffect(
        `${baseUrl}/api/pair`,
        {
          [this.#moonlightHeader]: user,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        body,
      ),
      (response) =>
        Effect.gen({ self: this }, function* () {
          if (response.statusCode !== 200) {
            response.resume();
            return yield* desktopFailure(
              new Error(sourceText("error.backend.moonlightPairingHttp", { status: response.statusCode ?? 0 })),
            );
          }
          let buffer = "";
          let pinSubmitted = false;
          const iterator = response[Symbol.asyncIterator]();
          for (;;) {
            const next = yield* desktopCall(() => iterator.next());
            if (next.done) break;
            const chunk = next.value;
            buffer += Buffer.from(chunk).toString("utf8");
            while (buffer.includes("\n")) {
              const newline = buffer.indexOf("\n");
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              if (!line) continue;
              const json = yield* desktopSync(() => JSON.parse(line));
              const message = yield* Schema.decodeUnknownEffect(moonlightPairMessageSchema)(json).pipe(
                Effect.mapError(desktopFailure),
              );
              if (typeof message === "object" && "Pin" in message) {
                this.#options.onDiagnostic?.("moonlight", "OpenBot: received local pairing PIN.\n");
                const pairingId = yield* this.#waitForPairingRequestEffect();
                yield* sunshineRequestEffect(
                  yield* desktopSync(() => this.#requireSunshineHttpsPort()),
                  "/api/pin",
                  this.#options.credentials,
                  join(this.#options.stateDirectory, "sunshine-cert.pem"),
                  JSON.stringify({ pairing_id: pairingId, pin: message.Pin, name: "OpenBot Remote Desktop" }),
                );
                this.#options.onDiagnostic?.("moonlight", "OpenBot: submitted local pairing PIN.\n");
                pinSubmitted = true;
                continue;
              }
              if (typeof message === "object" && "Paired" in message) return;
              return yield* desktopFailure(new Error(sourceText("error.backend.moonlightRejectedPairing")));
            }
          }
          if (!pinSubmitted) return yield* desktopFailure(new Error(sourceText("error.backend.moonlightNoPin")));
          return yield* desktopFailure(new Error(sourceText("error.backend.moonlightPairingIncomplete")));
        }),
      (response) =>
        Effect.sync(() => {
          response.destroy();
        }),
    );
  });

  readonly #assertEmbeddedPermissionsEffect = Effect.fn("SunshineMoonlightRuntime.assertEmbeddedPermissions")(
    function* (
      this: SunshineMoonlightRuntime,
      baseUrl: string,
      user: string,
    ): Effect.fn.Return<void, RemoteDesktopOperationError> {
      const { role } = yield* moonlightJsonEffect(
        baseUrl,
        "/api/role",
        moonlightRoleSchema,
        this.#moonlightHeader,
        {},
        user,
      );
      if (role.permissions.allow_transport_webrtc !== true || role.permissions.allow_transport_websockets !== false) {
        return yield* desktopFailure(new Error(sourceText("error.backend.moonlightWebNotEmbedded")));
      }
    },
  );

  readonly #startIceServerEffect = Effect.fn("SunshineMoonlightRuntime.startIceServer")(function* (
    this: SunshineMoonlightRuntime,
  ): Effect.fn.Return<string, RemoteDesktopOperationError> {
    if (this.#iceServer) {
      const address = Schema.decodeUnknownResult(localAddressSchema)(this.#iceServer.address());
      if (Result.isSuccess(address)) return yield* desktopCall(() => `http://127.0.0.1:${address.success.port}/ice`);
    }
    this.#iceToken = randomBytes(32).toString("base64url");
    let retained = false;
    return yield* Effect.acquireUseRelease(
      desktopSync(() =>
        createServer((request, response) => {
          if (request.url !== "/ice" || request.headers.authorization !== `Bearer ${this.#iceToken}`) {
            response.writeHead(401).end();
            return;
          }
          void runCauseEffect(
            this.#options.getIceServers().pipe(
              Effect.flatMap((servers) =>
                desktopSync(() => {
                  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                  response.end(JSON.stringify(servers.map((server) => ({ ...server, urls: arrayUrls(server.urls) }))));
                }),
              ),
              Effect.catch(() =>
                Effect.sync(() => {
                  response.writeHead(503).end();
                }),
              ),
            ),
          );
        }),
      ),
      (server) =>
        Effect.gen({ self: this }, function* () {
          const port = yield* desktopCall(() =>
            listenLoopback(server, () => new Error(sourceText("error.backend.iceServerNoPort"))),
          );
          this.#iceServer = server;
          retained = true;
          return `http://127.0.0.1:${port}/ice`;
        }),
      (server) => (retained ? Effect.void : closeSocketEffect(server).pipe(Effect.catch(() => Effect.void))),
    );
  });

  // After a start, nothing waits on these processes. One that exits on its own would leave a runtime
  // that still reports itself started, and every new session would wait for a stream that never comes.
  #watchExit(child: ChildProcess, source: "sunshine" | "moonlight"): void {
    child.once("exit", (code, signal) => {
      // A stop clears the field before it waits. A start in progress fails its own readiness wait.
      if ((source === "sunshine" ? this.#sunshine : this.#moonlight) !== child || !this.#state) return;
      this.#state = null;
      this.#options.onDiagnostic?.(source, `OpenBot: ${source} exited unexpectedly (${signal ?? `code ${code}`}).\n`);
      this.#options.onExit?.(source);
    });
  }

  #pipeDiagnostics(process: ChildProcess, source: "sunshine" | "moonlight"): void {
    for (const stream of [process.stdout, process.stderr]) {
      // Sunshine writes to both streams and they interleave, so each keeps its own carry-over: one
      // shared between them would join a line neither printed and miss the one that matters.
      const saidCaptureDenied = createScreenCaptureDenialWatcher();
      stream?.on("data", (chunk) => {
        if (source === "sunshine" && saidCaptureDenied(chunk.toString("utf8"))) this.#screenCaptureDenied = true;
      });
      forwardDiagnosticLines(stream, (text) =>
        this.#options.onDiagnostic?.(source, text.replaceAll(this.#moonlightHeader, "[REDACTED]")),
      );
    }
  }
}

const moonlightJsonEffect = Effect.fn("RemoteDesktop.moonlightJson")(function* <T>(
  baseUrl: string,
  path: string,
  schema: Schema.Decoder<T>,
  authHeader: string,
  init: MoonlightRequestInit = {},
  user = moonlightSlotUser(1),
) {
  return yield* Effect.acquireUseRelease(
    moonlightHttpResponseEffect(baseUrl, path, init, user, authHeader),
    (response) => readJsonResponseEffect(response, schema, true),
    (response) =>
      Effect.sync(() => {
        response.destroy();
      }),
  );
});

const moonlightHttpResponseEffect = Effect.fn("RemoteDesktop.moonlightHttpResponse")(function* (
  baseUrl: string,
  path: string,
  init: MoonlightRequestInit,
  user: string,
  authHeader: string,
) {
  const body = init.body ?? "";
  const headers: Record<string, string> = {
    [authHeader]: user,
    "Content-Type": "application/json",
    ...(body ? { "Content-Length": String(Buffer.byteLength(body)) } : {}),
  };
  const response = yield* requestStreamEffect(`${baseUrl}${path}`, headers, body, init.method ?? "GET");
  if (!response.statusCode || response.statusCode >= 300) {
    response.resume();
    return yield* desktopFailure(
      new Error(sourceText("error.backend.moonlightApiHttp", { status: response.statusCode ?? 0 })),
    );
  }
  return response;
});

const sunshineRequestEffect = Effect.fn("RemoteDesktop.sunshineRequest")(function* (
  port: number,
  path: string,
  credentials: { username: string; password: string },
  certificatePath: string,
  body: string,
) {
  const tls = yield* sunshineTlsOptionsEffect(certificatePath);
  return yield* Effect.acquireUseRelease(
    httpsResponseEffect(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        ...tls,
        auth: `${credentials.username}:${credentials.password}`,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      body,
    ),
    (response) =>
      Effect.gen(function* () {
        yield* Effect.callback<void, RemoteDesktopOperationError>((resume) => {
          const end = () => resume(Effect.void);
          const fail = (cause: Error) => resume(Effect.fail(desktopFailure(cause)));
          response.once("end", end);
          response.once("error", fail);
          response.resume();
          return Effect.sync(() => {
            response.removeListener("end", end);
            response.removeListener("error", fail);
          });
        });
        if (!response.statusCode || response.statusCode >= 300)
          return yield* desktopFailure(new SunshineApiError(response.statusCode ?? 0));
      }),
    (response) =>
      Effect.sync(() => {
        response.destroy();
      }),
  );
});

const sunshineJsonEffect = Effect.fn("RemoteDesktop.sunshineJson")(function* <T>(
  port: number,
  path: string,
  credentials: { username: string; password: string },
  certificatePath: string,
  schema: Schema.Decoder<T>,
) {
  const tls = yield* sunshineTlsOptionsEffect(certificatePath);
  return yield* Effect.acquireUseRelease(
    httpsResponseEffect({
      hostname: "127.0.0.1",
      port,
      path,
      ...tls,
      auth: `${credentials.username}:${credentials.password}`,
      headers: { Accept: "application/json" },
    }),
    (response) =>
      Effect.gen(function* () {
        if (!response.statusCode || response.statusCode >= 300)
          return yield* desktopFailure(new SunshineApiError(response.statusCode ?? 0));
        return yield* readJsonResponseEffect(response, schema, false);
      }),
    (response) =>
      Effect.sync(() => {
        response.destroy();
      }),
  );
});

const readJsonResponseEffect = Effect.fn("RemoteDesktop.readJsonResponse")(function* <T>(
  response: IncomingMessage,
  schema: Schema.Decoder<T>,
  firstLine: boolean,
) {
  const iterator = response[Symbol.asyncIterator]();
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  for (;;) {
    const next = yield* desktopCall(() => iterator.next());
    if (next.done) {
      buffer += decoder.end();
      break;
    }
    buffer += decoder.write(Buffer.from(next.value));
    const newline = buffer.indexOf("\n");
    if (firstLine && newline >= 0) {
      buffer = buffer.slice(0, newline);
      break;
    }
  }
  if (firstLine && !buffer.trim())
    return yield* desktopFailure(new Error(sourceText("error.backend.moonlightEmptyResponse")));
  const json = yield* desktopSync(() => JSON.parse(buffer));
  return yield* Schema.decodeUnknownEffect(schema)(json).pipe(Effect.mapError(desktopFailure));
});

const requestStreamEffect = Effect.fn("RemoteDesktop.requestStream")(
  (url: string, headers: Record<string, string>, body: string, method = "POST") =>
    Effect.callback<IncomingMessage, RemoteDesktopOperationError>((resume) => {
      let retained = false;
      const request = httpRequest(url, { method, headers }, (response) => {
        retained = true;
        resume(Effect.succeed(response));
      });
      request.setTimeout(10_000, () => request.destroy(new Error(sourceText("error.backend.remoteDesktopTimeout"))));
      request.once("error", (cause) => resume(Effect.fail(desktopFailure(cause))));
      request.end(body);
      return Effect.sync(() => {
        if (!retained) request.destroy();
      });
    }),
);

const httpsResponseEffect = Effect.fn("RemoteDesktop.httpsResponse")(
  (
    options: https.RequestOptions,
    body?: string,
    timeoutMs = 10_000,
    timeoutMessage = sourceText("error.backend.remoteDesktopTimeout"),
  ) =>
    Effect.callback<IncomingMessage, RemoteDesktopOperationError>((resume) => {
      let retained = false;
      const receive = (response: IncomingMessage) => {
        retained = true;
        resume(Effect.succeed(response));
      };
      const request = body === undefined ? https.get(options, receive) : https.request(options, receive);
      request.setTimeout(timeoutMs, () => request.destroy(new Error(timeoutMessage)));
      request.once("error", (cause) => resume(Effect.fail(desktopFailure(cause))));
      if (body !== undefined) request.end(body);
      return Effect.sync(() => {
        if (!retained) request.destroy();
      });
    }),
);

type WatchedChild = Pick<ChildProcess, "exitCode" | "signalCode">;
function childEnded(child: WatchedChild | null | undefined): boolean {
  return child !== null && child !== undefined && (child.exitCode !== null || child.signalCode !== null);
}

const waitForHttpsEffect = Effect.fn("RemoteDesktop.waitForHttps")(function* (
  port: number,
  certificatePath: string,
  child?: WatchedChild | null,
) {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (childEnded(child))
      return yield* desktopFailure(
        new Error(sourceText("error.backend.sunshineExited", { port }), { cause: lastError }),
      );
    const ready = yield* Effect.result(
      Effect.gen(function* () {
        const tls = yield* sunshineTlsOptionsEffect(certificatePath);
        yield* Effect.acquireUseRelease(
          httpsResponseEffect(
            { hostname: "127.0.0.1", port, path: "/", ...tls },
            undefined,
            readinessAttemptTimeout(deadline),
            sourceText("error.backend.sunshineNoAnswer"),
          ),
          (response) =>
            Effect.sync(() => {
              response.resume();
            }),
          (response) =>
            Effect.sync(() => {
              response.destroy();
            }),
        );
      }),
    );
    if (Result.isSuccess(ready)) return;
    lastError = ready.failure.cause;
    yield* Effect.sleep(200);
  }
  const message =
    lastError instanceof Error
      ? sourceText("error.backend.sunshineNotReadyReason", { reason: lastError.message })
      : sourceText("error.backend.sunshineNotReady");
  return yield* desktopFailure(new Error(message, { cause: lastError }));
});

const sunshineTlsOptionsEffect = Effect.fn("RemoteDesktop.sunshineTlsOptions")(function* (certificatePath: string) {
  const ca = yield* desktopCall(() => readFile(certificatePath));
  const expected = yield* desktopSync(() => new X509Certificate(ca).raw);
  return {
    allowPartialTrustChain: true as const,
    ca,
    checkServerIdentity: (_hostname: string, certificate: PeerCertificate): Error | undefined => {
      const presented = certificate.raw;
      if (presented.length === expected.length && timingSafeEqual(presented, expected)) return undefined;
      return new Error(sourceText("error.backend.sunshineTlsUnexpected"));
    },
  };
});

const waitForHttpEffect = Effect.fn("RemoteDesktop.waitForHttp")(function* (
  url: string,
  init: RequestInit,
  child?: WatchedChild | null,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (childEnded(child))
      return yield* desktopFailure(new Error(sourceText("error.backend.moonlightWebExited", { url })));
    const ready = yield* Effect.result(
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: (signal) =>
            fetch(url, {
              ...init,
              signal: AbortSignal.any([signal, AbortSignal.timeout(readinessAttemptTimeout(deadline))]),
            }),
          catch: desktopFailure,
        }),
        (response) => Effect.succeed(response.ok),
        (response) => desktopCall(() => response.body?.cancel()).pipe(Effect.catch(() => Effect.void)),
      ),
    );
    if (Result.isSuccess(ready) && ready.success) return;
    yield* Effect.sleep(200);
  }
  return yield* desktopFailure(new Error(sourceText("error.backend.moonlightWebNotReady")));
});

/** Keep each readiness attempt inside the original overall deadline. */
function readinessAttemptTimeout(deadline: number): number {
  return Math.max(1, Math.min(READINESS_ATTEMPT_TIMEOUT_MS, deadline - Date.now()));
}

const reservePort = Effect.fn("RemoteDesktop.reservePort")(() =>
  Effect.acquireUseRelease(
    listenTcpEffect(0),
    (server) =>
      Schema.decodeUnknownEffect(localAddressSchema)(server.address()).pipe(
        Effect.map((address) => address.port),
        Effect.mapError(desktopFailure),
      ),
    (server) => closeSocketEffect(server).pipe(Effect.orDie),
  ),
);

function arrayUrls(urls: string | string[]): string[] {
  return Array.isArray(urls) ? urls : [urls];
}

function moonlightSlotUser(slot: number): string {
  return `openbot-remote-slot-${slot}`;
}

/** Pinned Sunshine http::save_user_creds / util::Hex encoding. */
export function sunshinePasswordHash(password: string, salt: string): string {
  return createHash("sha256")
    .update(password + salt)
    .digest()
    .reverse()
    .toString("hex")
    .toUpperCase();
}
