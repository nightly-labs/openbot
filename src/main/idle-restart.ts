// A restart that the user of this computer asks for: OpenBot starts again, or installs the downloaded
// update, when no work runs. With many agents and routines there is seldom such a moment, so new
// routine runs wait while the restart waits. An overdue routine runs once after the restart, or after
// a cancel.
//
// A restart that an admin of a joined server asks for, and the automatic install, are
// `RequestedUpdate`. They do not hold routines.

import type { IdleRestart as IdleRestartStatus, IdleRestartTarget, UpdateStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { RoutineHoldWindow } from "../backend/routine-store";
import type { RestartReadiness } from "./update-readiness";

interface IdleRestartUpdater {
  getStatus(): UpdateStatus;
  installUpdate(): Promise<void>;
  setIdleRestart(restart: IdleRestartStatus | null): void;
}

export interface IdleRestartOptions {
  updater: IdleRestartUpdater;
  describeReadiness: () => RestartReadiness;
  holdRoutines: () => void;
  releaseRoutines: () => void;
  /**
   * Keeps the hold window over a restart or a quit, so that the next start runs the routines that
   * came due while they were held. `null` removes it.
   */
  recordHold: (window: RoutineHoldWindow | null) => void;
  /** Starts OpenBot again through the normal shutdown. */
  relaunch: () => void;
  log: (message: string) => void;
  /** How long the restart waits between two readiness checks. */
  pollMs?: number;
}

const DEFAULT_POLL_MS = 5_000;

export class IdleRestart {
  readonly #updater: IdleRestartUpdater;
  readonly #describeReadiness: () => RestartReadiness;
  readonly #holdRoutines: () => void;
  readonly #releaseRoutines: () => void;
  readonly #recordHold: (window: RoutineHoldWindow | null) => void;
  readonly #relaunch: () => void;
  readonly #log: (message: string) => void;
  readonly #pollMs: number;
  #status: IdleRestartStatus | null = null;
  /** When the routines were held, or `null` when they run. */
  #heldSince: Date | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** The restart started. A cancel then would report a restart that happens. */
  #restarting = false;

  constructor(options: IdleRestartOptions) {
    this.#updater = options.updater;
    this.#describeReadiness = options.describeReadiness;
    this.#holdRoutines = options.holdRoutines;
    this.#releaseRoutines = options.releaseRoutines;
    this.#recordHold = options.recordHold;
    this.#relaunch = options.relaunch;
    this.#log = options.log;
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  }

  /** A second request replaces the target of the first. */
  request(target: IdleRestartTarget): UpdateStatus {
    if (this.#restarting) throw new Error(sourceText("error.update.alreadyRestarting"));
    if (target === "update") {
      const status = this.#updater.getStatus();
      if (status.managedByHost) throw new Error(sourceText("error.update.managedByHost"));
      if (status.phase !== "ready") throw new Error(sourceText("error.update.notReady"));
    }
    if (!this.#heldSince) {
      this.#heldSince = new Date();
      this.#holdRoutines();
    }
    this.#log(`The user asked for a restart when idle (${target}).`);
    this.#publish({ target, waitingFor: [] });
    this.#schedule(0);
    return this.#updater.getStatus();
  }

  /** Removes the restart, or the error of the last one, and lets the routines run. */
  cancel(): UpdateStatus {
    if (this.#restarting) throw new Error(sourceText("error.update.alreadyRestarting"));
    if (this.#status && !this.#status.error) this.#log("The restart when idle was cancelled.");
    this.#end(null);
    return this.#updater.getStatus();
  }

  /** A quit while the routines are held keeps the window, as a restart does. */
  dispose(): void {
    this.#clearTimer();
    this.#keepHold();
  }

  #schedule(delayMs: number): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#attempt();
    }, delayMs);
    this.#timer.unref?.();
  }

  async #attempt(): Promise<void> {
    const status = this.#status;
    if (!status || status.error) return;
    const { safeToRestart, reasons } = this.#describeReadiness();
    if (!safeToRestart) {
      const waitingFor = [...new Set(reasons)];
      if (waitingFor.join() !== status.waitingFor.join()) this.#publish({ ...status, waitingFor });
      this.#schedule(this.#pollMs);
      return;
    }
    this.#restarting = true;
    this.#publish({ ...status, waitingFor: [] });
    this.#keepHold();
    if (status.target === "relaunch") {
      this.#log("Restarting OpenBot: no work runs.");
      this.#relaunch();
      return;
    }
    this.#log("Installing the update: no work runs.");
    try {
      await this.#updater.installUpdate();
      // The updater owns the install from here, and reports its own failure.
      this.#publish(null);
    } catch (error) {
      // A refusal before teardown (another macOS session runs OpenBot) leaves the update ready.
      const message = error instanceof Error ? error.message : String(error);
      this.#log(`The restart when idle failed: ${message}`);
      this.#restarting = false;
      this.#end({ ...status, waitingFor: [], error: message });
    }
  }

  #end(status: IdleRestartStatus | null): void {
    this.#clearTimer();
    this.#publish(status);
    if (this.#heldSince) {
      this.#heldSince = null;
      this.#recordHold(null);
      this.#releaseRoutines();
    }
  }

  #keepHold(): void {
    if (this.#heldSince) this.#recordHold({ since: this.#heldSince, until: new Date() });
  }

  #publish(status: IdleRestartStatus | null): void {
    this.#status = status;
    this.#updater.setIdleRestart(status);
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
