import { Deferred, Effect, type Scope } from "effect";
import type { ProviderClientOperationError } from "./provider-client-effects";

export interface IdleThread {
  readonly id: string;
  activeTurn: object | null;
  idleRelease: ReturnType<typeof setTimeout> | null;
  idleSince: number;
}

export interface IdleThreadPoolOptions<Thread extends IdleThread, Released> {
  releaseAfterMs: number;
  scope(): Scope.Scope;
  idleLimit: number;
  canRelease(thread: Thread): boolean;
  snapshot(thread: Thread): Released;
  dispose(thread: Thread): Effect.Effect<void, ProviderClientOperationError>;
  reopen(threadId: string, released: Released): Effect.Effect<unknown, ProviderClientOperationError>;
}

export class IdleThreadPool<Thread extends IdleThread, Released> {
  readonly #options: IdleThreadPoolOptions<Thread, Released>;
  readonly #threads = new Map<string, Thread>();
  readonly #released = new Map<string, Released>();
  readonly #waking = new Map<string, Deferred.Deferred<unknown, ProviderClientOperationError>>();
  readonly #startingTurns = new Set<string>();

  constructor(options: IdleThreadPoolOptions<Thread, Released>) {
    this.#options = options;
  }

  get(threadId: string): Thread | undefined {
    return this.#threads.get(threadId);
  }

  has(threadId: string): boolean {
    return this.#threads.has(threadId);
  }

  ids(): IterableIterator<string> {
    return this.#threads.keys();
  }

  released(threadId: string): Released | undefined {
    return this.#released.get(threadId);
  }

  isReleased(threadId: string): boolean {
    return this.#released.has(threadId) && !this.#threads.has(threadId);
  }

  add(thread: Thread): void {
    this.#threads.set(thread.id, thread);
    this.#released.delete(thread.id);
    this.#arm(thread);
  }

  forget(threadId: string): void {
    this.#released.delete(threadId);
  }

  detach(thread: Thread): void {
    this.#threads.delete(thread.id);
    this.#disarm(thread);
  }

  readonly close = Effect.fn("IdleThreadPool.close")(function* (
    this: IdleThreadPool<Thread, Released>,
    thread: Thread,
  ) {
    this.detach(thread);
    yield* this.#options.dispose(thread);
  }, Effect.uninterruptible);

  clear(): Thread[] {
    const threads = [...this.#threads.values()];
    for (const thread of threads) this.#disarm(thread);
    this.#threads.clear();
    this.#released.clear();
    return threads;
  }

  readonly startTurn = Effect.fn("IdleThreadPool.startTurn")(function* <T>(
    this: IdleThreadPool<Thread, Released>,
    threadId: string,
    open: () => Effect.Effect<T, ProviderClientOperationError>,
  ) {
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => this.#startingTurns.add(threadId)),
      () => open(),
      () =>
        Effect.sync(() => {
          this.#startingTurns.delete(threadId);
          const thread = this.#threads.get(threadId);
          if (thread && !thread.activeTurn && thread.idleRelease === null) this.#arm(thread);
        }),
    );
  }, Effect.uninterruptible);

  holdForTurn(thread: Thread): void {
    this.#disarm(thread);
  }

  awaitOwnTurn(thread: Thread): void {
    thread.idleSince = 0;
    this.#arm(thread);
  }

  readonly markIdle = Effect.fn("IdleThreadPool.markIdle")(function* (
    this: IdleThreadPool<Thread, Released>,
    thread: Thread,
  ) {
    thread.idleSince = Date.now();
    this.#arm(thread);
    yield* this.#releaseIdleOver(this.#options.idleLimit);
  });

  readonly wake = Effect.fn("IdleThreadPool.wake")(function* (
    this: IdleThreadPool<Thread, Released>,
    threadId: string,
  ) {
    const released = this.#released.get(threadId);
    if (released === undefined || this.#threads.has(threadId)) return;
    const waking = this.#waking.get(threadId);
    if (waking) {
      yield* Deferred.await(waking);
      return;
    }
    yield* this.opening(threadId, () => this.#options.reopen(threadId, released));
  }, Effect.uninterruptible);

  readonly opened = Effect.fn("IdleThreadPool.opened")(function* (
    this: IdleThreadPool<Thread, Released>,
    threadId: string,
  ) {
    const opening = this.#waking.get(threadId);
    if (opening) yield* Deferred.await(opening).pipe(Effect.ignore);
  });

  readonly opening = Effect.fn("IdleThreadPool.opening")(function* (
    this: IdleThreadPool<Thread, Released>,
    threadId: string,
    open: () => Effect.Effect<unknown, ProviderClientOperationError>,
  ) {
    if (this.#waking.has(threadId)) return false;
    const completion = Deferred.makeUnsafe<unknown, ProviderClientOperationError>();
    this.#waking.set(threadId, completion);
    const exit = yield* Effect.exit(open());
    yield* Deferred.done(completion, exit);
    if (this.#waking.get(threadId) === completion) this.#waking.delete(threadId);
    yield* exit;
    return true;
  }, Effect.uninterruptible);

  #arm(thread: Thread): void {
    this.#disarm(thread);
    if (!this.#options.canRelease(thread)) return;
    thread.idleRelease = setTimeout(() => {
      thread.idleRelease = null;
      if (!this.#isIdle(thread)) return;
      Effect.runFork(this.#release(thread));
    }, this.#options.releaseAfterMs);
    thread.idleRelease.unref?.();
  }

  #disarm(thread: Thread): void {
    if (thread.idleRelease) clearTimeout(thread.idleRelease);
    thread.idleRelease = null;
  }

  #isIdle(thread: Thread): boolean {
    return this.#threads.get(thread.id) === thread && !thread.activeTurn && !this.#startingTurns.has(thread.id);
  }

  releaseIdle(): Effect.Effect<void, ProviderClientOperationError> {
    return this.#releaseIdleOver(0);
  }

  readonly releaseWhere = Effect.fn("IdleThreadPool.releaseWhere")(function* (
    this: IdleThreadPool<Thread, Released>,
    stale: (thread: Thread) => boolean,
  ) {
    const closed = [...this.#threads.values()].filter((thread) => this.#isIdle(thread) && stale(thread));
    for (const thread of closed) yield* this.#release(thread);
    return closed;
  });

  readonly releaseNow = Effect.fn("IdleThreadPool.releaseNow")(function* (
    this: IdleThreadPool<Thread, Released>,
    thread: Thread,
  ) {
    if (this.#threads.get(thread.id) === thread) yield* this.#release(thread);
  });

  readonly #releaseIdleOver = Effect.fn("IdleThreadPool.releaseIdleOver")(function* (
    this: IdleThreadPool<Thread, Released>,
    limit: number,
  ) {
    const idle = [...this.#threads.values()]
      .filter((thread) => thread.idleRelease !== null && thread.idleSince > 0 && this.#isIdle(thread))
      .sort((left, right) => left.idleSince - right.idleSince);
    for (const thread of idle.slice(0, Math.max(0, idle.length - limit))) {
      yield* this.#release(thread);
    }
  });

  readonly #release = Effect.fn("IdleThreadPool.release")(function* (
    this: IdleThreadPool<Thread, Released>,
    thread: Thread,
  ) {
    this.#released.set(thread.id, this.#options.snapshot(thread));
    this.#threads.delete(thread.id);
    this.#disarm(thread);
    yield* Effect.forkIn(this.#options.dispose(thread), this.#options.scope(), { startImmediately: true });
  });
}
