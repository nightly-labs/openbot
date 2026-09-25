/** What a pool holds of a thread. The client owns the turn; the pool owns the timer and the time. */
export interface IdleThread {
  readonly id: string;
  activeTurn: object | null;
  idleRelease: ReturnType<typeof setTimeout> | null;
  /**
   * When the thread last became idle, so the longest idle thread is the first to go. `0` for a
   * thread that is open for a turn that has not started yet: only the timeout closes it.
   */
  idleSince: number;
}

export interface IdleThreadPoolOptions<Thread extends IdleThread, Released> {
  /** How long a thread with no turn stays open. */
  releaseAfterMs: number;
  /** How many idle threads stay open before the timeout. */
  idleLimit: number;
  /** Whether the thread can be closed and opened again. One that cannot would lose its session. */
  canRelease(thread: Thread): boolean;
  /** What opening the thread again needs, kept while it is closed. */
  snapshot(thread: Thread): Released;
  /** Ends the process or session of a thread that the pool no longer holds. */
  dispose(thread: Thread): Promise<void>;
  /** Opens a released thread again. It must `add` the thread before it settles. */
  reopen(threadId: string, released: Released): Promise<unknown>;
}

/**
 * The open threads of one provider client, and the idle ones it closed to free their processes and
 * MCP servers. A closed thread keeps a snapshot, and its next turn opens it again from its session.
 * It never closes a thread in a turn, or one whose turn is starting.
 */
export class IdleThreadPool<Thread extends IdleThread, Released> {
  readonly #options: IdleThreadPoolOptions<Thread, Released>;
  readonly #threads = new Map<string, Thread>();
  readonly #released = new Map<string, Released>();
  readonly #waking = new Map<string, Promise<unknown>>();
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

  values(): IterableIterator<Thread> {
    return this.#threads.values();
  }

  ids(): IterableIterator<string> {
    return this.#threads.keys();
  }

  released(threadId: string): Released | undefined {
    return this.#released.get(threadId);
  }

  /** Whether the thread was closed for being idle and is not open again yet. */
  isReleased(threadId: string): boolean {
    return this.#released.has(threadId) && !this.#threads.has(threadId);
  }

  /** Holds a thread that was just opened, and starts its idle timer. */
  add(thread: Thread): void {
    this.#threads.set(thread.id, thread);
    this.#released.delete(thread.id);
    this.#arm(thread);
  }

  /** Drops the snapshot of a released thread, so its next turn cannot open it again. */
  forget(threadId: string): void {
    this.#released.delete(threadId);
  }

  /** Stops holding the thread and ends it. No snapshot is kept. */
  async close(thread: Thread): Promise<void> {
    this.#threads.delete(thread.id);
    this.#disarm(thread);
    await this.#options.dispose(thread);
  }

  /** Stops every timer and forgets every thread. The caller ends the threads it gets back. */
  clear(): Thread[] {
    const threads = [...this.#threads.values()];
    for (const thread of threads) this.#disarm(thread);
    this.#threads.clear();
    this.#released.clear();
    return threads;
  }

  /**
   * Runs `open` with the thread marked as starting a turn. Opening the thread again yields, and
   * another thread going idle in that gap must not close this one.
   */
  async startTurn<T>(threadId: string, open: () => Promise<T>): Promise<T> {
    this.#startingTurns.add(threadId);
    try {
      return await open();
    } finally {
      this.#startingTurns.delete(threadId);
    }
  }

  /** Stops the idle timer of a thread whose turn has begun. */
  holdForTurn(thread: Thread): void {
    this.#disarm(thread);
  }

  /** Marks a thread with no turn as idle, and closes the longest idle threads over the limit. */
  markIdle(thread: Thread): void {
    thread.idleSince = Date.now();
    this.#arm(thread);
    this.#releaseOverLimit();
  }

  /** Opens a released thread again. One reopen per thread, however many callers ask for it. */
  async wake(threadId: string): Promise<void> {
    const released = this.#released.get(threadId);
    if (released === undefined || this.#threads.has(threadId)) return;
    let waking = this.#waking.get(threadId);
    if (!waking) {
      waking = this.#options.reopen(threadId, released).finally(() => this.#waking.delete(threadId));
      this.#waking.set(threadId, waking);
    }
    await waking;
  }

  #arm(thread: Thread): void {
    this.#disarm(thread);
    if (!this.#options.canRelease(thread)) return;
    thread.idleRelease = setTimeout(() => {
      thread.idleRelease = null;
      if (!this.#isIdle(thread)) return;
      this.#release(thread);
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

  /** An armed release timer marks a thread that is idle and can be opened again. */
  #releaseOverLimit(): void {
    const idle = [...this.#threads.values()]
      .filter((thread) => thread.idleRelease !== null && thread.idleSince > 0 && this.#isIdle(thread))
      .sort((left, right) => left.idleSince - right.idleSince);
    for (const thread of idle.slice(0, Math.max(0, idle.length - this.#options.idleLimit))) {
      this.#release(thread);
    }
  }

  #release(thread: Thread): void {
    this.#released.set(thread.id, this.#options.snapshot(thread));
    void this.close(thread);
  }
}
