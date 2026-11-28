import {
  type IngressRoute,
  type QueuedSignalMessage,
  type RouteHostState,
  sealQueuedDelivery,
} from "@openbot/contracts/signal-protocol/ingress-queue";
import { Deferred, Effect } from "effect";

export interface RouteWake {
  hostId: string | null;
  state: RouteHostState;
}

export type RouteWaker = (route: IngressRoute, wake: boolean) => Effect.Effect<RouteWake | null>;

type OfflineOutcome = "queued" | "hosted" | "unavailable" | "unlinked";

const FAILED_LOOKUP: RouteWake = { hostId: null, state: "not_hosted" };

export interface IngressQueueLimits {
  ttlMilliseconds: number;
  routeCheckMilliseconds: number;
  otherRouteCheckMilliseconds: number;
  maximumPerHost: number;
  maximumBytesPerHost: number;
  maximumBytes: number;
  webhookWakeMilliseconds: number;
}

const DEFAULT_INGRESS_QUEUE_LIMITS: IngressQueueLimits = {
  ttlMilliseconds: 10 * 60_000,
  routeCheckMilliseconds: 60_000,
  otherRouteCheckMilliseconds: 10 * 60_000,
  maximumPerHost: 64,
  maximumBytesPerHost: 192 * 1024,
  maximumBytes: 256 * 1024 * 1024,
  webhookWakeMilliseconds: 30 * 60_000,
};

const EXPIRY_INTERVAL_MILLISECONDS = 30_000;

const MAXIMUM_ROUTES = 100_000;

const MAXIMUM_KEYS = 100_000;

export interface QueuedFrame {
  id: string;
  route: string;
  sealed: string;
  telegramCallback: { botId: string; queryId: string } | null;
}

interface QueueEntry extends QueuedFrame {
  ingressRoute: IngressRoute;
  order: number;
  sentTo: string | null;
  bytes: number;
  expiresAt: number;
}

export interface HandedOverQueue {
  keys: [string, string][];
  entries: {
    id: string;
    hostId: string;
    route: IngressRoute;
    routeKey: string;
    sealed: string;
    telegramCallback: QueuedFrame["telegramCallback"];
    expiresAt: number;
  }[];
}

export function queueRouteKey(platform: IngressRoute["platform"], key: string): string {
  return `${platform}:${key}`;
}

export class IngressQueue {
  readonly #waker: RouteWaker | null;
  readonly #limits: IngressQueueLimits;
  readonly #now: () => number;
  readonly #keys = new Map<string, string>();
  readonly #routes = new Map<string, { wake: RouteWake; at: number; woke: boolean }>();
  readonly #pending = new Map<string, { answer: Deferred.Deferred<RouteWake>; wake: boolean }>();
  readonly #queues = new Map<string, QueueEntry[]>();
  readonly #webhookWakes = new Map<string, number>();
  #bytes = 0;
  #order = 0;
  #expiry: ReturnType<typeof setInterval> | null = null;

  readonly #fork: (work: Effect.Effect<unknown>) => void;

  constructor(
    waker: RouteWaker | null,
    options: { fork?: (work: Effect.Effect<unknown>) => void; now?: () => number } = {},
  ) {
    this.#waker = waker;
    this.#limits = DEFAULT_INGRESS_QUEUE_LIMITS;
    this.#fork = options.fork ?? ((work) => void Effect.runFork(work));
    this.#now = options.now ?? Date.now;
  }

  rememberKey(hostId: string, queueKey: string | null): void {
    this.#keys.delete(hostId);
    if (!queueKey) return;
    dropOldest(this.#keys, MAXIMUM_KEYS);
    this.#keys.set(hostId, queueKey);
  }

  get enabled(): boolean {
    return this.#waker !== null;
  }

  close(): void {
    if (this.#expiry) clearInterval(this.#expiry);
    this.#expiry = null;
    this.#queues.clear();
    this.#bytes = 0;
  }

  handOver(): HandedOverQueue {
    const now = this.#now();
    const entries: HandedOverQueue["entries"] = [];
    for (const [hostId, queue] of this.#queues) {
      for (const entry of queue) {
        if (!entry.sealed || entry.expiresAt <= now) continue;
        entries.push({
          id: entry.id,
          hostId,
          route: entry.ingressRoute,
          routeKey: entry.route,
          sealed: entry.sealed,
          telegramCallback: entry.telegramCallback,
          expiresAt: entry.expiresAt,
        });
      }
    }
    const keys = [...this.#keys];
    this.#queues.clear();
    this.#bytes = 0;
    return { keys, entries };
  }

  adopt(queue: HandedOverQueue): void {
    for (const [hostId, key] of queue.keys) if (!this.#keys.has(hostId)) this.rememberKey(hostId, key);
    const now = this.#now();
    for (const item of queue.entries) {
      const entries = this.#queues.get(item.hostId) ?? [];
      const bytes = item.sealed.length;
      if (
        item.expiresAt <= now ||
        entries.length >= this.#limits.maximumPerHost ||
        this.#bytes + bytes > this.#limits.maximumBytes ||
        entries.reduce((total, entry) => total + entry.bytes, 0) + bytes > this.#limits.maximumBytesPerHost
      )
        continue;
      if (entries.some((entry) => entry.id === item.id)) continue;
      entries.push({
        id: item.id,
        ingressRoute: item.route,
        route: item.routeKey,
        sealed: item.sealed,
        telegramCallback: item.telegramCallback,
        order: ++this.#order,
        sentTo: null,
        bytes,
        expiresAt: Math.min(item.expiresAt, now + this.#limits.ttlMilliseconds),
      });
      this.#queues.set(item.hostId, entries);
      this.#bytes += bytes;
    }
    if (queue.entries.length > 0) this.#startExpiry();
  }

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
    if (wake.hostId === null && wake !== FAILED_LOOKUP) return "unlinked";
    if (!wakes) return wake.state === "sleeping" || wake.state === "starting" ? "hosted" : "unavailable";
    if (wake.state !== "starting" || !wake.hostId) return "unavailable";
    return yield* this.#add(order, wake.hostId, route, routeKey, message, telegramCallback);
  }, Effect.uninterruptible);

  readonly wakeOnly = Effect.fn("IngressQueue.wakeOnly")(function* (
    this: IngressQueue,
    route: IngressRoute,
    routeKey: string,
    allowLookup: () => boolean,
  ): Effect.fn.Return<boolean> {
    if (!this.#waker) return false;
    if (!this.#fresh(routeKey, this.#now()) && !this.#pending.has(routeKey) && !allowLookup()) return false;
    const known = yield* this.#check(route, routeKey, false);
    if ((known.state !== "sleeping" && known.state !== "starting") || !known.hostId) return false;
    const now = this.#now();
    const last = this.#webhookWakes.get(known.hostId);
    if (last !== undefined && now - last < this.#limits.webhookWakeMilliseconds) return false;
    if (!allowLookup()) return false;
    this.#webhookWakes.delete(known.hostId);
    dropOldest(this.#webhookWakes, MAXIMUM_ROUTES);
    this.#webhookWakes.set(known.hostId, now);
    if (known.state === "starting" && !this.#pending.has(routeKey)) this.#routes.delete(routeKey);
    const started = (yield* this.#check(route, routeKey, true)).state === "starting";
    if (!started && this.#webhookWakes.get(known.hostId) === now) this.#webhookWakes.delete(known.hostId);
    return started;
  }, Effect.uninterruptible);

  forget(routeKey: string): void {
    this.#routes.delete(routeKey);
  }

  readonly keep = Effect.fn("IngressQueue.keep")(function* (
    this: IngressQueue,
    hostId: string,
    route: IngressRoute,
    routeKey: string,
    message: QueuedSignalMessage,
  ): Effect.fn.Return<Exclude<OfflineOutcome, "hosted">> {
    return yield* this.#add(++this.#order, hostId, route, routeKey, message, null);
  }, Effect.uninterruptible);

  readonly #add = Effect.fn("IngressQueue.add")(function* (
    this: IngressQueue,
    order: number,
    hostId: string,
    route: IngressRoute,
    routeKey: string,
    message: QueuedSignalMessage,
    telegramCallback: QueuedFrame["telegramCallback"],
  ): Effect.fn.Return<Exclude<OfflineOutcome, "hosted">> {
    const queueKey = this.#keys.get(hostId);
    if (!queueKey) return "unavailable";
    this.#prune(hostId);
    const queue = this.#queues.get(hostId) ?? [];
    if (queue.length >= this.#limits.maximumPerHost) return "unavailable";
    const entry: QueueEntry = {
      id: crypto.randomUUID().replaceAll("-", ""),
      ingressRoute: route,
      route: routeKey,
      sealed: "",
      telegramCallback,
      order,
      sentTo: null,
      bytes: 0,
      expiresAt: 0,
    };
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

  take(hostId: string, socketId: string, holds: (route: string) => boolean): QueuedFrame[] {
    this.#prune(hostId);
    const ready: QueuedFrame[] = [];
    const sealing = new Set<string>();
    for (const entry of this.#queues.get(hostId) ?? []) {
      if (!entry.sealed) sealing.add(entry.route);
      if (!entry.sealed || sealing.has(entry.route) || entry.sentTo === socketId || !holds(entry.route)) continue;
      entry.sentTo = socketId;
      ready.push({ id: entry.id, route: entry.route, sealed: entry.sealed, telegramCallback: entry.telegramCallback });
    }
    return ready;
  }

  acknowledge(hostId: string, id: string): void {
    const queue = this.#queues.get(hostId);
    const entry = queue?.find((item) => item.id === id && item.sealed);
    if (!entry) return;
    this.#bytes -= entry.bytes;
    this.#remove(hostId, entry);
  }

  readonly #check = Effect.fn("IngressQueue.check")(function* (
    this: IngressQueue,
    route: IngressRoute,
    routeKey: string,
    wake: boolean,
  ): Effect.fn.Return<RouteWake> {
    const now = this.#now();
    const known = this.#fresh(routeKey, now);
    if (known && (known.woke || !wake || known.wake.state !== "sleeping")) return known.wake;
    const current = this.#pending.get(routeKey);
    if (current) {
      const shared = yield* Deferred.await(current.answer);
      if (!wake || current.wake || shared.state !== "sleeping") return shared;
      return yield* this.#check(route, routeKey, wake);
    }
    const result = Deferred.makeUnsafe<RouteWake>();
    this.#pending.set(routeKey, { answer: result, wake });
    const waker = this.#waker;
    const asked = waker ? yield* waker(route, wake) : null;
    const answer: RouteWake = asked ?? FAILED_LOOKUP;
    if (asked) {
      this.#routes.delete(routeKey);
      dropOldest(this.#routes, MAXIMUM_ROUTES);
      this.#routes.set(routeKey, { wake: asked, at: now, woke: wake });
    }
    this.#pending.delete(routeKey);
    yield* Deferred.succeed(result, answer);
    return answer;
  }, Effect.uninterruptible);

  #fresh(routeKey: string, now: number): { wake: RouteWake; at: number; woke: boolean } | null {
    const known = this.#routes.get(routeKey);
    if (!known) return null;
    const hosted = known.wake.state === "sleeping" || known.wake.state === "starting";
    const age = hosted ? this.#limits.routeCheckMilliseconds : this.#limits.otherRouteCheckMilliseconds;
    return now - known.at < age ? known : null;
  }

  #remove(hostId: string, entry: QueueEntry): void {
    const queue = this.#queues.get(hostId);
    if (!queue) return;
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.#queues.delete(hostId);
  }

  #startExpiry(): void {
    if (this.#expiry) return;
    this.#expiry = setInterval(() => {
      this.#pruneAll();
      this.#wakeAgain();
      if (this.#queues.size > 0 || !this.#expiry) return;
      clearInterval(this.#expiry);
      this.#expiry = null;
    }, EXPIRY_INTERVAL_MILLISECONDS);
    this.#expiry.unref?.();
  }

  #wakeAgain(): void {
    const now = this.#now();
    for (const queue of this.#queues.values()) {
      const first = queue.find((entry) => entry.sealed);
      if (!first || this.#pending.has(first.route)) continue;
      const known = this.#routes.get(first.route);
      if (known && now - known.at < this.#limits.routeCheckMilliseconds) continue;
      this.#fork(this.#check(first.ingressRoute, first.route, true));
    }
  }

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
}

function dropOldest(map: Map<string, unknown>, maximum: number): void {
  for (const key of map.keys()) {
    if (map.size < maximum) return;
    map.delete(key);
  }
}
