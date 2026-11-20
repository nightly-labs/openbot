export interface KeepAwakeOptions {
  enabled: () => boolean;
  onBatteryToo: () => boolean;
  onBattery: () => boolean;
  start: () => number;
  stop: (id: number) => void;
  log: (message: string) => void;
}

export class KeepAwake {
  readonly #options: KeepAwakeOptions;
  #blocker: number | null = null;

  constructor(options: KeepAwakeOptions) {
    this.#options = options;
  }

  sync(): void {
    const hold = this.#options.enabled() && (this.#options.onBatteryToo() || !this.#options.onBattery());
    if (hold && this.#blocker === null) {
      this.#blocker = this.#options.start();
      this.#options.log("Keeping this computer awake.");
    } else if (!hold && this.#blocker !== null) {
      this.dispose();
      this.#options.log("Letting this computer sleep.");
    }
  }

  dispose(): void {
    if (this.#blocker !== null) this.#options.stop(this.#blocker);
    this.#blocker = null;
  }
}
