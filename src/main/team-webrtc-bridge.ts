import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { RemoteDesktopIceServer } from "@openbot/contracts/ipc";
import type { IceServer } from "@openbot/contracts/signal-protocol/messages";
import type { RemoteMemberRole } from "@openbot/contracts/signal-protocol/ticket";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { BrowserWindow, MessageChannelMain, type MessagePortMain } from "electron";
import { z } from "zod";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";

export type TeamWebRtcChannel = "rpc" | "events" | "files" | "desktop";

interface TeamWebRtcBridgeEvents {
  accountProfileChanged: [peerId: string];
  accountServersChanged: [peerId: string];
  signalReady: [peerId: string];
  /** The Signal socket of a peer opened. Only the connection trace reads it. */
  signalOpen: [peerId: string];
  incoming: [
    peerId: string,
    connection: {
      hostId: string;
      connectionId: string;
      sessionId: string;
      userId: string;
      membershipId: string;
      role: RemoteMemberRole;
      sessionExpiresAt: number;
    },
  ];
  connected: [peerId: string, binding?: { localFingerprint: string; remoteFingerprint: string }];
  disconnected: [peerId: string];
  data: [peerId: string, channel: TeamWebRtcChannel, data: string | ArrayBuffer];
  path: [peerId: string, path: "p2p" | "relay"];
  error: [peerId: string, code: string, message: string];
  iceServers: [peerId: string, servers: RemoteDesktopIceServer[]];
}

interface TeamWebRtcBridgeOptions {
  developmentUrl?: string | null;
  preloadPath?: string;
  iceTransportPolicy?: "all" | "relay";
}

// The envelope the hidden peer window posts back, not the Signal protocol - it is one flat bag
// because a single `port.on("message")` handler dispatches every reply and event on it, and the
// discriminated Signal union it carries fragments of has already been decoded on the other side.
// The schema stays zod and stays strict about it: this is the renderer-to-main trust boundary, and
// the only thing shared with the wire contract is the shape of what crosses it, tied below.
const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
}) satisfies z.ZodType<IceServer>;
const bridgeMessageSchema = z
  .object({
    type: z.string().optional(),
    commandId: z.string().optional(),
    peerId: z.string().optional(),
    hostId: z.string().optional(),
    channel: z.enum(["rpc", "events", "files", "desktop"]).optional(),
    data: z.union([z.string(), z.instanceof(ArrayBuffer)]).optional(),
    path: z.enum(["p2p", "relay"]).optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    connectionId: z.string().optional(),
    sessionId: z.string().optional(),
    userId: z.string().optional(),
    membershipId: z.string().optional(),
    role: z.enum(["owner", "admin", "member"]).optional(),
    sessionExpiresAt: z.number().int().positive().optional(),
    localFingerprint: z.string().min(1).max(256).optional(),
    remoteFingerprint: z.string().min(1).max(256).optional(),
    iceServers: z.array(iceServerSchema).optional(),
  })
  .loose();
type BridgeMessage = z.infer<typeof bridgeMessageSchema>;

type BridgeCommand =
  | {
      type: "connect";
      peerId: string;
      signalUrl: string;
      token: string;
      peer: "host" | "client";
      iceTransportPolicy: "all" | "relay";
    }
  | { type: "prepare-signal"; peerId: string; signalUrl: string }
  | { type: "disconnect" | "disconnect-peer" | "restart-ice" | "close"; peerId: string }
  | { type: "send"; peerId: string; channel: TeamWebRtcChannel; data: string | ArrayBuffer };

const COMMAND_TIMEOUT_MS = 15_000;
const SEND_COMMAND_TIMEOUT_MS = 75_000;

export class TeamWebRtcBridge extends EventEmitter<TeamWebRtcBridgeEvents> {
  readonly #options: TeamWebRtcBridgeOptions;
  readonly #pending = new Map<string, Deferred.Deferred<void, RemoteWorkflowError>>();
  #window: BrowserWindow | null = null;
  #port: MessagePortMain | null = null;
  #ready: Fiber.Fiber<void, RemoteWorkflowError> | null = null;
  #scope = Scope.makeUnsafe();
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  readonly #iceServers = new Map<string, RemoteDesktopIceServer[]>();

  constructor(options: TeamWebRtcBridgeOptions = {}) {
    super();
    this.#options = options;
  }

  readonly start = Effect.fn("TeamWebRtcBridge.start")(function* (this: TeamWebRtcBridge) {
    if (this.#stopping) yield* Deferred.await(this.#stopping);
    if (this.#ready) return yield* Fiber.join(this.#ready);
    const ready = yield* Effect.forkIn(this.#start(), this.#scope, { startImmediately: false });
    this.#ready = ready;
    ready.addObserver((exit) => {
      if (Exit.isFailure(exit) && this.#ready === ready) {
        this.#reset(sourceText("error.remote.bridgeStartFailed"));
        this.#ready = null;
      }
    });
    yield* Fiber.join(ready);
  }).bind(this);

  readonly connect = Effect.fn("TeamWebRtcBridge.connect")(function* (
    this: TeamWebRtcBridge,
    input: { peerId: string; signalUrl: string; token: string; peer: "host" | "client" },
  ) {
    yield* this.start();
    yield* this.#command({ type: "connect", ...input, iceTransportPolicy: this.#options.iceTransportPolicy ?? "all" });
  }).bind(this);

  /**
   * Opens the Signal socket of a client peer before its ticket exists. The next `connect` of that
   * peer sends its hello on this socket when it names the same address. The socket closes if no
   * `connect` takes it soon. It carries nothing before the hello.
   */
  readonly prepareSignal = Effect.fn("TeamWebRtcBridge.prepareSignal")(function* (
    this: TeamWebRtcBridge,
    peerId: string,
    signalUrl: string,
  ) {
    yield* this.start();
    yield* this.#command({ type: "prepare-signal", peerId, signalUrl });
  }).bind(this);

  readonly disconnect = Effect.fn("TeamWebRtcBridge.disconnect")(function* (this: TeamWebRtcBridge, peerId: string) {
    if (this.#port) yield* this.#command({ type: "disconnect", peerId });
  }).bind(this);

  readonly disconnectPeer = Effect.fn("TeamWebRtcBridge.disconnectPeer")(function* (
    this: TeamWebRtcBridge,
    peerId: string,
  ) {
    if (this.#port) yield* this.#command({ type: "disconnect-peer", peerId });
  }).bind(this);

  readonly send = Effect.fn("TeamWebRtcBridge.send")(function* (
    this: TeamWebRtcBridge,
    peerId: string,
    channel: TeamWebRtcChannel,
    data: string | ArrayBuffer,
  ) {
    yield* this.start();
    yield* this.#command({ type: "send", peerId, channel, data });
  }).bind(this);

  readonly restartIce = Effect.fn("TeamWebRtcBridge.restartIce")(function* (this: TeamWebRtcBridge, peerId: string) {
    yield* this.#command({ type: "restart-ice", peerId });
  }).bind(this);

  getIceServers(peerId: string): RemoteDesktopIceServer[] {
    return structuredClone(this.#iceServers.get(peerId) ?? []);
  }

  readonly stop = Effect.fn("TeamWebRtcBridge.stop")(function* (this: TeamWebRtcBridge) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const stopping = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = stopping;
    yield* Effect.gen({ self: this }, function* () {
      if (this.#port) yield* this.#command({ type: "close", peerId: "all" }).pipe(Effect.ignore);
      this.#ready = null;
      yield* Scope.close(this.#scope, Exit.void);
      yield* remoteDecode(() => this.#reset(sourceText("error.remote.bridgeStopped")));
      this.#scope = Scope.makeUnsafe();
    }).pipe(
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* () {
          yield* Deferred.done(stopping, exit);
          if (this.#stopping === stopping) this.#stopping = null;
        }),
      ),
    );
  }, Effect.uninterruptible).bind(this);

  #reset(message: string): void {
    this.#port?.close();
    this.#port = null;
    this.#window?.destroy();
    this.#window = null;
    this.#iceServers.clear();
    for (const pending of this.#pending.values()) {
      Deferred.doneUnsafe(pending, Effect.fail(new RemoteWorkflowError({ cause: new Error(message) })));
    }
    this.#pending.clear();
  }

  readonly #start = Effect.fn("TeamWebRtcBridge.load")(function* (this: TeamWebRtcBridge) {
    const window = yield* remoteDecode(
      () =>
        new BrowserWindow({
          show: false,
          webPreferences: {
            preload: this.#options.preloadPath ?? join(__dirname, "../preload/teamWebrtc.cjs"),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        }),
    );
    this.#window = window;
    yield* remoteDecode(() => window.webContents.setWindowOpenHandler(() => ({ action: "deny" })));
    yield* remoteCall(() =>
      this.#options.developmentUrl
        ? window.loadURL(new URL("team-webrtc.html", `${this.#options.developmentUrl}/`).toString())
        : window.loadURL("openbot-app://app/team-webrtc.html"),
    );
    const { port1, port2 } = yield* remoteDecode(() => new MessageChannelMain());
    this.#port = port1;
    const ready = Deferred.makeUnsafe<void>();
    const listener = (event: { data: unknown }) => {
      const message = bridgeMessageSchema.parse(event.data);
      this.#handleMessage(message);
      if (message.type === "bridge-ready") Deferred.doneUnsafe(ready, Effect.void);
    };
    yield* remoteDecode(() => {
      port1.on("message", listener);
      port1.start();
    });
    yield* Effect.gen(function* () {
      yield* remoteDecode(() => window.webContents.postMessage("openbot-team-webrtc-port", null, [port2]));
      yield* Deferred.await(ready).pipe(
        Effect.timeoutOrElse({
          duration: 10_000,
          orElse: () =>
            Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.bridgeDidNotStart")) })),
        }),
      );
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit) ? remoteDecode(() => port1.off("message", listener)).pipe(Effect.orDie) : Effect.void,
      ),
    );
  });

  readonly #command = Effect.fn("TeamWebRtcBridge.command")(function* (this: TeamWebRtcBridge, command: BridgeCommand) {
    const port = this.#port;
    if (!port) return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.bridgeNotReady")) });
    const commandId = crypto.randomUUID();
    yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const pending = Deferred.makeUnsafe<void, RemoteWorkflowError>();
        this.#pending.set(commandId, pending);
        return pending;
      }),
      (pending) =>
        Effect.gen(function* () {
          yield* remoteDecode(() => port.postMessage({ ...command, commandId }));
          yield* Deferred.await(pending).pipe(
            Effect.timeoutOrElse({
              duration: command.type === "send" ? SEND_COMMAND_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
              orElse: () =>
                Effect.fail(
                  new RemoteWorkflowError({
                    cause: new Error(sourceText("error.remote.bridgeCommandTimeout", { command: command.type })),
                  }),
                ),
            }),
          );
        }),
      () =>
        Effect.sync(() => {
          this.#pending.delete(commandId);
        }),
    );
  });

  #handleMessage(message: BridgeMessage): void {
    if ((message.type === "command-complete" || message.type === "command-error") && message.commandId) {
      const pending = this.#pending.get(message.commandId);
      if (!pending) return;
      this.#pending.delete(message.commandId);
      Deferred.doneUnsafe(
        pending,
        message.type === "command-complete"
          ? Effect.void
          : Effect.fail(
              new RemoteWorkflowError({
                cause: new Error(message.message ?? sourceText("error.remote.bridgeCommandFailed")),
              }),
            ),
      );
      return;
    }
    if (!message.peerId) return;
    if (
      message.type === "incoming-peer" &&
      message.hostId &&
      message.connectionId &&
      message.sessionId &&
      message.userId &&
      message.membershipId &&
      message.role &&
      message.sessionExpiresAt
    ) {
      this.emit("incoming", message.peerId, {
        hostId: message.hostId,
        connectionId: message.connectionId,
        sessionId: message.sessionId,
        userId: message.userId,
        membershipId: message.membershipId,
        role: message.role,
        sessionExpiresAt: message.sessionExpiresAt,
      });
    } else if (message.type === "account-profile-changed") this.emit("accountProfileChanged", message.peerId);
    else if (message.type === "account-servers-changed") this.emit("accountServersChanged", message.peerId);
    else if (message.type === "signal-ready") this.emit("signalReady", message.peerId);
    else if (message.type === "signal-open") this.emit("signalOpen", message.peerId);
    else if (message.type === "peer-connected" && message.localFingerprint && message.remoteFingerprint)
      this.emit("connected", message.peerId, {
        localFingerprint: message.localFingerprint,
        remoteFingerprint: message.remoteFingerprint,
      });
    else if (message.type === "peer-disconnected") this.emit("disconnected", message.peerId);
    else if (message.type === "ice-path" && message.path) this.emit("path", message.peerId, message.path);
    else if (message.type === "ice-servers" && message.iceServers) {
      this.#iceServers.set(message.peerId, message.iceServers);
      this.emit("iceServers", message.peerId, structuredClone(message.iceServers));
    } else if (message.type === "data" && message.channel && message.data !== undefined)
      this.emit("data", message.peerId, message.channel, message.data);
    else if (message.type === "peer-error")
      this.emit(
        "error",
        message.peerId,
        message.code ?? "webrtc_error",
        message.message ?? sourceText("error.remote.webRtcFailed"),
      );
  }
}
