export interface LiveActivityInstance<Props> {
  readonly startedAt: number | null;
  isActive(): boolean;
  update(props: Props, staleDate?: Date): Promise<void>;
  end(dismissalPolicy: "default" | "immediate"): Promise<void>;
  watchPushToken(receive: (token: string) => void): () => void;
}

const RESTART_AFTER_MS = 7 * 60 * 60 * 1000;

export interface LiveActivityStarter<Props> {
  start(props: Props, staleDate?: Date): LiveActivityInstance<Props>;
  getInstances(): LiveActivityInstance<Props>[];
}

export class LiveActivitySync<Props> {
  readonly #starter: LiveActivityStarter<Props>;
  readonly #onPushToken: (token: string | null, startedAt: number | null) => void;
  readonly #onChange: (change: "started" | "ended") => void;
  #activity: LiveActivityInstance<Props> | null = null;
  #stopWatch: (() => void) | null = null;
  #shown: string | null;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    starter: LiveActivityStarter<Props>,
    onPushToken: (token: string | null, startedAt: number | null) => void = () => undefined,
    onChange: (change: "started" | "ended") => void = () => undefined,
  ) {
    this.#starter = starter;
    this.#onPushToken = onPushToken;
    this.#onChange = onChange;
    const [current = null, ...extra] = starter.getInstances();
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
    this.#setActivity(null);
    if (!active) return;
    this.#queue = this.#queue.then(() => activity.end("immediate")).catch(() => undefined);
  }

  async #apply(props: Props | null, staleDate: Date | undefined): Promise<void> {
    const activity = this.#activity;
    if (props === null) {
      this.#setActivity(null);
      if (!activity) return;
      await activity.end("immediate");
      this.#onChange("ended");
      return;
    }
    if (activity) {
      try {
        await activity.update(props, staleDate);
        return;
      } catch {
        this.#setActivity(null);
      }
    }
    this.#setActivity(this.#starter.start(props, staleDate));
    this.#onChange("started");
  }

  #setActivity(activity: LiveActivityInstance<Props> | null): void {
    this.#stopWatch?.();
    this.#stopWatch = null;
    this.#activity = activity;
    this.#onPushToken(null, null);
    if (activity) this.#stopWatch = activity.watchPushToken((token) => this.#onPushToken(token, activity.startedAt));
  }
}

function stateKey(props: unknown, staleDate: Date | undefined): string {
  return JSON.stringify([props, staleDate?.getTime() ?? null]);
}
