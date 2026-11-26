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
const FALLBACK = "grok-4.6";

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
  account: string | null;
  models: string[];
}

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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
  oneStartWithoutModel?: { setups: string[][]; model: string | undefined };
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
const setups = async () =>
  (await readJsonl<SetupLine>(logPath)).filter((line) => line.event === "setup" && line.account === null);
const grokModels = () =>
  agents
    .listModels()
    .filter((model) => model.provider === "grok")
    .map((model) => model.id);
const setAccount = async (agentId: string, providerAccountId: string | null) =>
  (await runCauseEffect(agents.updateAgent({ agentId, providerAccountId }))).model;

async function restartGrok(partial: number, markLists = false): Promise<Set<number>> {
  const before = new Set((await setups()).map((line) => line.pid));
  writeFileSync(controlPath, JSON.stringify({ partial, markLists }));
  await runCauseEffect(agents.restartProvider("grok"));
  await waitFor("the restart to end", async () => {
    const row = agents.getStatus().providers?.find((provider) => provider.id === "grok");
    return row !== undefined && !row.restartPending;
  });
  return before;
}

async function listsAfter(label: string, before: Set<number>, done: (lines: SetupLine[]) => boolean) {
  const lines = await waitFor(label, async () => {
    const fresh = (await setups()).filter((line) => !before.has(line.pid));
    return fresh.length > 0 && done(fresh) ? fresh : null;
  });
  return lines.map((line) => line.models);
}

const hasModel = (lines: SetupLine[]) => lines.some((line) => line.models.includes(MODEL));
const listMark = () => agents.listModels().find((model) => model.id.startsWith("grok-list-"))?.id;

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

  const late = await restartGrok(2);
  const lateLists = await listsAfter(
    "a list with the model",
    late,
    (fresh) => modelOf(agent.id) !== MODEL || hasModel(fresh),
  );
  report.restartWithLateList = { setups: lateLists, model: modelOf(agent.id) };
  assert.equal(report.restartWithLateList.model, MODEL, "A list that lacks the model only for a moment keeps it.");

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

  const once = await restartGrok(Number.MAX_SAFE_INTEGER, true);
  const startMark = await waitFor("the first list of the start", async () => listMark());
  await waitFor("OpenBot to read the list again", async () => {
    const mark = listMark();
    return mark !== undefined && mark !== startMark;
  });
  const onceLists = (await setups()).filter((line) => !once.has(line.pid)).map((line) => line.models);
  const gone = await restartGrok(Number.MAX_SAFE_INTEGER);
  report.oneStartWithoutModel = { setups: onceLists, model: modelOf(agent.id) };
  assert.equal(report.oneStartWithoutModel.model, MODEL, "One start whose lists all lack the model keeps it.");
  const goneLists = await listsAfter("the agent to move", gone, () => modelOf(agent.id) !== MODEL);
  report.restartWithoutModel = { setups: goneLists, model: modelOf(agent.id) };
  assert.equal(report.restartWithoutModel.model, FALLBACK, "A model that two starts lack still moves.");
  assert.ok(report.restartWithoutModel.setups.length >= 2, "The agent moves only after Grok is asked again.");

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

  assert.equal(await setAccount(agent.id, secondAccount.id), MODEL, "The second account serves the model.");
  const shortOnly = await restartGrok(Number.MAX_SAFE_INTEGER);
  const listedWithout = grokModels();
  assert.ok(!listedWithout.includes(MODEL), "The first account's list lacks the model.");
  const movedWithout = await setAccount(agent.id, null);
  await listsAfter("two short lists after the account move", shortOnly, (fresh) => fresh.length >= 2);
  const shortAgain = await restartGrok(Number.MAX_SAFE_INTEGER);
  const withoutLists = await listsAfter(
    "the agent to move after the account move",
    shortAgain,
    () => modelOf(agent.id) !== MODEL,
  );
  report.accountMoveWithoutModel = {
    listed: listedWithout,
    movedTo: movedWithout,
    setups: withoutLists,
    model: modelOf(agent.id),
  };
  assert.equal(movedWithout, MODEL, "An account move during the wait keeps the model.");
  assert.equal(
    report.accountMoveWithoutModel.model,
    FALLBACK,
    "A model that the first account lacks still moves at a later start.",
  );
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
