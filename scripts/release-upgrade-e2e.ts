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
import { RUN_MARKER_FILE } from "../src/main/run-marker";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const logger = createOpenBotLogger("release-upgrade-e2e");
const REPOSITORY = "nightly-labs/openbot";
const OUT = resolve(import.meta.dirname, "../.openbot-build/release-upgrade-e2e");
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
    "Usage: bun scripts/release-upgrade-e2e.ts <macos|windows|linux|linux-arm64> [--new=<artifact>] [--previous=<tag> | --previous-age-days=<n>] [--previous-artifact=<file>] [--history]",
  );
}
const expectedPlatform = { macos: "darwin", windows: "win32", linux: "linux", "linux-arm64": "linux" }[target];
if (process.platform !== expectedPlatform) throw new Error(`The ${target} test must run on ${expectedPlatform}.`);
if (target === "linux" && process.arch !== "x64") throw new Error("The linux test needs an x64 computer.");
if (target === "linux-arm64" && process.arch !== "arm64")
  throw new Error("The linux-arm64 test needs an arm64 computer.");
if (target === "windows" && process.arch !== "x64") throw new Error("The windows test needs an x64 computer.");
if (target === "windows" && process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("The Windows test installs OpenBot for this user and runs only on a GitHub Actions runner.");
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const history = process.argv.includes("--history");

const newVersion = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile(resolve(import.meta.dirname, "../package.json"), "utf8"))).version;

interface Report {
  passed: boolean;
  error?: string;
  target: Target;
  arch: string;
  previousVersion?: string;
  history: boolean;
  newVersion: string;
  installedVersion?: string;
  oldQuit?: QuitResult;
  newQuit?: QuitResult;
  seedApi?: SeedApi;
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
  tablesWithFewerRows: Record<string, { before: number; after: number }>;
}

interface QuitResult {
  clean: boolean;
  exitCode: number | null;
  runMarker?: string | null;
}
const runMarkerFile = z.object({ state: z.string() });

const report: Report = { passed: false, target, arch: process.arch, history, newVersion };
const root = await mkdtemp(join(tmpdir(), "openbot-upgrade-"));
const userDataPath = join(root, "user-data");
const homePath = join(root, "home");
await mkdir(userDataPath);
await mkdir(homePath);
const agentsFolder = join(target === "windows" ? (process.env.USERPROFILE ?? homePath) : homePath, "OpenBot", "Agents");
const earlierWorkspaces = new Set(await listWorkspaces());
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

function previousTag(ageDays?: number): string {
  const listed = z
    .array(z.object({ tagName: z.string(), publishedAt: z.string() }))
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
            "tagName,publishedAt",
          ],
          { encoding: "utf8" },
        ),
      ),
    );
  const latestPublished = ageDays === undefined ? Number.POSITIVE_INFINITY : Date.now() - ageDays * 86_400_000;
  const versions = listed
    .filter((entry) => Date.parse(entry.publishedAt) <= latestPublished)
    .map((entry) => entry.tagName)
    .filter((tag) => /^v\d+\.\d+\.\d+$/u.test(tag))
    .map((tag) => tag.slice(1))
    .filter((version) => compareVersions(version, newVersion) < 0)
    .sort(compareVersions);
  const newest = versions.at(-1);
  check(
    newest,
    `No published release is older than ${newVersion}${ageDays === undefined ? "" : ` and ${ageDays} days`}.`,
  );
  return `v${newest}`;
}

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

async function newArtifact(): Promise<string> {
  const given = option("new");
  if (given) return resolve(given);
  const extension = target === "macos" ? ".zip" : target === "windows" ? ".exe" : ".AppImage";
  const distRoot = resolve(import.meta.dirname, "../dist");
  const found = (await readdir(distRoot)).filter((name) => name.endsWith(extension));
  check(found.length === 1, `Expected one ${extension} artifact in dist/, found ${found.length}.`);
  return join(distRoot, found[0] ?? "");
}

const macApplications = join(root, "Applications");
const macBundle = join(macApplications, "OpenBot.app");
const windowsFolder = join(process.env.LOCALAPPDATA ?? "", "Programs", "OpenBot");
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
    const staging = join(root, "update-staging");
    await mkdir(staging);
    extractMacZip(artifact, staging);
    await rm(macBundle, { recursive: true, force: true });
    await rename(join(staging, "OpenBot.app"), macBundle);
    verifyMacSignature();
    return;
  }
  if (target === "windows") {
    const exitCode = await runInstaller(artifact, "--updated /S");
    check(exitCode === 0, `The new installer exited with code ${exitCode}.`);
    return;
  }
  const staging = `${linuxAppImage}.new`;
  await copyFile(artifact, staging);
  await chmod(staging, 0o755);
  await rename(staging, linuxAppImage);
}

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
  await rm(join(userDataPath, "DevToolsActivePort"), { force: true });
  const args = [`--user-data-dir=${userDataPath}`, "--remote-debugging-port=0"];
  if (target === "macos") args.push("--use-mock-keychain");
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
  await waitFor(
    "main to answer the window",
    LAUNCH_LIMIT_MS,
    async () => {
      try {
        return await page.evaluate(async () => {
          if (typeof window.openbot === "undefined") return null;
          if ("agent" in window.openbot && "listAgents" in window.openbot.agent)
            await window.openbot.agent.listAgents();
          else await window.openbot.getAppInfo();
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

async function rendererCalledMain(): Promise<boolean> {
  try {
    return (await readFile(join(userDataPath, "logs", "trace.ndjson"), "utf8")).includes('"kind":"ipc"');
  } catch {
    return false;
  }
}

async function quit(app: RunningApp, byWindowClose = process.platform === "win32"): Promise<QuitResult> {
  if (byWindowClose) {
    await app.page.evaluate(() => {
      setTimeout(() => window.close(), 0);
    });
  }
  await app.browser.close().catch(() => undefined);
  if (!byWindowClose) app.child.kill("SIGTERM");
  const limit = sleep(QUIT_LIMIT_MS).then(() => "limit" as const);
  const outcome = await Promise.race([app.exited, limit]);
  current.app = null;
  current.process = null;
  if (outcome !== "limit") {
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
    return { clean: true, exitCode: outcome, runMarker: await readRunMarkerState() };
  }
  logger.warn("OpenBot did not quit in time; it is killed.");
  forceKill(app.child);
  const exitCode = await app.exited;
  stopLeftovers(app);
  return { clean: false, exitCode };
}

async function readRunMarkerState(): Promise<string | null> {
  try {
    const marker = runMarkerFile.parse(JSON.parse(await readFile(join(userDataPath, RUN_MARKER_FILE), "utf8")));
    return marker.state;
  } catch {
    return null;
  }
}

function forceKill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } catch {}
  } else child.kill("SIGKILL");
}

function stopLeftovers(app: LaunchedProcess): void {
  const pid = app.child.pid;
  if (process.platform !== "win32" && pid) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
  app.child.stderr?.destroy();
}

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

interface SeedApi {
  updatePreference: boolean;
  customAgents: boolean;
  memories: boolean;
  channels: boolean;
}

interface Seed {
  api: SeedApi;
  agentIds: string[];
  agentMessageIds: string[];
  memoryIds: string[];
  channelId: string | null;
  channelMessageIds: string[];
}

async function readSeedApi(page: Page): Promise<SeedApi> {
  return page.evaluate(() => {
    const agent = "agent" in window.openbot ? window.openbot.agent : null;
    return {
      updatePreference: "update" in window.openbot && "setPreference" in window.openbot.update,
      customAgents: "customAgents" in window.openbot && agent !== null && "createAgent" in agent,
      memories: agent !== null && "createMemory" in agent && "listMemories" in agent,
      channels: agent !== null && "channelCommand" in agent && "listChannels" in agent && "readChannel" in agent,
    };
  });
}

async function seed(page: Page): Promise<Seed> {
  const api = await readSeedApi(page);
  report.seedApi = api;
  const missing = Object.entries(api)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  check(history || missing.length === 0, `The previous release has no ${missing.join(", ")} call. Use --history.`);
  const seeded: Seed = {
    api,
    agentIds: [],
    agentMessageIds: [],
    memoryIds: [],
    channelId: null,
    channelMessageIds: [],
  };

  if (api.updatePreference) {
    await page.evaluate(() => window.openbot.update.setPreference({ autoDownload: false, autoInstall: false }));
  }
  if (!api.customAgents) return seeded;

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
        if (error instanceof Error && /is not connected|listed no models/u.test(error.message)) return null;
        throw error;
      }
    });

  const agents = [await createAgent("Upgrade One"), await createAgent("Upgrade Two")];
  const agentIds = agents.map((agent) => agent.id);
  seeded.agentIds = agentIds;
  const agentMessageIds = seeded.agentMessageIds;
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

  for (const agentId of api.memories ? agentIds : []) {
    const memory = await page.evaluate(
      (id) => window.openbot.agent.createMemory({ agentId: id, text: "The release upgrade check made this memory." }),
      agentId,
    );
    seeded.memoryIds.push(memory.id);
  }

  if (!api.channels) return seeded;
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

  seeded.channelId = channelId;
  seeded.channelMessageIds = channelMessages.map((entry) => entry.id);
  return seeded;
}

async function searchSeedMessages(page: Page, agentId: string) {
  const found = await page.evaluate(
    (id) => window.openbot.agent.searchConversationMessages({ query: "upgradecheck", agentId: id, limit: 100 }),
    agentId,
  );
  return found.results.filter((result) => result.agentId === agentId).map((result) => result.message);
}

async function readSeed(page: Page, seeded: Seed): Promise<Counts> {
  const { api } = seeded;
  const agents = seeded.agentIds.length > 0 ? await page.evaluate(() => window.openbot.agent.listAgents()) : [];
  const agentIds = new Set(agents.map((agent) => agent.id));
  let agentMessages = 0;
  let memories = 0;
  for (const agentId of seeded.agentIds) {
    if (!agentIds.has(agentId)) continue;
    const messageIds = new Set((await searchSeedMessages(page, agentId)).map((message) => message.id));
    agentMessages += seeded.agentMessageIds.filter((id) => messageIds.has(id)).length;
    if (!api.memories) continue;
    const memoryList = await page.evaluate((id) => window.openbot.agent.listMemories(id), agentId);
    const memoryIds = new Set(memoryList.map((memory) => memory.id));
    memories += seeded.memoryIds.filter((id) => memoryIds.has(id)).length;
  }
  const { channelId } = seeded;
  const channels = channelId ? await page.evaluate(() => window.openbot.agent.listChannels()) : [];
  const channelFound = channels.some((channel) => channel.id === channelId);
  let channelMessages = 0;
  if (channelId && channelFound) {
    const channelPage = await page.evaluate((id) => window.openbot.agent.readChannel({ channelId: id }), channelId);
    const messageIds = new Set(channelPage.messages.map((entry) => entry.id));
    channelMessages = seeded.channelMessageIds.filter((id) => messageIds.has(id)).length;
  }
  const customAgents = api.customAgents
    ? await page.evaluate((server) => window.openbot.customAgents.list(server), LOCAL_SERVER_ID)
    : [];
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

function rowCounts(db: DatabaseSync): Map<string, number> {
  return new Map(
    [...tableColumns(db).keys()].map((name) => {
      const [row] = rows(db, `SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`);
      return [name, isNumber(row?.count) ? row.count : -1];
    }),
  );
}

function foreignKeyViolations(db: DatabaseSync): number {
  return rows(db, "PRAGMA foreign_key_check").length;
}

async function checkDatabase(
  previousSchemaVersion: number,
  previousForeignKeyViolations: number,
  previousRowCounts: ReadonlyMap<string, number>,
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
    const tablesWithFewerRows: DatabaseReport["tablesWithFewerRows"] = {};
    for (const [table, after] of rowCounts(db)) {
      const before = previousRowCounts.get(table);
      if (before !== undefined && after < before) tablesWithFewerRows[table] = { before, after };
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
      tablesWithFewerRows,
    };
  } finally {
    db.close();
  }
}

async function printLogs(): Promise<void> {
  const logs = join(userDataPath, "logs");
  if (!existsSync(logs)) return;
  const names = await readdir(logs, { recursive: true });
  for (const name of names.filter((entry) => entry.endsWith(".log"))) {
    const text = await readFile(join(logs, name), "utf8").catch(
      (error: unknown) => `(not readable: ${error instanceof Error ? error.message : String(error)})`,
    );
    logger.info(`--- ${name} (last lines) ---\n${text.split("\n").slice(-80).join("\n")}`);
  }
}

try {
  const ageDays = option("previous-age-days");
  const tag = option("previous") ?? previousTag(ageDays === undefined ? undefined : Number(ageDays));
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
  const previousRowCounts = rowCounts(before);
  before.close();

  await installNew(newBuild);
  const newApp = await launch();
  report.installedVersion = await readAppVersion(newApp.page);
  report.afterUpgrade = await readSeed(newApp.page, seeded);
  report.newQuit = await quit(newApp, process.platform !== "darwin");
  report.database = await checkDatabase(previousSchemaVersion, previousForeignKeyViolations, previousRowCounts);

  const { afterUpgrade, database } = report;
  check(
    report.installedVersion === newVersion,
    `The new build reports version ${report.installedVersion}, not ${newVersion}.`,
  );
  const oldQuitClean = report.oldQuit.clean && report.oldQuit.exitCode === 0;
  const oldQuitMessage = `The previous release did not quit cleanly on the quit request (exit code ${report.oldQuit.exitCode}).`;
  if (history && !oldQuitClean) logger.warn(oldQuitMessage);
  else check(oldQuitClean, oldQuitMessage);
  check(
    report.newQuit.clean && report.newQuit.exitCode === 0,
    `The new build did not quit cleanly on the quit request (exit code ${report.newQuit.exitCode}).`,
  );
  check(
    report.newQuit.runMarker === "clean",
    `The new build ended before its teardown was done (run marker: ${report.newQuit.runMarker}).`,
  );
  check(
    JSON.stringify(afterUpgrade) === JSON.stringify(report.seeded),
    `The new build lost seeded data: before ${JSON.stringify(report.seeded)}, after ${JSON.stringify(afterUpgrade)}.`,
  );
  if (seeded.api.customAgents) {
    check(report.seeded.agents === 2 && report.seeded.customAgents === 1, "The seed step did not make its agents.");
    check(report.seeded.workspaceFolders === 2, "The seed step did not make the agents' workspace folders.");
  }
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
  const fewerRows = JSON.stringify(database.tablesWithFewerRows);
  if (fewerRows !== "{}") {
    const message = `The upgraded database has fewer rows in some tables: ${fewerRows}.`;
    check(!history, message);
    logger.warn(message);
  }
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
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  if (target === "linux" || target === "linux-arm64") await rm(linuxAppImage, { force: true }).catch(() => undefined);
}
