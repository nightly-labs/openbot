export interface TeardownRegistryOptions {
  reportError: (name: string, error: unknown) => void;
  stepTimeoutMs?: number;
}

const DEFAULT_STEP_TIMEOUT_MS = 10_000;

interface TeardownStep {
  order: number;
  name: string;
  run: () => PromiseLike<unknown> | unknown;
  afterAbandonedSteps: boolean;
}

export interface TeardownStepOptions {
  afterAbandonedSteps?: boolean;
}

export class TeardownRegistry {
  readonly #reportError: (name: string, error: unknown) => void;
  readonly #stepTimeoutMs: number;
  #steps: TeardownStep[] = [];
  #pending: TeardownStep[] | null = null;
  #closed = false;
  #tail: Promise<void> = Promise.resolve();
  readonly #abandoned = new Set<Promise<unknown>>();

  constructor({ reportError, stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS }: TeardownRegistryOptions) {
    this.#reportError = reportError;
    this.#stepTimeoutMs = stepTimeoutMs;
  }

  push(
    order: number,
    name: string,
    run: () => PromiseLike<unknown> | unknown,
    { afterAbandonedSteps = false }: TeardownStepOptions = {},
  ): void {
    const step = { order, name, run, afterAbandonedSteps };
    if (!this.#closed) {
      this.#steps.push(step);
      return;
    }
    const pending = this.#pending;
    if (pending) {
      const at = pending.findIndex((queued) => queued.order > order);
      pending.splice(at === -1 ? pending.length : at, 0, step);
      return;
    }
    this.#tail = this.#tail.then(() => this.#runStep(step));
  }

  async runAll(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#tail = this.#tail.then(() => this.#drain());
    }
    let awaited: Promise<void> | null = null;
    while (awaited !== this.#tail) {
      awaited = this.#tail;
      await awaited;
    }
  }

  async #drain(): Promise<void> {
    const pending = [...this.#steps].sort((left, right) => left.order - right.order);
    this.#steps = [];
    this.#pending = pending;
    for (let step = pending.shift(); step; step = pending.shift()) await this.#runStep(step);
    this.#pending = null;
  }

  async #runStep(step: TeardownStep): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const running = (step.afterAbandonedSteps ? this.#abandonedSettled() : Promise.resolve()).then(() => step.run());
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.#reportError(step.name, new Error(`It did not stop within ${this.#stepTimeoutMs} ms.`));
        const abandoned = running.then(
          () => undefined,
          (error) => this.#reportError(step.name, error),
        );
        this.#abandoned.add(abandoned);
        void abandoned.finally(() => this.#abandoned.delete(abandoned));
        resolve();
      }, this.#stepTimeoutMs);
    });
    try {
      await Promise.race([running, timedOut]);
    } catch (error) {
      this.#reportError(step.name, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async #abandonedSettled(): Promise<void> {
    if (this.#abandoned.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waitEnded = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.#stepTimeoutMs / 2);
    });
    await Promise.race([Promise.allSettled([...this.#abandoned]), waitEnded]);
    clearTimeout(timer);
  }
}
