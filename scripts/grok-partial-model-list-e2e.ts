// Checks that a Grok agent keeps its model when Grok lists only part of its models as it starts.
// Grok 1.0.70 starts on its two built-in models while it renews an expired sign-in, and has its whole
// catalogue about a second later. A `model/list` in between used to move every agent on a newer model
// to Grok's default, and the agent stayed there after the list was whole again.
// Runs the real agent service on a temporary profile with a fake Grok
// (`provider-fakes/agents/grok-partial-list.ts`). Checks:
//   1. After a restart whose first lists lack the agent's model and whose next list has it, the agent
//      keeps its model.
//   2. A restart while the earlier process's activation still waits: the earlier activation does not
//      move the agent on the new process's first lists, and the agent keeps its model.
//   3. Control: after a restart whose lists all lack the model, the agent moves to the first built-in model.
//   4. An agent on a second account whose own list has the model moves back to the first account while
//      a restart's activation waits on short lists: it keeps its model, and keeps it after the full list.
//   5. Control: the same move while every list of the first account lacks the model. The agent moves to
//      the first built-in model after Grok is asked again.
// `bun run test:grok-partial-model-list`. Writes .openbot-build/grok-partial-model-list-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-partial-model-list-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-grok-partial-list-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeGrok = join(root, "grok");
const logPath = join(root, "grok.jsonl");
const controlPath = join(root, "control.json");
const accountsRoot = join(root, "provider-accounts");
const MODEL = "grok-4.7";
// The short list lacks the Grok default (`grok-4.7`), so an agent moves to its first model.
const FALLBACK = "grok-4.6";

// Before the service modules load: the stores and the CLI search read these.
process.env.HOME = home;
process.env.OPENBOT_GROK_PATH = fakeGrok;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ProviderAccountStore } = await import("../src/backend/agent/provider-account-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface SetupLine {
  event: string;
  pid: number;
  setup: number;
  /** The account folder of a process of the second account, else null. */
  account: string | null;
  models: string[];
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

/** Waits for a state of the service or of the fake Grok. */
async function waitFor<T>(label: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const report: {
  passed: boolean;
  restartWithLateList?: { setups: string[][]; model: string | undefined };
  restartDuringWait?: { setups: string[][]; model: string | undefined };
  restartWithoutModel?: { setups: string[][]; model: string | undefined };
  accountMoveDuringWait?: { listed: string[]; movedTo: string; setups: string[][]; model: string | undefined };
  accountMoveWithoutModel?: { listed: string[]; movedTo: string; setups: string[][]; model: string | undefined };
  error?: string;
} = { passed: false };

writeFileSync(controlPath, JSON.stringify({ partial: 0 }));
await installFakeAgent(fakeGrok, "grok-partial-list", {
  FAKE_LOG: logPath,
  FAKE_CONTROL: controlPath,
  FAKE_ACCOUNTS: accountsRoot,
});
const accounts = new ProviderAccountStore(join(userData, "openbot-provider-accounts-v1.json"), accountsRoot);
await runCauseEffect(accounts.load());
const secondAccount = await runCauseEffect(accounts.create("grok"));
assert.ok(secondAccount, "The second Grok account was not created.");
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  providerAccounts: accounts,
  preferredProvider: "grok",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "grok"),
});

const modelOf = (agentId: string) => store.list().find((agent) => agent.id === agentId)?.model;
const idle = (agentId: string) =>
  !agents.listQueue(agentId).deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
/** The setups of the first account's processes. A check of the second account starts processes of its own. */
const setups = async () =>
  (await readJsonl<SetupLine>(logPath)).filter((line) => line.event === "setup" && line.account === null);
const grokModels = () =>
  agents
    .listModels()
    .filter((model) => model.provider === "grok")
    .map((model) => model.id);
const setAccount = async (agentId: string, providerAccountId: string | null) =>
  (await runCauseEffect(agents.updateAgent({ agentId, providerAccountId }))).model;

/**
 * Restarts Grok with `partial` short lists, and answers the pids that ran before the restart. It
 * returns when the restart is done: a restart while one is still pending does nothing.
 */
async function restartGrok(partial: number): Promise<Set<number>> {
  const before = new Set((await setups()).map((line) => line.pid));
  writeFileSync(controlPath, JSON.stringify({ partial }));
  await runCauseEffect(agents.restartProvider("grok"));
  await waitFor("the restart to end", async () => {
    const row = agents.getStatus().providers?.find((provider) => provider.id === "grok");
    return row !== undefined && !row.restartPending;
  });
  return before;
}

/** The lists of the processes that started after `before`, once `done` holds for them. */
async function listsAfter(label: string, before: Set<number>, done: (lines: SetupLine[]) => boolean) {
  const lines = await waitFor(label, async () => {
    const fresh = (await setups()).filter((line) => !before.has(line.pid));
    return fresh.length > 0 && done(fresh) ? fresh : null;
  });
  return lines.map((line) => line.models);
}

const hasModel = (lines: SetupLine[]) => lines.some((line) => line.models.includes(MODEL));

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Grok partial list",
      description: "Checks the model of a Grok agent when Grok lists part of its models.",
      avatarSeed: "grok-partial-list",
      avatarHue: null,
      initialMessage: "Hello.",
      provider: "grok",
      model: MODEL,
    }),
  );
  await waitFor("the first turn to end", async () => idle(agent.id));
  assert.equal(modelOf(agent.id), MODEL, "The agent starts on the model it was created with.");

  // 1. The first two lists lack the model, as a Grok that renews its sign-in gives them, and the next
  // one has it. The agent keeps its model.
  const late = await restartGrok(2);
  const lateLists = await listsAfter(
    "a list with the model",
    late,
    (fresh) => modelOf(agent.id) !== MODEL || hasModel(fresh),
  );
  report.restartWithLateList = { setups: lateLists, model: modelOf(agent.id) };
  assert.equal(report.restartWithLateList.model, MODEL, "A list that lacks the model only for a moment keeps it.");

  // 2. Every list of one process lacks the model, and that process is replaced while its activation
  // waits. The new process lists three short lists before the full one, so the earlier activation
  // reads a short list from it when it wakes.
  const first = await restartGrok(Number.MAX_SAFE_INTEGER);
  await listsAfter("two short lists", first, (fresh) => fresh.length >= 2);
  const second = await restartGrok(3);
  const secondLists = await listsAfter(
    "a list with the model after the second restart",
    second,
    (fresh) => modelOf(agent.id) !== MODEL || hasModel(fresh),
  );
  report.restartDuringWait = { setups: secondLists, model: modelOf(agent.id) };
  assert.equal(report.restartDuringWait.model, MODEL, "A replaced process's activation does not move the agent.");

  // 3. Control: every list lacks the model. The agent moves to the first built-in model, after a second list.
  const gone = await restartGrok(Number.MAX_SAFE_INTEGER);
  const goneLists = await listsAfter("the agent to move", gone, () => modelOf(agent.id) !== MODEL);
  report.restartWithoutModel = { setups: goneLists, model: modelOf(agent.id) };
  assert.equal(report.restartWithoutModel.model, FALLBACK, "A model that every list lacks still moves.");
  assert.ok(report.restartWithoutModel.setups.length >= 3, "The agent moves only after Grok is asked again.");

  // 4. The agent runs on the second account, whose own list has the model. While a restart's
  // activation waits on the first account's short lists, it moves back to the first account.
  const whole = await restartGrok(0);
  await listsAfter("a full list", whole, hasModel);
  await runCauseEffect(agents.updateAgent({ agentId: agent.id, model: MODEL }));
  await waitFor("the second account to connect", async () =>
    agents
      .getStatus()
      .providers?.find((row) => row.id === "grok")
      ?.accounts?.some((account) => account.id === secondAccount.id && account.state === "connected"),
  );
  assert.equal(await setAccount(agent.id, secondAccount.id), MODEL, "The second account serves the model.");
  const shortStart = await restartGrok(2);
  const listedDuringWait = grokModels();
  assert.ok(!listedDuringWait.includes(MODEL), "The first account's list lacks the model during the wait.");
  const movedTo = await setAccount(agent.id, null);
  const accountLists = await listsAfter(
    "a list with the model after the account move",
    shortStart,
    (fresh) => modelOf(agent.id) !== MODEL || hasModel(fresh),
  );
  report.accountMoveDuringWait = {
    listed: listedDuringWait,
    movedTo,
    setups: accountLists,
    model: modelOf(agent.id),
  };
  assert.equal(movedTo, MODEL, "An account move during the wait keeps the model.");
  assert.equal(report.accountMoveDuringWait.model, MODEL, "The agent keeps its model after the full list.");

  // 5. Control: the same move while every list of the first account lacks the model.
  assert.equal(await setAccount(agent.id, secondAccount.id), MODEL, "The second account serves the model.");
  const shortOnly = await restartGrok(Number.MAX_SAFE_INTEGER);
  const listedWithout = grokModels();
  assert.ok(!listedWithout.includes(MODEL), "The first account's list lacks the model.");
  const movedWithout = await setAccount(agent.id, null);
  const withoutLists = await listsAfter(
    "the agent to move after the account move",
    shortOnly,
    () => modelOf(agent.id) !== MODEL,
  );
  report.accountMoveWithoutModel = {
    listed: listedWithout,
    movedTo: movedWithout,
    setups: withoutLists,
    model: modelOf(agent.id),
  };
  assert.equal(report.accountMoveWithoutModel.model, FALLBACK, "A model that the first account lacks still moves.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
