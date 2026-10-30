// Runs the same cases against each provider driver that speaks ACP, over one fake agent
// (`provider-fakes/agents/conformance.ts`): start and list models, one turn, a model switch, a cancel
// and a turn after it, a resume in a new process, a missing session, and a sign-in that is necessary.
// A driver that skips a case fails here. The fake differs per driver only where the real CLIs differ.
// Codex, Claude, Pi, Inception, DeepSeek, OpenRouter and Muse speak other protocols and have no shared
// fake yet; the report names them in `notCovered`.
// `bun run test:provider-conformance`. Writes .openbot-build/provider-conformance-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { isMissingProviderSessionError } from "../src/backend/agent/thread-items";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeAccountReadResult, decodeModelListResponse } from "../src/backend/protocol";
import {
  NO_PROVIDER_CREDENTIALS,
  type ProviderClientContext,
  requireProviderDriver,
} from "../src/backend/provider-drivers";
import { CustomAgentStore } from "../src/main/custom-agent-store";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, xorCipher } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-conformance-e2e");
const NOT_COVERED = ["codex", "claude", "pi", "inception", "deepseek", "openrouter", "muse"] as const;

interface DriverCase {
  provider: AgentProviderId;
  /** The form of the missing-session error that this provider's CLI gives. */
  missing: "protocol" | "opencode" | "antigravity" | "cursor";
  /** Why the sign-in case does not apply, when it does not. */
  noSignIn?: string;
}

const DRIVERS: readonly DriverCase[] = [
  { provider: "opencode", missing: "opencode" },
  { provider: "antigravity", missing: "antigravity" },
  { provider: "cursor", missing: "cursor" },
  { provider: "cline", missing: "protocol" },
  { provider: "grok", missing: "protocol" },
  {
    provider: "acp",
    missing: "protocol",
    noSignIn: "Each custom agent signs in its own CLI. The provider is signed in while an agent is saved.",
  },
];

interface LogEntry {
  event: string;
  sessionId?: string;
  model?: string | null;
  text?: string;
  configId?: string;
  value?: string;
}

interface DriverResult {
  provider: AgentProviderId;
  models: string[];
  turn: { reply: string; status: string | null };
  switched: { model: string; agentModel: string | null; status: string | null };
  cancel: { status: string | null; cancelSent: boolean; next: string | null };
  resume: { restored: boolean; status: string | null };
  missingSession: boolean;
  signInRequired: boolean | string;
}

interface Report {
  passed: boolean;
  drivers: DriverResult[];
  notCovered: readonly string[];
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-provider-conformance-e2e-"));
const report: Report = { passed: false, drivers: [], notCovered: NOT_COVERED };
const clients: AgentClient[] = [];

/** Waits until the fake logs an entry that matches, or fails after `timeoutMs`. */
async function waitForEntry(log: string, match: (entry: LogEntry) => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await readJsonl<LogEntry>(log)).some(match)) {
    if (Date.now() > deadline) throw new Error("The fake agent did not log the expected request.");
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

/** One driver with one fake executable. A custom agent is saved with that executable as its command. */
async function driverSetup(
  driver: DriverCase,
  name: string,
  env: Readonly<Record<string, string>>,
): Promise<{ open: () => AgentClient; agentModel: (raw: string) => string }> {
  const executable = join(root, name, "bin", driver.provider);
  await installFakeAgent(executable, "conformance", env);
  const provider = requireProviderDriver(driver.provider);
  let context: ProviderClientContext = NO_PROVIDER_CREDENTIALS;
  let cli: AgentCliInfo = { executable, version: "99.0.0", source: "managed" };
  let agentModel = (raw: string) => raw;
  if (driver.provider === "acp") {
    const store = new CustomAgentStore({ path: join(root, name, "custom-agents.json"), cipher: xorCipher });
    await runCauseEffect(store.load());
    await runCauseEffect(
      store.save({ id: name, name, command: executable, args: ["acp"], env: [], usagePrompt: null }),
    );
    context = { ...NO_PROVIDER_CREDENTIALS, customAgents: () => store.configs() };
    cli = await runCauseEffect(provider.resolveCli());
    agentModel = (raw) => `${name}/${raw}`;
  }
  return {
    open: () => {
      const client = provider.createClient(cli, 20_000, context);
      clients.push(client);
      client.start();
      return client;
    },
    agentModel,
  };
}

async function conform(driver: DriverCase): Promise<DriverResult> {
  const name = `${driver.provider}-agent`;
  const log = join(root, `${driver.provider}.jsonl`);
  const workspace = join(root, "workspace");
  const setup = await driverSetup(driver, name, { FAKE_LOG: log, FAKE_MISSING: driver.missing });
  const label = driver.provider;

  // Start: the client lists the agent's models.
  let client = setup.open();
  const listed = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
  const models = listed.data.flatMap((model) => model.model ?? []);
  const alpha = setup.agentModel("fake-alpha");
  const beta = setup.agentModel("fake-beta");
  assert.ok(models.includes(alpha) && models.includes(beta), `${label}: model/list gives the agent's models.`);

  // One turn.
  const thread = await startThread(client, { cwd: workspace, model: alpha });
  const turn = await runTurn(client, thread, { model: alpha });
  assert.equal(turn.error, null, `${label}: the turn succeeds.`);
  assert.equal(turn.status, "completed", `${label}: the turn completes.`);
  assert.match(turn.reply, /ok fake-alpha/, `${label}: the reply reaches the client.`);

  // Model switch: the next prompt runs on the other model.
  const switchedTurn = await runTurn(client, thread, { model: beta });
  const prompts = (await readJsonl<LogEntry>(log)).filter((entry) => entry.event === "prompt");
  const switched = { model: beta, agentModel: prompts.at(-1)?.model ?? null, status: switchedTurn.status };
  assert.equal(switchedTurn.error, null, `${label}: the turn on the other model succeeds.`);
  assert.equal(switched.status, "completed", `${label}: the turn on the other model completes.`);
  assert.equal(switched.agentModel, "fake-beta", `${label}: the agent runs the selected model.`);

  // Cancel: the turn ends as interrupted, the agent gets `session/cancel`, and the next turn works.
  const waiting = runTurn(client, thread, { model: beta, text: "wait" });
  await waitForEntry(log, (entry) => entry.event === "prompt" && entry.text?.trim() === "wait");
  await runCauseEffect(client.request("turn/interrupt", { threadId: thread }, (value) => value));
  const cancelled = await waiting;
  // Antigravity ends the turn locally, so the agent can log the cancel after the turn ends.
  const cancelSent = await waitForEntry(log, (entry) => entry.event === "cancel").then(
    () => true,
    () => false,
  );
  const next = await runTurn(client, thread, { model: beta });
  const cancel = { status: cancelled.status, cancelSent, next: next.status };
  assert.equal(cancel.status, "interrupted", `${label}: a cancelled turn ends as interrupted.`);
  assert.equal(cancel.cancelSent, true, `${label}: the agent gets session/cancel.`);
  assert.equal(cancel.next, "completed", `${label}: a turn after the cancel completes.`);

  // Resume: a new process opens the same session again and runs a turn on it.
  await runCauseEffect(client.stop());
  client = setup.open();
  await runCauseEffect(client.request("thread/resume", { threadId: thread, cwd: workspace, model: beta }, (v) => v));
  const restoredTurn = await runTurn(client, thread, { model: beta });
  const sessionId = thread.split(":").at(-1);
  const resume = {
    restored: (await readJsonl<LogEntry>(log)).some(
      (entry) => (entry.event === "session/load" || entry.event === "session/resume") && entry.sessionId === sessionId,
    ),
    status: restoredTurn.status,
  };
  assert.equal(resume.restored, true, `${label}: the new process restores the session.`);
  assert.equal(resume.status, "completed", `${label}: a turn on the restored session completes.`);

  // Missing session: the agent's own error for a session it does not have is a missing session, so
  // the agent gets a new session with its transcript.
  const gone = thread.replace(/[^:]+$/u, "gone-1");
  const missingSession = await runCauseEffect(
    client.request("thread/resume", { threadId: gone, cwd: workspace, model: beta }, (v) => v),
  ).then(
    () => false,
    (error: unknown) => isMissingProviderSessionError(error, driver.provider),
  );
  assert.equal(missingSession, true, `${label}: the agent's missing-session error is a missing session.`);

  // Sign-in: a started agent that gives sessions has an account. An agent that refuses each session
  // before its sign-in has none. `account/read` does not start the agent, so `initialize` comes first.
  let signInRequired: boolean | string = driver.noSignIn ?? false;
  if (!driver.noSignIn) {
    const signedIn = await runCauseEffect(client.request("account/read", {}, decodeAccountReadResult));
    assert.notEqual(signedIn.account, null, `${label}: a signed-in agent has an account.`);
    const signedOut = (await driverSetup(driver, `${name}-signed-out`, { FAKE_SIGNED_OUT: "1" })).open();
    await runCauseEffect(signedOut.request("initialize", {}, (value) => value));
    const account = await runCauseEffect(signedOut.request("account/read", {}, decodeAccountReadResult));
    signInRequired = account.account === null;
    assert.equal(signInRequired, true, `${label}: a signed-out agent has no account.`);
  }

  return {
    provider: driver.provider,
    models,
    turn: { reply: turn.reply, status: turn.status },
    switched,
    cancel,
    resume,
    missingSession,
    signInRequired,
  };
}

try {
  // A new provider must get a case here, or a reason in `NOT_COVERED`.
  const listed: readonly string[] = [...DRIVERS.map((driver) => driver.provider), ...NOT_COVERED];
  assert.deepEqual(
    [...listed].sort(),
    [...AGENT_PROVIDERS].sort(),
    "Each provider is a conformance case or is in NOT_COVERED, once.",
  );
  await mkdir(join(root, "workspace"));
  for (const driver of DRIVERS) {
    report.drivers.push(await conform(driver));
    await stopClients(clients.splice(0));
  }
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
