const IDLE_RELEASE_MS = 600_000;

export interface ComputerUseDisplayAwakeOptions {
  turnRunning: () => boolean;
  start: () => number;
  stop: (id: number) => void;
}

export class ComputerUseDisplayAwake {
  readonly #options: ComputerUseDisplayAwakeOptions;
  #blocker: number | null = null;
  #idleRelease: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ComputerUseDisplayAwakeOptions) {
    this.#options = options;
  }

  noteToolCall(): void {
    if (this.#blocker === null) this.#blocker = this.#options.start();
    if (this.#idleRelease) clearTimeout(this.#idleRelease);
    this.#idleRelease = setTimeout(() => this.release(), IDLE_RELEASE_MS);
    this.#idleRelease.unref?.();
  }

  turnEnded(): void {
    if (!this.#options.turnRunning()) this.release();
  }

  release(): void {
    if (this.#idleRelease) {
      clearTimeout(this.#idleRelease);
      this.#idleRelease = null;
    }
    const blocker = this.#blocker;
    if (blocker === null) return;
    this.#blocker = null;
    this.#options.stop(blocker);
  }
}
