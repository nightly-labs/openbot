// Makes sure that the new build starts on the data of the previous public release, as a user's
// update does. The release workflow runs it after the launch check, so a failure stops the publish.
//
//   1. Downloads the previous public release for this platform from GitHub Releases (the newest
//      published, non-prerelease version below the new one) and checks it against SHA256SUMS.txt.
//   2. Installs it the way a user does: macOS extracts the update ZIP to a temporary Applications
//      folder, Windows runs the NSIS installer silently, Linux puts the AppImage in /opt/OpenBot,
//      where the shipped AppArmor profile applies (build/linux/openbot.apparmor).
//   3. Starts it once on an empty user data folder and home folder, so that it makes a real profile
//      and openbot.db. Through the app's own API (`window.openbot`, over the DevTools protocol), it
//      adds a custom ACP agent, two agents that each answer a first message, a memory for each
//      agent, and a channel with both agents and one answered message. The custom agent is a fake
//      on this computer, so no model and no network is used for the turns.
//   4. Quits the app with the signal that a user's quit or a log-out sends, and waits for the exit.
//   5. Installs the new build over it as an update does: macOS replaces the .app, Windows runs the
//      new installer with `--updated /S`, as electron-updater does, Linux replaces the AppImage.
//   6. Starts the new build on the same data, waits until main answers the window, and checks the
//      app version, that every agent, message, memory, channel and the custom agent is still there,
//      and, after a second quit, that openbot.db has every migration of this source, the tables and
//      columns of a new database, and no integrity or foreign-key fault.
//
// Usage: bun scripts/release-upgrade-e2e.ts <macos|windows|linux|linux-arm64>
//          [--new=<artifact>] [--previous=<tag>] [--previous-artifact=<file>]
//   --new                The new build: the update ZIP (macOS), the NSIS installer (Windows) or the
//                        AppImage (Linux). Default: the one such file in dist/.
//   --previous           The tag of the release to start from. Default: found with `gh release list`.
//   --previous-artifact  A downloaded artifact of that release, in place of the download.
// The download needs `gh` with a token (GH_TOKEN or GITHUB_TOKEN). Windows installs in the real
// %LOCALAPPDATA%\Programs\OpenBot, so it runs only on a GitHub Actions runner. Linux needs a display
// (`xvfb-run -a`), a writable /opt/OpenBot and the AppArmor profile; it never uses `--no-sandbox`.
// Writes .openbot-build/release-upgrade-e2e/report.json with versions and counts only, no user text.
//
// The seed step calls the API of the previous release. When a change renames or changes one of
// these calls, keep the earlier call for the seed step until the next release ships.
//
// The update itself is not downloaded by the old app's electron-updater. On macOS its feed is in
// Contents/Resources/app-update.yml, which the code signature seals: a changed file breaks the
// signature and Squirrel.Mac refuses the update. The packaged update service has no feed override
// (no setFeedURL, no forceDevUpdateConfig, no environment variable), so the only way to send the
// installed app to a local feed is to intercept its HTTPS requests to GitHub with
// `--ignore-certificate-errors` or a trusted local CA. Both weaken the trust boundary, so this test
// does not do it. On Windows and Linux app-update.yml is not signed, but a changed copy would test
// a modified install. electron-updater installs on Windows with the same `--updated /S` arguments
// that this test uses, and on Linux it replaces the AppImage file, as this test does; macOS
// replaces the bundle. `bun run verify:update-artifacts` checks the feed files of the new build.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  access,
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { LOCAL_SERVER_ID, type OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { isNumber } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, chromium, type Page } from "playwright-core";
import { z } from "zod";
import { migrateOpenBotDatabase } from "../src/backend/openbot-database-schema";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const logger = createOpenBotLogger("release-upgrade-e2e");
const REPOSITORY = "nightly-labs/openbot";
const OUT = resolve(import.meta.dirname, "../.openbot-build/release-upgrade-e2e");
// Limits only make a hang fail; every wait ends on a state.
const LAUNCH_LIMIT_MS = 5 * 60_000;
const TURN_LIMIT_MS = 2 * 60_000;
const QUIT_LIMIT_MS = 2 * 60_000;
const INSTALLER_LIMIT_MS = 5 * 60_000;
const POLL_MS = 250;
const CUSTOM_AGENT_ID = "upgradecheck";
const MAIN_PAGE_URL = "openbot-app://app/index.html";

type Target = "macos" | "windows" | "linux" | "linux-arm64";

const target = process.argv[2];
if (target !== "macos" && target !== "windows" && target !== "linux" && target !== "linux-arm64") {
  throw new Error(
    "Usage: bun scripts/release-upgrade-e2e.ts <macos|windows|linux|linux-arm64> [--new=<artifact>] [--previous=<tag>] [--previous-artifact=<file>]",
  );
}
const expectedPlatform = { macos: "darwin", windows: "win32", linux: "linux", "linux-arm64": "linux" }[target];
if (process.platform !== expectedPlatform) throw new Error(`The ${target} test must run on ${expectedPlatform}.`);
if (target === "linux" && process.arch !== "x64") throw new Error("The linux test needs an x64 computer.");
if (target === "linux-arm64" && process.arch !== "arm64")
  throw new Error("The linux-arm64 test needs an arm64 computer.");
if (target === "windows" && process.arch !== "x64") throw new Error("The windows test needs an x64 computer.");
// The installer writes the real per-user install folder and registry entries.
if (target === "windows" && process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("The Windows test installs OpenBot for this user and runs only on a GitHub Actions runner.");
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const newVersion = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile(resolve(import.meta.dirname, "../package.json"), "utf8"))).version;

interface Report {
  passed: boolean;
  error?: string;
  target: Target;
  arch: string;
  previousVersion?: string;
  newVersion: string;
  installedVersion?: string;
  oldQuit?: QuitResult;
  newQuit?: QuitResult;
  seeded?: Counts;
  afterUpgrade?: Counts;
  database?: DatabaseReport;
}

interface Counts {
  agents: number;
  agentMessages: number;
  memories: number;
  channels: number;
  channelMessages: number;
  customAgents: number;
  workspaceFolders: number;
}

interface DatabaseReport {
  previousSchemaVersion: number;
  schemaVersion: number;
  latestSchemaVersion: number;
  missingMigrations: number;
  missingTables: number;
  missingColumns: number;
  extraTables: number;
  integrity: string;
  foreignKeyViolations: number;
  previousForeignKeyViolations: number;
}

interface QuitResult {
  /** True when the app exited on the quit request; false when the limit forced a kill. */
  clean: boolean;
  exitCode: number | null;
}

const report: Report = { passed: false, target, arch: process.arch, newVersion };
const root = await mkdtemp(join(tmpdir(), "openbot-upgrade-"));
const userDataPath = join(root, "user-data");
const homePath = join(root, "home");
await mkdir(userDataPath);
await mkdir(homePath);
// The app puts agent workspaces in `homedir()`/OpenBot/Agents. On Windows `homedir()` reads
// USERPROFILE, which stays the real one (see `launchEnvironment`), and an earlier step of the job
// can have made workspaces there. So the check counts only the folders that are new.
const agentsFolder = join(target === "windows" ? (process.env.USERPROFILE ?? homePath) : homePath, "OpenBot", "Agents");
const earlierWorkspaces = new Set(await listWorkspaces());
// The process and the app that run now, so that a failure can stop them. `process` is set at the
// spawn and `app` when the window is connected.
const current: { process: LaunchedProcess | null; app: RunningApp | null } = { process: null, app: null };

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The newest published, non-prerelease release below the new version. */
function previousTag(): string {
  const listed = z
    .array(z.object({ tagName: z.string() }))
    .parse(
      JSON.parse(
        execFileSync(
          "gh",
          [
            "release",
            "list",
            "--repo",
            REPOSITORY,
            "--exclude-drafts",
            "--exclude-pre-releases",
            "--limit",
            "100",
            "--json",
            "tagName",
          ],
          { encoding: "utf8" },
        ),
      ),
    );
  const versions = listed
    .map((entry) => entry.tagName)
    .filter((tag) => /^v\d+\.\d+\.\d+$/u.test(tag))
    .map((tag) => tag.slice(1))
    .filter((version) => compareVersions(version, newVersion) < 0)
    .sort(compareVersions);
  const newest = versions.at(-1);
  check(newest, `No published release is older than ${newVersion}.`);
  return `v${newest}`;
}

/** The name of the artifact that a user of this platform installs and updates from. */
function artifactName(version: string): string {
  if (target === "macos") return `OpenBot-${version}-${process.arch === "arm64" ? "arm64" : "x64"}.zip`;
  if (target === "windows") return `OpenBot-${version}-x64.exe`;
  return `OpenBot-${version}-${target === "linux" ? "x86_64" : "arm64"}.AppImage`;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadPrevious(tag: string, version: string): Promise<string> {
  const name = artifactName(version);
  const directory = join(root, "download");
  await mkdir(directory);
  execFileSync(
    "gh",
    [
      "release",
      "download",
      tag,
      "--repo",
      REPOSITORY,
      "--dir",
      directory,
      "--pattern",
      name,
      "--pattern",
      "SHA256SUMS.txt",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const sums = await readFile(join(directory, "SHA256SUMS.txt"), "utf8");
  const expected = sums
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+\*?/u))
    .find((parts) => parts[1] === name)?.[0];
  check(expected, `SHA256SUMS.txt of ${tag} does not list ${name}.`);
  const path = join(directory, name);
  check((await sha256(path)) === expected, `${name} of ${tag} does not match SHA256SUMS.txt.`);
  return path;
}

/** The one update artifact of this platform in dist/, as `verify:update-artifacts` finds it. */
async function newArtifact(): Promise<string> {
  const given = option("new");
  if (given) return resolve(given);
  const extension = target === "macos" ? ".zip" : target === "windows" ? ".exe" : ".AppImage";
  const distRoot = resolve(import.meta.dirname, "../dist");
  const found = (await readdir(distRoot)).filter((name) => name.endsWith(extension));
  check(found.length === 1, `Expected one ${extension} artifact in dist/, found ${found.length}.`);
  return join(distRoot, found[0] ?? "");
}

// --- Install -------------------------------------------------------------------------------------

const macApplications = join(root, "Applications");
const macBundle = join(macApplications, "OpenBot.app");
const windowsFolder = join(process.env.LOCALAPPDATA ?? "", "Programs", "OpenBot");
// The shipped AppArmor profile attaches to this path.
const linuxAppImage = "/opt/OpenBot/OpenBot.AppImage";

function executablePath(): string {
  if (target === "macos") return join(macBundle, "Contents", "MacOS", "OpenBot");
  if (target === "windows") return join(windowsFolder, "OpenBot.exe");
  return linuxAppImage;
}

function runInstaller(file: string, args: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, [args], { windowsVerbatimArguments: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${basename(file)} ${args} did not exit; it probably shows a dialog.`));
    }, INSTALLER_LIMIT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise(code ?? -1);
    });
  });
}

/** `ditto` keeps the extended attributes and symbolic links that the code signature covers. */
function extractMacZip(zip: string, destination: string): void {
  execFileSync("ditto", ["-x", "-k", zip, destination], { stdio: ["ignore", "ignore", "inherit"] });
}

function verifyMacSignature(): void {
  execFileSync("codesign", ["--verify", "--deep", "--strict", macBundle], { stdio: ["ignore", "ignore", "inherit"] });
}

async function installPrevious(artifact: string): Promise<void> {
  if (target === "macos") {
    await mkdir(macApplications);
    extractMacZip(artifact, macApplications);
    verifyMacSignature();
    return;
  }
  if (target === "windows") {
    check(process.env.LOCALAPPDATA, "LOCALAPPDATA is not set.");
    check(!existsSync(executablePath()), `${windowsFolder} already has OpenBot. Use a computer with no OpenBot.`);
    const exitCode = await runInstaller(artifact, "/S");
    check(exitCode === 0, `The installer of the previous release exited with code ${exitCode}.`);
    check(existsSync(executablePath()), "The installer of the previous release did not install OpenBot.exe.");
    return;
  }
  await access("/opt/OpenBot", constants.W_OK).catch(() => {
    throw new Error("/opt/OpenBot must exist and be writable, with the AppArmor profile installed.");
  });
  check(!existsSync(linuxAppImage), `${linuxAppImage} already exists. Use a computer with no OpenBot there.`);
  await copyFile(artifact, linuxAppImage);
  await chmod(linuxAppImage, 0o755);
}

async function installNew(artifact: string): Promise<void> {
  if (target === "macos") {
    // Squirrel.Mac extracts the ZIP beside the app and then replaces the bundle.
    const staging = join(root, "update-staging");
    await mkdir(staging);
    extractMacZip(artifact, staging);
    await rm(macBundle, { recursive: true, force: true });
    await rename(join(staging, "OpenBot.app"), macBundle);
    verifyMacSignature();
    return;
  }
  if (target === "windows") {
    // electron-updater runs the new installer with these arguments.
    const exitCode = await runInstaller(artifact, "--updated /S");
    check(exitCode === 0, `The new installer exited with code ${exitCode}.`);
    return;
  }
  // electron-updater writes the new AppImage beside the old one and renames it over the old one.
  const staging = `${linuxAppImage}.new`;
  await copyFile(artifact, staging);
  await chmod(staging, 0o755);
  await rename(staging, linuxAppImage);
}

// --- Launch and quit -----------------------------------------------------------------------------

interface LaunchedProcess {
  child: ChildProcess;
  exited: Promise<number | null>;
  stderr: () => string;
}

interface RunningApp extends LaunchedProcess {
  browser: Browser;
  page: Page;
}

function launchEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Agent workspaces go to ~/OpenBot, so the home folder is the test's own. Windows keeps the real
    // USERPROFILE: with an empty one, Windows cannot find the AppData known folder and the start
    // fails ("Failed to get 'appData' path"). So on Windows the workspaces go to the real profile
    // (see `agentsFolder`). The runner is discarded after the job.
    HOME: homePath,
    ...(target === "windows" ? {} : { USERPROFILE: homePath }),
    CODEX_HOME: join(userDataPath, "codex-home"),
    CLAUDE_CONFIG_DIR: join(userDataPath, "claude-home"),
    OPENBOT_CODEX_PATH: join(userDataPath, target === "windows" ? "missing-codex.exe" : "missing-codex"),
    OPENBOT_CLAUDE_PATH: join(userDataPath, target === "windows" ? "missing-claude.exe" : "missing-claude"),
    OPENBOT_GROK_PATH: join(userDataPath, target === "windows" ? "missing-grok.exe" : "missing-grok"),
  };
}

async function waitFor<T>(
  description: string,
  limitMs: number,
  read: () => Promise<T | null | undefined>,
  exited?: Promise<unknown>,
): Promise<T> {
  let stopped = false;
  void exited?.then(() => {
    stopped = true;
  });
  const deadline = Date.now() + limitMs;
  for (;;) {
    const value = await read();
    if (value !== null && value !== undefined) return value;
    if (stopped) throw new Error(`OpenBot exited before ${description}.`);
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await sleep(POLL_MS);
  }
}

async function readDevToolsPort(): Promise<number | null> {
  try {
    const port = Number((await readFile(join(userDataPath, "DevToolsActivePort"), "utf8")).split("\n")[0]);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

async function launch(): Promise<RunningApp> {
  // A stale port file from the earlier start would point at a closed port.
  await rm(join(userDataPath, "DevToolsActivePort"), { force: true });
  const args = [`--user-data-dir=${userDataPath}`, "--remote-debugging-port=0"];
  if (target === "macos") args.push("--use-mock-keychain");
  // On POSIX the app gets its own process group, so that the cleanup also stops the helpers that
  // outlive a killed app: the crash handler and the fake agent keep the stderr pipe open.
  const child = spawn(executablePath(), args, {
    env: launchEnvironment(),
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  const exited = new Promise<number | null>((resolvePromise) => {
    child.once("exit", (code) => resolvePromise(code));
    child.once("error", () => resolvePromise(null));
  });
  current.process = { child, exited, stderr: () => stderr };

  const port = await waitFor("the DevTools port", LAUNCH_LIMIT_MS, readDevToolsPort, exited);
  // Playwright shows only the pages of the browser contexts that exist when it connects, and the
  // main window has its own session. So it connects only after the window's target is listed.
  let targets: string[] = [];
  await waitFor(
    "the main window target",
    LAUNCH_LIMIT_MS,
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const entries = z.array(z.object({ type: z.string(), url: z.string() })).parse(await response.json());
        targets = entries.map((entry) => `${entry.type} ${entry.url}`);
        return entries.some((entry) => entry.url.startsWith(MAIN_PAGE_URL)) ? true : null;
      } catch (error) {
        targets = [`no answer from port ${port}: ${error instanceof Error ? error.message : String(error)}`];
        return null;
      }
    },
    exited,
  ).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} DevTools targets: ${targets.join("; ") || "none"}. The window called main: ${await rendererCalledMain()}.`,
    );
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await waitFor(
    "the main window",
    LAUNCH_LIMIT_MS,
    async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith(MAIN_PAGE_URL)),
    exited,
  );
  // Main answers the window when its services and the database are ready.
  await waitFor(
    "main to answer the window",
    LAUNCH_LIMIT_MS,
    async () => {
      try {
        return await page.evaluate(async () => {
          if (typeof window.openbot === "undefined") return null;
          await window.openbot.agent.listAgents();
          return true;
        });
      } catch {
        return null;
      }
    },
    exited,
  );
  const app = { child, browser, page, exited, stderr: () => stderr };
  current.app = app;
  return app;
}

/**
 * Whether the window has called main. The renderer asks main for `getAppInfo` when it mounts, and
 * main records each trusted call in `logs/trace.ndjson`, as `scripts/verify-windows-package.ts` reads.
 */
async function rendererCalledMain(): Promise<boolean> {
  try {
    return (await readFile(join(userDataPath, "logs", "trace.ndjson"), "utf8")).includes('"kind":"ipc"');
  } catch {
    return false;
  }
}

/**
 * Asks the app to quit as a user does, and waits for the exit. POSIX sends SIGTERM, which main
 * handles as a quit (`quitFor("signal")`), as a log-out or `kill` does. Windows closes the main
 * window, as the window's close button does: on Windows the app quits when its main window closes.
 * WM_CLOSE from `taskkill` without `/F` did not quit the app on the CI runner.
 */
async function quit(app: RunningApp): Promise<QuitResult> {
  if (process.platform === "win32") {
    // The timer lets the call return before the page closes.
    await app.page.evaluate(() => {
      setTimeout(() => window.close(), 0);
    });
  }
  await app.browser.close().catch(() => undefined);
  if (process.platform !== "win32") app.child.kill("SIGTERM");
  const limit = sleep(QUIT_LIMIT_MS).then(() => "limit" as const);
  const outcome = await Promise.race([app.exited, limit]);
  current.app = null;
  current.process = null;
  if (outcome !== "limit") {
    // Chromium deletes its profile lock when it ends, after the database host has stopped. On
    // Windows the lock is `lockfile`, which Chromium opens with delete-on-close; it has no
    // `SingletonLock` there.
    const lockName = process.platform === "win32" ? "lockfile" : "SingletonLock";
    await waitFor("the profile lock to be released", QUIT_LIMIT_MS, async () =>
      (await lstat(join(userDataPath, lockName)).then(
        () => false,
        () => true,
      ))
        ? true
        : null,
    );
    stopLeftovers(app);
    return { clean: true, exitCode: outcome };
  }
  logger.warn("OpenBot did not quit in time; it is killed.");
  forceKill(app.child);
  const exitCode = await app.exited;
  stopLeftovers(app);
  return { clean: false, exitCode };
}

function forceKill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } catch {
      // The app can exit before taskkill reads the process tree.
    }
  } else child.kill("SIGKILL");
}

/** Stops each process that is left in the app's process group, and closes the stderr pipe. */
function stopLeftovers(app: LaunchedProcess): void {
  const pid = app.child.pid;
  if (process.platform !== "win32" && pid) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The group is empty.
    }
  }
  app.child.stderr?.destroy();
}

// --- Seed and read ---------------------------------------------------------------------------------

// A custom agent that speaks the Agent Client Protocol on stdio and answers each prompt.
const FAKE_AGENT = `const NL = String.fromCharCode(10);
let buffer = "";
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
let sessions = 0;
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: "upgrade-check", version: "1.0.0" }, agentCapabilities: {} } });
    return;
  }
  if (message.method === "session/new") {
    sessions += 1;
    write({ id: message.id, result: { sessionId: "session-" + sessions } });
    return;
  }
  if (message.method === "session/prompt") {
    write({ method: "session/update", params: { sessionId: message.params.sessionId, update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Answer from upgradecheck." },
    } } });
    write({ id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  write({ id: message.id, result: {} });
}
setInterval(() => {}, 1000);
`;

interface Seed {
  agentIds: string[];
  agentMessageIds: string[];
  memoryIds: string[];
  channelId: string;
  channelMessageIds: string[];
}

async function seed(page: Page): Promise<Seed> {
  // The old app must not download the public latest release while the test runs.
  await page.evaluate(() => window.openbot.update.setPreference({ autoDownload: false, autoInstall: false }));

  const fakeAgentPath = join(root, "fake-acp-agent.mjs");
  await writeFile(fakeAgentPath, FAKE_AGENT);
  await page.evaluate(
    ({ id, command, script, server }) =>
      window.openbot.customAgents.save(
        { id, name: "Upgrade check", command, args: [script], env: [], usagePrompt: null },
        server,
      ),
    { id: CUSTOM_AGENT_ID, command: process.execPath, script: fakeAgentPath, server: LOCAL_SERVER_ID },
  );

  // A saved custom agent restarts the provider. Until the restarted process has listed its models,
  // the host refuses the model with "listed no models"; that refusal is the state to wait out.
  const createAgent = (name: string) =>
    waitFor(`agent ${name} to be created`, TURN_LIMIT_MS, async () => {
      try {
        return await page.evaluate(
          ({ name, model }) =>
            window.openbot.agent.createAgent({
              name,
              description: "Made by the release upgrade check.",
              avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
              avatarHue: null,
              initialMessage: "Say hello to upgradecheck.",
              provider: "acp",
              model,
            }),
          { name, model: `${CUSTOM_AGENT_ID}/default` },
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("listed no models")) return null;
        throw error;
      }
    });

  const agents = [await createAgent("Upgrade One"), await createAgent("Upgrade Two")];
  const agentIds = agents.map((agent) => agent.id);
  const agentMessageIds: string[] = [];
  for (const agentId of agentIds) {
    const messages = await waitFor(`the first turn of ${agentId}`, TURN_LIMIT_MS, async () => {
      const found = await searchSeedMessages(page, agentId);
      const answered = found.some(
        (message) => message.author !== "user" && message.status === "completed" && message.text.length > 0,
      );
      const working = found.some((message) => message.status === "streaming");
      return answered && !working ? found : null;
    });
    agentMessageIds.push(...messages.map((message) => message.id));
  }

  const memoryIds: string[] = [];
  for (const agentId of agentIds) {
    const memory = await page.evaluate(
      (id) => window.openbot.agent.createMemory({ agentId: id, text: "The release upgrade check made this memory." }),
      agentId,
    );
    memoryIds.push(memory.id);
  }

  const channelId = randomUUID();
  await page.evaluate(
    ({ channelId, agentIds }) =>
      window.openbot.agent.channelCommand({
        type: "save",
        operationId: crypto.randomUUID(),
        channelId,
        draft: {
          name: "upgrade-check",
          title: "Upgrade check",
          instructions: "",
          members: agentIds.map((agentId) => ({ agentId })),
          leadAgentId: null,
        },
      }),
    { channelId, agentIds },
  );
  await page.evaluate(
    ({ channelId, recipient }) =>
      window.openbot.agent.channelCommand({
        type: "send",
        operationId: crypto.randomUUID(),
        channelId,
        text: "Say hello in the channel.",
        recipientAgentId: recipient,
        replyToMessageId: null,
        attachmentDraftIds: [],
      }),
    { channelId, recipient: agentIds[0] ?? null },
  );
  const channelMessages = await waitFor("the answer in the channel", TURN_LIMIT_MS, async () => {
    const channelPage = await page.evaluate((id) => window.openbot.agent.readChannel({ channelId: id }), channelId);
    const answered = channelPage.messages.some(
      (entry) => entry.author.kind === "agent" && entry.message.status === "completed" && entry.message.text.length > 0,
    );
    const working = channelPage.messages.some((entry) => entry.message.status === "streaming");
    return answered && !working ? channelPage.messages : null;
  });

  return {
    agentIds,
    agentMessageIds,
    memoryIds,
    channelId,
    channelMessageIds: channelMessages.map((entry) => entry.id),
  };
}

/**
 * The seeded messages of one agent chat. The app reads a whole chat only for a signed-in account
 * (`readConversation` needs a reader), and the release runner has no account. The message search
 * reads the same messages without a reader; the prompt and the answer carry the word `upgradecheck`.
 */
async function searchSeedMessages(page: Page, agentId: string) {
  const found = await page.evaluate(
    (id) => window.openbot.agent.searchConversationMessages({ query: "upgradecheck", agentId: id, limit: 100 }),
    agentId,
  );
  return found.results.filter((result) => result.agentId === agentId).map((result) => result.message);
}

/** What the running app shows of the seed. Every count is of seeded items that it still has. */
async function readSeed(page: Page, seeded: Seed): Promise<Counts> {
  const agents = await page.evaluate(() => window.openbot.agent.listAgents());
  const agentIds = new Set(agents.map((agent) => agent.id));
  let agentMessages = 0;
  let memories = 0;
  for (const agentId of seeded.agentIds) {
    if (!agentIds.has(agentId)) continue;
    const messageIds = new Set((await searchSeedMessages(page, agentId)).map((message) => message.id));
    agentMessages += seeded.agentMessageIds.filter((id) => messageIds.has(id)).length;
    const memoryList = await page.evaluate((id) => window.openbot.agent.listMemories(id), agentId);
    const memoryIds = new Set(memoryList.map((memory) => memory.id));
    memories += seeded.memoryIds.filter((id) => memoryIds.has(id)).length;
  }
  const channels = await page.evaluate(() => window.openbot.agent.listChannels());
  const channelFound = channels.some((channel) => channel.id === seeded.channelId);
  let channelMessages = 0;
  if (channelFound) {
    const channelPage = await page.evaluate(
      (id) => window.openbot.agent.readChannel({ channelId: id }),
      seeded.channelId,
    );
    const messageIds = new Set(channelPage.messages.map((entry) => entry.id));
    channelMessages = seeded.channelMessageIds.filter((id) => messageIds.has(id)).length;
  }
  const customAgents = await page.evaluate((server) => window.openbot.customAgents.list(server), LOCAL_SERVER_ID);
  const workspaceFolders = (await listWorkspaces()).filter((name) => !earlierWorkspaces.has(name)).length;
  return {
    agents: seeded.agentIds.filter((id) => agentIds.has(id)).length,
    agentMessages,
    memories,
    channels: channelFound ? 1 : 0,
    channelMessages,
    customAgents: customAgents.filter((agent) => agent.id === CUSTOM_AGENT_ID).length,
    workspaceFolders,
  };
}

async function listWorkspaces(): Promise<string[]> {
  return existsSync(agentsFolder) ? await readdir(agentsFolder) : [];
}

async function readAppVersion(page: Page): Promise<string> {
  return (await page.evaluate(() => window.openbot.getAppInfo())).version;
}

// --- Database --------------------------------------------------------------------------------------

/** Opens a copy, so the read never changes the app's files, also when a WAL file is left. */
async function openDatabaseCopy(name: string): Promise<DatabaseSync> {
  const directory = join(root, name);
  await mkdir(directory);
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = join(userDataPath, `openbot.db${suffix}`);
    if (existsSync(source)) await copyFile(source, join(directory, `openbot.db${suffix}`));
  }
  check(existsSync(join(directory, "openbot.db")), "The user data folder has no openbot.db.");
  return new DatabaseSync(join(directory, "openbot.db"));
}

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all();
}

function appliedVersions(db: DatabaseSync): number[] {
  return rows(db, "SELECT version FROM schema_migrations ORDER BY version").map((row) =>
    isNumber(row.version) ? row.version : -1,
  );
}

function tableColumns(db: DatabaseSync): Map<string, Set<string>> {
  const tables = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  return new Map(
    tables.map((table) => {
      const name = String(table.name);
      const columns = rows(db, `PRAGMA table_info("${name.replaceAll('"', '""')}")`).map((column) =>
        String(column.name),
      );
      return [name, new Set(columns)];
    }),
  );
}

function foreignKeyViolations(db: DatabaseSync): number {
  return rows(db, "PRAGMA foreign_key_check").length;
}

async function checkDatabase(
  previousSchemaVersion: number,
  previousForeignKeyViolations: number,
): Promise<DatabaseReport> {
  const fresh = new DatabaseSync(":memory:");
  migrateOpenBotDatabase(fresh);
  const expectedVersions = appliedVersions(fresh);
  const expectedTables = tableColumns(fresh);
  fresh.close();

  const db = await openDatabaseCopy("database-after");
  try {
    const versions = new Set(appliedVersions(db));
    const tables = tableColumns(db);
    let missingTables = 0;
    let missingColumns = 0;
    for (const [table, columns] of expectedTables) {
      const actual = tables.get(table);
      if (!actual) {
        missingTables += 1;
        logger.error(`The upgraded database has no table ${table}.`);
        continue;
      }
      for (const column of columns) {
        if (actual.has(column)) continue;
        missingColumns += 1;
        logger.error(`The upgraded database has no column ${table}.${column}.`);
      }
    }
    const integrity = rows(db, "PRAGMA integrity_check")
      .map((row) => String(Object.values(row)[0]))
      .join("; ");
    return {
      previousSchemaVersion,
      schemaVersion: Math.max(...versions),
      latestSchemaVersion: Math.max(...expectedVersions),
      missingMigrations: expectedVersions.filter((version) => !versions.has(version)).length,
      missingTables,
      missingColumns,
      extraTables: [...tables.keys()].filter((table) => !expectedTables.has(table)).length,
      integrity,
      foreignKeyViolations: foreignKeyViolations(db),
      previousForeignKeyViolations,
    };
  } finally {
    db.close();
  }
}

// --- Run -------------------------------------------------------------------------------------------

async function printLogs(): Promise<void> {
  const logs = join(userDataPath, "logs");
  if (!existsSync(logs)) return;
  // Main writes `logs/main/main.log`, the updater `logs/update/update.log`, and so on.
  const names = await readdir(logs, { recursive: true });
  for (const name of names.filter((entry) => entry.endsWith(".log"))) {
    // The app can still hold a file open; one unreadable file must not hide the others.
    const text = await readFile(join(logs, name), "utf8").catch(
      (error: unknown) => `(not readable: ${error instanceof Error ? error.message : String(error)})`,
    );
    logger.info(`--- ${name} (last lines) ---\n${text.split("\n").slice(-80).join("\n")}`);
  }
}

try {
  const tag = option("previous") ?? previousTag();
  const previousVersion = tag.replace(/^v/u, "");
  check(compareVersions(previousVersion, newVersion) < 0, `${tag} is not older than ${newVersion}.`);
  report.previousVersion = previousVersion;
  const newBuild = await newArtifact();
  const previousArtifact = option("previous-artifact");
  const previousBuild = previousArtifact ? resolve(previousArtifact) : await downloadPrevious(tag, previousVersion);
  logger.info(`Upgrade from ${tag} to ${newVersion} (${basename(newBuild)}) in ${root}.`);

  await installPrevious(previousBuild);
  const oldApp = await launch();
  const oldVersion = await readAppVersion(oldApp.page);
  check(oldVersion === previousVersion, `The previous release reports version ${oldVersion}, not ${previousVersion}.`);
  const seeded = await seed(oldApp.page);
  report.seeded = await readSeed(oldApp.page, seeded);
  report.oldQuit = await quit(oldApp);

  const before = await openDatabaseCopy("database-before");
  const previousSchemaVersion = Math.max(...appliedVersions(before));
  const previousForeignKeyViolations = foreignKeyViolations(before);
  before.close();

  await installNew(newBuild);
  const newApp = await launch();
  report.installedVersion = await readAppVersion(newApp.page);
  report.afterUpgrade = await readSeed(newApp.page, seeded);
  report.newQuit = await quit(newApp);
  report.database = await checkDatabase(previousSchemaVersion, previousForeignKeyViolations);

  const { afterUpgrade, database } = report;
  check(
    report.installedVersion === newVersion,
    `The new build reports version ${report.installedVersion}, not ${newVersion}.`,
  );
  // A crash (no exit code) or a failed shutdown (a non-zero code) during the quit is a failure too.
  check(
    report.oldQuit.clean && report.oldQuit.exitCode === 0,
    `The previous release did not quit cleanly on the quit request (exit code ${report.oldQuit.exitCode}).`,
  );
  check(
    report.newQuit.clean && report.newQuit.exitCode === 0,
    `The new build did not quit cleanly on the quit request (exit code ${report.newQuit.exitCode}).`,
  );
  check(
    JSON.stringify(afterUpgrade) === JSON.stringify(report.seeded),
    `The new build lost seeded data: before ${JSON.stringify(report.seeded)}, after ${JSON.stringify(afterUpgrade)}.`,
  );
  check(report.seeded.agents === 2 && report.seeded.customAgents === 1, "The seed step did not make its agents.");
  check(report.seeded.workspaceFolders === 2, "The seed step did not make the agents' workspace folders.");
  check(database.integrity === "ok", `PRAGMA integrity_check failed: ${database.integrity}.`);
  check(
    database.foreignKeyViolations === 0,
    `The upgraded database has ${database.foreignKeyViolations} foreign-key violations (the previous release left ${database.previousForeignKeyViolations}).`,
  );
  check(
    database.missingMigrations === 0 && database.schemaVersion === database.latestSchemaVersion,
    `The upgraded database is at schema ${database.schemaVersion}, not ${database.latestSchemaVersion}, and misses ${database.missingMigrations} migrations.`,
  );
  check(
    database.missingTables === 0 && database.missingColumns === 0,
    `The upgraded database misses ${database.missingTables} tables and ${database.missingColumns} columns of a new database.`,
  );
  report.passed = true;
  logger.info(`Upgrade from ${tag} to ${newVersion} passed.`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  logger.error(`Release upgrade check failed: ${report.error}`);
  const running = current.app ?? current.process;
  if (running) logger.error(`OpenBot stderr (last lines):\n${running.stderr()}`);
  await printLogs().catch(() => undefined);
  process.exitCode = 1;
} finally {
  await current.app?.browser.close().catch(() => undefined);
  const running = current.process;
  if (running) {
    forceKill(running.child);
    await running.exited;
    stopLeftovers(running);
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  // The Windows install stays: the runner is discarded after the job.
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  if (target === "linux" || target === "linux-arm64") await rm(linuxAppImage, { force: true }).catch(() => undefined);
}
