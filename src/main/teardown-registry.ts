/**
 * The named shutdown steps `createApplicationServices` accumulates while it builds, so a quit that
 * arrives mid-startup tears down exactly what exists rather than nothing at all.
 *
 * Two things it does that the hand-written shutdown sequence it replaces did not:
 *
 * - **Every step is caught.** A rejecting `remoteServers.stop()` used to skip the host, the WebRTC
 *   bridge and the agent service below it, leaving provider CLIs running after the app had quit.
 * - **A step registered after `runAll` still runs.** Construction keeps going after `before-quit`
 *   fires, so a service built during the teardown would otherwise leak a listening socket or a
 *   child process. Its step is chained onto the run in progress instead of being dropped.
 *
 * Steps declare an **order** rather than running last-in-first-out. Shutdown here is largely
 * *construction* order and not its reverse: the browser host is destroyed before the
 * picture-in-picture window that holds a reference to it, and the provider runtimes stop before the
 * agent service that owns them. Reversing that would move the browser's cookie and state flush
 * behind a potentially slow agent stop, so the order is declared and sorted, never inferred.
 */

export interface TeardownRegistryOptions {
  reportError: (name: string, error: unknown) => void;
}

interface TeardownStep {
  order: number;
  name: string;
  run: () => PromiseLike<unknown> | unknown;
}

export class TeardownRegistry {
  readonly #reportError: (name: string, error: unknown) => void;
  #steps: TeardownStep[] = [];
  #closed = false;
  #tail: Promise<void> = Promise.resolve();

  constructor({ reportError }: TeardownRegistryOptions) {
    this.#reportError = reportError;
  }

  /** `order` is the position in the shutdown sequence, not the position in this call sequence. */
  push(order: number, name: string, run: () => PromiseLike<unknown> | unknown): void {
    const step = { order, name, run };
    if (this.#closed) {
      this.#tail = this.#tail.then(() => this.#runStep(step));
      return;
    }
    this.#steps.push(step);
  }

  /** Idempotent: a second call awaits the first run rather than starting another. */
  async runAll(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#tail = this.#tail.then(() => this.#drain());
    }
    // Construction that was already in flight when the quit arrived keeps registering steps while
    // this runs, and each one extends the tail. Wait until awaiting it leaves nothing new behind;
    // the loop terminates because only construction pushes, and construction is finite.
    let awaited: Promise<void> | null = null;
    while (awaited !== this.#tail) {
      awaited = this.#tail;
      await awaited;
    }
  }

  async #drain(): Promise<void> {
    const steps = [...this.#steps].sort((left, right) => left.order - right.order);
    this.#steps = [];
    for (const step of steps) await this.#runStep(step);
  }

  async #runStep(step: TeardownStep): Promise<void> {
    try {
      await step.run();
    } catch (error) {
      this.#reportError(step.name, error);
    }
  }
}
