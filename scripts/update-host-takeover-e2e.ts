import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import {
  type UpdateAdapter,
  type UpdateCancellationToken,
  type UpdateCheckOutcome,
  UpdateService,
} from "../src/main/update-service";

const logger = createOpenBotLogger("update-host-takeover-e2e");
const OUT = resolve(import.meta.dirname, "../.openbot-build/update-host-takeover-e2e");
const CURRENT = "1.0.0";
const TENANT_RELEASE = "1.1.0";
const HOST_RELEASE = "1.2.0";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void };

class Token implements UpdateCancellationToken {
  cancelled = false;
  #onCancel: (() => void) | null = null;
  cancel(): void {
    this.cancelled = true;
    this.#onCancel?.();
  }
  onCancel(callback: () => void): void {
    this.#onCancel = callback;
  }
}

class ProbeUpdater implements UpdateAdapter {
  allowPrerelease = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  readonly #events = new EventEmitter();
  readonly checks: Deferred<UpdateCheckOutcome | null>[] = [];
  readonly downloads: { token: Token; ended: Promise<void> }[] = [];
  #checkStarted: Deferred<void> = Promise.withResolvers();
  #downloadStarted: Deferred<void> = Promise.withResolvers();

  on(event: string, listener: (value: ProgressInfo & UpdateInfo & Error) => void): this {
    this.#events.on(event, listener);
    return this;
  }

  emit(event: "download-progress" | "update-downloaded", value: Partial<ProgressInfo> | Partial<UpdateInfo>): void {
    this.#events.emit(event, value);
  }

  checkForUpdates(): Promise<UpdateCheckOutcome | null> {
    const check = Promise.withResolvers<UpdateCheckOutcome | null>();
    this.checks.push(check);
    this.#checkStarted.resolve();
    return check.promise;
  }

  downloadUpdate(cancellationToken?: UpdateCancellationToken): Promise<unknown> {
    assert.ok(cancellationToken instanceof Token, "the download uses the token of the check");
    const download = Promise.withResolvers<unknown>();
    cancellationToken.onCancel(() => download.reject(new Error("cancelled")));
    this.downloads.push({
      token: cancellationToken,
      ended: download.promise.then(
        () => undefined,
        () => undefined,
      ),
    });
    this.#downloadStarted.resolve();
    return download.promise;
  }

  quitAndInstall(): void {
    throw new Error("The takeover check installs nothing.");
  }

  async nextCheck(): Promise<Deferred<UpdateCheckOutcome | null>> {
    await this.#checkStarted.promise;
    this.#checkStarted = Promise.withResolvers();
    const check = this.checks.at(-1);
    assert.ok(check);
    return check;
  }

  async nextDownload(): Promise<{ token: Token; ended: Promise<void> }> {
    await this.#downloadStarted.promise;
    this.#downloadStarted = Promise.withResolvers();
    const download = this.downloads.at(-1);
    assert.ok(download);
    return download;
  }
}

function available(version: string): UpdateCheckOutcome {
  return { isUpdateAvailable: true, updateInfo: { version }, cancellationToken: new Token() };
}

function newService(updater: ProbeUpdater): UpdateService {
  const service = new UpdateService(updater, {
    currentVersion: CURRENT,
    enabled: true,
    autoDownload: true,
    beforeInstall: async () => undefined,
    platform: "darwin",
    initialCheckDelayMs: 3_600_000,
    checkIntervalMs: 3_600_000,
  });
  service.start();
  return service;
}

function hostState(phase: "idle" | "downloading", version: string | null) {
  return { phase, cycle: "cycle-1", version, updatedAt: Date.now(), error: null };
}

function view(status: UpdateStatus) {
  return {
    phase: status.phase,
    availableVersion: status.availableVersion,
    progress: status.progress,
    managedByHost: status.managedByHost === true,
  };
}

const steps: { name: string; status: ReturnType<typeof view> }[] = [];
const record = (name: string, status: UpdateStatus) => steps.push({ name, status: view(status) });

{
  const updater = new ProbeUpdater();
  const service = newService(updater);
  const checked = Effect.runPromise(service.checkForUpdates());
  (await updater.nextCheck()).resolve(available(TENANT_RELEASE));
  await checked;
  const download = await updater.nextDownload();
  updater.emit("download-progress", { percent: 40 });
  assert.deepEqual(view(service.getStatus()), {
    phase: "downloading",
    availableVersion: TENANT_RELEASE,
    progress: 40,
    managedByHost: false,
  });
  record("the tenant downloads its release", service.getStatus());

  service.setManagedByHost(true);
  assert.equal(download.token.cancelled, true, "the takeover cancels the download of the tenant");
  await download.ended;
  assert.deepEqual(view(service.getStatus()), {
    phase: "idle",
    availableVersion: null,
    progress: null,
    managedByHost: true,
  });
  record("a tenant that the host does not list shows no busy phase", service.getStatus());

  service.setHostState(hostState("downloading", HOST_RELEASE));
  const host = view(service.getStatus());
  assert.deepEqual(host, { phase: "downloading", availableVersion: HOST_RELEASE, progress: null, managedByHost: true });
  updater.emit("download-progress", { percent: 80 });
  updater.emit("update-downloaded", { version: TENANT_RELEASE });
  assert.deepEqual(view(service.getStatus()), host, "late events of the cancelled download change nothing");
  record("late events of the cancelled download change nothing", service.getStatus());

  service.setManagedByHost(false);
  assert.equal(service.getStatus().phase, "idle");
  const again = Effect.runPromise(service.checkForUpdates());
  (await updater.nextCheck()).resolve(available(TENANT_RELEASE));
  await again;
  await updater.nextDownload();
  assert.deepEqual(view(service.getStatus()), {
    phase: "downloading",
    availableVersion: TENANT_RELEASE,
    progress: null,
    managedByHost: false,
  });
  record("after the host gives the updates back, the tenant downloads again", service.getStatus());
  await Effect.runPromise(service.stop());
}

{
  const updater = new ProbeUpdater();
  const service = newService(updater);
  const checked = Effect.runPromise(service.checkForUpdates());
  const check = await updater.nextCheck();
  assert.equal(service.getStatus().phase, "checking");
  service.setManagedByHost(true);
  service.setHostState(hostState("idle", null));
  check.resolve(available(TENANT_RELEASE));
  await checked;
  assert.deepEqual(view(service.getStatus()), {
    phase: "up-to-date",
    availableVersion: null,
    progress: null,
    managedByHost: true,
  });
  assert.equal(updater.downloads.length, 0, "the late check result starts no download");
  record("a late check result does not replace the host state", service.getStatus());
  await Effect.runPromise(service.stop());
}

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: true, steps }, null, 2)}\n`);
for (const step of steps) logger.info(`ok - ${step.name}`);
logger.info(`Wrote ${join(OUT, "report.json")}`);
