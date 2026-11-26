import type { TeamMemberSummary } from "@openbot/contracts/ipc";
import {
  openWatchRequest,
  sealWatchReply,
  verifyWatchProof,
  WATCH_RELAY_REPLY_SEALED_LIMIT,
  WATCH_SESSION_TTL_MS,
  type WatchRelayRequest,
  type WatchTicketClaims,
  watchClockAccepts,
  watchProofMessage,
  watchSealedDigest,
} from "@openbot/contracts/signal-protocol/watch-relay";
import type { WatchRelaySetup } from "@openbot/contracts/team-protocol/watch-relay-v1";
import type { WatchCommand } from "@openbot/contracts/watch-protocol";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Exit, Result } from "effect";
import type { PreferenceStore } from "./preference-file";
import type { WatchIngressAnswer, WatchIngressDelivery } from "./signal-ingress";
import type {
  WatchCommandReply,
  WatchRelayCommands,
  WatchRelayContext,
  WatchRelayMember,
} from "./watch-relay-commands";
import type { WatchRelayKey, WatchRelayWanted } from "./watch-relay-key";
import { shrunkWatchSnapshots } from "./watch-relay-snapshot";

const logger = createOpenBotLogger("watch-relay");

const REPLAY_WINDOW_MS = 10 * 60_000;
const REPLAY_LIMIT = 10_000;
const WANTED_WRITE_STEP_MS = 60 * 60_000;
const LANGUAGE_LIMIT = 1_000;
const TIMER_LIMIT_MS = 2_147_483_647;
const REPLY_PLAINTEXT_LIMIT = Math.floor((WATCH_RELAY_REPLY_SEALED_LIMIT * 3) / 4) - 28;

export interface WatchRelayIngress {
  acquireWatchRelay(): () => void;
  authEpoch(): number | null;
}

export interface WatchRelayServiceOptions {
  hostId(): string | null;
  key: Effect.Effect<WatchRelayKey | null>;
  wanted: PreferenceStore<WatchRelayWanted>;
  ingress: WatchRelayIngress;
  verifyTicket(ticket: string): Effect.Effect<WatchTicketClaims, unknown>;
  member(membershipId: string, role: TeamMemberSummary["role"]): TeamMemberSummary | null;
  commands(): WatchRelayCommands | null;
  now?: () => number;
}

const answer = (status: WatchIngressAnswer["status"]): WatchIngressAnswer => ({ status });

export class WatchRelayService {
  readonly #options: WatchRelayServiceOptions;
  readonly #now: () => number;
  readonly #key: Effect.Effect<WatchRelayKey | null>;
  readonly #seen = new Map<string, number>();
  readonly #languages = new Map<string, string>();
  #loadedKey: WatchRelayKey | null = null;
  #release: (() => void) | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(options: WatchRelayServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#key = Effect.runSync(Effect.cached(options.key)).pipe(
      Effect.tap((key) =>
        Effect.sync(() => {
          this.#loadedKey = key;
        }),
      ),
    );
  }

  available(): boolean {
    return this.#loadedKey !== null;
  }

  readonly start = Effect.fn("WatchRelay.start")(function* (this: WatchRelayService) {
    yield* this.#options.wanted
      .load()
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => logger.warn("The watch relay setting could not be read.", toLogValue(failure.cause))),
        ),
      );
    yield* this.#key;
    this.#hold(this.#options.wanted.get().wantedUntil);
  });

  readonly setup = Effect.fn("WatchRelay.setup")(function* (
    this: WatchRelayService,
  ): Effect.fn.Return<WatchRelaySetup | null> {
    const hostId = this.#options.hostId();
    const key = yield* this.#key;
    if (!hostId || !key) return null;
    yield* this.#want();
    return { hostId, watchKey: key.publicKey };
  });

  readonly deliver = Effect.fn("WatchRelay.deliver")(function* (
    this: WatchRelayService,
    delivery: WatchIngressDelivery,
  ): Effect.fn.Return<WatchIngressAnswer> {
    const hostId = this.#options.hostId();
    const key = yield* this.#key;
    const commands = this.#options.commands();
    if (!hostId || !key || !commands) return answer(503);
    const verified = yield* this.#options.verifyTicket(delivery.ticket).pipe(Effect.result);
    if (Result.isFailure(verified)) return answer(401);
    const claims = verified.success;
    if (claims.hostId !== hostId) return answer(403);
    const epoch = this.#options.ingress.authEpoch();
    if (epoch === null || claims.authEpoch !== epoch) return answer(401);
    const member = this.#options.member(claims.membershipId, claims.role);
    if (!member || member.disabled) return answer(403);
    if (!watchClockAccepts(delivery.ts, this.#now())) return answer(401);
    const proven = yield* Effect.tryPromise(async () =>
      verifyWatchProof(
        claims.clientPublicKey,
        watchProofMessage(hostId, claims.jti, await watchSealedDigest(delivery.sealed), delivery.ts),
        delivery.proof,
      ),
    ).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!proven) return answer(401);
    const opened = yield* Effect.tryPromise(() =>
      openWatchRequest(key.privateKey, hostId, claims.jti, delivery.sealed),
    ).pipe(Effect.result);
    if (Result.isFailure(opened)) return answer(400);
    const request = opened.success;
    if (!this.#firstSight(request.id)) return answer(400);
    yield* this.#want();
    const context: WatchRelayContext = {
      hostId,
      watchKey: key.publicKey,
      language: this.#language(claims.watchSessionId, request.command),
    };
    const relayMember: WatchRelayMember = { id: member.id, userId: claims.userId, role: claims.role };
    const exit = yield* commands.run(relayMember, request.command, context).pipe(Effect.exit);
    const reply: WatchCommandReply = Exit.isSuccess(exit)
      ? exit.value
      : { result: { ok: false, error: "failed", message: "" }, snapshot: null };
    const sealed = yield* this.#seal(request, reply).pipe(Effect.result);
    if (Result.isFailure(sealed)) return answer(503);
    return { status: 200, sealed: sealed.success };
  });

  readonly dispose = Effect.fn("WatchRelay.dispose")(function* (this: WatchRelayService) {
    yield* Effect.sync(() => {
      this.#disposed = true;
      this.#clearTimer();
      this.#release?.();
      this.#release = null;
    });
  });

  #language(watchSessionId: string, command: WatchCommand): string | undefined {
    if (command.type === "refresh" && command.language) {
      this.#languages.delete(watchSessionId);
      this.#languages.set(watchSessionId, command.language);
      if (this.#languages.size > LANGUAGE_LIMIT) {
        const oldest = this.#languages.keys().next().value;
        if (oldest !== undefined) this.#languages.delete(oldest);
      }
    }
    return this.#languages.get(watchSessionId);
  }

  #firstSight(requestId: string): boolean {
    const now = this.#now();
    for (const [id, expiresAt] of this.#seen) {
      if (expiresAt > now && this.#seen.size < REPLAY_LIMIT) break;
      this.#seen.delete(id);
    }
    if (this.#seen.has(requestId)) return false;
    this.#seen.set(requestId, now + REPLAY_WINDOW_MS);
    return true;
  }

  readonly #seal = Effect.fn("WatchRelay.seal")(function* (
    this: WatchRelayService,
    request: WatchRelayRequest,
    reply: WatchCommandReply,
  ) {
    const text = fittedReply(reply);
    return yield* Effect.tryPromise(() => sealWatchReply(request.responseKey, request.id, text));
  });

  readonly #want = Effect.fn("WatchRelay.want")(function* (this: WatchRelayService) {
    const until = this.#now() + WATCH_SESSION_TTL_MS;
    if (until - this.#options.wanted.get().wantedUntil >= WANTED_WRITE_STEP_MS)
      yield* this.#options.wanted
        .set({ wantedUntil: until })
        .pipe(
          Effect.catch((failure) =>
            Effect.sync(() => logger.warn("The watch relay setting could not be saved.", toLogValue(failure.cause))),
          ),
        );
    this.#hold(until);
  });

  #hold(until: number): void {
    if (this.#disposed) return;
    const remaining = until - this.#now();
    if (remaining <= 0) {
      this.#clearTimer();
      this.#release?.();
      this.#release = null;
      return;
    }
    this.#release ??= this.#options.ingress.acquireWatchRelay();
    this.#clearTimer();
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.#hold(this.#options.wanted.get().wantedUntil);
      },
      Math.min(remaining, TIMER_LIMIT_MS),
    );
    this.#timer.unref?.();
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

function fittedReply({ result, snapshot }: WatchCommandReply): string {
  const fits = (text: string) => Buffer.byteLength(text) <= REPLY_PLAINTEXT_LIMIT;
  if (snapshot) {
    for (const candidate of shrunkWatchSnapshots(snapshot)) {
      const text = JSON.stringify({ ...result, snapshot: JSON.stringify(candidate) });
      if (fits(text)) return text;
    }
    return JSON.stringify(result);
  }
  const whole = JSON.stringify(result);
  if (fits(whole) || !result.ok || !result.avatars) return whole;
  const avatars: Record<string, string> = {};
  for (const [name, data] of Object.entries(result.avatars)) {
    if (!fits(JSON.stringify({ ...result, avatars: { ...avatars, [name]: data } }))) break;
    avatars[name] = data;
  }
  return JSON.stringify({ ...result, avatars });
}
