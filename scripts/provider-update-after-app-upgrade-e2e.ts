// Starts the real `ProviderRuntimeManager` the way main does after an app upgrade (#3164), with an
// older managed copy of some provider CLIs on disk and no network. Checks that the first update check
// starts the update of each managed CLI with no offer shown first, leaves a CLI the user installed
// and an off provider alone, and that a start with no upgrade only offers the update. An off provider
// gets no offer until it is turned on, and loses it when it is turned off again (#3319). Also checks
// that the stored app version that decides "upgrade" is read back.
// `bun scripts/provider-update-after-app-upgrade-e2e.ts`.
// Writes .openbot-build/provider-update-after-app-upgrade-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { createProviderCliAppVersionStore } from "../src/main/provider-cli-app-version-store";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-update-after-app-upgrade-e2e");
const WAIT_MS = 15_000;
const OLD_VERSION = "0.0.1";
/** Managed copy, updated after an upgrade. */
const MANAGED: ManagedProviderId = "opencode";
/** Managed copy too, but the agent runs a CLI the user installed. */
const SYSTEM: ManagedProviderId = "claude";
/** Managed copy of a provider the user turned off. */
const OFF: ManagedProviderId = "grok";

interface Report {
  passed: boolean;
  versionStore?: { missing: string | null; saved: string | null };
  upgrade?: {
    phases: Record<string, string[]>;
    offeredBeforeUpdate: boolean;
    systemOffer: string | null;
  };
  noUpgrade?: {
    phases: Record<string, string[]>;
    offer: string | null;
    offOffer: string | null;
    offerAfterOn: string | null;
    offerAfterOff: string | null;
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-update-after-app-upgrade-e2e-"));
const report: Report = { passed: false };
/** Whether the user turned `OFF` on, as the provider switch file says. */
let offTurnedOn = false;

/** The first status that `check` accepts, or a failure after `WAIT_MS`. */
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

/** A manager with no network and an older copy of each named provider in its store. */
async function startManager(name: string, providers: ManagedProviderId[]) {
  const manager = new ProviderRuntimeManager({
    root: join(root, name),
    isProviderOn: (provider) => provider !== OFF || offTurnedOn,
    availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
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

const managers: ProviderRuntimeManager[] = [];
try {
  const versionPath = join(root, "openbot-provider-cli-app-version-v1.json");
  const missing = createProviderCliAppVersionStore(versionPath);
  await runCauseEffect(missing.load());
  const before = missing.get().appVersion;
  await runCauseEffect(missing.set({ appVersion: "9.9.9" }));
  const saved = createProviderCliAppVersionStore(versionPath);
  await runCauseEffect(saved.load());
  report.versionStore = { missing: before, saved: saved.get().appVersion };
  assert.equal(report.versionStore.missing, null, "no stored version reads as an upgrade");
  assert.equal(report.versionStore.saved, "9.9.9", "the app version is read back on the next start");

  const upgrade = await startManager("upgrade", [MANAGED, SYSTEM, OFF]);
  managers.push(upgrade.manager);
  assert.equal(upgrade.manager.getStatus().providers[MANAGED].version, OLD_VERSION);
  upgrade.manager.setSystemVersion(SYSTEM, OLD_VERSION);
  // Main forwards status to the renderer only from here, as `application-services.ts` does.
  upgrade.snapshots.length = 0;
  const updateEnded = nextStatus(
    upgrade.manager,
    "the managed update to end",
    (snapshot) => snapshot.providers[MANAGED].phase === "download-error",
  );
  upgrade.manager.startUpdateChecks({ updateInstalled: true });
  // The release check is still on its way: only the CLI that it will update has no offer.
  const duringCheck = upgrade.manager.getStatus().providers;
  assert.equal(duringCheck[MANAGED].availableVersion ?? null, null, "the CLI to update is not offered");
  assert.notEqual(duringCheck[SYSTEM].availableVersion ?? null, null, "a CLI the user installed stays offered");
  await runCauseEffect(upgrade.manager.checkForUpdates()).catch(() => undefined);
  await updateEnded;
  const firstDownload = upgrade.snapshots.findIndex((snapshot) => snapshot.providers[MANAGED].phase === "downloading");
  const upgraded = {
    phases: phases(upgrade.snapshots),
    offeredBeforeUpdate: upgrade.snapshots
      .slice(0, firstDownload === -1 ? undefined : firstDownload)
      .some((snapshot) => (snapshot.providers[MANAGED].availableVersion ?? null) !== null),
    systemOffer: upgrade.manager.getStatus().providers[SYSTEM].availableVersion ?? null,
  };
  report.upgrade = upgraded;
  assert.notEqual(firstDownload, -1, "the managed CLI update starts on its own");
  assert.equal(upgraded.offeredBeforeUpdate, false, "no offer is shown before the update starts");
  assert.ok(!upgraded.phases[SYSTEM]?.includes("downloading"), "a CLI the user installed is left alone");
  assert.ok(!upgraded.phases[OFF]?.includes("downloading"), "an off provider is left alone");
  assert.notEqual(upgraded.systemOffer, null, "a CLI the user installed keeps its offer");

  const noUpgrade = await startManager("no-upgrade", [MANAGED, OFF]);
  managers.push(noUpgrade.manager);
  noUpgrade.manager.startUpdateChecks();
  await runCauseEffect(noUpgrade.manager.checkForUpdates()).catch(() => undefined);
  const offOffer = noUpgrade.manager.getStatus().providers[OFF].availableVersion ?? null;
  // Main sends the offers again when the user turns a provider on or off, as `saveProviderUse` does.
  offTurnedOn = true;
  await runCauseEffect(noUpgrade.manager.providerUseChanged());
  const offerAfterOn = noUpgrade.snapshots.at(-1)?.providers[OFF].availableVersion ?? null;
  offTurnedOn = false;
  await runCauseEffect(noUpgrade.manager.providerUseChanged());
  const offerAfterOff = noUpgrade.snapshots.at(-1)?.providers[OFF].availableVersion ?? null;
  const notUpgraded = {
    phases: phases(noUpgrade.snapshots),
    offer: noUpgrade.manager.getStatus().providers[MANAGED].availableVersion ?? null,
    offOffer,
    offerAfterOn,
    offerAfterOff,
  };
  report.noUpgrade = notUpgraded;
  assert.ok(!notUpgraded.phases[MANAGED]?.includes("downloading"), "with no upgrade nothing downloads");
  assert.notEqual(notUpgraded.offer, null, "with no upgrade the update is offered");
  assert.equal(notUpgraded.offOffer, null, "an off provider is not offered an update");
  assert.notEqual(notUpgraded.offerAfterOn, null, "turning the provider on offers the update at once");
  assert.equal(notUpgraded.offerAfterOff, null, "turning it off again takes the offer back at once");

  report.passed = true;
} finally {
  for (const manager of managers) await runCauseEffect(manager.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
