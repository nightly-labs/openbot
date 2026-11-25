import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import {
  BUILT_IN_PROVIDER_DRIVERS,
  NO_PROVIDER_CREDENTIALS,
  requireProviderDriver,
} from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-model-reread-e2e");
const BEFORE = ["gemini-4-carbon", "gemini-4-argon"];
const RELEASED = "gemini-4-neon";
const RELEASED_WHILE_IDLE = "gemini-4-xenon";

interface SetupLine {
  event: string;
  method: string;
  pid: number;
  sessionId: string;
  models: string[];
}

interface Report {
  passed: boolean;
  relistWhileRunning?: boolean;
  relistWhenReleased?: boolean;
  atStart?: string[];
  afterReread?: string[];
  rereadFresh?: boolean;
  setups?: { method: string; pid: number; sessionId: string; models: string[] }[];
  rereadUsedNewProcess?: boolean;
  rereadProcessExited?: boolean;
  runtimeRunningAfterReread?: string[];
  runtimeReleasedAfterReread?: string[];
  runtimeClientRemainsReleased?: boolean;
  runtimeStatusEvents?: number;
  providerErrors?: number;
  failure?: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((settle) => setTimeout(settle, 25));
  }
  return true;
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-model-reread-e2e-"));
process.env.GEMINI_HOME = join(root, "gemini");
const executable = join(root, "agy", "bin", "antigravity");
const log = join(root, "agent.jsonl");
const control = join(root, "control.json");
const report: Report = { passed: false };
const clients: AgentClient[] = [];
let runtime: ProviderRuntime | null = null;
let database: OpenBotDatabase | null = null;

try {
  await writeFile(control, JSON.stringify({ models: BEFORE }));
  await installFakeAgent(executable, "antigravity-model-list", { FAKE_LOG: log, FAKE_CONTROL: control });
  const client = requireProviderDriver("antigravity").createClient(
    { executable, version: "1.5.11", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.start();
  const providerErrors: unknown[] = [];
  const catalog = new ModelCatalog({
    client: (provider) => (provider === "antigravity" ? client : undefined),
    isSignedOut: () => false,
    requestTimeoutMs: 10_000,
    recordProviderError: (_provider, error) => providerErrors.push(error),
    startSettingsChanged: () => Effect.void,
  });
  const listed = () =>
    catalog
      .list()
      .filter((model) => model.provider === "antigravity")
      .map((model) => model.id);

  const driverCatalog = requireProviderDriver("antigravity").catalog;
  report.relistWhileRunning = driverCatalog?.relistWhileRunning === true;
  report.relistWhenReleased = driverCatalog?.relistWhenReleased === true;
  assert.ok(report.relistWhileRunning, "The Antigravity list is read again while the CLI runs.");
  assert.ok(report.relistWhenReleased, "The Antigravity list is read again even after idle release.");

  await runCauseEffect(catalog.refresh());
  report.atStart = listed();
  assert.deepEqual(report.atStart, BEFORE, "The start lists the models that the account has.");

  await writeFile(control, JSON.stringify({ models: [RELEASED, ...BEFORE] }));
  report.rereadFresh = await runCauseEffect(catalog.relist("antigravity", { quiet: true }));
  report.afterReread = listed();
  assert.ok(report.rereadFresh, "The reread gives a fresh list.");
  assert.deepEqual(report.afterReread, [RELEASED, ...BEFORE], "The reread lists the released model.");

  const setups = (await readJsonl<SetupLine>(log)).filter((line) => line.event === "setup");
  report.setups = setups.map(({ method, pid, sessionId, models }) => ({ method, pid, sessionId, models }));
  const opened = setups.filter((line) => line.method === "session/new");
  assert.ok(opened.length >= 2, "The reread opens a session in a new short-lived process.");
  const initialPid = opened[0]?.pid;
  const rereadSetup = opened.at(-1);
  assert.ok(rereadSetup && initialPid && rereadSetup.pid !== initialPid, "The reread uses a new process.");
  report.rereadUsedNewProcess = true;
  report.rereadProcessExited = await waitForExit(rereadSetup.pid);
  assert.ok(report.rereadProcessExited, "The short-lived reread process stops after reading models.");
  report.providerErrors = providerErrors.length;
  assert.equal(report.providerErrors, 0, "No read records a provider error.");

  await stopClients(clients);
  clients.length = 0;

  await writeFile(control, JSON.stringify({ models: BEFORE }));
  const profileDir = join(root, "profile");
  const homeDir = join(root, "home");
  await mkdir(profileDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  database = new OpenBotDatabase(profileDir);
  const store = new AgentStore(profileDir, homeDir, database);
  let statusEvents = 0;
  runtime = new ProviderRuntime({
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
      isProviderBusy: () => false,
      isAgentBusy: () => false,
      isProviderAssigned: () => false,
      onAgentClientLost: () => Effect.void,
      sharedRoot: () => join(root, "shared"),
      onProviderResumed: () => undefined,
      onProviderActivated: () => Effect.void,
      captureConfigRevision: () => 0,
    },
    emit: (event) => {
      if (event.type === "status") statusEvents += 1;
    },
    emitError: () => undefined,
    requestTimeoutMs: 10_000,
    onDemandModelRereadMs: 0,
    preferredProvider: "antigravity",
    clientFactory: null,
    bundledExecutables: { antigravity: executable },
    credentials: NO_PROVIDER_CREDENTIALS,
    redactMcp: (text) => text,
  });

  await runCauseEffect(runtime.start());
  assert.deepEqual(
    runtime
      .listModels()
      .filter((model) => model.provider === "antigravity")
      .map((model) => model.id),
    BEFORE,
  );

  const statusBeforeRunningReread = statusEvents;
  await writeFile(control, JSON.stringify({ models: [RELEASED, ...BEFORE] }));
  await runCauseEffect(runtime.rereadModels("antigravity"));
  report.runtimeRunningAfterReread = runtime
    .listModels()
    .filter((model) => model.provider === "antigravity")
    .map((model) => model.id);
  assert.deepEqual(report.runtimeRunningAfterReread, [RELEASED, ...BEFORE]);
  assert.ok(statusEvents > statusBeforeRunningReread, "Reread emits a status event when running models change.");

  const released = await runCauseEffect(runtime.releaseSharedProcess("antigravity"));
  assert.equal(released, false, "Idle unassigned Antigravity process releases cleanly.");
  assert.equal(runtime.currentClient("antigravity"), null);

  const statusBeforeReleasedReread = statusEvents;
  await writeFile(control, JSON.stringify({ models: [RELEASED_WHILE_IDLE, RELEASED, ...BEFORE] }));
  await runCauseEffect(runtime.rereadModels("antigravity"));
  report.runtimeReleasedAfterReread = runtime
    .listModels()
    .filter((model) => model.provider === "antigravity")
    .map((model) => model.id);
  report.runtimeClientRemainsReleased = runtime.currentClient("antigravity") === null;
  report.runtimeStatusEvents = statusEvents;
  assert.deepEqual(report.runtimeReleasedAfterReread, [RELEASED_WHILE_IDLE, RELEASED, ...BEFORE]);
  assert.ok(report.runtimeClientRemainsReleased, "Reread while released does not leave a long-lived CLI running.");
  assert.ok(statusEvents > statusBeforeReleasedReread, "Reread emits a status event when released models change.");

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (runtime) {
    const remaining = await runCauseEffect(runtime.dispose()).catch(() => []);
    await stopClients(remaining).catch(() => undefined);
  }
  await stopClients(clients).catch(() => undefined);
  database?.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
