import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import lockValue from "../native-runtime.lock.json";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { ProviderRuntimeManager } from "../src/main/provider-runtime-manager";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-runtime-blocked-e2e");
const WAIT_MS = 15_000;
const BLOCKED_VERSION = "2.3.2";
const BLOCKLIST_URL = "https://raw.githubusercontent.com/nightly-labs/openbot/main/provider-runtime-blocklist.json";
const LICENSE = "fake OpenCode license\n";

interface Scenario {
  versionBefore: string | null;
  versionAfter: string | null;
  blockedCopyKept: boolean;
}

interface Report {
  passed: boolean;
  pinnedVersion?: string;
  blocked?: Scenario & { versionAfterRestart: string | null; leftCopyKeptAfterCleanup: boolean };
  notBlocked?: Scenario;
  userCli?: Scenario;
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-runtime-blocked-e2e-"));
const report: Report = { passed: false };
const baseLock = parseAgentRuntimeLock(lockValue);
const pinnedVersion = baseLock.opencode.version;
report.pinnedVersion = pinnedVersion;
assert.notEqual(pinnedVersion, BLOCKED_VERSION, "the pinned OpenCode is not the blocked version");

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const executableText = (version: string) => `#!/bin/sh\necho ${version}\n`;

type OpencodeTarget = keyof typeof baseLock.opencode.artifacts;

function isOpencodeTarget(value: string): value is OpencodeTarget {
  return Object.hasOwn(baseLock.opencode.artifacts, value);
}

function lockFor(target: OpencodeTarget) {
  const lock = structuredClone(baseLock);
  lock.opencode.artifacts[target].binarySha256 = sha256(executableText(pinnedVersion));
  lock.opencode.licenseSha256 = sha256(LICENSE);
  return lock;
}

function blocklistFetch(blocked: string[]) {
  return async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== BLOCKLIST_URL) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ schemaVersion: 1, blocked: { opencode: blocked } }), {
      headers: { "content-type": "application/json" },
    });
  };
}

async function writeCopy(versionRoot: string, version: string, executable: string, recorded: boolean): Promise<void> {
  await mkdir(join(versionRoot, "bin"), { recursive: true });
  const text = executableText(version);
  await writeFile(join(versionRoot, "bin", executable), text, { mode: 0o755 });
  await writeFile(join(versionRoot, "LICENSE"), LICENSE);
  if (!recorded) return;
  const target = basename(dirname(versionRoot));
  const record = {
    layoutVersion: 1,
    runtime: "opencode",
    version,
    target,
    files: { [`bin/${executable}`]: sha256(text), LICENSE: sha256(LICENSE) },
  };
  await writeFile(join(versionRoot, "openbot-install.json"), `${JSON.stringify(record)}\n`);
}

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

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

const managers: ProviderRuntimeManager[] = [];

async function startManager(name: string, blocked: string[]) {
  const probe = new ProviderRuntimeManager({ root: join(root, name), isProviderOn: () => false });
  const pinnedExecutable = probe.executablePath("opencode");
  assert.ok(pinnedExecutable, "this platform has a managed OpenCode");
  const pinnedRoot = dirname(dirname(pinnedExecutable));
  const target = basename(dirname(pinnedRoot));
  assert.ok(isOpencodeTarget(target), "the store folder names an OpenCode target");
  const executable = basename(pinnedExecutable);
  const blockedRoot = join(dirname(pinnedRoot), BLOCKED_VERSION);
  await writeCopy(pinnedRoot, pinnedVersion, executable, false);
  await writeCopy(blockedRoot, BLOCKED_VERSION, executable, true);
  const open = async () => {
    const manager = new ProviderRuntimeManager({
      root: join(root, name),
      isProviderOn: (provider) => provider === "opencode",
      lock: lockFor(target),
      fetchImpl: blocklistFetch(blocked),
    });
    managers.push(manager);
    await runCauseEffect(manager.initialize());
    return manager;
  };
  const manager = await open();
  assert.ok(await readFile(join(pinnedRoot, "bin", executable), "utf8"), "the pinned copy is on disk");
  const leaveBlockedCopy = () => writeCopy(blockedRoot, BLOCKED_VERSION, executable, true);
  return { manager, blockedRoot, open, leaveBlockedCopy };
}

const version = (manager: ProviderRuntimeManager) => manager.getStatus().providers.opencode.version;

try {
  const blocked = await startManager("blocked", [BLOCKED_VERSION]);
  const versionBefore = version(blocked.manager);
  assert.equal(versionBefore, BLOCKED_VERSION, "the newest verified copy runs at start");
  const movedBack = nextStatus(
    blocked.manager,
    "the move back to the pinned OpenCode",
    (snapshot) =>
      snapshot.providers.opencode.phase === "ready" && snapshot.providers.opencode.version === pinnedVersion,
  );
  blocked.manager.startUpdateChecks();
  await movedBack;
  await runCauseEffect(blocked.manager.downloadAndWait("opencode"));
  const versionAfter = version(blocked.manager);
  const blockedCopyKept = await exists(blocked.blockedRoot);
  await runCauseEffect(blocked.manager.stop());
  const restarted = await blocked.open();
  const versionAfterRestart = version(restarted);
  await blocked.leaveBlockedCopy();
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await utimes(blocked.blockedRoot, old, old);
  restarted.startUpdateChecks();
  await runCauseEffect(restarted.checkForUpdates()).catch(() => undefined);
  await runCauseEffect(restarted.removeOldVersions());
  report.blocked = {
    versionBefore,
    versionAfter,
    blockedCopyKept,
    versionAfterRestart,
    leftCopyKeptAfterCleanup: await exists(blocked.blockedRoot),
  };
  assert.equal(versionAfter, pinnedVersion, "a copy on a blocked version moves back to the pinned one");
  assert.equal(blockedCopyKept, false, "the blocked copy goes after the move back");
  assert.equal(versionAfterRestart, pinnedVersion, "a restart keeps the pinned copy");
  assert.equal(report.blocked.leftCopyKeptAfterCleanup, false, "the cleanup removes a blocked copy that stayed");

  const notBlocked = await startManager("not-blocked", []);
  const notBlockedBefore = version(notBlocked.manager);
  notBlocked.manager.startUpdateChecks();
  await runCauseEffect(notBlocked.manager.checkForUpdates()).catch(() => undefined);
  report.notBlocked = {
    versionBefore: notBlockedBefore,
    versionAfter: version(notBlocked.manager),
    blockedCopyKept: await exists(notBlocked.blockedRoot),
  };
  assert.equal(report.notBlocked.versionAfter, BLOCKED_VERSION, "a newer copy that is not blocked stays");

  const userCli = await startManager("user-cli", [BLOCKED_VERSION]);
  userCli.manager.setSystemVersion("opencode", BLOCKED_VERSION);
  const userCliBefore = version(userCli.manager);
  userCli.manager.startUpdateChecks();
  await runCauseEffect(userCli.manager.checkForUpdates()).catch(() => undefined);
  report.userCli = {
    versionBefore: userCliBefore,
    versionAfter: version(userCli.manager),
    blockedCopyKept: await exists(userCli.blockedRoot),
  };
  assert.equal(report.userCli.versionAfter, BLOCKED_VERSION, "OpenBot leaves OpenCode alone next to a user's CLI");

  report.passed = true;
} finally {
  for (const manager of managers) await runCauseEffect(manager.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
