// Updates a managed provider CLI end to end on the real driver and `ProviderRuntime` while a turn
// runs on the provider (#2473), with a fake Gemini ACP server for the installed and the new version.
// Checks that the update waits for the turn instead of failing, holds new turns meanwhile, keeps an
// idle restart of the app away while it waits, installs when the turn ends without a restart of the
// app, never runs two installs at once when it is asked for again while it waits, and that a cancel
// ends the wait with nothing installed.
// `bun scripts/provider-update-busy-e2e.ts`. Writes .openbot-build/provider-update-busy-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect, Result } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { ANTIGRAVITY_MANIFEST } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { checkProviderAccountReload } from "./provider-account-reload-e2e";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-update-busy-e2e");
const WAIT_MS = 15_000;
const INSTALLED = "1.2.1";
const NEWER = "1.2.2";

// An ACP server with one model. It writes its pid to `FAKE_AGY_LOG` when it starts.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
fs.appendFileSync(process.env.FAKE_AGY_LOG, process.pid + NL);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
  if (message.method === "session/new")
    return write({ id: message.id, result: {
      sessionId: "s-" + message.id,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } });
  write({ id: message.id, result: {} });
}
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
setInterval(() => {}, 1000);
`;

interface Report {
  passed: boolean;
  queued?: {
    waited: boolean;
    installs: number;
    holdsNewTurns: boolean;
    countsAsActiveWork: boolean;
    state: string | undefined;
  };
  turnEnded?: { installs: number; version: string | null | undefined; holdsNewTurns: boolean; resumed: number };
  askedAgain?: { installs: number; maxConcurrentInstalls: number; holdsNewTurns: boolean };
  cancelled?: { failure: string | undefined; installs: number; holdsNewTurns: boolean; resumed: number };
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-update-busy-e2e-"));
const log = join(root, "agy.log");
const report: Report = { passed: false };
process.env.FAKE_AGY_LOG = log;

/** Waits for a condition that another fiber or process changes, and fails after `WAIT_MS`. */
async function waitFor(label: string, check: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resume) => setTimeout(resume, 20));
  }
}

async function installVersion(version: string): Promise<string> {
  const executable = join(root, "agy", version, "bin", "agy_acp_server");
  await mkdir(join(root, "agy", version, "bin"), { recursive: true });
  await writeFile(join(root, "agy", version, ANTIGRAVITY_MANIFEST), JSON.stringify({ version }));
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  return executable;
}

let busy = false;
let resumed = 0;
let installs = 0;
let running = 0;
let maxConcurrentInstalls = 0;
let release: (() => void) | null = null;

/** The install that main hands over: it counts, and the test can hold it open. */
function install(executable: string, hold = false) {
  return () =>
    Effect.promise(async () => {
      installs += 1;
      running += 1;
      maxConcurrentInstalls = Math.max(maxConcurrentInstalls, running);
      if (hold) await new Promise<void>((resume) => (release = resume));
      running -= 1;
      return executable;
    });
}

const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
const installedExecutable = await installVersion(INSTALLED);
const newerExecutable = await installVersion(NEWER);
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
    isStopping: () => false,
    isProviderBusy: () => busy,
    isAgentBusy: () => false,
    isProviderAssigned: () => true,
    onAgentClientLost: () => Effect.void,
    sharedRoot: () => join(root, "shared"),
    onProviderResumed: () => {
      resumed += 1;
    },
    onProviderActivated: () => Effect.void,
    captureConfigRevision: () => 0,
  },
  emit: () => undefined,
  emitError: () => undefined,
  requestTimeoutMs: 5_000,
  preferredProvider: "antigravity",
  clientFactory: null,
  bundledExecutables: { antigravity: installedExecutable },
  credentials: { ...NO_PROVIDER_CREDENTIALS, providerTempDirectory: join(root, "temp") },
  redactMcp: (text) => text,
});
const row = () => providers.status().providers?.find((candidate) => candidate.id === "antigravity");

try {
  await runCauseEffect(providers.ensureProvider("antigravity"));
  assert.equal(row()?.state, "available");
  assert.equal(row()?.version, INSTALLED);

  // 1. An update asked for while a turn runs waits for it. It does not fail, installs nothing yet,
  // and new turns of the provider wait for it.
  busy = true;
  let waited = false;
  const update = runCauseEffect(
    providers
      .updateProviderCli("antigravity", install(newerExecutable), new AbortController().signal, () => {
        waited = true;
      })
      .pipe(Effect.result),
  );
  await waitFor("the update to wait for the turn", () => waited);
  report.queued = {
    waited,
    installs,
    holdsNewTurns: providers.isReplacingCli("antigravity"),
    countsAsActiveWork: providers.activeProcessCount() > 0,
    state: row()?.state,
  };
  assert.equal(installs, 0, "nothing is installed while the turn runs");
  assert.ok(report.queued.holdsNewTurns, "new turns wait for the update");
  assert.ok(report.queued.countsAsActiveWork, "an idle restart of the app does not cut the wait");
  assert.equal(row()?.state, "available", "the provider keeps its row while the update waits");

  // 2. The turn ends: the update installs, the provider runs the new version, and turns go on.
  const resumedBefore = resumed;
  busy = false;
  const updated = await update;
  assert.ok(Result.isSuccess(updated), "the update succeeds after the turn");
  report.turnEnded = {
    installs,
    version: row()?.version,
    holdsNewTurns: providers.isReplacingCli("antigravity"),
    resumed: resumed - resumedBefore,
  };
  assert.equal(installs, 1);
  assert.equal(row()?.version, NEWER);
  assert.equal(row()?.state, "available");
  assert.equal(report.turnEnded.holdsNewTurns, false);
  assert.ok(report.turnEnded.resumed >= 1, "held turns are told to go on");

  // 3. Asked for again while it waits, as a second press of Update or Retry would: the two never
  // install at the same time.
  installs = 0;
  busy = true;
  let waitedFirst = false;
  const first = runCauseEffect(
    providers
      .updateProviderCli("antigravity", install(newerExecutable, true), new AbortController().signal, () => {
        waitedFirst = true;
      })
      .pipe(Effect.result),
  );
  await waitFor("the first update to wait", () => waitedFirst);
  const second = runCauseEffect(
    providers
      .updateProviderCli("antigravity", install(newerExecutable), new AbortController().signal, () => undefined)
      .pipe(Effect.result),
  );
  busy = false;
  await waitFor("the first install to start", () => release !== null);
  const releaseFirst: () => void = release ?? (() => undefined);
  releaseFirst();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  report.askedAgain = {
    installs,
    maxConcurrentInstalls,
    holdsNewTurns: providers.isReplacingCli("antigravity"),
  };
  assert.ok(Result.isSuccess(firstResult) && Result.isSuccess(secondResult));
  assert.equal(maxConcurrentInstalls, 1, "no two installs overlap");
  assert.equal(report.askedAgain.holdsNewTurns, false);
  assert.equal(row()?.state, "available");

  // 4. A cancel while it waits ends the update with an abort and installs nothing. Turns go on.
  installs = 0;
  busy = true;
  const controller = new AbortController();
  let waitedCancelled = false;
  const cancelled = runCauseEffect(
    providers
      .updateProviderCli("antigravity", install(newerExecutable), controller.signal, () => {
        waitedCancelled = true;
      })
      .pipe(Effect.result),
  );
  await waitFor("the update to wait before the cancel", () => waitedCancelled);
  const resumedBeforeCancel = resumed;
  controller.abort();
  const cancelledResult = await cancelled;
  assert.ok(Result.isFailure(cancelledResult));
  const failure = cancelledResult.failure.cause;
  report.cancelled = {
    failure: failure instanceof Error ? failure.name : undefined,
    installs,
    holdsNewTurns: providers.isReplacingCli("antigravity"),
    resumed: resumed - resumedBeforeCancel,
  };
  assert.equal(report.cancelled.failure, "AbortError", "main reads it as a cancel, not a failure");
  assert.equal(installs, 0);
  assert.equal(report.cancelled.holdsNewTurns, false);
  assert.equal(report.cancelled.resumed, 1);
  assert.equal(row()?.state, "available");
  busy = false;

  await checkProviderAccountReload();
  report.passed = true;
} finally {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  const pids = (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map(Number);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // Already stopped.
    }
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
