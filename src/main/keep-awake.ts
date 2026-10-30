/**
 * Holds one power save blocker while the user chose to keep this computer awake, and while it runs
 * on its power adapter unless the user chose battery power too. The computer then does not sleep when idle, so routines run on time; the display
 * can still turn off. A closed lid or a sleep that the user selects still sleeps the computer.
 */
export interface KeepAwakeOptions {
  enabled: () => boolean;
  /** The user chose to keep the computer awake on battery power too. */
  onBatteryToo: () => boolean;
  onBattery: () => boolean;
  /** Electron `powerSaveBlocker.start("prevent-app-suspension")`. */
  start: () => number;
  stop: (id: number) => void;
  /** Main's logger, so `logs/main/main.log` shows when the computer could not sleep. */
  log: (message: string) => void;
}

export class KeepAwake {
  readonly #options: KeepAwakeOptions;
  #blocker: number | null = null;

  constructor(options: KeepAwakeOptions) {
    this.#options = options;
  }

  /** Called at start, when the choice is saved, and when the power source changes. */
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
