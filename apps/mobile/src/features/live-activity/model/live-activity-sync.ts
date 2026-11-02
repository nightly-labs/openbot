export interface LiveActivityInstance<Props> {
  /**
   * When iOS started the activity, in milliseconds, or `null` when the app does not know, as for one
   * that an older version started. iOS stops its updates 8 hours later.
   */
  readonly startedAt: number | null;
  /**
   * Whether iOS still shows and updates the activity. An update of an ended activity does nothing and
   * does not fail, so an activity that iOS or the host ended needs this check.
   */
  isActive(): boolean;
  update(props: Props, staleDate?: Date): Promise<void>;
  end(dismissalPolicy: "default" | "immediate"): Promise<void>;
  /** Calls `receive` with the push token of this activity, now and each time iOS changes it. */
  watchPushToken(receive: (token: string) => void): () => void;
}

/**
 * iOS ends an activity 8 hours after its start. One that is older than this when the app comes back
 * starts again, so it does not stop while the app is away.
 */
const RESTART_AFTER_MS = 7 * 60 * 60 * 1000;

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
  readonly #onPushToken: (token: string | null, startedAt: number | null) => void;
  readonly #onChange: (change: "started" | "ended") => void;
  #activity: LiveActivityInstance<Props> | null = null;
  #stopWatch: (() => void) | null = null;
  /** The state the activity shows, or `null` when it is not known. */
  #shown: string | null;
  #queue: Promise<void> = Promise.resolve();

  /**
   * `onPushToken` receives the token the host updates the activity with and the start of the activity,
   * or `null` when there is no activity. `onChange` receives each start and end that the app makes.
   */
  constructor(
    starter: LiveActivityStarter<Props>,
    onPushToken: (token: string | null, startedAt: number | null) => void = () => undefined,
    onChange: (change: "started" | "ended") => void = () => undefined,
  ) {
    this.#starter = starter;
    this.#onPushToken = onPushToken;
    this.#onChange = onChange;
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

  /**
   * The host updated or ended the activity while the app was away, so the app no longer knows what it
   * shows. Call it when the app comes back: an activity that ended, or that iOS ends soon, starts again
   * with the next state. iOS starts an activity only while the app is on screen.
   */
  forget(now = Date.now()): void {
    this.#shown = null;
    const activity = this.#activity;
    if (!activity) return;
    const active = activity.isActive();
    if (active && (activity.startedAt === null || now - activity.startedAt < RESTART_AFTER_MS)) return;
    this.#setActivity(null);
    if (!active) return;
    // The end goes before the next start, so the old activity does not stay beside the new one.
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
        // The user or the host can end the activity. Start a new one.
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
