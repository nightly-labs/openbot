import { SIGNAL_NO_READY_CLOSE_CODE } from "@openbot/contracts/signal-protocol/messages";
import { ticketNamesSignalHome } from "@openbot/contracts/signal-protocol/ticket";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Context, Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamWebRtcBridge } from "./team-webrtc-bridge";
import { type IncomingConnection, TeamWebRtcHostPeer, type TeamWebRtcHostPeerOptions } from "./team-webrtc-host-peer";

interface TeamWebRtcHostGatewayOptions extends TeamWebRtcHostPeerOptions {
  /** A new ticket for the host's home Signal. `failedSignalUrl` names a home that did not answer. */
  renewSignal?: (
    hostId: string,
    failedSignalUrl?: string,
  ) => Effect.Effect<{ signalUrl: string; ticket: string }, RemoteWorkflowError>;
  /**
   * True when the account service refused a `renewSignal` for good, such as for a machine token that it
   * no longer accepts. The same request cannot succeed, so the host does not send it again.
   */
  renewalRefused?: (cause: unknown) => boolean;
  /** `reason` names the last Signal close or error code for the log, never its text. */
  onSignalRecoveryFailure?: (error: Error, reason: string) => void;
  /** True when devices could not reach the host through Signal for a long time; false when they can again. */
  onSignalLost?: (lost: boolean) => void;
  /** Whether devices may connect only over a private network, such as the Wi-Fi or Tailscale. */
  privateNetwork?: () => boolean;
}

const logger = createOpenBotLogger("team-webrtc-host");

// How long the host's Signal socket can stay closed before the host asks for another Signal machine.
// The time starts at the first close and stops when Signal accepts the host again. Each move that does
// not make the socket ready doubles the time, up to `SIGNAL_MOVE_LIMIT_MS`. With a fixed time, a host
// that reached no home asked for a ticket about every 50 s (20 s here and the 30 s ready wait) without end.
const SIGNAL_MOVE_AFTER_MS = 20_000;
const SIGNAL_MOVE_LIMIT_MS = 10 * 60_000;
// A host with no `ready` for this long reports the lost registration, so `openbot status` and the
// app show it (#3749). The host stays `online`: a restart would drop the devices that are connected
// now. It is longer than the reconnect backoff, so a Signal restart does not cause it.
const SIGNAL_LOST_REPORT_AFTER_MS = 3 * 60_000;

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
              // Local Signal can answer before the bridge command resolves.
              bridge.on("signalReady", onReady);
              bridge.on("error", onError);
            }),
            () =>
              Effect.gen(function* () {
                // The route is read after the bridge starts: a change before that finds no port to post to.
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
  // The last close or error code of the host's own Signal socket, such as `close 4000`.
  #lastSignalEnd: string | null = null;
  #localApiPort: number | null = null;
  // The Signal URL of the host's registration, which a move names as the failed one.
  #signalUrl: string | null = null;
  #signalMoveTimer: ReturnType<typeof setTimeout> | null = null;
  #signalLostTimer: ReturnType<typeof setTimeout> | null = null;
  #signalLostReported = false;
  // Set when the hidden window ends the host peer for good during a move, as it does after
  // `authentication_required` or close code 4000.
  #signalEnded = false;
  // The host's ticket names a home Signal machine. Only then can a move find another machine; the entry
  // Signal moves by DNS, and the hidden window keeps the device peers while it connects again.
  #signalHomed = false;
  // The moves since Signal last accepted the host. Each one doubles the time before the next.
  #signalMoves = 0;
  // The account service refused a Signal ticket for good. No move or renewal is sent until the next start, which
  // registers the host again and gets a new machine token.
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
    this.#signalMoves = 0;
    this.#signalRenewalRefused = false;
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

  /**
   * Loads the bridge window before the Signal ticket exists. `start` then uses the same load, so a
   * host start does not wait for the window after its account requests.
   */
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
      this.#signalMoves = 0;
      this.#signalRenewalRefused = false;
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

  /** Applies a changed network route to the connected host. A later connection reads it itself. */
  readonly applyNetworkRoute = Effect.fn("HostGateway.applyNetworkRoute")(function* (this: TeamWebRtcHostGateway) {
    if (this.#hostId) yield* this.#bridge.setPrivateNetwork(this.#hostId, this.#options.privateNetwork?.() ?? false);
  }).bind(this);

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
      this.#signalEnded = true;
      this.#cancelSignalMove();
      this.#cancelSignalLostReport();
      const fiber = this.#runtime.runFork(this.#clearPeers());
      this.#operations.add(fiber);
      fiber.addObserver(() => this.#operations.delete(fiber));
      // The bridge does not reconnect a host peer that Signal closed for good, such as with code
      // 4000 or after a `protocol_error`. Report it like a failed recovery, so the host leaves
      // `online` and a hosted server publishes again. A start or a recovery reports its own failure.
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

  // One line for each close: a socket that connects again does so on the backoff steps.
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

  // One timer for each outage, as for the move.
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
    // A start or a recovery reports its own failure.
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

  // One timer for each outage: a later close does not start the time again.
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

  // The home Signal machine did not accept the host again in time. The account service gets its URL
  // as the failed one and can give the host another home. When the ticket request or the new
  // connection fails, the hidden window continues to connect and the host tries again later. When the
  // account service refuses the ticket for good, such as for a machine token that it no longer accepts
  // (401), the host stops asking: a start registers it again.
  readonly #moveSignal = (): void => {
    this.#signalMoveTimer = null;
    const hostId = this.#hostId;
    if (!hostId) return;
    if (this.#connecting || this.#signalRecovery) {
      this.#scheduleSignalMove();
      return;
    }
    logger.warn(`Host Signal socket is not ready after ${this.#lastSignalEnd ?? "a close"}; it asks for a new home.`);
    // A move that succeeds but does not make the socket ready also counts: the next close starts a
    // longer time.
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
            // The socket still connects again to its home, which can come back. A long outage shows as
            // the lost registration.
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
    // The message text can come from Signal, so only the code is logged. A late relayed frame gets
    // `permission_denied` for each ICE candidate and does not touch the registration.
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

  // The account service refused a Signal ticket for good. No move or renewal is sent until the next
  // start, which registers the host again.
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
  ): Effect.fn.Return<void, RemoteWorkflowError, HostSignal> {
    const renew = this.#options.renewSignal;
    if (!renew) return;
    const bootstrap = yield* renew(hostId, failedSignalUrl);
    if (this.#hostId !== hostId) return;
    // No other machine is configured. The device peers stay, and the hidden window connects again.
    if (failedSignalUrl !== undefined && bootstrap.signalUrl === failedSignalUrl && !this.#signalEnded) return;
    yield* this.#clearPeers();
    yield* HostSignal.use((signal) => signal.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
    if (this.#hostId !== hostId) return;
    this.#signalUrl = bootstrap.signalUrl;
    this.#signalEnded = false;
    this.#signalHomed = ticketNamesSignalHome(bootstrap.ticket);
    yield* HostSignal.use((signal) => signal.connect(hostId, bootstrap.signalUrl, bootstrap.ticket));
    if (this.#hostId !== hostId)
      yield* HostSignal.use((signal) => signal.disconnect(hostId)).pipe(Effect.catch(() => Effect.void));
  });
}
