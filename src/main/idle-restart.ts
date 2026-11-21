import type { IdleRestart as IdleRestartStatus, IdleRestartTarget, UpdateStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import type { RoutineHoldWindow } from "../backend/routine-store";
import type { RestartReadiness } from "./update-readiness";
import type { UpdateService } from "./update-service";

interface IdleRestartUpdater {
  getStatus(): UpdateStatus;
  installUpdate: UpdateService["installUpdate"];
  setIdleRestart(restart: IdleRestartStatus | null): void;
}

export interface IdleRestartOptions {
  updater: IdleRestartUpdater;
  describeReadiness: () => RestartReadiness;
  holdRoutines: () => void;
  releaseRoutines: () => void;
  recordHold: (window: RoutineHoldWindow | null) => void;
  relaunch: () => void;
  log: (message: string) => void;
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
  #heldSince: Date | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #restarting = false;
  #handedOff = false;

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

  request(target: IdleRestartTarget): UpdateStatus {
    if (this.#restarting || this.#updater.getStatus().phase === "installing") {
      throw new Error(sourceText("error.update.alreadyRestarting"));
    }
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

  restartNow(): UpdateStatus {
    if (this.#restarting) throw new Error(sourceText("error.update.alreadyRestarting"));
    const status = this.#status;
    if (!status || status.error) return this.#updater.getStatus();
    this.#clearTimer();
    this.#log(`The user asked to restart now while waiting for: ${status.waitingFor.join(", ") || "nothing"}.`);
    this.#startRestart(status);
    Effect.runFork(this.#restart(status));
    return this.#updater.getStatus();
  }

  cancel(): UpdateStatus {
    if (this.#restarting) throw new Error(sourceText("error.update.alreadyRestarting"));
    if (this.#status && !this.#status.error) this.#log("The restart when idle was cancelled.");
    this.#end(null);
    return this.#updater.getStatus();
  }

  dispose(): void {
    this.#clearTimer();
    this.#keepHold();
  }

  #schedule(delayMs: number): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      Effect.runFork(this.#attempt());
    }, delayMs);
    this.#timer.unref?.();
  }

  readonly #attempt = Effect.fn("IdleRestart.attempt")(function* (this: IdleRestart) {
    const status = this.#status;
    if (!status || status.error) return;
    const { safeToRestart, reasons } = this.#describeReadiness();
    if (!safeToRestart) {
      const waitingFor = [...new Set(reasons)];
      if (waitingFor.join() !== status.waitingFor.join()) this.#publish({ ...status, waitingFor });
      this.#schedule(this.#pollMs);
      return;
    }
    this.#log("No work runs.");
    this.#startRestart(status);
    yield* this.#restart(status);
  });

  #startRestart(status: IdleRestartStatus): void {
    this.#restarting = true;
    this.#publish({ ...status, waitingFor: [] });
    this.#keepHold();
  }

  readonly #restart = Effect.fn("IdleRestart.restart")(function* (this: IdleRestart, status: IdleRestartStatus) {
    if (status.target === "relaunch") {
      this.#log("Restarting OpenBot.");
      this.#relaunch();
      return;
    }
    this.#log("Installing the update.");
    const installed = yield* Effect.result(this.#updater.installUpdate());
    if (Result.isSuccess(installed)) {
      this.#restarting = false;
      this.#handedOff = true;
      this.#publish(null);
    } else {
      const error = installed.failure.cause;
      const message = error instanceof Error ? error.message : String(error);
      this.#log(`The restart when idle failed: ${message}`);
      this.#restarting = false;
      if (this.#updater.getStatus().errorCode === "install_failed") this.#handedOff = true;
      this.#end({ ...status, waitingFor: [], error: message });
    }
  });

  #end(status: IdleRestartStatus | null): void {
    this.#clearTimer();
    this.#publish(status);
    if (this.#heldSince && !this.#handedOff) {
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
