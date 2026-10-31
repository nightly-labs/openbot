// Starts the real `ProviderRuntimeManager` over a store with downloaded provider CLIs, as main does,
// with no network (#3321). Checks that the downloaded CLI of a provider that is off is removed with
// its partial downloads and verification records, and reads as not downloaded after; that a provider
// that is on, whose CLI path the user set, or Pi while a key-only provider that runs on it is on, is
// refused; that a version a program holds stays whole and the removal reports it; that this
// instance does not stamp a provider that is off; and that a version another
// instance stamped after this one is kept. A verified version keeps no older one: the older version
// goes once no instance stamped it within the window, and is not stamped again. The Storage page
// removes the downloads of providers that are off in one step, and never one that is on: one that a
// program holds fails and is named, and the others still go. A provider that runs the CLI the user
// installed runs nothing from the store, so its download can go. The real resolver picks that CLI
// over OpenBot's copy when it is as new, and an update still starts the copy it downloaded.
// `bun scripts/provider-runtime-remove-e2e.ts`.
// Writes .openbot-build/provider-runtime-remove-e2e/report.json.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentProviderId, ManagedProviderId } from "@openbot/contracts/agent-providers";
import { resolveCodexCli, resolveInstalledFirst } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { INSTALL_RECORD } from "../src/main/provider-runtime-descriptors";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-runtime-remove-e2e");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Off since long ago, with two versions, a partial download and a verification record. */
const OFF: ManagedProviderId = "cursor";
/** On: its download is not removed. */
const ON: ManagedProviderId = "opencode";
/** Off, but a sibling instance stamped its version a moment ago. */
const SIBLING: ManagedProviderId = "cline";
/** On at the start, then turned off: this instance's own stamp does not keep it. */
const TURNED_OFF: ManagedProviderId = "grok";
/** On at the start, then turned off; a sibling stamped it after this instance did. */
const SHARED: ManagedProviderId = "antigravity";
/** Off, and the user pointed OpenBot at a CLI of their own. */
const CONFIGURED: ManagedProviderId = "claude";
const CONFIGURED_ENV = `OPENBOT_${CONFIGURED.toUpperCase()}_PATH`;
/** Off, but DeepSeek, which is on, runs on its CLI. */
const PI: ManagedProviderId = "pi";
/** Off, but its versions cannot be moved: a program holds them, as Windows does with an open CLI. */
const HELD: ManagedProviderId = "muse";
/** On, with a verified version newer than the pin. */
const READY: ManagedProviderId = "codex";
const READY_VERSION = "999.0.0";

interface Report {
  passed: boolean;
  offStampedAtStart?: boolean;
  bytesBefore?: Partial<Record<ManagedProviderId, number>>;
  versionsBefore?: number;
  removed?: { versions: string[]; partials: string[]; records: string[]; phase: string; version: string | null };
  bytesAfter?: number;
  onRefused?: string;
  configuredRefused?: string;
  configuredKept?: boolean;
  piRefused?: string;
  piKept?: boolean;
  heldRefused?: string;
  heldWhole?: boolean;
  siblingKept?: boolean;
  turnedOffRemoved?: boolean;
  sharedKept?: boolean;
  readyPhase?: string;
  readyBackupCollected?: boolean;
  readyRecentKept?: boolean;
  readyRecentStampedAgain?: boolean;
  readyMeasured?: number;
  storageBefore?: { bytes: number; providers: ManagedProviderId[] };
  storageHeldFailure?: string;
  storageOffRemoved?: boolean;
  storageAfter?: { bytes: number; providers: ManagedProviderId[] };
  storageKept?: { on: boolean; ready: boolean; sibling: boolean; configured: boolean; pi: boolean };
  installedMeasured?: number;
  installedListed?: ManagedProviderId[];
  installedGoneMeasured?: number;
  installedRemoved?: { phase: string; gone: boolean };
  choice?: Record<string, { source: string; version: string }>;
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-runtime-remove-e2e-"));
const store = join(root, "provider-runtimes");
const downloads = join(root, "downloads");
const report: Report = { passed: false };
const off = new Set<AgentProviderId>([OFF, SIBLING, CONFIGURED, PI, HELD]);
const previousConfigured = process.env[CONFIGURED_ENV];

const manager = new ProviderRuntimeManager({
  root: store,
  downloadRoot: downloads,
  isProviderOn: (provider) => !off.has(provider),
  availableDiskBytes: async () => Number.MAX_SAFE_INTEGER,
  fetchImpl: async () => {
    throw new TypeError("fetch failed");
  },
});

/** The directory that holds the versions of one provider CLI for this computer's target. */
function targetRoot(provider: ManagedProviderId): string {
  const pinned = manager.executablePath(provider);
  assert.ok(pinned, "this platform has managed runtimes");
  return dirname(dirname(dirname(pinned)));
}

/** Puts a version with an executable in the store, last stamped at `stampedAt`. */
async function install(provider: ManagedProviderId, version: string, stampedAt: Date): Promise<string> {
  const pinned = manager.executablePath(provider);
  assert.ok(pinned);
  const path = join(targetRoot(provider), version);
  await mkdir(join(path, "bin"), { recursive: true });
  await writeFile(join(path, "bin", basename(pinned)), "#!/bin/sh\n".padEnd(4096, "#"), { mode: 0o755 });
  await writeFile(join(dirname(path), `.${version}.verified.json`), "{}\n");
  await utimes(path, stampedAt, stampedAt);
  return path;
}

/** Puts a version in the store as an update writes one: an install record and a CLI that answers its version. */
async function installVerified(provider: ManagedProviderId, version: string): Promise<string> {
  const pinned = manager.executablePath(provider);
  assert.ok(pinned);
  const path = join(targetRoot(provider), version);
  const executable = join(path, "bin", basename(pinned));
  await mkdir(dirname(executable), { recursive: true });
  await writeFile(executable, `#!/bin/sh\necho "codex-cli ${version}"\n`, { mode: 0o755 });
  const digest = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
  const record = {
    layoutVersion: 1,
    runtime: provider,
    version,
    target: basename(targetRoot(provider)),
    files: { [`bin/${basename(pinned)}`]: digest },
  };
  await writeFile(join(path, INSTALL_RECORD), `${JSON.stringify(record)}\n`);
  return path;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function refusal(provider: ManagedProviderId): Promise<string> {
  const error = await runCauseEffect(manager.removeDownload(provider)).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof Error, `${provider} is refused`);
  return error.message;
}

try {
  process.env[CONFIGURED_ENV] = join(root, "user-cli", CONFIGURED);
  const old = new Date(Date.now() - 30 * DAY_MS);
  const offVersions = [await install(OFF, "0.0.1", old), await install(OFF, "0.0.2", old)];
  const target = basename(targetRoot(OFF));
  const partials = [
    join(downloads, `${OFF}-${target}-0.0.3.partial`),
    join(downloads, `${OFF}-${target}-0.0.3.partial.json`),
  ];
  await mkdir(downloads, { recursive: true });
  for (const partial of partials) await writeFile(partial, "partial");
  const onVersion = await install(ON, "0.0.1", old);
  const siblingVersion = await install(SIBLING, "0.0.1", new Date());
  const turnedOffVersion = await install(TURNED_OFF, "0.0.1", old);
  const sharedVersion = await install(SHARED, "0.0.1", old);
  const configuredVersion = await install(CONFIGURED, "0.0.1", old);
  const piVersion = await install(PI, "0.0.1", old);
  const heldVersion = await install(HELD, "0.0.1", old);
  // The version that the verified one replaced, last run long ago.
  const readyBackup = await install(READY, "0.0.1", old);
  const readyPath = await installVerified(READY, READY_VERSION);

  await runCauseEffect(manager.initialize());
  // A provider that is on is stamped at start: the one older version is its working fallback.
  assert.ok((await stat(onVersion)).mtimeMs > old.getTime(), "a provider that is on is stamped at start");
  report.offStampedAtStart = (await stat(offVersions[1] ?? "")).mtimeMs > old.getTime();
  assert.equal(report.offStampedAtStart, false, "a provider that is off is not stamped");
  report.readyPhase = manager.getStatus().providers[READY].phase;
  assert.equal(report.readyPhase, "ready", "the verified version is what the provider runs");
  report.readyBackupCollected = !(await exists(readyBackup));
  assert.ok(report.readyBackupCollected, "a verified version keeps no older one to fall back on");

  // A version run within the window stays, and this instance does not stamp it again.
  const recent = new Date(Date.now() - DAY_MS / 2);
  const readyRecent = await install(READY, "0.0.2", recent);
  await runCauseEffect(manager.removeOldVersions());
  report.readyRecentKept = await exists(readyRecent);
  assert.ok(report.readyRecentKept, "a version stamped within the window stays");
  report.readyRecentStampedAgain = (await stat(readyRecent)).mtimeMs !== recent.getTime();
  assert.equal(report.readyRecentStampedAgain, false, "the replaced version is not stamped again");

  const measure = async (provider: ManagedProviderId) =>
    (await runCauseEffect(manager.measureDownload(provider))).bytes;
  report.bytesBefore = {
    [OFF]: await measure(OFF),
    [ON]: await measure(ON),
    [SIBLING]: await measure(SIBLING),
    [CONFIGURED]: await measure(CONFIGURED),
    [PI]: await measure(PI),
  };
  assert.ok((report.bytesBefore[OFF] ?? 0) >= 2 * 4096, "both versions of the off provider count");
  report.versionsBefore = (await runCauseEffect(manager.measureDownload(OFF))).versions;
  assert.equal(report.versionsBefore, 2, "the page names how many versions it removes");
  assert.equal(report.bytesBefore[ON], 0, "a provider that is on offers nothing to remove");
  assert.equal(report.bytesBefore[SIBLING], 0, "a version a sibling stamped is not counted");
  assert.equal(report.bytesBefore[CONFIGURED], 0, "a provider with a CLI path offers nothing to remove");
  assert.equal(report.bytesBefore[PI], 0, "Pi offers nothing to remove while DeepSeek runs on it");

  const snapshot = await runCauseEffect(manager.removeDownload(OFF));
  const removed = {
    versions: (await Promise.all(offVersions.map(exists))).every((found) => !found)
      ? offVersions.map((p) => basename(p))
      : [],
    partials: (await Promise.all(partials.map(exists))).every((found) => !found)
      ? partials.map((p) => basename(p))
      : [],
    records: (await exists(join(targetRoot(OFF), ".0.0.1.verified.json"))) ? [] : [".0.0.1.verified.json"],
    phase: snapshot.providers[OFF].phase,
    version: snapshot.providers[OFF].version,
  };
  report.removed = removed;
  assert.equal(removed.versions.length, 2, "every version is removed");
  assert.equal(removed.partials.length, 2, "the partial download is removed");
  assert.equal(removed.records.length, 1, "the verification records are removed");
  assert.equal(removed.phase, "not-downloaded", "the provider reads as not downloaded");
  assert.equal(removed.version, null, "no older copy is left to name");
  report.bytesAfter = await measure(OFF);
  assert.equal(report.bytesAfter, 0, "nothing is left to remove");

  report.onRefused = await refusal(ON);
  assert.ok(await exists(onVersion), "the download of a provider that is on stays");
  report.configuredRefused = await refusal(CONFIGURED);
  report.configuredKept = await exists(configuredVersion);
  assert.ok(report.configuredKept, "the store copy of a provider with a CLI path stays");
  report.piRefused = await refusal(PI);
  report.piKept = await exists(piVersion);
  assert.ok(report.piKept, "the Pi CLI that DeepSeek runs on stays");

  // A directory that refuses the move stays whole, and the removal says that it did not finish.
  await chmod(targetRoot(HELD), 0o555);
  try {
    report.heldRefused = await refusal(HELD);
  } finally {
    await chmod(targetRoot(HELD), 0o755);
  }
  const heldExecutable = manager.executablePath(HELD);
  report.heldWhole =
    Boolean(heldExecutable) && (await exists(join(heldVersion, "bin", basename(heldExecutable ?? ""))));
  assert.ok(report.heldWhole, "a version that cannot be moved keeps its executable");

  await runCauseEffect(manager.removeDownload(SIBLING));
  report.siblingKept = await exists(siblingVersion);
  assert.ok(report.siblingKept, "a version a sibling stamped recently stays");

  // Turned off after this instance stamped both at start. A sibling stamps one of them later.
  off.add(TURNED_OFF);
  off.add(SHARED);
  const sharedStamp = new Date((await stat(sharedVersion)).mtimeMs + 5000);
  await utimes(sharedVersion, sharedStamp, sharedStamp);
  await runCauseEffect(manager.removeDownload(TURNED_OFF));
  report.turnedOffRemoved = !(await exists(turnedOffVersion));
  assert.ok(report.turnedOffRemoved, "this instance's own stamp does not keep a version");
  await runCauseEffect(manager.removeDownload(SHARED));
  report.sharedKept = await exists(sharedVersion);
  assert.ok(report.sharedKept, "a sibling's stamp after this instance's keeps a version");

  report.readyMeasured = await measure(READY);
  assert.equal(report.readyMeasured, 0, "a verified provider that is on offers nothing to remove");

  // The Storage page: the held Muse version and a new Cursor version are the downloads that can go.
  const offLater = await install(OFF, "0.0.3", old);
  report.storageBefore = await runCauseEffect(manager.removableRuntimes());
  assert.deepEqual(
    [...report.storageBefore.providers].sort(),
    [OFF, HELD].sort(),
    "it names only providers that are off",
  );
  assert.ok(report.storageBefore.bytes >= 2 * 4096, "both downloads count");
  await chmod(targetRoot(HELD), 0o555);
  try {
    const failure = await runCauseEffect(manager.removeRemovableRuntimes()).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failure instanceof Error, "a download that a program holds fails the removal");
    report.storageHeldFailure = failure.message;
  } finally {
    await chmod(targetRoot(HELD), 0o755);
  }
  assert.equal(report.storageHeldFailure, "Could not remove the CLI downloads of Muse.", "the failure names it");
  report.storageOffRemoved = !(await exists(offLater));
  assert.ok(report.storageOffRemoved, "one failure does not stop the others");
  report.storageAfter = await runCauseEffect(manager.removeRemovableRuntimes());
  assert.deepEqual(report.storageAfter, { bytes: 0, providers: [] }, "nothing is left to remove");
  assert.ok(!(await exists(heldVersion)), "the held version goes once the program lets it go");
  report.storageKept = {
    on: await exists(onVersion),
    ready: (await exists(readyPath)) && (await exists(readyRecent)),
    sibling: await exists(siblingVersion),
    configured: await exists(configuredVersion),
    pi: await exists(piVersion),
  };
  assert.deepEqual(
    report.storageKept,
    { on: true, ready: true, sibling: true, configured: true, pi: true },
    "the page keeps every provider that is on, and what the provider page refuses",
  );

  // The provider now runs the CLI the user installed, so no agent runs OpenBot's copy.
  manager.setSystemVersion(ON, "9.9.9");
  report.installedMeasured = await measure(ON);
  assert.ok(report.installedMeasured >= 4096, "the copy of a provider that runs the user's CLI counts");
  report.installedListed = (await runCauseEffect(manager.removableRuntimes())).providers;
  assert.deepEqual(report.installedListed, [ON], "the Storage page names it");
  assert.equal(manager.setSystemVersion(ON, null), true, "main is told that the copy runs again");
  report.installedGoneMeasured = await measure(ON);
  assert.equal(report.installedGoneMeasured, 0, "the copy stays once the user's CLI is gone");
  manager.setSystemVersion(ON, "9.9.9");
  const installedSnapshot = await runCauseEffect(manager.removeDownload(ON));
  report.installedRemoved = { phase: installedSnapshot.providers[ON].phase, gone: !(await exists(onVersion)) };
  assert.deepEqual(report.installedRemoved, { phase: "not-downloaded", gone: true }, "the copy is removed");

  // The real Codex resolver, with a CLI on PATH and OpenBot's copy that answer their versions.
  const fakeCodex = async (name: string, version: string) => {
    const path = join(root, "choice", name, "codex");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `#!/bin/sh\necho "codex-cli ${version}"\n`, { mode: 0o755 });
    return path;
  };
  const choose = async (
    installed: string | null,
    copy: string,
    preferInstalled = true,
  ): Promise<{ source: string; version: string }> => {
    const system = installed ? await fakeCodex(`system-${installed}`, installed) : join(root, "choice", "none");
    const managed = await fakeCodex(`managed-${copy}`, copy);
    const cli = await runCauseEffect(
      resolveInstalledFirst(
        (input) => resolveCodexCli({ ...input, systemCandidates: [system] }),
        managed,
        preferInstalled,
      ),
    );
    return { source: cli.source, version: cli.version };
  };
  report.choice = {
    same: await choose("0.200.0", "0.200.0"),
    installedNewer: await choose("0.201.0", "0.200.0"),
    copyNewer: await choose("0.200.0", "0.201.0"),
    update: await choose("0.201.0", "0.200.0", false),
    noInstalled: await choose(null, "0.200.0"),
  };
  assert.deepEqual(
    report.choice,
    {
      same: { source: "system", version: "0.200.0" },
      installedNewer: { source: "system", version: "0.201.0" },
      copyNewer: { source: "managed", version: "0.201.0" },
      update: { source: "managed", version: "0.200.0" },
      noInstalled: { source: "managed", version: "0.200.0" },
    },
    "the user's CLI wins when it is as new, and an update starts OpenBot's copy",
  );

  report.passed = true;
} finally {
  if (previousConfigured === undefined) delete process.env[CONFIGURED_ENV];
  else process.env[CONFIGURED_ENV] = previousConfigured;
  await runCauseEffect(manager.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
