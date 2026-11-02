// Starts Pi signed out on the real driver and `ProviderRuntime`, with a fake `pi` that lists models
// only while its `auth.json` holds a credential. Then writes that file in two steps, an empty object
// and then a credential, and checks that the Pi row is checked after each write and becomes
// available with no restart and no user action (#2895).
// `bun scripts/pi-sign-in-watch-e2e.ts`. Writes .openbot-build/pi-sign-in-watch-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentProviderState } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-sign-in-watch-e2e");
const WAIT_MS = 15_000;

const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
if (process.argv.includes("--version")) {
  process.stdout.write("1.2.0\\n");
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + "\\n");
function signedIn() {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "auth.json"), "utf8"))).length > 0;
  } catch {
    return false;
  }
}
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const reply = (data) => send({ type: "response", id: message.id, command: message.type, success: true, data });
  if (message.type === "get_available_models")
    return reply({ models: signedIn() ? [{ provider: "openai", id: "gpt-fake", name: "GPT Fake" }] : [] });
  reply({});
});
`;

interface Report {
  passed: boolean;
  atStart?: { state: AgentProviderState | undefined; spawns: number };
  afterEmptyFile?: { states: (AgentProviderState | undefined)[]; spawns: number };
  afterSignIn?: { states: (AgentProviderState | undefined)[]; spawns: number; phase: string };
  error?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-pi-sign-in-watch-e2e-"));
const agentDirectory = join(root, "pi-agent");
const log = join(root, "pi.jsonl");
const executable = join(root, "bin", "pi");
const report: Report = { passed: false };
const saved = {
  OPENBOT_PI_PATH: process.env.OPENBOT_PI_PATH,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  FAKE_PI_LOG: process.env.FAKE_PI_LOG,
};
process.env.OPENBOT_PI_PATH = executable;
process.env.PI_CODING_AGENT_DIR = agentDirectory;
process.env.FAKE_PI_LOG = log;

async function spawns(): Promise<number> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).length;
}

const store = new AgentStore(join(root, "profile"), join(root, "home"), new OpenBotDatabase(join(root, "profile")));
/** The Pi row state of each status event that changed it, in order. */
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
    onProviderActivated: () => Effect.void,
    captureConfigRevision: () => 0,
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

const piState = () => providers.status().providers?.find((row) => row.id === "pi")?.state;

/** Resolves when the Pi row has gone through `states` in order, counting from `from` in `piStates`. */
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

try {
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(executable, FAKE_PI);
  await chmod(executable, 0o755);

  // 1. No sign-in file: Pi starts signed out and keeps no client.
  await runCauseEffect(providers.start());
  report.atStart = { state: piState(), spawns: await spawns() };
  assert.equal(report.atStart.state, "sign-in-required");

  // 2. Pi creates the file empty before the credential. The host checks again and finds no account.
  let from = piStates.length;
  await writeFile(join(agentDirectory, "auth.json"), "{}");
  await waitForPiStates(from, ["checking", "sign-in-required"]);
  report.afterEmptyFile = { states: piStates.slice(from), spawns: await spawns() };
  assert.ok(report.afterEmptyFile.spawns > report.atStart.spawns, "Pi was asked for its models again");

  // 3. The credential lands. The host checks again, with no restart and no user action.
  from = piStates.length;
  await writeFile(join(agentDirectory, "auth.json"), JSON.stringify({ openai: { type: "oauth" } }));
  await waitForPiStates(from, ["checking", "available"]);
  report.afterSignIn = { states: piStates.slice(from), spawns: await spawns(), phase: providers.status().phase };
  assert.equal(piState(), "available");
  assert.ok(report.afterSignIn.spawns > report.afterEmptyFile.spawns, "Pi was asked for its models again");
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
