import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { teeLogLines } from "@openbot/logging";
import { Effect, Result } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentClient, AgentProvider } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  NO_PROVIDER_CREDENTIALS,
  requireProviderDriver,
} from "../src/backend/provider-drivers";
import { sweepProviderTemp } from "../src/backend/provider-temp";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-start-e2e");
const WAIT_MS = 15_000;
const SLOW_UNPACK_MS = 7_000;
const FIRST_INSTALL_START_TIMEOUT_MS = 4_000;
const FIRST_INSTALL_UNPACK_MS = 6_000;
const KEY_AUTH_START_TIMEOUT_MS = 2_000;
const FAKE_VERSION = "1.5.4";

const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const NL = String.fromCharCode(10);
if (process.argv[2] === "--version") {
  process.stdout.write("${FAKE_VERSION}" + NL);
  process.exit(0);
}
const temp = process.env.TMP || process.env.TEMP || process.env.TMPDIR;
const unpacked = path.join(temp, "_MEI" + process.pid.toString(16));
fs.mkdirSync(unpacked, { recursive: true });
fs.writeFileSync(path.join(unpacked, "python310.dll"), Buffer.alloc(5 * 1024 * 1024));
fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
  pid: process.pid, TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR, unpacked,
}) + NL);
let sessions = 0;
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    const authMethods = process.env.FAKE_AGY_KEY_AUTH
      ? [{ id: "gemini-api-key", name: "Gemini API key" }]
      : process.env.FAKE_AGY_SIGN_IN
        ? [{ id: "oauth-personal", name: "Google" }]
        : [];
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods } });
    return;
  }
  if (message.method === "authenticate" && process.env.FAKE_AGY_KEY_AUTH === "hang") return;
  if (message.method === "authenticate" && process.env.FAKE_AGY_SIGN_IN === "wait") {
    const opener = path.join((process.env.PATH || "").split(path.delimiter)[0] || "", process.platform === "darwin" ? "open" : "xdg-open");
    if (path.basename(path.dirname(opener)).startsWith("openbot-sign-in-") && fs.existsSync(opener)) {
      require("node:child_process").spawn(opener, ["https://accounts.google.com/o/oauth2/auth?state=fake"], { stdio: "ignore" });
    } else process.stderr.write("OpenBot's opener is not first on PATH." + NL);
    return;
  }
  if (message.method === "session/new" && process.env.FAKE_AGY_AUTH_REQUIRED && fs.existsSync(process.env.FAKE_AGY_AUTH_REQUIRED)) {
    write({ id: message.id, error: { code: -32000, message: "Authentication required" } });
    return;
  }
  if (message.method === "session/new") {
    const answer = () => write({ id: message.id, result: {
      sessionId: "s-" + message.id,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } });
    sessions += 1;
    const hold = process.env.FAKE_AGY_HOLD;
    if (!hold || sessions === 1 || !fs.existsSync(hold)) return answer();
    fs.appendFileSync(hold + ".held", process.pid + NL);
    const wait = setInterval(() => {
      if (fs.existsSync(hold)) return;
      clearInterval(wait);
      answer();
    }, 20);
    return;
  }
  write({ id: message.id, result: {} });
}
function serve() {
  let buffer = "";
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
}
if (process.env.FAKE_AGY_MODE === "slow") setTimeout(serve, Number(process.env.FAKE_AGY_UNPACK_MS));
else process.stdin.on("data", () => {
  if (process.env.FAKE_AGY_MODE === "crash") process.exit(3);
});
setInterval(() => {}, 1000);
`;

interface StartEntry {
  pid: number;
  TMP: string;
  TEMP: string;
  TMPDIR: string;
  unpacked: string;
}

interface Report {
  passed: boolean;
  stoppedProcess?: { tempRoot: string; envInRoot: boolean; unpackedWhileRunning: boolean; leftAfterStop: string[] };
  startCap?: { attempts: number; spawns: number; state: string | undefined; message: string | null | undefined };
  automaticRefresh?: { spawns: number };
  sameTime?: { spawns: number; message: string | null | undefined };
  userRefresh?: { spawns: number };
  leftInTempRoot?: string[];
  launchSweep?: { left: string[] };
  lowDisk?: { attempts: number; spawns: number; message: string | null | undefined };
  slowStart?: {
    timedOut: { state: string | undefined; message: string | null | undefined; lastError: string | null };
    retry: { spawns: number; state: string | undefined };
    keyChange: { spawns: number; state: string | undefined };
    logLines: string[];
  };
  disposeDuringKeyChange?: {
    handedToStop: number;
    keyChange: "succeeded" | "failed";
    leftInRuntime: number;
    processStopped: boolean;
  };
  disposeDuringCatalogRefresh?: {
    handedToStop: number;
    keyChange: "succeeded" | "failed";
    leftInRuntime: number;
    newProcessStopped: boolean;
    previousProcessStopped: boolean;
  };
  firstInstallTimeout?: {
    activated: boolean;
    timedOut: { state: string | undefined; message: string | null | undefined };
    retry: { spawns: number; state: string | undefined };
  };
  keyAuthenticateHang?: {
    whileWaiting: { connectionState: string | undefined; signInPending: boolean | undefined };
    keyChange: "succeeded" | "failed" | "still waiting";
    connectionState: string | undefined;
    state: string | undefined;
    lastError: string | null;
  };
  browserSignIn?: {
    whileWaiting: { connectionState: string | undefined; signInPending: boolean | undefined };
    afterCancel: { connectionState: string | undefined; signInPending: boolean | undefined };
  };
  settingsUnreadable?: {
    attempts: number;
    spawns: number;
    state: string | undefined;
    message: string | null | undefined;
  };
  settingsUnreadableAfterStart?: {
    before: string | undefined;
    chatError: string | null;
    state: string | undefined;
    message: string | null | undefined;
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-start-e2e-"));
const log = join(root, "agy.jsonl");
const report: Report = { passed: false };
process.env.FAKE_AGY_LOG = log;
process.env.GEMINI_HOME = join(root, "gemini");

async function starts(): Promise<StartEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitFor(label: string, check: () => Promise<boolean>, waitMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resume) => setTimeout(resume, 50));
  }
}

const entries = (path: string): Promise<string[]> => readdir(path).catch(() => []);

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runtime(
  tempRoot: string,
  freeBytes: () => number,
  isStopping: () => boolean = () => false,
  firstInstall = false,
  savedKey: string | null = null,
): { providers: ProviderRuntime; store: AgentStore } {
  const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
  const providers = new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "antigravity"),
    conversation: new ConversationRuntime(
      store,
      () => undefined,
      () => store.list(),
    ),
    hooks: {
      bindClient: () => undefined,
      onProvidersReady: () => Effect.void,
      onProviderLost: () => undefined,
      onClientStopped: () => Effect.void,
      isStopping,
      isProviderBusy: () => false,
      isAgentBusy: () => false,
      isProviderAssigned: () => true,
      onAgentClientLost: () => Effect.void,
      sharedRoot: () => join(root, "shared"),
      onProviderResumed: () => undefined,
      onProviderActivated: () => Effect.void,
      captureConfigRevision: () => 0,
    },
    emit: () => undefined,
    emitError: () => undefined,
    requestTimeoutMs: 5_000,
    ...(firstInstall ? { longStartTimeoutMs: FIRST_INSTALL_START_TIMEOUT_MS } : {}),
    ...(savedKey ? { longStartTimeoutMs: KEY_AUTH_START_TIMEOUT_MS } : {}),
    preferredProvider: "antigravity",
    clientFactory: null,
    bundledExecutables: { antigravity: firstInstall ? firstInstallExecutable : executable },
    credentials: {
      ...NO_PROVIDER_CREDENTIALS,
      apiKey: (provider) => (provider === "antigravity" ? savedKey : null),
      providerTempDirectory: tempRoot,
      availableDiskBytes: freeBytes,
    },
    redactMcp: (text) => text,
  });
  return { providers, store };
}

async function stopAll(providers: ProviderRuntime): Promise<void> {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
}

function antigravityRow(providers: ProviderRuntime) {
  return providers.status().providers?.find((row) => row.id === ("antigravity" satisfies AgentProvider));
}

async function installFakeAgy(installRoot: string): Promise<string> {
  const path = join(installRoot, FAKE_VERSION, "bin", "antigravity");
  await mkdir(join(installRoot, FAKE_VERSION, "bin"), { recursive: true });
  await writeFile(path, FAKE_AGY);
  await chmod(path, 0o755);
  return path;
}

const executable = join(root, "agy", FAKE_VERSION, "bin", "antigravity");
const firstInstallExecutable = join(root, "agy-first-install", FAKE_VERSION, "bin", "antigravity");
try {
  await installFakeAgy(join(root, "agy"));
  const cli: AgentCliInfo = { executable, version: FAKE_VERSION, source: "managed" };

  process.env.FAKE_AGY_MODE = "hang";
  const stoppedRoot = join(root, "temp-stopped");
  const client: AgentClient = requireProviderDriver("antigravity").createClient(cli, 5_000, {
    ...NO_PROVIDER_CREDENTIALS,
    providerTempDirectory: stoppedRoot,
  });
  client.start();
  await waitFor("the fake server to unpack", async () => (await starts()).length === 1);
  const [started] = await starts();
  assert.ok(started);
  const tempRoot = join(stoppedRoot, "antigravity");
  const envInRoot = [started.TMP, started.TEMP, started.TMPDIR].every((path) => path.startsWith(`${tempRoot}${sep}`));
  const unpackedWhileRunning = (await entries(started.unpacked)).length > 0;
  await runCauseEffect(client.stop());
  await waitFor("the stopped process's folder to be removed", async () => (await entries(tempRoot)).length === 0);
  report.stoppedProcess = {
    tempRoot,
    envInRoot,
    unpackedWhileRunning,
    leftAfterStop: await entries(tempRoot),
  };
  assert.ok(envInRoot, "TMP, TEMP and TMPDIR point into OpenBot's temporary root");
  assert.ok(unpackedWhileRunning, "the fake server unpacked while it ran");

  process.env.FAKE_AGY_MODE = "crash";
  await rm(log, { force: true });
  const capRoot = join(root, "temp-cap");
  const { providers } = runtime(capRoot, () => Number.MAX_SAFE_INTEGER);
  const attempts = 6;
  for (let attempt = 0; attempt < attempts; attempt += 1)
    await runCauseEffect(providers.ensureProvider("antigravity").pipe(Effect.ignore));
  const capRow = antigravityRow(providers);
  report.startCap = {
    attempts,
    spawns: (await starts()).length,
    state: capRow?.state,
    message: capRow?.message,
  };
  assert.equal(report.startCap.spawns, attempts, "one start for each request, and no restart by itself");
  assert.equal(capRow?.state, "error");
  assert.equal(capRow?.message, sourceText("error.provider.startPaused", { provider: "Gemini" }));

  await runCauseEffect(providers.refreshProviders({ automatic: true }).pipe(Effect.ignore));
  report.automaticRefresh = { spawns: (await starts()).length - attempts };
  assert.equal(report.automaticRefresh.spawns, 0);

  const together = (await starts()).length;
  await runCauseEffect(
    Effect.all(
      Array.from({ length: attempts }, () => providers.ensureProvider("antigravity").pipe(Effect.ignore)),
      { concurrency: "unbounded" },
    ),
  );
  report.sameTime = { spawns: (await starts()).length - together, message: antigravityRow(providers)?.message };
  assert.equal(report.sameTime.spawns, 1, "one start for requests at the same time");
  assert.equal(report.sameTime.message, sourceText("error.provider.startPaused", { provider: "Gemini" }));

  const beforeUserRefresh = (await starts()).length;
  await runCauseEffect(providers.refreshProviders({ automatic: false }).pipe(Effect.ignore));
  report.userRefresh = { spawns: (await starts()).length - beforeUserRefresh };
  assert.equal(report.userRefresh.spawns, 1);
  await runCauseEffect(providers.dispose());
  await waitFor(
    "every crashed process's folder to be removed",
    async () => (await entries(join(capRoot, "antigravity"))).length === 0,
  );
  report.leftInTempRoot = await entries(join(capRoot, "antigravity"));

  await rm(log, { force: true });
  const lowDisk = runtime(join(root, "temp-low-disk"), () => 0).providers;
  for (let attempt = 0; attempt < attempts; attempt += 1)
    await runCauseEffect(lowDisk.ensureProvider("antigravity").pipe(Effect.ignore));
  report.lowDisk = { attempts, spawns: (await starts()).length, message: antigravityRow(lowDisk)?.message };
  await runCauseEffect(lowDisk.dispose());
  assert.equal(report.lowDisk.spawns, 0);
  assert.equal(report.lowDisk.message, sourceText("error.provider.tempDiskSpace", { provider: "Gemini" }));

  const sweepRoot = join(root, "temp-sweep");
  await mkdir(join(sweepRoot, "antigravity", "run-earlier", "_MEI1a2b"), { recursive: true });
  await writeFile(join(sweepRoot, "antigravity", "run-earlier", "_MEI1a2b", "python310.dll"), "");
  await Effect.runPromise(sweepProviderTemp(sweepRoot));
  await waitFor(
    "the earlier run's folder to be removed",
    async () => (await entries(join(sweepRoot, "antigravity"))).length === 0,
  );
  report.launchSweep = { left: await entries(join(sweepRoot, "antigravity")) };

  const logLines: string[] = [];
  const stopTee = teeLogLines(["acp-connection", "provider-runtime"], (line) => logLines.push(line));
  process.env.FAKE_AGY_MODE = "slow";
  process.env.FAKE_AGY_UNPACK_MS = String(SLOW_UNPACK_MS);
  await rm(log, { force: true });
  const slow = runtime(join(root, "temp-slow"), () => Number.MAX_SAFE_INTEGER).providers;
  await runCauseEffect(slow.ensureProvider("antigravity").pipe(Effect.ignore));
  const timedOutRow = antigravityRow(slow);
  const timedOut = {
    state: timedOutRow?.state,
    message: timedOutRow?.message,
    lastError: slow.lastError("antigravity"),
  };
  assert.equal(timedOut.state, "error");
  assert.equal(timedOut.message, sourceText("error.provider.cliTimedOut", { provider: "Gemini" }));
  assert.equal(timedOut.lastError, sourceText("error.provider.acpStartTimedOut", { provider: "Gemini", seconds: "5" }));
  await waitFor(
    "the retry to connect the slow server",
    async () => antigravityRow(slow)?.state === "available",
    5_000 + SLOW_UNPACK_MS + WAIT_MS,
  );
  const retry = { spawns: (await starts()).length, state: antigravityRow(slow)?.state };
  await stopAll(slow);
  assert.equal(retry.spawns, 2, "one start that timed out, then one retry that connected");

  await rm(log, { force: true });
  const keyChange = runtime(join(root, "temp-slow-key"), () => Number.MAX_SAFE_INTEGER).providers;
  await runCauseEffect(keyChange.changeProviderCredential("antigravity", () => Effect.void));
  const keyChangeResult = { spawns: (await starts()).length, state: antigravityRow(keyChange)?.state };
  await stopAll(keyChange);
  stopTee();
  assert.equal(keyChangeResult.state, "available");
  assert.equal(keyChangeResult.spawns, 1);
  const diagnostics = logLines.filter((line) =>
    /An ACP agent process (started|wrote its first output|ended)|A provider did not start/u.test(line),
  );
  report.slowStart = { timedOut, retry, keyChange: keyChangeResult, logLines: diagnostics };
  assert.ok(diagnostics.some((line) => line.includes("An ACP agent process started.")));
  assert.ok(diagnostics.some((line) => line.includes("An ACP agent process wrote its first output.")));
  assert.ok(diagnostics.some((line) => line.includes("An ACP agent process ended.") && line.includes('"pid"')));
  assert.ok(
    diagnostics.some((line) => line.includes("A provider did not start.") && line.includes('"stage":"initialize"')),
  );

  process.env.FAKE_AGY_UNPACK_MS = "2000";
  await rm(log, { force: true });
  let stopping = false;
  const disposing = runtime(
    join(root, "temp-dispose"),
    () => Number.MAX_SAFE_INTEGER,
    () => stopping,
  ).providers;
  const keyChangeEnd = runCauseEffect(disposing.changeProviderCredential("antigravity", () => Effect.void)).then(
    () => "succeeded" as const,
    () => "failed" as const,
  );
  await waitFor("the key change to start its process", async () => (await starts()).length === 1);
  stopping = true;
  const handed = await runCauseEffect(disposing.dispose());
  for (const client of handed) await runCauseEffect(client.stop());
  const keyChangeAfterDispose = await keyChangeEnd;
  const [keyChangeStart] = await starts();
  assert.ok(keyChangeStart);
  const left = await runCauseEffect(disposing.dispose());
  report.disposeDuringKeyChange = {
    handedToStop: handed.length,
    keyChange: keyChangeAfterDispose,
    leftInRuntime: left.length,
    processStopped: false,
  };
  for (const client of left) await runCauseEffect(client.stop());
  assert.equal(left.length, 0, "the disposed runtime holds no client");
  await waitFor("the key change's process to stop", async () => !running(keyChangeStart.pid));
  report.disposeDuringKeyChange.processStopped = true;

  process.env.FAKE_AGY_UNPACK_MS = "0";
  delete process.env.FAKE_AGY_HOLD;
  await rm(log, { force: true });
  let refreshStopping = false;
  const refreshing = runtime(
    join(root, "temp-dispose-refresh"),
    () => Number.MAX_SAFE_INTEGER,
    () => refreshStopping,
  ).providers;
  await runCauseEffect(refreshing.ensureProvider("antigravity"));
  assert.equal(antigravityRow(refreshing)?.state, "available");
  const [previousStart] = await starts();
  assert.ok(previousStart);
  const hold = join(root, "hold-catalog");
  await writeFile(hold, "");
  process.env.FAKE_AGY_HOLD = hold;
  const refreshKeyChangeEnd = runCauseEffect(
    refreshing.changeProviderCredential("antigravity", () => Effect.void),
  ).then(
    () => "succeeded" as const,
    () => "failed" as const,
  );
  await waitFor(
    "the new process to hold the catalogue refresh",
    async () => (await readFile(`${hold}.held`, "utf8").catch(() => "")).length > 0,
  );
  delete process.env.FAKE_AGY_HOLD;
  refreshStopping = true;
  const refreshHanded = await runCauseEffect(refreshing.dispose());
  for (const client of refreshHanded) await runCauseEffect(client.stop());
  await rm(hold);
  const refreshKeyChange = await refreshKeyChangeEnd;
  const newStart = (await starts()).find((entry) => entry.pid !== previousStart.pid);
  assert.ok(newStart);
  const refreshLeft = await runCauseEffect(refreshing.dispose());
  for (const client of refreshLeft) await runCauseEffect(client.stop());
  report.disposeDuringCatalogRefresh = {
    handedToStop: refreshHanded.length,
    keyChange: refreshKeyChange,
    leftInRuntime: refreshLeft.length,
    newProcessStopped: false,
    previousProcessStopped: false,
  };
  assert.equal(refreshLeft.length, 0, "the disposed runtime holds no client");
  await waitFor("the new process to stop", async () => !running(newStart.pid));
  report.disposeDuringCatalogRefresh.newProcessStopped = true;
  await waitFor("the previous process to stop", async () => !running(previousStart.pid));
  report.disposeDuringCatalogRefresh.previousProcessStopped = true;

  process.env.FAKE_AGY_UNPACK_MS = String(FIRST_INSTALL_UNPACK_MS);
  await rm(log, { force: true });
  const firstInstall = runtime(
    join(root, "temp-first-install"),
    () => Number.MAX_SAFE_INTEGER,
    () => false,
    true,
  ).providers;
  const activation = await runCauseEffect(
    firstInstall
      .updateProviderCli(
        "antigravity",
        () => Effect.promise(() => installFakeAgy(join(root, "agy-first-install"))),
        new AbortController().signal,
        () => undefined,
      )
      .pipe(Effect.result),
  );
  const activationRow = antigravityRow(firstInstall);
  report.firstInstallTimeout = {
    activated: Result.isSuccess(activation),
    timedOut: { state: activationRow?.state, message: activationRow?.message },
    retry: { spawns: 0, state: undefined },
  };
  assert.ok(report.firstInstallTimeout.activated, "a start that timed out keeps the first install");
  assert.equal(activationRow?.message, sourceText("error.provider.cliTimedOut", { provider: "Gemini" }));
  await waitFor(
    "the retry to connect the first install",
    async () => antigravityRow(firstInstall)?.state === "available",
    5_000 + FIRST_INSTALL_UNPACK_MS + WAIT_MS,
  );
  report.firstInstallTimeout.retry = { spawns: (await starts()).length, state: antigravityRow(firstInstall)?.state };
  await stopAll(firstInstall);
  assert.equal(report.firstInstallTimeout.retry.spawns, 2, "one start that timed out, then one retry that connected");

  process.env.FAKE_AGY_UNPACK_MS = "0";
  process.env.FAKE_AGY_KEY_AUTH = "hang";
  await rm(log, { force: true });
  const keyed = runtime(
    join(root, "temp-key-hang"),
    () => Number.MAX_SAFE_INTEGER,
    () => false,
    false,
    "fake-gemini-key",
  ).providers;
  const keyHangEnd = runCauseEffect(keyed.changeProviderCredential("antigravity", () => Effect.void)).then(
    () => "succeeded" as const,
    () => "failed" as const,
  );
  await waitFor("the key change to start its process", async () => (await starts()).length === 1);
  const waitingRow = antigravityRow(keyed);
  const whileWaiting = { connectionState: waitingRow?.connectionState, signInPending: waitingRow?.signInPending };
  const keyHang = await Promise.race([
    keyHangEnd,
    new Promise<"still waiting">((done) =>
      setTimeout(() => done("still waiting"), 2 * KEY_AUTH_START_TIMEOUT_MS + WAIT_MS),
    ),
  ]);
  const keyHangRow = antigravityRow(keyed);
  report.keyAuthenticateHang = {
    whileWaiting,
    keyChange: keyHang,
    connectionState: keyHangRow?.connectionState,
    state: keyHangRow?.state,
    lastError: keyed.lastError("antigravity"),
  };
  delete process.env.FAKE_AGY_KEY_AUTH;
  await stopAll(keyed);
  assert.equal(whileWaiting.connectionState, "connecting");
  assert.equal(
    whileWaiting.signInPending,
    false,
    "a check again opens no page, so the row offers no sign-in to finish",
  );
  assert.equal(keyHang, "failed", "the key change fails when `authenticate` does not answer");
  assert.equal(keyHangRow?.connectionState, undefined, "the row does not stay connecting");
  assert.equal(
    report.keyAuthenticateHang.lastError,
    sourceText("error.provider.acpStartTimedOut", {
      provider: "Gemini",
      seconds: String(KEY_AUTH_START_TIMEOUT_MS / 1_000),
    }),
  );

  await rm(log, { force: true });
  const signingIn = runtime(join(root, "temp-sign-in"), () => Number.MAX_SAFE_INTEGER).providers;
  await runCauseEffect(signingIn.ensureProvider("antigravity").pipe(Effect.ignore));
  process.env.FAKE_AGY_SIGN_IN = "wait";
  let pageOpened = false;
  await runCauseEffect(
    signingIn.connectProvider("antigravity", async () => {
      pageOpened = true;
    }),
  );
  await waitFor("the Google page to open", async () => pageOpened);
  const signInRow = antigravityRow(signingIn);
  const signInWaiting = { connectionState: signInRow?.connectionState, signInPending: signInRow?.signInPending };
  await runCauseEffect(signingIn.cancelProviderSignIn("antigravity"));
  const cancelledRow = antigravityRow(signingIn);
  report.browserSignIn = {
    whileWaiting: signInWaiting,
    afterCancel: { connectionState: cancelledRow?.connectionState, signInPending: cancelledRow?.signInPending },
  };
  delete process.env.FAKE_AGY_SIGN_IN;
  await stopAll(signingIn);
  assert.equal(signInWaiting.connectionState, "connecting");
  assert.equal(signInWaiting.signInPending, true, "a Connect that waits for the Google page offers its sign-in");
  assert.equal(report.browserSignIn.afterCancel.connectionState, undefined, "Cancel ends the sign-in");

  await rm(log, { force: true });
  const settings = join(root, "gemini", "antigravity-acp", "settings.json");
  const refused = join(root, "auth-required");
  await mkdir(settings, { recursive: true });
  await writeFile(refused, "");
  process.env.FAKE_AGY_AUTH_REQUIRED = refused;
  const unreadable = runtime(join(root, "temp-settings"), () => Number.MAX_SAFE_INTEGER).providers;
  const settingsAttempts = 6;
  for (let attempt = 0; attempt < settingsAttempts; attempt += 1)
    await runCauseEffect(unreadable.ensureProvider("antigravity").pipe(Effect.ignore));
  const unreadableRow = antigravityRow(unreadable);
  report.settingsUnreadable = {
    attempts: settingsAttempts,
    spawns: (await starts()).length,
    state: unreadableRow?.state,
    message: unreadableRow?.message,
  };
  await stopAll(unreadable);
  await rm(settings, { recursive: true, force: true });
  await rm(refused);
  assert.equal(report.settingsUnreadable.spawns, 3, "three failed starts, then no more");
  assert.equal(unreadableRow?.state, "error");
  assert.equal(unreadableRow?.message, sourceText("error.provider.geminiSettingsUnreadable"));

  const later = runtime(join(root, "temp-settings-later"), () => Number.MAX_SAFE_INTEGER).providers;
  await runCauseEffect(later.ensureProvider("antigravity"));
  const startedState = antigravityRow(later)?.state;
  await mkdir(settings, { recursive: true });
  await writeFile(refused, "");
  const laterClient = later.clientFor("antigravity");
  assert.ok(laterClient, "the started provider has a client");
  const opened = await Effect.runPromise(
    Effect.result(laterClient.request("thread/start", { cwd: root, model: "gemini-fake" }, (value) => value)),
  );
  const chatError = Result.isFailure(opened)
    ? opened.failure.cause instanceof Error
      ? opened.failure.cause.message
      : String(opened.failure.cause)
    : null;
  await waitFor("the row to show the refusal", async () => antigravityRow(later)?.state === "error");
  const laterRow = antigravityRow(later);
  report.settingsUnreadableAfterStart = {
    before: startedState,
    chatError,
    state: laterRow?.state,
    message: laterRow?.message,
  };
  delete process.env.FAKE_AGY_AUTH_REQUIRED;
  await stopAll(later);
  await rm(settings, { recursive: true, force: true });
  await rm(refused);
  assert.equal(startedState, "available");
  assert.equal(chatError, sourceText("error.provider.geminiSettingsUnreadable"));
  assert.equal(laterRow?.message, sourceText("error.provider.geminiSettingsUnreadable"));

  report.passed = true;
} finally {
  for (const entry of await starts()) if (running(entry.pid)) process.kill(entry.pid);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
