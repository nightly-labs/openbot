// The order of `start()` and `stop()` for one service that opens a process, a socket or a port.
//
// A start waits for a stop that is still running, and a stop waits for a start that is still running,
// so a stop never returns while a start can still open what the stop closed. Callers that ask for the
// same action while it runs get the same promise, so two calls do not open two listeners.
//
// A start that can take long can be told to give up first: `interruptStart` runs only when a start is
// still running, before the stop waits for it. Without it, a slow start delays the stop, and the
// shutdown sequence stops each step after a fixed time.
export class LifecycleGate<T> {
  #starting: Promise<T> | null = null;
  #stopping: Promise<void> | null = null;

  async start(run: () => Promise<T>): Promise<T> {
    while (this.#stopping) await this.#stopping.catch(() => undefined);
    if (this.#starting) return this.#starting;
    const starting = run();
    this.#starting = starting;
    try {
      return await starting;
    } finally {
      if (this.#starting === starting) this.#starting = null;
    }
  }

  async stop(run: () => Promise<void>, interruptStart?: () => Promise<void>): Promise<void> {
    if (this.#stopping) return this.#stopping;
    const stopping = this.#stop(run, interruptStart);
    this.#stopping = stopping;
    try {
      await stopping;
    } finally {
      if (this.#stopping === stopping) this.#stopping = null;
    }
  }

  async #stop(run: () => Promise<void>, interruptStart?: () => Promise<void>): Promise<void> {
    const starting = this.#starting;
    if (starting) {
      await interruptStart?.();
      await starting.catch(() => undefined);
    }
    await run();
  }
}
