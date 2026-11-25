import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-update-automatic-e2e");
const WAIT_MS = 15_000;
const OLD_VERSION = "0.0.1";
const MANAGED: ManagedProviderId = "opencode";
const SYSTEM: ManagedProviderId = "claude";
const OFF: ManagedProviderId = "grok";

interface Report {
  passed: boolean;
  firstCheck?: {
    phases: Record<string, string[]>;
    offeredBeforeUpdate: boolean;
    systemOffer: string | null;
    offerAfterFailure: string | null;
  };
  laterCheck?: { phases: Record<string, string[]> };
  turnedOn?: { phases: Record<string, string[]>; offerAfterOff: string | null };
  cancelled?: { phases: Record<string, string[]>; offer: string | null };
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-update-automatic-e2e-"));
const report: Report = { passed: false };
let offTurnedOn = false;

function nextStatus(
  manager: ProviderRuntimeManager,
  label: string,
  check: (snapshot: ProviderRuntimeSnapshot) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), WAIT_MS);
    const listener = (snapshot: ProviderRuntimeSnapshot) => {
      if (!check(snapshot)) return;
      clearTimeout(timer);
      manager.off("status", listener);
      resolve();
    };
    manager.on("status", listener);
  });
}

async function startManager(
  name: string,
  providers: ManagedProviderId[],
  availableDiskBytes: () => Promise<number> = async () => Number.MAX_SAFE_INTEGER,
) {
  const manager = new ProviderRuntimeManager({
    root: join(root, name),
    isProviderOn: (provider) => provider !== OFF || offTurnedOn,
    availableDiskBytes,
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  for (const provider of providers) {
    const pinned = manager.executablePath(provider);
    assert.ok(pinned, "this platform has managed runtimes");
    const bin = join(dirname(dirname(dirname(pinned))), OLD_VERSION, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, basename(pinned)), "#!/bin/sh\n", { mode: 0o755 });
  }
  await runCauseEffect(manager.initialize());
  const snapshots: ProviderRuntimeSnapshot[] = [];
  manager.on("status", (snapshot) => snapshots.push(snapshot));
  return { manager, snapshots };
}

function phases(snapshots: ProviderRuntimeSnapshot[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const provider of [MANAGED, SYSTEM, OFF]) {
    result[provider] = snapshots
      .map((snapshot) => snapshot.providers[provider].phase)
      .filter((phase, index, all) => phase !== all[index - 1]);
  }
  return result;
}

function offer(manager: ProviderRuntimeManager, provider: ManagedProviderId): string | null {
  return manager.getStatus().providers[provider].availableVersion ?? null;
}

const managers: ProviderRuntimeManager[] = [];
try {
  const automatic = await startManager("automatic", [MANAGED, SYSTEM, OFF]);
  managers.push(automatic.manager);
  assert.equal(automatic.manager.getStatus().providers[MANAGED].version, OLD_VERSION);
  automatic.manager.setSystemVersion(SYSTEM, OLD_VERSION);
  assert.notEqual(offer(automatic.manager, MANAGED), null, "before the checks start, the update is offered");
  automatic.snapshots.length = 0;
  const updateEnded = nextStatus(
    automatic.manager,
    "the managed update to end",
    (snapshot) => snapshot.providers[MANAGED].phase === "download-error",
  );
  automatic.manager.startUpdateChecks();
  assert.equal(offer(automatic.manager, MANAGED), null, "the CLI to update is not offered");
  assert.notEqual(offer(automatic.manager, SYSTEM), null, "a CLI the user installed stays offered");
  await runCauseEffect(automatic.manager.checkForUpdates()).catch(() => undefined);
  await updateEnded;
  const firstDownload = automatic.snapshots.findIndex(
    (snapshot) => snapshot.providers[MANAGED].phase === "downloading",
  );
  const firstCheck = {
    phases: phases(automatic.snapshots),
    offeredBeforeUpdate: automatic.snapshots
      .slice(0, firstDownload === -1 ? undefined : firstDownload)
      .some((snapshot) => (snapshot.providers[MANAGED].availableVersion ?? null) !== null),
    systemOffer: offer(automatic.manager, SYSTEM),
    offerAfterFailure: offer(automatic.manager, MANAGED),
  };
  report.firstCheck = firstCheck;
  assert.notEqual(firstDownload, -1, "the managed CLI update starts on its own");
  assert.equal(firstCheck.offeredBeforeUpdate, false, "no offer is shown before the update starts");
  assert.ok(!firstCheck.phases[SYSTEM]?.includes("downloading"), "a CLI the user installed is left alone");
  assert.ok(!firstCheck.phases[OFF]?.includes("downloading"), "an off provider is left alone");
  assert.notEqual(firstCheck.systemOffer, null, "a CLI the user installed keeps its offer");
  assert.notEqual(firstCheck.offerAfterFailure, null, "a failed update is offered again");

  automatic.snapshots.length = 0;
  await runCauseEffect(automatic.manager.checkForUpdates()).catch(() => undefined);
  const laterCheck = { phases: phases(automatic.snapshots) };
  report.laterCheck = laterCheck;
  assert.ok(!laterCheck.phases[MANAGED]?.includes("downloading"), "a failed update does not start again by itself");

  automatic.snapshots.length = 0;
  const offEnded = nextStatus(
    automatic.manager,
    "the update of the provider turned on to end",
    (snapshot) => snapshot.providers[OFF].phase === "download-error",
  );
  offTurnedOn = true;
  await runCauseEffect(automatic.manager.providerUseChanged());
  await offEnded;
  offTurnedOn = false;
  await runCauseEffect(automatic.manager.providerUseChanged());
  const turnedOn = { phases: phases(automatic.snapshots), offerAfterOff: offer(automatic.manager, OFF) };
  report.turnedOn = turnedOn;
  assert.ok(turnedOn.phases[OFF]?.includes("downloading"), "turning a provider on starts its update at once");
  assert.equal(turnedOn.offerAfterOff, null, "turning it off again takes the offer back at once");

  let releaseDisk: () => void = () => undefined;
  const diskHeld = new Promise<void>((resolve) => {
    releaseDisk = resolve;
  });
  const cancel = await startManager("cancel", [MANAGED], async () => {
    await diskHeld;
    return Number.MAX_SAFE_INTEGER;
  });
  managers.push(cancel.manager);
  const downloading = nextStatus(
    cancel.manager,
    "the automatic update to start",
    (snapshot) => snapshot.providers[MANAGED].phase === "downloading",
  );
  cancel.manager.startUpdateChecks();
  await downloading;
  const cancelled = runCauseEffect(cancel.manager.cancel(MANAGED));
  releaseDisk();
  await cancelled;
  await runCauseEffect(cancel.manager.checkForUpdates()).catch(() => undefined);
  const afterCancel = { phases: phases(cancel.snapshots), offer: offer(cancel.manager, MANAGED) };
  report.cancelled = afterCancel;
  assert.equal(cancel.manager.getStatus().providers[MANAGED].version, OLD_VERSION, "the old CLI stays after a cancel");
  assert.equal(
    afterCancel.phases[MANAGED]?.filter((phase) => phase === "downloading").length,
    1,
    "a cancelled update does not start again by itself",
  );
  assert.notEqual(afterCancel.offer, null, "a cancelled update stays offered");

  report.passed = true;
} finally {
  for (const manager of managers) await runCauseEffect(manager.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
