import { sourceText } from "@openbot/i18n/source";
import { Context, Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { type IncomingConnection, TeamWebRtcHostPeer, type TeamWebRtcHostPeerOptions } from "./team-webrtc-host-peer";

interface TeamWebRtcHostGatewayOptions extends TeamWebRtcHostPeerOptions {
  renewSignal?: (hostId: string) => Effect.Effect<{ signalUrl: string; ticket: string }, RemoteWorkflowError>;
  onSignalRecoveryFailure?: (error: Error) => void;
}

class HostSignal extends Context.Service<
  HostSignal,
  {
    connect(peerId: string, signalUrl: string, token: string): Effect.Effect<void, RemoteWorkflowError>;
    disconnect(peerId: string): Effect.Effect<void, RemoteWorkflowError>;
  }
>()("openbot/main/HostSignal") {
  static layer(
    bridge: TeamWebRtcBridge,
    scope: Scope.Scope,
    pendingConnections: Set<Fiber.Fiber<void, RemoteWorkflowError>>,
  ) {
    return Layer.succeed(
      HostSignal,
      HostSignal.of({
        disconnect: (peerId) => bridge.disconnect(peerId),
        connect: Effect.fn("HostSignal.connect")(function* (peerId: string, signalUrl: string, token: string) {
          const ready = Deferred.makeUnsafe<void, RemoteWorkflowError>();
          const onReady = (id: string) => {
            if (id === peerId) Deferred.doneUnsafe(ready, Effect.void);
          };
          const onError = (id: string, _code: string, message: string) => {
            if (id === peerId)
              Deferred.doneUnsafe(ready, Effect.fail(new RemoteWorkflowError({ cause: new Error(message) })));
          };
          return yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              // Local Signal can answer before the bridge command resolves.
              bridge.on("signalReady", onReady);
              bridge.on("error", onError);
            }),
            () =>
              Effect.gen(function* () {
                const connecting = yield* Effect.forkIn(
                  bridge
                    .connect({ peerId, signalUrl, token, peer: "host" })
                    .pipe(
                      Effect.tapError((error) => Effect.sync(() => Deferred.doneUnsafe(ready, Effect.fail(error)))),
                    ),
                  scope,
                  { startImmediately: false },
                );
                pendingConnections.add(connecting);
                connecting.addObserver(() => pendingConnections.delete(connecting));
                yield* Deferred.await(ready).pipe(
                  Effect.timeoutOrElse({
                    duration: "30 seconds",
                    orElse: () =>
                      Effect.fail(
                        new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.signalTimeout")) }),
                      ),
                  }),
                );
              }),
            () =>
              Effect.sync(() => {
                bridge.off("signalReady", onReady);
                bridge.off("error", onError);
              }),
          );
        }),
      }),
    );
  }
}

/** One Signal registration, with independently authenticated device connections. */
export class TeamWebRtcHostGateway {
  readonly #options: TeamWebRtcHostGatewayOptions;
  readonly #bridge: TeamWebRtcBridge;
  readonly #runtime: ManagedRuntime.ManagedRuntime<HostSignal, never>;
  readonly #connectionScope = Scope.makeUnsafe();
  readonly #operations = new Set<Fiber.Fiber<void, RemoteWorkflowError>>();
  readonly #pendingConnections = new Set<Fiber.Fiber<void, RemoteWorkflowError>>();
  readonly #retiring = new Set<Fiber.Fiber<void>>();
  readonly #peers = new Map<string, TeamWebRtcHostPeer>();
  #hostId: string | null = null;
  #localApiPort: number | null = null;
  #connecting: Fiber.Fiber<void, RemoteWorkflowError> | null = null;
  #signalRecovery: Fiber.Fiber<void> | null = null;
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  #disposal: Deferred.Deferred<void, RemoteWorkflowError> | null = null;

  constructor(options: TeamWebRtcHostGatewayOptions) {
    this.#options = options;
    this.#bridge = options.bridge;
    this.#runtime = ManagedRuntime.make(
      HostSignal.layer(options.bridge, this.#connectionScope, this.#pendingConnections),
    );
    this.#bridge.on("incoming", this.#onIncoming);
    this.#bridge.on("disconnected", this.#onDisconnected);
    this.#bridge.on("error", this.#onError);
  }

  #provide<A>(operation: Effect.Effect<A, RemoteWorkflowError, HostSignal>): Effect.Effect<A, RemoteWorkflowError> {
    return Effect.flatMap(this.#runtime.contextEffect, (context) => operation.pipe(Effect.provideContext(context)));
  }

  readonly start = Effect.fn("HostGateway.start")(function* (
    this: TeamWebRtcHostGateway,
    input: {
      hostId: string;
      signalUrl: string;
      ticket: string;
      localApiPort: number;
    },
  ) {
    this.#hostId = input.hostId;
    this.#localApiPort = input.localApiPort;
    const connecting = yield* Effect.forkIn(
      this.#provide(HostSignal.use((signal) => signal.connect(input.hostId, input.signalUrl, input.ticket))),
      this.#connectionScope,
      { startImmediately: false },
    );
    this.#connecting = connecting;
    connecting.addObserver(() => {
      if (this.#connecting === connecting) this.#connecting = null;
    });
    yield* Fiber.join(connecting).pipe(
      Effect.catch((error) => this.stop().pipe(Effect.andThen(Effect.fail(error)))),
      Effect.onInterrupt(() => this.stop().pipe(Effect.catch(() => Effect.void))),
    );
  }).bind(this);

  readonly stop = Effect.fn("HostGateway.stop")(function* (this: TeamWebRtcHostGateway) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const stopped = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = stopped;
    return yield* Effect.gen({ self: this }, function* () {
      const hostId = this.#hostId;
      this.#hostId = null;
      this.#localApiPort = null;
      if (this.#connecting) yield* Fiber.interrupt(this.#connecting);
      if (this.#signalRecovery) yield* Fiber.interrupt(this.#signalRecovery);
      yield* this.#clearPeers();
      yield* Fiber.awaitAll([...this.#pendingConnections]);
      if (hostId) yield* this.#bridge.disconnect(hostId);
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          Deferred.doneUnsafe(stopped, exit);
          this.#stopping = null;
        }),
      ),
    );
  }, Effect.uninterruptible).bind(this);

  readonly revokeSession = Effect.fn("HostGateway.revokeSession")((sessionId: string) =>
    Effect.forEach([...this.#peers.values()], (peer) => peer.revokeSession(sessionId), {
      concurrency: "unbounded",
      discard: true,
    }),
  );

  /** Whether any connected device has a file transfer moving right now, either direction. */
  hasActiveTransfers(): boolean {
    return [...this.#peers.values()].some((peer) => peer.hasActiveTransfers());
  }

  readonly dispose = Effect.fn("HostGateway.dispose")(function* (this: TeamWebRtcHostGateway) {
    if (this.#disposal) return yield* Deferred.await(this.#disposal);
    const disposed = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#disposal = disposed;
    return yield* this.stop().pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          this.#bridge.off("incoming", this.#onIncoming);
          this.#bridge.off("disconnected", this.#onDisconnected);
          this.#bridge.off("error", this.#onError);
          yield* Fiber.awaitAll([...this.#operations]);
          yield* Scope.close(this.#connectionScope, Exit.void);
          yield* this.#runtime.disposeEffect;
        }),
      ),
      Effect.onExit((exit) => Effect.sync(() => Deferred.doneUnsafe(disposed, exit))),
    );
  }, Effect.uninterruptible).bind(this);

  // These executions belong to the native bridge event callbacks below.
  #retire(peer: TeamWebRtcHostPeer): void {
    const fiber = this.#runtime.runFork(peer.dispose());
    this.#retiring.add(fiber);
    fiber.addObserver(() => this.#retiring.delete(fiber));
  }

  readonly #clearPeers = Effect.fn("HostGateway.clearPeers")(function* (this: TeamWebRtcHostGateway) {
    const peers = [...this.#peers.values()];
    this.#peers.clear();
    yield* Effect.forEach(peers, (peer) => peer.dispose(), { concurrency: "unbounded", discard: true });
    yield* Fiber.awaitAll([...this.#retiring]);
  });

  readonly #onIncoming = (peerId: string, connection: IncomingConnection): void => {
    if (connection.hostId !== this.#hostId || this.#localApiPort === null || peerId === this.#hostId) return;
    let peer = this.#peers.get(peerId);
    if (!peer) {
      peer = new TeamWebRtcHostPeer(this.#options, {
        peerId,
        hostId: connection.hostId,
        localApiPort: this.#localApiPort,
      });
      this.#peers.set(peerId, peer);
    }
    const fiber = this.#runtime.runFork(peer.incoming(connection));
    this.#operations.add(fiber);
    fiber.addObserver(() => this.#operations.delete(fiber));
  };

  readonly #onDisconnected = (peerId: string): void => {
    if (peerId === this.#hostId) {
      const fiber = this.#runtime.runFork(this.#clearPeers());
      this.#operations.add(fiber);
      fiber.addObserver(() => this.#operations.delete(fiber));
    } else {
      const peer = this.#peers.get(peerId);
      if (peer) this.#retire(peer);
      this.#peers.delete(peerId);
    }
  };

  readonly #onError = (peerId: string, code: string): void => {
    if (
      peerId !== this.#hostId ||
      !this.#options.renewSignal ||
      this.#signalRecovery ||
      (code !== "authentication_required" && code !== "session_revoked")
    )
      return;
    const fiber = this.#runtime.runFork(
      this.#recoverSignal(peerId).pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            if (this.#hostId === peerId)
              this.#options.onSignalRecoveryFailure?.(
                cause instanceof Error ? cause : new Error(sourceText("error.remote.signalRecoveryFailed")),
              );
          }),
        ),
      ),
    );
    this.#signalRecovery = fiber;
    fiber.addObserver(() => {
      if (this.#signalRecovery === fiber) this.#signalRecovery = null;
    });
  };

  readonly #recoverSignal = Effect.fn("HostGateway.recoverSignal")(function* (
    this: TeamWebRtcHostGateway,
    hostId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostSignal> {
    const renew = this.#options.renewSignal;
    if (!renew) return;
    const bootstrap = yield* renew(hostId);
    if (this.#hostId !== hostId) return;
    yield* this.#clearPeers();
    yield* HostSignal.use((signal) => signal.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
    if (this.#hostId !== hostId) return;
    yield* HostSignal.use((signal) => signal.connect(hostId, bootstrap.signalUrl, bootstrap.ticket));
    if (this.#hostId !== hostId)
      yield* HostSignal.use((signal) => signal.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
  });
}
