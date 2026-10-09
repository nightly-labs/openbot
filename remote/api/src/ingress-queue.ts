import { type QueuedSignalMessage, sealQueuedDelivery } from "@openbot/contracts/signal-protocol/ingress-queue";
import { Deferred, Effect } from "effect";

/**
 * The one path of every messaging platform for an event whose route has no `ingress` socket. Each
 * platform gives only its route, whether the event addresses OpenBot (`wakes`), and its delivery frame.
 *
 * Signal asks the account service for the route's host. A hosted server that sleeps starts for an event
 * that addresses OpenBot, and Signal keeps that event, sealed to the host's queue key, until the host's
 * socket holds the route again. Everything here is in memory: a restart of Signal loses it. Signal never
 * keeps an event that it cannot seal.
 */

export type IngressRoute =
  | { platform: "slack"; appId: string; teamId: string }
  | { platform: "discord"; guildId: string }
  | { platform: "telegram"; botId: string; chatId: string };

/** What the account service says of a route's host: `starting` is a hosted server that comes online. */
type RouteHostState = "not_hosted" | "ended" | "sleeping" | "starting";

export interface RouteWake {
  hostId: string | null;
  state: RouteHostState;
}

/**
 * Asks the account service for the host of a route, and starts it with `wake`. Null when the account
 * service did not answer: that is not remembered, so the next event asks again.
 */
export type RouteWaker = (route: IngressRoute, wake: boolean) => Effect.Effect<RouteWake | null>;

/**
 * `queued`: kept for the host. `hosted`: a hosted server has the route, but the event is not kept.
 * `unavailable`: no host can take the event now.
 */
type OfflineOutcome = "queued" | "hosted" | "unavailable";

export interface IngressQueueLimits {
  /** How long an event waits for its host. A hosted server starts in a few minutes. */
  ttlMilliseconds: number;
  /** A route of a hosted server asks the account service at most this often. */
  routeCheckMilliseconds: number;
  /** A route of a computer that is not a hosted server, or of a plan that ended, asks this often. */
  otherRouteCheckMilliseconds: number;
  maximumPerHost: number;
  maximumBytesPerHost: number;
  maximumBytes: number;
}

const DEFAULT_INGRESS_QUEUE_LIMITS: IngressQueueLimits = {
  ttlMilliseconds: 10 * 60_000,
  routeCheckMilliseconds: 60_000,
  otherRouteCheckMilliseconds: 10 * 60_000,
  maximumPerHost: 64,
  maximumBytesPerHost: 4 * 1024 * 1024,
  maximumBytes: 256 * 1024 * 1024,
};

/** How often expired events go when no other event or flush comes. */
const EXPIRY_INTERVAL_MILLISECONDS = 30_000;

/** Bounds the remembered routes. Past it, the entries older than the longest check interval go. */
const MAXIMUM_ROUTES = 100_000;

export interface QueuedFrame {
  /** `<platform>:<route key>`, as `queueRouteKey` makes it. */
  route: string;
  sealed: string;
  /** A Telegram callback query that the host can answer after the flush. */
  telegramCallback: { botId: string; queryId: string } | null;
}

interface QueueEntry extends QueuedFrame {
  /** The arrival order. The account service answers concurrent events in any order. */
  order: number;
  bytes: number;
  expiresAt: number;
}

export function queueRouteKey(platform: IngressRoute["platform"], key: string): string {
  return `${platform}:${key}`;
}

export class IngressQueue {
  readonly #waker: RouteWaker | null;
  readonly #limits: IngressQueueLimits;
  readonly #now: () => number;
  /** The queue key of each host, from its last `ingress` hello. */
  readonly #keys = new Map<string, string>();
  readonly #routes = new Map<string, { wake: RouteWake; at: number; woke: boolean }>();
  /** A route that asks the account service now. Concurrent events share the answer. */
  readonly #pending = new Map<string, { answer: Deferred.Deferred<RouteWake>; wake: boolean }>();
  readonly #queues = new Map<string, QueueEntry[]>();
  #bytes = 0;
  #order = 0;
  #expiry: ReturnType<typeof setInterval> | null = null;

  constructor(waker: RouteWaker | null, limits = DEFAULT_INGRESS_QUEUE_LIMITS, now: () => number = Date.now) {
    this.#waker = waker;
    this.#limits = limits;
    this.#now = now;
  }

  /** The key from the host's last `ingress` hello. A hello without one removes the earlier key. */
  rememberKey(hostId: string, queueKey: string | null): void {
    if (queueKey) this.#keys.set(hostId, queueKey);
    else this.#keys.delete(hostId);
  }

  /** Whether Signal can start hosts and keep their events. */
  get enabled(): boolean {
    return this.#waker !== null;
  }

  /** Drops every kept event and stops the expiry timer. */
  close(): void {
    if (this.#expiry) clearInterval(this.#expiry);
    this.#expiry = null;
    this.#queues.clear();
    this.#bytes = 0;
  }

  /**
   * One event for a route that no socket holds. `message` is the frame the host would get; it is kept
   * only when `wakes` is true and the host starts. It cannot be interrupted: a place it took in the
   * queue is always sealed or given back.
   */
  readonly offline = Effect.fn("IngressQueue.offline")(function* (
    this: IngressQueue,
    route: IngressRoute,
    routeKey: string,
    wakes: boolean,
    message: QueuedSignalMessage,
    telegramCallback: QueuedFrame["telegramCallback"] = null,
  ): Effect.fn.Return<OfflineOutcome> {
    const order = ++this.#order;
    if (!this.#waker) return "unavailable";
    const wake = yield* this.#check(route, routeKey, wakes);
    if (!wakes) return wake.state === "sleeping" || wake.state === "starting" ? "hosted" : "unavailable";
    const queueKey = wake.hostId ? this.#keys.get(wake.hostId) : undefined;
    if (wake.state !== "starting" || !wake.hostId || !queueKey) return "unavailable";
    const hostId = wake.hostId;
    this.#prune(hostId);
    const queue = this.#queues.get(hostId) ?? [];
    if (queue.length >= this.#limits.maximumPerHost) return "unavailable";
    // The place is taken before the seal, so the events of a route keep their order.
    const entry: QueueEntry = { route: routeKey, sealed: "", telegramCallback, order, bytes: 0, expiresAt: 0 };
    const later = queue.findIndex((item) => item.order > order);
    queue.splice(later < 0 ? queue.length : later, 0, entry);
    this.#queues.set(hostId, queue);
    const sealed = yield* Effect.tryPromise(() => sealQueuedDelivery(queueKey, hostId, message)).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    const hostBytes = (this.#queues.get(hostId) ?? []).reduce((total, item) => total + item.bytes, 0);
    if (sealed && this.#bytes + sealed.length > this.#limits.maximumBytes) this.#pruneAll();
    if (
      !sealed ||
      hostBytes + sealed.length > this.#limits.maximumBytesPerHost ||
      this.#bytes + sealed.length > this.#limits.maximumBytes
    ) {
      this.#remove(hostId, entry);
      return "unavailable";
    }
    entry.sealed = sealed;
    entry.bytes = sealed.length;
    entry.expiresAt = this.#now() + this.#limits.ttlMilliseconds;
    this.#bytes += entry.bytes;
    this.#startExpiry();
    return "queued";
  }, Effect.uninterruptible);

  /**
   * The kept events of a host whose new socket holds their routes, in order. Others wait, and so do the
   * later events of a route whose earlier event is still being sealed.
   */
  take(hostId: string, holds: (route: string) => boolean): QueuedFrame[] {
    this.#prune(hostId);
    const queue = this.#queues.get(hostId);
    if (!queue) return [];
    const ready: QueuedFrame[] = [];
    const waiting: QueueEntry[] = [];
    const sealing = new Set<string>();
    for (const entry of queue) {
      if (!entry.sealed) sealing.add(entry.route);
      if (entry.sealed && !sealing.has(entry.route) && holds(entry.route)) {
        ready.push({ route: entry.route, sealed: entry.sealed, telegramCallback: entry.telegramCallback });
        this.#bytes -= entry.bytes;
      } else waiting.push(entry);
    }
    if (waiting.length > 0) this.#queues.set(hostId, waiting);
    else this.#queues.delete(hostId);
    return ready;
  }

  readonly #check = Effect.fn("IngressQueue.check")(function* (
    this: IngressQueue,
    route: IngressRoute,
    routeKey: string,
    wake: boolean,
  ): Effect.fn.Return<RouteWake> {
    const now = this.#now();
    const known = this.#routes.get(routeKey);
    const hosted = known?.wake.state === "sleeping" || known?.wake.state === "starting";
    const fresh =
      known &&
      now - known.at < (hosted ? this.#limits.routeCheckMilliseconds : this.#limits.otherRouteCheckMilliseconds);
    // A route that was only looked up asks again to start a server that sleeps.
    if (fresh && (known.woke || !wake || known.wake.state !== "sleeping")) return known.wake;
    const current = this.#pending.get(routeKey);
    if (current) {
      const shared = yield* Deferred.await(current.answer);
      // A lookup did not start the server: this event asks again, with a wake.
      if (!wake || current.wake || shared.state !== "sleeping") return shared;
      return yield* this.#check(route, routeKey, wake);
    }
    const result = Deferred.makeUnsafe<RouteWake>();
    this.#pending.set(routeKey, { answer: result, wake });
    const waker = this.#waker;
    const asked = waker ? yield* waker(route, wake) : null;
    const answer: RouteWake = asked ?? { hostId: null, state: "not_hosted" };
    if (this.#routes.size >= MAXIMUM_ROUTES) this.#pruneRoutes(now);
    if (asked) this.#routes.set(routeKey, { wake: asked, at: now, woke: wake });
    this.#pending.delete(routeKey);
    yield* Deferred.succeed(result, answer);
    return answer;
  }, Effect.uninterruptible);

  #remove(hostId: string, entry: QueueEntry): void {
    const queue = this.#queues.get(hostId);
    if (!queue) return;
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.#queues.delete(hostId);
  }

  /** Expired events go on time also when no other event or flush comes for their host. */
  #startExpiry(): void {
    if (this.#expiry) return;
    this.#expiry = setInterval(() => {
      this.#pruneAll();
      if (this.#queues.size > 0 || !this.#expiry) return;
      clearInterval(this.#expiry);
      this.#expiry = null;
    }, EXPIRY_INTERVAL_MILLISECONDS);
    this.#expiry.unref?.();
  }

  /** Drops the events of a host that waited too long. A place still being sealed stays. */
  #prune(hostId: string): void {
    const queue = this.#queues.get(hostId);
    if (!queue) return;
    const now = this.#now();
    const kept = queue.filter((entry) => {
      if (!entry.sealed || entry.expiresAt > now) return true;
      this.#bytes -= entry.bytes;
      return false;
    });
    if (kept.length > 0) this.#queues.set(hostId, kept);
    else this.#queues.delete(hostId);
  }

  #pruneAll(): void {
    for (const hostId of [...this.#queues.keys()]) this.#prune(hostId);
  }

  #pruneRoutes(now: number): void {
    for (const [key, known] of this.#routes) {
      if (now - known.at >= this.#limits.otherRouteCheckMilliseconds) this.#routes.delete(key);
    }
  }
}
