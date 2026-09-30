export interface LiveActivityInstance<Props> {
  update(props: Props, staleDate?: Date): Promise<void>;
  end(dismissalPolicy: "default" | "immediate"): Promise<void>;
  /** Calls `receive` with the push token of this activity, now and each time iOS changes it. */
  watchPushToken(receive: (token: string) => void): () => void;
}

export interface LiveActivityStarter<Props> {
  start(props: Props, staleDate?: Date): LiveActivityInstance<Props>;
  getInstances(): LiveActivityInstance<Props>[];
}

/**
 * Keeps one Live Activity equal to the latest island state. ActivityKit calls run one at a time and
 * skip a state the activity already shows, because iOS limits how often an app can update it.
 */
export class LiveActivitySync<Props> {
  readonly #starter: LiveActivityStarter<Props>;
  readonly #onPushToken: (token: string | null) => void;
  #activity: LiveActivityInstance<Props> | null = null;
  #stopWatch: (() => void) | null = null;
  /** The state the activity shows, or `null` when it is not known. */
  #shown: string | null;
  #queue: Promise<void> = Promise.resolve();

  /** `onPushToken` receives the token the host updates the activity with, or `null` when there is no activity. */
  constructor(starter: LiveActivityStarter<Props>, onPushToken: (token: string | null) => void = () => undefined) {
    this.#starter = starter;
    this.#onPushToken = onPushToken;
    // An activity from an earlier launch shows old state. Keep one to update and end the others.
    const [current = null, ...extra] = starter.getInstances();
    this.#setActivity(current);
    this.#shown = current ? null : stateKey(null, undefined);
    for (const activity of extra) void activity.end("immediate").catch(() => undefined);
  }

  /**
   * Shows `props`, or ends the activity when they are `null`. A `staleDate` tells iOS when to mark
   * the content out of date, because the app cannot update it while it is suspended.
   */
  show(props: Props | null, staleDate?: Date): Promise<void> {
    const key = stateKey(props, staleDate);
    if (key === this.#shown) return this.#queue;
    this.#shown = key;
    this.#queue = this.#queue
      .then(() => this.#apply(props, staleDate))
      .catch(() => {
        // The user can turn Live Activities off, and iOS limits how many run. Try again on the next change.
        this.#shown = null;
      });
    return this.#queue;
  }

  /** The host updated or ended the activity while the app was away, so the app no longer knows what it shows. */
  forget(): void {
    this.#shown = null;
  }

  async #apply(props: Props | null, staleDate: Date | undefined): Promise<void> {
    const activity = this.#activity;
    if (props === null) {
      this.#setActivity(null);
      await activity?.end("immediate");
      return;
    }
    if (activity) {
      try {
        await activity.update(props, staleDate);
        return;
      } catch {
        // The user or the host can end the activity. Start a new one.
        this.#setActivity(null);
      }
    }
    this.#setActivity(this.#starter.start(props, staleDate));
  }

  #setActivity(activity: LiveActivityInstance<Props> | null): void {
    this.#stopWatch?.();
    this.#stopWatch = null;
    this.#activity = activity;
    this.#onPushToken(null);
    if (activity) this.#stopWatch = activity.watchPushToken((token) => this.#onPushToken(token));
  }
}

function stateKey(props: unknown, staleDate: Date | undefined): string {
  return JSON.stringify([props, staleDate?.getTime() ?? null]);
}
