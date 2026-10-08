import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { fetchLatestLinuxRelease, newerRelease } from "./host-release-service";
import {
  isValidSemver,
  type UpdateAdapter,
  type UpdateCancellationToken,
  type UpdateCheckOutcome,
} from "./update-service";

/** The path unit that starts `openbot-hosted-update request`. Without it, no request is acted on. */
export const HOSTED_UPDATE_TRIGGER = "/etc/systemd/system/openbot-update-request.path";

/** The paths that scripts/hosting/openbot-hosted-update and openbot-update-request.path use. */
export interface HostedUpdatePaths {
  /** The runtime directory of openbot.service, which the service user owns. */
  readonly requests: string;
  /** Root writes the step of a request here while it runs. */
  readonly state: string;
  /** The version of a complete staged release. */
  readonly stagedReady: string;
}

const HOSTED_UPDATE_PATHS: HostedUpdatePaths = {
  requests: "/run/openbot",
  state: "/run/openbot-update.state",
  stagedReady: "/opt/OpenBot/staged.ready",
};

interface HostedUpdateOptions {
  currentVersion: string;
  arch: string;
  fetch?: typeof fetch;
  paths?: HostedUpdatePaths;
  pollIntervalMs?: number;
}

type HostedUpdateEvents = {
  "download-progress": [progress: ProgressInfo];
  "update-downloaded": [info: Pick<UpdateInfo, "version">];
};

/** A listener of any updater event. Each event passes at most one of these values, or none. */
type UpdateListener = (value: ProgressInfo & UpdateInfo & Error) => void;

class RequestCancellation implements UpdateCancellationToken {
  cancelled = false;
  cancel(): void {
    this.cancelled = true;
  }
}

/**
 * The updater of a hosted or self-installed Linux server. OpenBot runs as the service user from a
 * release that root owns, so it cannot replace itself. It asks root instead: an empty file in its
 * runtime directory starts `openbot-hosted-update request` through a path unit. That stages the
 * newest release, or stops OpenBot, moves the staged release into place and starts OpenBot again.
 *
 * UpdateService drives this as it drives electron-updater, so its deadlines apply. While root works,
 * the time of the state file changes, and each change is a progress event. When root stops without
 * a staged release, or never takes the request, the download fails. An install request has no
 * answer: shutdown preparation exits OpenBot after its deadline, and when root did not take the
 * request, systemd starts the same release again. Each start of openbot.service starts the path
 * unit, so this happens only when an administrator stopped it.
 */
export class HostedUpdateAdapter implements UpdateAdapter {
  allowPrerelease = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  readonly #events = new EventEmitter();
  readonly #options: HostedUpdateOptions;
  readonly #paths: HostedUpdatePaths;
  #latestVersion: string | null = null;

  constructor(options: HostedUpdateOptions) {
    this.#options = options;
    this.#paths = options.paths ?? HOSTED_UPDATE_PATHS;
  }

  on(event: string, listener: UpdateListener): this {
    this.#events.on(event, listener);
    return this;
  }

  async checkForUpdates(): Promise<UpdateCheckOutcome> {
    const version = await fetchLatestLinuxRelease(
      this.#options.arch,
      this.#options.fetch ?? fetch,
      AbortSignal.timeout(15_000),
    );
    this.#latestVersion = version;
    if (!newerRelease(version, this.#options.currentVersion))
      return { isUpdateAvailable: false, updateInfo: { version } };
    return { isUpdateAvailable: true, updateInfo: { version }, cancellationToken: new RequestCancellation() };
  }

  async downloadUpdate(cancellationToken?: UpdateCancellationToken): Promise<void> {
    // The timer of the server stages each release too, so the release is often there already.
    const staged = await this.#stagedVersion();
    if (staged && (!this.#latestVersion || !newerRelease(this.#latestVersion, staged))) {
      this.#emit("update-downloaded", { version: staged });
      return;
    }
    const request = join(this.#paths.requests, "update-stage");
    await writeFile(request, "", { mode: 0o600 });
    let changedAt: number | null = null;
    for (;;) {
      await delay(this.#options.pollIntervalMs ?? 2_000);
      if (cancellationToken?.cancelled) throw new Error("The download was cancelled.");
      if (await this.#exists(request)) continue;
      const state = await this.#readState();
      if (state) {
        if (state.changedAt !== changedAt) {
          changedAt = state.changedAt;
          // Root reports only the percent.
          this.#emit("download-progress", {
            percent: state.percent,
            total: 0,
            transferred: 0,
            delta: 0,
            bytesPerSecond: 0,
          });
        }
        continue;
      }
      // `stage` removes a staged release that is not the latest one, so what is there now is.
      const ready = await this.#stagedVersion();
      if (!ready) throw new Error("The server staged no release.");
      this.#emit("update-downloaded", { version: ready });
      return;
    }
  }

  /** Root stops this process when it takes the request. */
  quitAndInstall(): void {
    writeFileSync(join(this.#paths.requests, "update-install"), "", { mode: 0o600 });
  }

  #emit<Event extends keyof HostedUpdateEvents>(event: Event, ...values: HostedUpdateEvents[Event]): void {
    this.#events.emit(event, ...values);
  }

  async #stagedVersion(): Promise<string | null> {
    const version = await readFile(this.#paths.stagedReady, "utf8").then(
      (value) => value.trim(),
      () => "",
    );
    return isValidSemver(version) && newerRelease(version, this.#options.currentVersion) ? version : null;
  }

  async #readState(): Promise<{ changedAt: number; percent: number } | null> {
    try {
      const [text, info] = await Promise.all([readFile(this.#paths.state, "utf8"), stat(this.#paths.state)]);
      const [step, value] = text.trim().split(" ");
      const percent = step === "downloading" ? Math.min(Number(value) || 0, 100) : step === "preparing" ? 100 : 0;
      return { changedAt: info.mtimeMs, percent };
    } catch {
      return null;
    }
  }

  async #exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  }
}
