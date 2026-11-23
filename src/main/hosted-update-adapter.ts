import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isNewerRelease } from "@openbot/contracts/release-version";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { fetchLatestLinuxRelease } from "./host-release-service";
import type { UpdateAdapter, UpdateCancellationToken, UpdateCheckOutcome } from "./update-service";

export const HOSTED_UPDATE_TRIGGER = "/etc/systemd/system/openbot-update-request.path";

export interface HostedUpdatePaths {
  readonly requests: string;
  readonly state: string;
  readonly stagedReady: string;
}

export const HOSTED_RUNTIME_DIRECTORY = "/run/openbot";

const HOSTED_UPDATE_PATHS: HostedUpdatePaths = {
  requests: HOSTED_RUNTIME_DIRECTORY,
  state: "/run/openbot-update.state",
  stagedReady: "/opt/OpenBot/staged.ready",
};

export const CONTAINER_UPDATE_PATHS: HostedUpdatePaths = {
  requests: "/var/lib/openbot-update/requests",
  state: "/var/lib/openbot-update/status/state",
  stagedReady: "/var/lib/openbot-update/status/staged.ready",
};

export const CONTAINER_UPDATE_TRIGGER = "/var/lib/openbot-update/status/enabled";

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

type UpdateListener = (value: ProgressInfo & UpdateInfo & Error) => void;

class RequestCancellation implements UpdateCancellationToken {
  cancelled = false;
  cancel(): void {
    this.cancelled = true;
  }
}

export class HostedUpdateAdapter implements UpdateAdapter {
  allowPrerelease = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  readonly #events = new EventEmitter();
  readonly #options: HostedUpdateOptions;
  readonly #paths: HostedUpdatePaths;

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
    if (!isNewerRelease(version, this.#options.currentVersion))
      return { isUpdateAvailable: false, updateInfo: { version } };
    return { isUpdateAvailable: true, updateInfo: { version }, cancellationToken: new RequestCancellation() };
  }

  async downloadUpdate(cancellationToken?: UpdateCancellationToken): Promise<void> {
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
      const ready = await this.#stagedVersion();
      if (!ready) throw new Error("The server staged no release.");
      this.#emit("update-downloaded", { version: ready });
      return;
    }
  }

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
    return isNewerRelease(version, this.#options.currentVersion) ? version : null;
  }

  async #readState(): Promise<{ changedAt: number; percent: number } | null> {
    try {
      const [text, info] = await Promise.all([readFile(this.#paths.state, "utf8"), stat(this.#paths.state)]);
      const [step, value] = text.trim().split(" ");
      const percent = step === "downloading" ? Math.min(Number(value) || 0, 100) : Number.NaN;
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
