import { SIGNAL_NO_READY_CLOSE_CODE } from "@openbot/contracts/signal-protocol/messages";
import { ticketNamesSignalHome, ticketSignalHome } from "@openbot/contracts/signal-protocol/ticket";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Context, Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { type IncomingConnection, TeamWebRtcHostPeer, type TeamWebRtcHostPeerOptions } from "./team-webrtc-host-peer";

interface TeamWebRtcHostGatewayOptions extends TeamWebRtcHostPeerOptions {
  renewSignal?: (
    hostId: string,
    failedSignalUrl?: string,
  ) => Effect.Effect<{ signalUrl: string; ticket: string }, RemoteWorkflowError>;
  renewalRefused?: (cause: unknown) => boolean;
  onSignalRecoveryFailure?: (error: Error, reason: string) => void;
  onSignalLost?: (lost: boolean) => void;
  privateNetwork?: () => boolean;
  preferredSignalHome?: () => string | null;
}

const logger = createOpenBotLogger("team-webrtc-host");

const SIGNAL_MOVE_AFTER_MS = 20_000;
const SIGNAL_MOVE_LIMIT_MS = 10 * 60_000;
const SIGNAL_LOST_REPORT_AFTER_MS = 3 * 60_000;
const SIGNAL_HOME_RETURN_CHECK_MS = 15 * 60_000;
const SIGNAL_HOME_FOLLOW_DELAY_MS = 1_000;

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
    privateNetwork: () => boolean,
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
              bridge.on("signalReady", onReady);
              bridge.on("error", onError);
            }),
            () =>
              Effect.gen(function* () {
                const connecting = yield* Effect.forkIn(
                  bridge.start().pipe(
                    Effect.andThen(
                      Effect.suspend(() =>
                        bridge.connect({ peerId, signalUrl, token, peer: "host", privateNetwork: privateNetwork() }),
                      ),
                    ),
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
  #lastSignalEnd: string | null = null;
  #localApiPort: number | null = null;
  #signalUrl: string | null = null;
  #signalHome: string | null = null;
  #signalHomeReturnTimer: ReturnType<typeof setInterval> | null = null;
  #signalHomeFollowTimer: ReturnType<typeof setTimeout> | null = null;
  #signalMoveTimer: ReturnType<typeof setTimeout> | null = null;
  #signalLostTimer: ReturnType<typeof setTimeout> | null = null;
  #signalLostReported = false;
  #signalEnded = false;
  #signalHomed = false;
  #signalMoves = 0;
  #signalRenewalRefused = false;
  #connecting: Fiber.Fiber<void, RemoteWorkflowError> | null = null;
  #signalRecovery: Fiber.Fiber<void> | null = null;
  #stopping: Deferred.Deferred<void, RemoteWorkflowError> | null = null;
  #disposal: Deferred.Deferred<void, RemoteWorkflowError> | null = null;

  constructor(options: TeamWebRtcHostGatewayOptions) {
    this.#options = options;
    this.#bridge = options.bridge;
    this.#runtime = ManagedRuntime.make(
      HostSignal.layer(
        options.bridge,
        this.#connectionScope,
        this.#pendingConnections,
        () => options.privateNetwork?.() ?? false,
      ),
    );
    this.#bridge.on("incoming", this.#onIncoming);
    this.#bridge.on("disconnected", this.#onDisconnected);
    this.#bridge.on("error", this.#onError);
    this.#bridge.on("signalClosed", this.#onSignalClosed);
    this.#bridge.on("signalReady", this.#onSignalReady);
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
    this.#signalLostReported = false;
    this.#lastSignalEnd = null;
    this.#signalUrl = input.signalUrl;
    this.#signalEnded = false;
    this.#signalHomed = ticketNamesSignalHome(input.ticket);
    this.#signalHome = ticketSignalHome(input.ticket);
    this.#signalMoves = 0;
    this.#signalRenewalRefused = false;
    this.#localApiPort = input.localApiPort;
    this.#startSignalHomeReturnCheck();
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

  readonly prepare = Effect.fn("HostGateway.prepare")(function* (this: TeamWebRtcHostGateway) {
    yield* this.#bridge.start();
  }).bind(this);

  readonly stop = Effect.fn("HostGateway.stop")(function* (this: TeamWebRtcHostGateway) {
    if (this.#stopping) return yield* Deferred.await(this.#stopping);
    const stopped = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#stopping = stopped;
    return yield* Effect.gen({ self: this }, function* () {
      const hostId = this.#hostId;
      this.#hostId = null;
      this.#signalLostReported = false;
      this.#localApiPort = null;
      this.#signalUrl = null;
      this.#signalHome = null;
      this.#signalMoves = 0;
      this.#signalRenewalRefused = false;
      this.#stopSignalHomeReturnCheck();
      this.#cancelSignalHomeFollow();
      this.#cancelSignalMove();
      this.#cancelSignalLostReport();
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

  signalHome(): string | null {
    return this.#hostId ? this.#signalHome : null;
  }

  readonly #followSignalHome = Effect.fn("HostGateway.followSignalHome")(function* (this: TeamWebRtcHostGateway) {
    const hostId = this.#hostId;
    if (!hostId || this.#connecting || this.#signalRecovery || this.#signalRenewalRefused || !this.#options.renewSignal)
      return;
    const fiber = this.#runtime.runFork(
      this.#recoverSignal(hostId, undefined, true).pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            if (this.#hostId !== hostId) return;
            this.#noteRenewalRefused(cause);
            logger.warn("Host Signal home change failed; the host keeps its Signal.");
          }),
        ),
      ),
    );
    this.#signalRecovery = fiber;
    fiber.addObserver(() => {
      if (this.#signalRecovery === fiber) this.#signalRecovery = null;
    });
    yield* Fiber.join(fiber);
  }).bind(this);

  scheduleSignalHomeFollow(): void {
    this.#cancelSignalHomeFollow();
    if (!this.#hostId) return;
    this.#signalHomeFollowTimer = setTimeout(this.#followSignalHomeNow, SIGNAL_HOME_FOLLOW_DELAY_MS);
  }

  #cancelSignalHomeFollow(): void {
    if (this.#signalHomeFollowTimer !== null) clearTimeout(this.#signalHomeFollowTimer);
    this.#signalHomeFollowTimer = null;
  }

  readonly #followSignalHomeNow = (): void => {
    this.#signalHomeFollowTimer = null;
    const fiber = this.#runtime.runFork(this.#followSignalHome());
    this.#operations.add(fiber);
    fiber.addObserver(() => this.#operations.delete(fiber));
  };

  #startSignalHomeReturnCheck(): void {
    this.#stopSignalHomeReturnCheck();
    if (!this.#options.preferredSignalHome) return;
    this.#signalHomeReturnTimer = setInterval(this.#checkSignalHomeReturn, SIGNAL_HOME_RETURN_CHECK_MS);
  }

  #stopSignalHomeReturnCheck(): void {
    if (this.#signalHomeReturnTimer !== null) clearInterval(this.#signalHomeReturnTimer);
    this.#signalHomeReturnTimer = null;
  }

  readonly #checkSignalHomeReturn = (): void => {
    const preferred = this.#options.preferredSignalHome?.() ?? null;
    if (preferred === null || preferred === this.#signalHome || this.#signalEnded || !this.#signalHomed) return;
    this.#followSignalHomeNow();
  };

  readonly applyNetworkRoute = Effect.fn("HostGateway.applyNetworkRoute")(function* (this: TeamWebRtcHostGateway) {
    if (this.#hostId) yield* this.#bridge.setPrivateNetwork(this.#hostId, this.#options.privateNetwork?.() ?? false);
  }).bind(this);

  readonly revokeSession = Effect.fn("HostGateway.revokeSession")((sessionId: string) =>
    Effect.forEach([...this.#peers.values()], (peer) => peer.revokeSession(sessionId), {
      concurrency: "unbounded",
      discard: true,
    }),
  );

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
          this.#bridge.off("signalClosed", this.#onSignalClosed);
          this.#bridge.off("signalReady", this.#onSignalReady);
          yield* Fiber.awaitAll([...this.#operations]);
          yield* Scope.close(this.#connectionScope, Exit.void);
          yield* this.#runtime.disposeEffect;
        }),
      ),
      Effect.onExit((exit) => Effect.sync(() => Deferred.doneUnsafe(disposed, exit))),
    );
  }, Effect.uninterruptible).bind(this);

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
      this.#signalEnded = true;
      this.#cancelSignalMove();
      this.#cancelSignalLostReport();
      const fiber = this.#runtime.runFork(this.#clearPeers());
      this.#operations.add(fiber);
      fiber.addObserver(() => this.#operations.delete(fiber));
      if (!this.#connecting && !this.#signalRecovery)
        this.#options.onSignalRecoveryFailure?.(
          new Error(sourceText("error.remote.signalRecoveryFailed")),
          this.#lastSignalEnd ?? "peer closed",
        );
    } else {
      const peer = this.#peers.get(peerId);
      if (peer) this.#retire(peer);
      this.#peers.delete(peerId);
    }
  };

  readonly #onSignalClosed = (peerId: string, code: string, terminal: boolean): void => {
    if (peerId !== this.#hostId) return;
    this.#lastSignalEnd = `close ${code}`;
    if (terminal) {
      logger.warn(`Host Signal socket closed with code ${code}; it does not connect again.`);
      this.#cancelSignalMove();
      this.#cancelSignalLostReport();
    } else {
      if (code === SIGNAL_NO_READY_CLOSE_CODE)
        logger.warn("Host Signal socket did not answer in time; it connects again.");
      else logger.info(`Host Signal socket closed with code ${code}; it connects again.`);
      this.#scheduleSignalMove();
      this.#scheduleSignalLostReport();
    }
  };

  readonly #onSignalReady = (peerId: string): void => {
    if (peerId !== this.#hostId) return;
    this.#signalMoves = 0;
    this.#cancelSignalMove();
    this.#cancelSignalLostReport();
    if (this.#signalLostReported) {
      this.#signalLostReported = false;
      logger.info("Host Signal socket is ready again.");
      this.#options.onSignalLost?.(false);
    }
  };

  #scheduleSignalLostReport(): void {
    if (this.#signalLostTimer !== null || !this.#hostId) return;
    this.#signalLostTimer = setTimeout(this.#reportSignalLost, SIGNAL_LOST_REPORT_AFTER_MS);
  }

  #cancelSignalLostReport(): void {
    if (this.#signalLostTimer !== null) clearTimeout(this.#signalLostTimer);
    this.#signalLostTimer = null;
  }

  readonly #reportSignalLost = (): void => {
    this.#signalLostTimer = null;
    if (!this.#hostId) return;
    if (this.#connecting || this.#signalRecovery) {
      this.#scheduleSignalLostReport();
      return;
    }
    if (this.#signalLostReported) return;
    this.#signalLostReported = true;
    logger.warn(
      `Host Signal socket not ready ${SIGNAL_LOST_REPORT_AFTER_MS / 60_000} minutes after ${this.#lastSignalEnd ?? "a close"}.`,
    );
    this.#options.onSignalLost?.(true);
  };

  #scheduleSignalMove(): void {
    if (
      this.#signalMoveTimer !== null ||
      !this.#hostId ||
      !this.#signalHomed ||
      this.#signalRenewalRefused ||
      !this.#options.renewSignal
    )
      return;
    this.#signalMoveTimer = setTimeout(this.#moveSignal, this.#signalMoveDelay());
  }

  #signalMoveDelay(): number {
    return Math.min(SIGNAL_MOVE_AFTER_MS * 2 ** this.#signalMoves, SIGNAL_MOVE_LIMIT_MS);
  }

  #cancelSignalMove(): void {
    if (this.#signalMoveTimer !== null) clearTimeout(this.#signalMoveTimer);
    this.#signalMoveTimer = null;
  }

  readonly #moveSignal = (): void => {
    this.#signalMoveTimer = null;
    const hostId = this.#hostId;
    if (!hostId) return;
    if (this.#connecting || this.#signalRecovery) {
      this.#scheduleSignalMove();
      return;
    }
    logger.warn(`Host Signal socket is not ready after ${this.#lastSignalEnd ?? "a close"}; it asks for a new home.`);
    this.#signalMoves += 1;
    const fiber = this.#runtime.runFork(
      this.#recoverSignal(hostId, this.#signalUrl ?? undefined).pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            if (this.#hostId !== hostId) return;
            const refused = this.#noteRenewalRefused(cause);
            if (this.#signalEnded) {
              this.#options.onSignalRecoveryFailure?.(
                cause instanceof Error ? cause : new Error(sourceText("error.remote.signalRecoveryFailed")),
                `move ${refused ? "refused" : "failed"} after ${this.#lastSignalEnd ?? "a Signal close"}`,
              );
              return;
            }
            if (refused) return;
            logger.warn(
              `Host Signal move failed; the host tries again in ${Math.round(this.#signalMoveDelay() / 1000)} s.`,
            );
            this.#scheduleSignalMove();
          }),
        ),
      ),
    );
    this.#signalRecovery = fiber;
    fiber.addObserver(() => {
      if (this.#signalRecovery === fiber) this.#signalRecovery = null;
    });
  };

  readonly #onError = (peerId: string, code: string, _message: string, terminal = false): void => {
    if (peerId === this.#hostId && (terminal || code !== "permission_denied")) {
      this.#lastSignalEnd = `error ${code}`;
      logger.warn(`Host Signal error ${code}; ${terminal ? "the socket does not connect again" : "the socket stays"}.`);
    }
    if (
      peerId !== this.#hostId ||
      !this.#options.renewSignal ||
      this.#signalRecovery ||
      this.#signalRenewalRefused ||
      (code !== "authentication_required" && code !== "session_revoked")
    )
      return;
    const fiber = this.#runtime.runFork(
      this.#recoverSignal(peerId).pipe(
        Effect.catch(({ cause }) =>
          Effect.sync(() => {
            if (this.#hostId !== peerId) return;
            this.#noteRenewalRefused(cause);
            this.#options.onSignalRecoveryFailure?.(
              cause instanceof Error ? cause : new Error(sourceText("error.remote.signalRecoveryFailed")),
              `recovery failed after ${this.#lastSignalEnd ?? "a Signal error"}`,
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

  #noteRenewalRefused(cause: unknown): boolean {
    if (this.#options.renewalRefused?.(cause) !== true) return false;
    if (!this.#signalRenewalRefused)
      logger.warn("The account service refused the host Signal ticket; the host does not ask again.");
    this.#signalRenewalRefused = true;
    this.#cancelSignalMove();
    return true;
  }

  readonly #recoverSignal = Effect.fn("HostGateway.recoverSignal")(function* (
    this: TeamWebRtcHostGateway,
    hostId: string,
    failedSignalUrl?: string,
    onlyToMove = false,
  ): Effect.fn.Return<void, RemoteWorkflowError, HostSignal> {
    const renew = this.#options.renewSignal;
    if (!renew) return;
    const bootstrap = yield* renew(hostId, failedSignalUrl);
    if (this.#hostId !== hostId) return;
    if (failedSignalUrl !== undefined && bootstrap.signalUrl === failedSignalUrl && !this.#signalEnded) return;
    if (onlyToMove && bootstrap.signalUrl === this.#signalUrl && !this.#signalEnded) return;
    yield* this.#clearPeers();
    yield* HostSignal.use((signal) => signal.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
    if (this.#hostId !== hostId) return;
    this.#signalUrl = bootstrap.signalUrl;
    this.#signalEnded = false;
    this.#signalHomed = ticketNamesSignalHome(bootstrap.ticket);
    this.#signalHome = ticketSignalHome(bootstrap.ticket);
    yield* HostSignal.use((signal) => signal.connect(hostId, bootstrap.signalUrl, bootstrap.ticket));
    if (this.#hostId !== hostId)
      yield* HostSignal.use((signal) => signal.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
  });
}
