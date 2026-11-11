// Checks the staged rollout (docs/RELEASING.md#staged-rollout) on the update manifests of a real
// release. It downloads the manifests of v0.67.0 with `gh release download`, which only reads, and
// changes only local copies. Then it:
// - runs `scripts/update-rollout.ts` on the four manifests at 10%, 0% and 100%, and checks that only
//   the `stagingPercentage` line changes and that each SHA-512 and size stays the same;
// - checks that the script stops for a changed value, a wrong version, a missing manifest and a
//   percentage that is not a whole number from 0 to 100;
// - merges the macOS manifest from its two halves, as the publish job does, and sets the percentage;
// - runs `scripts/verify-update-artifacts.ts` on a small dist folder with each kind of value;
// - runs the update check of the installed electron-updater, against a local HTTP server that serves
//   the changed manifests, for 2,000 installs, each with its own `.updaterId`;
// - runs the app's `UpdateService` on that updater: an automatic check keeps the stage, a check that a
//   person asks for skips it, and a paused release (0%) stays paused for both.
// `bun run test:update-rollout [-- --manifests <dir>]`. Writes .openbot-build/update-rollout-e2e/report.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { RequestOptions } from "node:http";
import { join, resolve } from "node:path";
import type { UpdateStatus } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { AppUpdater } from "electron-updater/out/AppUpdater";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { UpdateService } from "../src/main/update-service";
import { mergeMacUpdateManifests } from "./merge-mac-update-manifests";
import { readScriptArguments } from "./script-arguments";
import {
  assertOnlyStagingChanged,
  readStagingPercentage,
  readUpdateManifest,
  setStagingPercentage,
  UPDATE_MANIFESTS,
  type UpdateManifest,
} from "./update-rollout";

const logger = createOpenBotLogger("update-rollout-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/update-rollout-e2e");
const RELEASE_TAG = "v0.67.0";
const VERSION = RELEASE_TAG.slice(1);
const INSTALLS = 2000;

/**
 * The electron-updater base class with an app adapter in place of Electron. A check goes through its
 * own provider, YAML parser and `isUpdateAvailable`, which reads the per-install ID from
 * `<userData>/.updaterId` and creates it on the first check.
 */
class ProbeUpdater extends AppUpdater {
  constructor(userData: string, version: string, platform: NodeJS.Platform) {
    super(null, {
      version,
      name: "OpenBot",
      isPackaged: true,
      appUpdateConfigPath: join(userData, "app-update.yml"),
      userDataPath: userData,
      baseCachePath: join(userData, "cache"),
      whenReady: () => Promise.resolve(),
      relaunch: () => undefined,
      quit: () => undefined,
      onQuit: () => undefined,
    });
    this.logger = null;
    this.autoDownload = false;
    // electron-updater's own test option, and an HTTP client that needs no Electron `net` module.
    Object.assign(this, {
      _testOnlyOptions: { platform },
      httpExecutor: {
        request: async (request: RequestOptions) => {
          const response = await fetch(`http://${request.hostname}:${request.port}${request.path}`);
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${request.path}`);
          return response.text();
        },
      },
    });
  }

  async check(feedUrl: string): Promise<boolean> {
    this.setFeedURL({ provider: "generic", url: feedUrl });
    const result = await this.checkForUpdates();
    assert.ok(result, "the updater is active");
    return result.isUpdateAvailable;
  }

  protected doDownloadUpdate(): never {
    throw new Error("The rollout check downloads nothing.");
  }

  quitAndInstall(): void {
    throw new Error("The rollout check installs nothing.");
  }
}

const parsed = readScriptArguments({
  usage: "Usage: bun scripts/update-rollout-e2e.ts [--manifests <dir with the four v0.67.0 manifests>]",
  options: { manifests: { type: "string" } },
});
if (!parsed) process.exit(0);

type ManifestName = (typeof UPDATE_MANIFESTS)[number];

await rm(OUT, { recursive: true, force: true });
const sourceDir = join(OUT, "source");
await mkdir(sourceDir, { recursive: true });
if (parsed.values.manifests) {
  for (const name of UPDATE_MANIFESTS) await cp(join(resolve(parsed.values.manifests), name), join(sourceDir, name));
} else {
  run("gh", [
    "release",
    "download",
    RELEASE_TAG,
    "--repo",
    "nightly-labs/openbot",
    "--pattern",
    "*.yml",
    "--dir",
    sourceDir,
  ]);
}
const originals = new Map<ManifestName, string>();
for (const name of UPDATE_MANIFESTS) originals.set(name, await readFile(join(sourceDir, name), "utf8"));
const original = (name: ManifestName) => originals.get(name) ?? "";
const sourceHashes = Object.fromEntries(UPDATE_MANIFESTS.map((name) => [name, sha256(original(name))]));
for (const name of UPDATE_MANIFESTS) {
  assert.equal(
    readStagingPercentage(readUpdateManifest(original(name))),
    100,
    `${name} of ${RELEASE_TAG} has no stagingPercentage`,
  );
}

// 1. The CLI on copies of the four manifests.
const workDir = join(OUT, "work");
const workPaths = UPDATE_MANIFESTS.map((name) => join(workDir, name));
const resetWork = async () => {
  await rm(workDir, { recursive: true, force: true });
  await cp(sourceDir, workDir, { recursive: true });
};
const rollout = (...args: string[]) => run("bun", ["scripts/update-rollout.ts", ...args], { allowFailure: true });
const cliHashes: Record<string, Record<string, string>> = {};
await resetWork();
for (const percentage of [10, 0, 50, 100]) {
  assert.equal(rollout("--version", VERSION, "--percentage", String(percentage), ...workPaths).status, 0);
  assert.equal(rollout("--check", "--version", VERSION, "--percentage", String(percentage), ...workPaths).status, 0);
  const other = percentage === 50 ? "10" : "50";
  assert.notEqual(rollout("--check", "--version", VERSION, "--percentage", other, ...workPaths).status, 0);
  for (const name of UPDATE_MANIFESTS) {
    const changed = await readFile(join(workDir, name), "utf8");
    const expected = percentage === 100 ? original(name) : `${original(name)}stagingPercentage: ${percentage}\n`;
    assert.equal(changed, expected, `${name} at ${percentage}% is the original with only the staging line`);
    assertSameUpdaterValues(original(name), changed, percentage);
  }
  cliHashes[`${percentage}%`] = Object.fromEntries(
    await Promise.all(
      UPDATE_MANIFESTS.map(async (name) => [name, sha256(await readFile(join(workDir, name), "utf8"))]),
    ),
  );
}
// From 0% back to 100% gives the bytes of the release.
assert.deepEqual(cliHashes["100%"], sourceHashes);

const refusals: Record<string, number | null> = {};
const refuse = async (label: string, args: string[]) => {
  await resetWork();
  await setWorkPercentage(10);
  const before = await readWork();
  const result = rollout(...args);
  assert.notEqual(result.status, 0, `${label} must fail`);
  assert.deepEqual(await readWork(), before, `${label} must not change a manifest`);
  refusals[label] = result.status;
};
await refuse("other version", ["--version", "0.66.0", "--percentage", "20", ...workPaths]);
await refuse("three manifests", ["--version", VERSION, "--percentage", "20", ...workPaths.slice(1)]);
await refuse("manifest twice", [
  "--version",
  VERSION,
  "--percentage",
  "20",
  workPaths[0] ?? "",
  ...workPaths.slice(0, 3),
]);
for (const value of ["101", "-1", "2.5", "010", "ten", ""]) {
  await refuse(`percentage "${value}"`, ["--version", VERSION, "--percentage", value, ...workPaths]);
}
await refuse("no percentage", ["--version", VERSION, ...workPaths]);

// 2. The check that runs before each write stops for any other change.
const tamperCases: Record<string, string> = {};
for (const name of UPDATE_MANIFESTS) {
  const source = original(name);
  const staged = setStagingPercentage(source, 10);
  const sha512 = firstValue(source, "sha512");
  const size = firstValue(source, "size");
  const variants: Record<string, string> = {
    "file sha512": staged.replace(sha512, `${sha512.slice(0, -4)}AAA=`),
    "file size": staged.replace(`size: ${size}`, `size: ${Number(size) + 1}`),
    "extra line": `${staged}minimumSystemVersion: 99.0.0\n`,
    "releaseDate quotes": staged.replace(/releaseDate: (['"])(.+)\1/u, "releaseDate: $2"),
    "second staging line": `${staged}stagingPercentage: 10\n`,
    "staging as text": staged.replace("stagingPercentage: 10", "stagingPercentage: '10'"),
    "other percentage": staged.replace("stagingPercentage: 10", "stagingPercentage: 11"),
  };
  for (const [label, tampered] of Object.entries(variants)) {
    assert.notEqual(tampered, staged, `${name}: the ${label} case changes the text`);
    const error = captureError(() => assertOnlyStagingChanged(source, tampered, 10));
    assert.ok(error, `${name}: the ${label} change must stop the rollout`);
    tamperCases[`${name}: ${label}`] = error;
  }
}

// 3. The publish job merges the macOS halves and then sets the percentage.
const mac = readUpdateManifest(original("latest-mac.yml"));
const macFiles = mac.files;
const isArm64 = (file: UpdateManifest["files"][number]) => file.url.includes("arm64");
const arm64Half = stringify({ ...mac, files: macFiles.filter(isArm64) }, { version: "1.1" });
const x64Half = stringify({ ...mac, files: macFiles.filter((file) => !isArm64(file)) }, { version: "1.1" });
const merged = mergeMacUpdateManifests(arm64Half, x64Half);
const mergedStaged = setStagingPercentage(merged, 10);
assertSameUpdaterValues(merged, mergedStaged, 10);
assert.deepEqual(parse(merged, { version: "1.1" }), parse(original("latest-mac.yml"), { version: "1.1" }));
const macMerge = { files: macFiles.length, arm64: macFiles.filter(isArm64).length, staged: sha256(mergedStaged) };

// 4. `verify-update-artifacts.ts` accepts a whole number from 0 to 100 and no field, and stops for other values.
const verifyResults: Record<string, number | null> = {};
const verifyRoot = join(OUT, "verify");
const fakeAppImage = Buffer.from("not an AppImage: a small file that the verify script hashes\n");
const linux = readUpdateManifest(original("latest-linux.yml"));
const [linuxFile] = linux.files;
assert.ok(linuxFile, "latest-linux.yml lists the AppImage");
const fakeHash = createHash("sha512").update(fakeAppImage).digest("base64");
const fakeManifest = stringify(
  { ...linux, files: [{ ...linuxFile, sha512: fakeHash, size: fakeAppImage.length }], sha512: fakeHash },
  { version: "1.1" },
);
for (const [label, line, expected] of [
  ["absent", "", 0],
  ["10", "stagingPercentage: 10\n", 0],
  ["0", "stagingPercentage: 0\n", 0],
  ["100", "stagingPercentage: 100\n", 0],
  ["2.5", "stagingPercentage: 2.5\n", 1],
  ['"10"', 'stagingPercentage: "10"\n', 1],
  ["101", "stagingPercentage: 101\n", 1],
  ["-1", "stagingPercentage: -1\n", 1],
] as const) {
  const dist = join(verifyRoot, label.replace(/\W/gu, "_"), "dist");
  await mkdir(join(dist, "linux-unpacked/resources/voice/runtime"), { recursive: true });
  await writeFile(join(dist, "linux-unpacked/resources/voice/runtime/sherpa-onnx.node"), "");
  await writeFile(join(dist, linuxFile.url), fakeAppImage);
  await writeFile(join(dist, "latest-linux.yml"), `${fakeManifest}${line}`);
  const result = run("bun", [join(ROOT, "scripts/verify-update-artifacts.ts"), "linux"], {
    allowFailure: true,
    cwd: join(dist, ".."),
  });
  if (expected === 0) assert.equal(result.status, 0, `verify accepts stagingPercentage ${label}: ${result.stderr}`);
  else assert.notEqual(result.status, 0, `verify stops for stagingPercentage ${label}`);
  verifyResults[label] = result.status;
}

// 5. The update check of electron-updater, through its own HTTP request, YAML parser and staging check.
const served = new Map<string, string>();
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const body = served.get(new URL(request.url).pathname);
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  },
});
const feeds: Array<{ name: ManifestName; platform: NodeJS.Platform; arch: string }> = [
  { name: "latest.yml", platform: "win32", arch: process.arch },
  { name: "latest-mac.yml", platform: "darwin", arch: process.arch },
  { name: "latest-linux.yml", platform: "linux", arch: "x64" },
  { name: "latest-linux-arm64.yml", platform: "linux", arch: "arm64" },
];
const installsRoot = join(OUT, "installs");
const updaterResults: Record<string, { installs: number; offered: Record<string, number> }> = {};
const serviceResults: Record<
  string,
  {
    automatic: UpdateStatus["phase"];
    staged: string | null;
    requested: UpdateStatus["phase"];
    later?: { phase: UpdateStatus["phase"]; staged: string | null };
  }
> = {};
try {
  for (const feed of feeds) {
    process.env.TEST_UPDATER_ARCH = feed.arch;
    const installs = feed.name === "latest-linux.yml" ? INSTALLS : 200;
    const scenarios = { absent: original(feed.name), "10": "", "50": "", "0": "", "100": "" };
    for (const percentage of [10, 50, 0, 100] as const) {
      scenarios[percentage] = setStagingPercentage(original(feed.name), percentage);
    }
    for (const [scenario, body] of Object.entries(scenarios))
      served.set(`/${feed.name}/${scenario}/${feed.name}`, body);
    const offered: Record<string, Set<number>> = {};
    for (const scenario of Object.keys(scenarios)) offered[scenario] = new Set();
    const ids = new Set<string>();
    for (let install = 0; install < installs; install += 1) {
      const userData = join(installsRoot, feed.name, String(install));
      const updater = new ProbeUpdater(userData, "0.66.0", feed.platform);
      for (const scenario of Object.keys(scenarios)) {
        const available = await updater.check(`http://127.0.0.1:${server.port}/${feed.name}/${scenario}/`);
        if (available) offered[scenario]?.add(install);
      }
      // The same install is in the same part of the stage at the next check.
      const again = await updater.check(`http://127.0.0.1:${server.port}/${feed.name}/10/`);
      assert.equal(again, offered["10"]?.has(install), "an install keeps its place in the stage");
      ids.add((await readFile(join(userData, ".updaterId"), "utf8")).trim());
      // An install that already has this version gets no update at any percentage.
      const current = new ProbeUpdater(userData, VERSION, feed.platform);
      assert.equal(await current.check(`http://127.0.0.1:${server.port}/${feed.name}/absent/`), false);
    }
    assert.equal(ids.size, installs, "each install has its own .updaterId");
    const count = (scenario: string) => offered[scenario]?.size ?? 0;
    assert.equal(count("absent"), installs, "no field: every install gets the release");
    assert.equal(count("100"), installs, "100%: every install gets the release");
    assert.equal(count("0"), 0, "0%: no install gets the release");
    for (const [scenario, share] of [
      ["10", 0.1],
      ["50", 0.5],
    ] as const) {
      // Five standard deviations of a binomial count: the eight counts fail by chance about once in
      // 200,000 runs.
      const margin = 5 * Math.sqrt(installs * share * (1 - share));
      assert.ok(
        Math.abs(count(scenario) - installs * share) <= margin,
        `${scenario}%: ${count(scenario)} of ${installs}`,
      );
    }
    for (const install of offered["10"] ?? []) {
      assert.ok(offered["50"]?.has(install), "an install in the 10% stage stays in the 50% stage");
    }
    updaterResults[feed.name] = {
      installs,
      offered: Object.fromEntries(Object.keys(scenarios).map((scenario) => [scenario, count(scenario)])),
    };
  }

  // 6. The app's UpdateService on the same updater and feed. Its timer runs the automatic check; its
  // `checkForUpdates()` is the check that a person asks for in Settings > Updates.
  process.env.TEST_UPDATER_ARCH = "x64";
  const feedUrl = (scenario: string) => `http://127.0.0.1:${server.port}/latest-linux.yml/${scenario}/`;
  const placed: { inside?: string; outside?: string } = {};
  for (let install = 0; !(placed.inside && placed.outside); install += 1) {
    const userData = join(installsRoot, "service", String(install));
    const inside = await new ProbeUpdater(userData, "0.66.0", "linux").check(feedUrl("10"));
    placed[inside ? "inside" : "outside"] ??= userData;
  }
  const { inside, outside } = placed;
  assert.ok(inside && outside);
  // The next release, also at 10%. The requested check skips the stage only for the release it found.
  const [major, minor] = VERSION.split(".");
  const laterVersion = `${major}.${Number(minor) + 1}.0`;
  served.set(
    "/latest-linux.yml/later10/latest-linux.yml",
    setStagingPercentage(original("latest-linux.yml"), 10).replace(/^version: .*$/m, `version: ${laterVersion}`),
  );
  serviceResults.outsideAt10 = await serviceChecks(outside, "0.66.0", feedUrl("10"), feedUrl("later10"));
  serviceResults.insideAt10 = await serviceChecks(inside, "0.66.0", feedUrl("10"));
  serviceResults.outsideAt0 = await serviceChecks(outside, "0.66.0", feedUrl("0"));
  serviceResults.insideAt0 = await serviceChecks(inside, "0.66.0", feedUrl("0"));
  serviceResults.currentAt10 = await serviceChecks(outside, VERSION, feedUrl("10"));
  // `staged` is the release that Settings > Updates names after the automatic check.
  assert.deepEqual(serviceResults.outsideAt10, {
    automatic: "up-to-date",
    staged: VERSION,
    requested: "available",
    later: { phase: "up-to-date", staged: laterVersion },
  });
  assert.deepEqual(serviceResults.insideAt10, { automatic: "available", staged: null, requested: "available" });
  assert.deepEqual(serviceResults.outsideAt0, { automatic: "up-to-date", staged: null, requested: "up-to-date" });
  assert.deepEqual(serviceResults.insideAt0, { automatic: "up-to-date", staged: null, requested: "up-to-date" });
  assert.deepEqual(serviceResults.currentAt10, { automatic: "up-to-date", staged: null, requested: "up-to-date" });
} finally {
  server.stop(true);
  delete process.env.TEST_UPDATER_ARCH;
}

// The downloaded release manifests are the same at the end.
for (const name of UPDATE_MANIFESTS) assert.equal(await readFile(join(sourceDir, name), "utf8"), original(name));
await rm(installsRoot, { recursive: true, force: true });
const report = {
  release: RELEASE_TAG,
  electronUpdater: await packageVersion("electron-updater"),
  source: sourceHashes,
  cli: { ...cliHashes, refusals },
  tamper: tamperCases,
  macMerge,
  verify: verifyResults,
  electronUpdaterChecks: updaterResults,
  updateServiceChecks: serviceResults,
  ok: true,
};
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
logger.info(`The staged rollout checks passed. Report: ${join(OUT, "report.json")}`);

/**
 * Starts an UpdateService for the install in `userData`, waits for its first automatic check, then
 * asks for a check as the Settings button does. Returns the phase after each check. With
 * `laterFeedUrl`, the next automatic check reads that feed.
 */
async function serviceChecks(userData: string, version: string, feedUrl: string, laterFeedUrl?: string) {
  const updater = new ProbeUpdater(userData, version, "linux");
  updater.setFeedURL({ provider: "generic", url: feedUrl });
  const service = new UpdateService(updater, {
    currentVersion: version,
    enabled: true,
    autoDownload: false,
    beforeInstall: async () => undefined,
    platform: "linux",
    initialCheckDelayMs: 0,
    // A short interval only when the test waits for the next automatic check.
    checkIntervalMs: laterFeedUrl ? 100 : 3_600_000,
  });
  const automatic = new Promise<UpdateStatus>((resolvePhase) => {
    service.on("status", (status) => {
      if (status.phase !== "idle" && status.phase !== "checking") resolvePhase(status);
    });
  });
  try {
    service.start();
    const first = await automatic;
    assert.equal(first.errorCode, null, `the automatic check has no error: ${first.message}`);
    const requested = await Effect.runPromise(service.checkForUpdates());
    assert.equal(requested.errorCode, null, `the requested check has no error: ${requested.message}`);
    assert.equal(requested.stagedVersion, undefined, "the requested check names no waiting release");
    const result = { automatic: first.phase, staged: first.stagedVersion ?? null, requested: requested.phase };
    if (!laterFeedUrl) return result;
    updater.setFeedURL({ provider: "generic", url: laterFeedUrl });
    // The first outcome after the next automatic check starts.
    const later = await new Promise<UpdateStatus>((resolvePhase) => {
      let checking = false;
      service.on("status", (status) => {
        if (status.phase === "checking") checking = true;
        else if (checking) resolvePhase(status);
      });
    });
    assert.equal(later.errorCode, null, `the later automatic check has no error: ${later.message}`);
    return { ...result, later: { phase: later.phase, staged: later.stagedVersion ?? null } };
  } finally {
    await Effect.runPromise(service.stop());
  }
}

/** The values that electron-updater reads, with js-yaml, are those of the release, with the new percentage. */
function assertSameUpdaterValues(before: string, after: string, percentage: number): void {
  const url = new URL("https://example.invalid/latest.yml");
  const old = parseUpdateInfo(before, "latest.yml", url);
  const updated = parseUpdateInfo(after, "latest.yml", url);
  assert.equal(updated.stagingPercentage, percentage === 100 ? undefined : percentage);
  const { stagingPercentage: _old, ...restOld } = old;
  const { stagingPercentage: _updated, ...restUpdated } = updated;
  assert.deepEqual(restUpdated, restOld);
}

async function setWorkPercentage(percentage: number): Promise<void> {
  for (const path of workPaths) await writeFile(path, setStagingPercentage(await readFile(path, "utf8"), percentage));
}

async function readWork(): Promise<string[]> {
  return Promise.all(workPaths.map((path) => readFile(path, "utf8")));
}

function firstValue(source: string, key: string): string {
  const match = new RegExp(`^\\s+(?:- )?${key}: (.+)$`, "mu").exec(source);
  assert.ok(match?.[1], `the manifest has a file ${key}`);
  return match[1];
}

function captureError(action: () => void): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function packageVersion(name: string): Promise<string> {
  const source = await readFile(join(ROOT, "node_modules", name, "package.json"), "utf8");
  return z.object({ version: z.string() }).parse(JSON.parse(source)).version;
}

function run(command: string, args: string[], options: { allowFailure?: boolean; cwd?: string } = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}: ${result.stderr}`);
  }
  return result;
}
