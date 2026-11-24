export interface LiveActivityInstance<Props> {
  readonly startedAt: number | null;
  isActive(): boolean;
  update(props: Props, staleDate?: Date): Promise<void>;
  end(dismissalPolicy: "default" | "immediate"): Promise<void>;
  watchPushToken(receive: (token: string) => void): () => void;
}

export const RESTART_AFTER_MS = 7 * 60 * 60 * 1000;

export interface LiveActivityStarter<Props> {
  start(props: Props, staleDate?: Date): LiveActivityInstance<Props>;
  getInstances(): LiveActivityInstance<Props>[];
}

export interface LiveActivitySyncEvents<Props> {
  pushToken(token: string | null, startedAt: number | null): void;
  change(change: "started" | "ended"): void;
  shown(props: Props | null, startedAt: number | null): void;
  dismissed(startedAt: number | null): void;
}

const NO_EVENTS: LiveActivitySyncEvents<unknown> = {
  pushToken: () => undefined,
  change: () => undefined,
  shown: () => undefined,
  dismissed: () => undefined,
};

export class LiveActivitySync<Props> {
  readonly #starter: LiveActivityStarter<Props>;
  readonly #events: LiveActivitySyncEvents<Props>;
  #activity: LiveActivityInstance<Props> | null = null;
  #stopWatch: (() => void) | null = null;
  #shown: string | null;
  #queue: Promise<void> = Promise.resolve();

  constructor(starter: LiveActivityStarter<Props>, events: Partial<LiveActivitySyncEvents<Props>> = {}) {
    this.#starter = starter;
    this.#events = { ...NO_EVENTS, ...events };
    const [current = null, ...extra] = starter.getInstances();
    if (!current) this.#events.dismissed(null);
    this.#setActivity(current);
    this.#shown = current ? null : stateKey(null, undefined);
    for (const activity of extra) void activity.end("immediate").catch(() => undefined);
  }

  show(props: Props | null, staleDate?: Date): Promise<void> {
    const key = stateKey(props, staleDate);
    if (key === this.#shown) return this.#queue;
    this.#shown = key;
    this.#queue = this.#queue
      .then(() => this.#apply(props, staleDate))
      .catch(() => {
        this.#shown = null;
      });
    return this.#queue;
  }

  forget(now = Date.now()): void {
    this.#shown = null;
    const activity = this.#activity;
    if (!activity) return;
    const active = activity.isActive();
    if (active && (activity.startedAt === null || now - activity.startedAt < RESTART_AFTER_MS)) return;
    if (!active) {
      if (dismissedByUser(activity, now)) this.#events.dismissed(activity.startedAt);
      this.#setActivity(null);
      return;
    }
    this.#setActivity(null);
    this.#queue = this.#queue.then(() => activity.end("immediate")).catch(() => undefined);
  }

  async #apply(props: Props | null, staleDate: Date | undefined): Promise<void> {
    const activity = this.#activity;
    if (props === null) {
      this.#setActivity(null);
      if (!activity) return;
      await activity.end("immediate");
      this.#events.change("ended");
      return;
    }
    if (activity) {
      try {
        await activity.update(props, staleDate);
        this.#events.shown(props, activity.startedAt);
        return;
      } catch {
        if (dismissedByUser(activity, Date.now())) {
          this.#events.dismissed(activity.startedAt);
          this.#setActivity(null);
          this.#shown = null;
          return;
        }
        this.#setActivity(null);
      }
    }
    const started = this.#starter.start(props, staleDate);
    this.#setActivity(started);
    this.#events.shown(props, started.startedAt);
    this.#events.change("started");
  }

  #setActivity(activity: LiveActivityInstance<Props> | null): void {
    this.#stopWatch?.();
    this.#stopWatch = null;
    this.#activity = activity;
    this.#events.pushToken(null, null);
    if (!activity) {
      this.#events.shown(null, null);
      return;
    }
    this.#stopWatch = activity.watchPushToken((token) => this.#events.pushToken(token, activity.startedAt));
  }
}

function dismissedByUser(activity: LiveActivityInstance<unknown>, now: number): boolean {
  return activity.startedAt !== null && now - activity.startedAt < RESTART_AFTER_MS && !activity.isActive();
}

function stateKey(props: unknown, staleDate: Date | undefined): string {
  return JSON.stringify([props, staleDate?.getTime() ?? null]);
}
