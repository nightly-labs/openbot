// The order of `start()` and `stop()` for one service that opens a process, a socket or a port.
//
// Starts and stops run one at a time, in the order of the calls, so the last call always decides
// whether the service runs. A stop never returns while a start that came before it can still open
// what the stop closed. A call that repeats the last queued action shares its promise, so two starts
// at once do not open two listeners. A start that follows a finished start runs again: `run` must
// return at once when the service already runs.
//
// A start that can take long can be told to give up: a stop queued behind a start calls
// `interruptStart` while that start runs, then waits for it. Without it, a slow start delays the
// stop, and the shutdown sequence stops each step after a fixed time.

interface QueuedStart<T> {
  readonly kind: "start";
  readonly promise: Promise<T>;
  /** Runs `interrupt` now if the start runs, or when it begins. */
  interrupt(interrupt: () => Promise<void>): void;
  /** The interrupt that ran, for the stop behind this start to wait for. */
  interrupted(): Promise<void>;
}

interface QueuedStop {
  readonly kind: "stop";
  readonly promise: Promise<void>;
}

export class LifecycleGate<T> {
  #queue: Promise<unknown> = Promise.resolve();
  #last: QueuedStart<T> | QueuedStop | null = null;

  start(run: () => Promise<T>): Promise<T> {
    const last = this.#last;
    if (last?.kind === "start") return last.promise;
    let running = false;
    let waiting: (() => Promise<void>) | null = null;
    let interrupted: Promise<void> = Promise.resolve();
    const interruptNow = (interrupt: () => Promise<void>): void => {
      interrupted = interrupt();
      // The stop behind this start awaits it and reports the error.
      interrupted.catch(() => undefined);
    };
    const promise = this.#queue.then(() => {
      running = true;
      const starting = run();
      if (waiting) interruptNow(waiting);
      return starting;
    });
    this.#push({
      kind: "start",
      promise,
      interrupt: (interrupt) => {
        if (running) interruptNow(interrupt);
        else waiting = interrupt;
      },
      interrupted: () => interrupted,
    });
    return promise;
  }

  stop(run: () => Promise<void>, interruptStart?: () => Promise<void>): Promise<void> {
    const last = this.#last;
    if (last?.kind === "stop") return last.promise;
    if (last?.kind === "start" && interruptStart) last.interrupt(interruptStart);
    const promise = this.#queue.then(async () => {
      try {
        if (last?.kind === "start") await last.interrupted();
      } finally {
        await run();
      }
    });
    this.#push({ kind: "stop", promise });
    return promise;
  }

  #push(operation: QueuedStart<T> | QueuedStop): void {
    this.#last = operation;
    this.#queue = operation.promise.catch(() => undefined);
    const clear = (): void => {
      if (this.#last === operation) this.#last = null;
    };
    operation.promise.then(clear, clear);
  }
}
