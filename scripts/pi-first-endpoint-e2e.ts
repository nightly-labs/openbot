import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentProviderState, CustomProviderRestart } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { createCustomProviderChanges } from "../src/main/custom-provider-changes";
import { CustomProviderStore } from "../src/main/custom-provider-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-first-endpoint-e2e");
const WAIT_MS = 15_000;

const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  process.stdout.write("1.2.0\\n");
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify({ pid: process.pid }) + "\\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (data) => send({ type: "response", id: message.id, command: message.type, success: true, data });
  if (message.type === "get_available_models")
    return reply({
      models: fs.existsSync(process.env.FAKE_PI_ENDPOINTS) ? [{ provider: "lab", id: "lab-model", name: "Lab Model" }] : [],
    });
  reply({});
});
`;

interface Report {
  passed: boolean;
  atStart?: { state: AgentProviderState | undefined; spawns: number };
  offHarness?: { restart: CustomProviderRestart; spawns: number };
  afterSave?: {
    restart: CustomProviderRestart;
    states: (AgentProviderState | undefined)[];
    spawns: number;
    committedRevision: number;
    activatedRevision: number;
    piModels: string[];
  };
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-first-endpoint-e2e-"));
const agentDirectory = join(root, "pi-agent");
const endpointsPath = join(root, "custom-providers.json");
const log = join(root, "pi.jsonl");
const executable = join(root, "bin", "pi");
const report: Report = { passed: false };
const saved = {
  OPENBOT_PI_PATH: process.env.OPENBOT_PI_PATH,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  FAKE_PI_LOG: process.env.FAKE_PI_LOG,
  FAKE_PI_ENDPOINTS: process.env.FAKE_PI_ENDPOINTS,
};
process.env.OPENBOT_PI_PATH = executable;
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.FAKE_PI_LOG = log;
process.env.FAKE_PI_ENDPOINTS = endpointsPath;

async function spawns(): Promise<number> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).length;
}

let committedRevision = 0;
let resolveActivation: (revision: number) => void = () => {};
const activation = new Promise<number>((resolveWait) => {
  resolveActivation = resolveWait;
});
const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
const piStates: (AgentProviderState | undefined)[] = [];
let onStatus = () => {};
const providers = new ProviderRuntime({
  offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "pi"),
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
    isProviderAssigned: () => true,
    onAgentClientLost: () => Effect.void,
    sharedRoot: () => join(root, "shared"),
    onProviderResumed: () => undefined,
    onProviderActivated: (provider, configRevision) =>
      Effect.sync(() => {
        if (provider === "pi") resolveActivation(configRevision);
      }),
    captureConfigRevision: () => committedRevision,
  },
  emit: (event) => {
    if (event.type !== "status") return;
    const state = event.status.providers?.find((row) => row.id === "pi")?.state;
    if (piStates.at(-1) !== state) piStates.push(state);
    onStatus();
  },
  emitError: () => undefined,
  requestTimeoutMs: 5_000,
  preferredProvider: "pi",
  clientFactory: null,
  bundledExecutables: {},
  credentials: NO_PROVIDER_CREDENTIALS,
  redactMcp: (text) => text,
});

const customProviders = new CustomProviderStore({
  path: endpointsPath,
  cipher: {
    encrypt: (value: string) => Buffer.from(Buffer.from(value, "utf8").toString("hex"), "utf8"),
    decrypt: (value: Buffer) => Buffer.from(value.toString("utf8"), "hex").toString("utf8"),
    canPersist: () => true,
  },
});
const changes = createCustomProviderChanges({
  service: {
    saveCustomProvider: (_id, _harness, persist) =>
      persist().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            committedRevision += 1;
          }),
        ),
      ),
    updateCustomProvider: (_id, _harness, _removed, persist) => persist(),
    removeCustomProvider: (_id, persist) => persist(),
    reloadCustomProviderConfig: (harness) => providers.reloadCustomProviderConfig(harness),
    startHarnessForMovedAgents: () => Effect.void,
  },
  customProviders,
  providerRuntimes: { startCustomProviderHarness: () => Effect.void },
});

const piState = () => providers.status().providers?.find((row) => row.id === "pi")?.state;

function waitForPiStates(from: number, states: readonly AgentProviderState[]): Promise<void> {
  const reached = () => {
    let next = 0;
    for (const state of piStates.slice(from)) if (state === states[next]) next += 1;
    return next >= states.length;
  };
  return new Promise((resolveWait, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for Pi to go through ${states.join(", ")}.`)),
      WAIT_MS,
    );
    onStatus = () => {
      if (!reached()) return;
      clearTimeout(timer);
      resolveWait();
    };
    onStatus();
  });
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), WAIT_MS)),
  ]);
}

try {
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(executable, FAKE_PI);
  await chmod(executable, 0o755);

  await runCauseEffect(providers.start());
  report.atStart = { state: piState(), spawns: await spawns() };
  assert.equal(report.atStart.state, "sign-in-required");

  const offRestart = await runCauseEffect(providers.reloadCustomProviderConfig("opencode"));
  report.offHarness = { restart: offRestart, spawns: await spawns() };
  assert.equal(offRestart, "not-running", "a harness that is turned off does not start");
  assert.equal(report.offHarness.spawns, report.atStart.spawns);

  const from = piStates.length;
  const result = await runCauseEffect(
    changes.save({
      id: "lab",
      name: "Lab",
      baseUrl: "http://127.0.0.1:9/v1",
      apiKey: null,
      models: [{ id: "lab-model", name: "Lab Model" }],
      headers: [],
      harness: "pi",
    }),
  );
  assert.ok(existsSync(endpointsPath), "the endpoint was saved");
  assert.equal(result.restart, "restarted", "the save starts the signed-out Pi");
  await waitForPiStates(from, ["checking", "available"]);
  const activatedRevision = await withTimeout(activation, "Pi did not activate after the save.");
  const piModels = providers
    .listModels()
    .filter((model) => model.provider === "pi")
    .map((model) => model.id);
  report.afterSave = {
    restart: result.restart,
    states: piStates.slice(from),
    spawns: await spawns(),
    committedRevision,
    activatedRevision,
    piModels,
  };
  assert.ok(activatedRevision >= committedRevision, "the new Pi client has the saved endpoint list");
  assert.ok(
    piModels.some((id) => id.includes("lab-model")),
    "Pi lists the model of the first endpoint",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  for (const client of await runCauseEffect(providers.dispose())) await runCauseEffect(client.stop());
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
