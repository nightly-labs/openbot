import { LIVE_ACTIVITY_URL } from "./live-activity-link";

export interface LiveActivityInstance<Props> {
  update(props: Props, staleDate?: Date): Promise<void>;
  end(dismissalPolicy: "default" | "immediate"): Promise<void>;
}

export interface LiveActivityStarter<Props> {
  start(props: Props, url: string, staleDate?: Date): LiveActivityInstance<Props>;
  getInstances(): LiveActivityInstance<Props>[];
}

/**
 * Keeps one Live Activity equal to the latest island state. ActivityKit calls run one at a time and
 * skip a state the activity already shows, because iOS limits how often an app can update it.
 */
export class LiveActivitySync<Props> {
  readonly #starter: LiveActivityStarter<Props>;
  #activity: LiveActivityInstance<Props> | null;
  /** The state the activity shows, or `null` when it is not known. */
  #shown: string | null;
  #queue: Promise<void> = Promise.resolve();

  constructor(starter: LiveActivityStarter<Props>) {
    this.#starter = starter;
    // An activity from an earlier launch shows old state. Keep one to update and end the others.
    const [current = null, ...extra] = starter.getInstances();
    this.#activity = current;
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

  async #apply(props: Props | null, staleDate: Date | undefined): Promise<void> {
    const activity = this.#activity;
    if (props === null) {
      this.#activity = null;
      await activity?.end("immediate");
      return;
    }
    if (activity) {
      try {
        await activity.update(props, staleDate);
        return;
      } catch (error) {
        // The user can dismiss the activity. Start a new one on the next change.
        this.#activity = null;
        throw error;
      }
    }
    this.#activity = this.#starter.start(props, LIVE_ACTIVITY_URL, staleDate);
  }
}

function stateKey(props: unknown, staleDate: Date | undefined): string {
  return JSON.stringify([props, staleDate?.getTime() ?? null]);
}
