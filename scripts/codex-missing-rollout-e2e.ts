import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-missing-rollout-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-codex-rollout-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
const defaultHome = join(home, ".codex");

process.env.HOME = home;
process.env.CODEX_HOME = defaultHome;
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(defaultHome, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ProviderAccountStore } = await import("../src/backend/agent/provider-account-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.163.0\\n");
  process.exit(0);
}
const codexHome = process.env.CODEX_HOME;
const rolloutsPath = path.join(codexHome, "fake-rollouts.json");
const rollouts = () => { try { return JSON.parse(fs.readFileSync(rolloutsPath, "utf8")); } catch { return []; } };
const hasRollout = (threadId) => rollouts().some((turn) => turn.threadId === threadId);
const control = () => { try { return JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8")); } catch { return {}; } };
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({ pid: process.pid, codexHome, ...entry }) + "\\n");
log({ start: true });
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const loaded = new Set();
const started = new Set();
let buffer = "";
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": {
      const id = "thread-" + process.pid + "-" + (++threads);
      loaded.add(id);
      return write({ id: message.id, result: { thread: { id, turns: [] } } });
    }
    case "thread/resume":
      if (!loaded.has(params.threadId) && !hasRollout(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "no rollout found for thread id " + params.threadId } });
      loaded.add(params.threadId);
      return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "unsubscribed" } });
    case "thread/turns/list":
      if (started.has(params.threadId) && !hasRollout(params.threadId))
        return write({ id: message.id, error: { code: -32601, message: "paginated_threads is not supported yet" } });
      if (!loaded.has(params.threadId) && !hasRollout(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "thread not loaded: " + params.threadId } });
      return write({ id: message.id, result: {
        data: rollouts().filter((turn) => turn.threadId === params.threadId).reverse().map((turn) => ({ id: turn.turnId, status: "completed" })),
        nextCursor: null,
      } });
    case "thread/items/list": {
      const item = { type: "agentMessage", id: "message-" + params.turnId, text: "Done.", phase: "final_answer" };
      return write({ id: message.id, result: { data: [{ turnId: params.turnId, item }], nextCursor: null } });
    }
    case "turn/start": {
      if (control().refuseTurns) return write({ id: message.id, error: { code: -32603, message: "Fake turn refusal." } });
      if (!loaded.has(params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "thread not found: " + params.threadId } });
      const turnId = "turn-" + process.pid + "-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      started.add(params.threadId);
      const complete = () => {
        if (control().holdTurns) return setTimeout(complete, 25);
        fs.writeFileSync(rolloutsPath, JSON.stringify([...rollouts(), { threadId: params.threadId, turnId }]));
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      };
      setTimeout(complete, 50);
      return;
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      log({ method: message.method ?? null, threadId: (message.params || {}).threadId ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ProtocolLine {
  pid: number;
  codexHome: string;
  start?: boolean;
  method?: string | null;
  threadId?: string | null;
}

interface Report {
  passed: boolean;
  threads?: { refused: string; account: string; complete: string };
  accountHomeUsedForAccountTurn?: boolean;
  firstStart?: { refusedReads: number; accountReadsOnSharedProcess: number; completeReads: number };
  providerRestart?: { refusedReads: number; accountReadsOnSharedProcess: number; completeReads: number };
  backfillErrors?: { agent: string; message: string }[];
  refusedNextTurn?: { resumeRefused: boolean; newThread: string | null; turnStarted: boolean; errors: string[] };
  startingSession?: { read: boolean; errors: string[]; importedAfterTurn?: boolean };
  error?: string;
}

const report: Report = { passed: false };
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

function protocol(): ProtocolLine[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): ProtocolLine => JSON.parse(line));
  } catch {
    return [];
  }
}

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const accountsPath = join(userData, "openbot-provider-accounts-v1.json");
const accountsRoot = join(userData, "provider-accounts");

async function startApp() {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const providerAccounts = new ProviderAccountStore(accountsPath, accountsRoot);
  await runCauseEffect(providerAccounts.load());
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    providerAccounts,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  });
  const errors: { agentId: string; code: string; message: string }[] = [];
  agents.on("event", (event) => {
    if (event.type === "error" && event.agentId)
      errors.push({ agentId: event.agentId, code: event.code ?? "", message: event.message });
  });
  return { database, store, agents, providerAccounts, errors };
}

function importedSince(agentId: string, since: string): boolean {
  const session = app.store.activeProviderSession(agentId);
  const imported = session ? app.store.database.providerHistoryImport(session.id) : null;
  return imported?.state === "complete" && imported.updatedAt > since;
}

const idle = (app: Awaited<ReturnType<typeof startApp>>, agentId: string) =>
  !app.agents
    .listQueue(agentId)
    .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));

let app = await startApp();
try {
  await runCauseEffect(app.agents.initialize());
  await waitFor("Codex to be ready", () => app.agents.getStatus().phase === "ready");
  const account = await runCauseEffect(app.providerAccounts.create("codex"));
  if (!account) throw new Error("The provider account was not created.");
  const accountHome = app.providerAccounts.home(account);

  const complete = await runCauseEffect(
    app.agents.createAgent({
      name: "Complete",
      description: "Has a session with a saved rollout.",
      avatarSeed: "complete",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const completeThread = await waitFor("the complete turn to end", () => {
    const session = app.store.activeProviderSession(complete.id)?.externalSessionId;
    return session && idle(app, complete.id) ? session : null;
  });

  const onAccount = await runCauseEffect(
    app.agents.createAgent(
      {
        name: "On account",
        description: "Runs on the second Codex account.",
        avatarSeed: "on-account",
        avatarHue: null,
        initialMessage: "First message.",
      },
      (agent) => app.agents.updateAgent({ agentId: agent.id, providerAccountId: account.id }),
    ),
  );
  const accountThread = await waitFor("the account turn to end", () => {
    const session = app.store.activeProviderSession(onAccount.id)?.externalSessionId;
    return session && idle(app, onAccount.id) ? session : null;
  });
  report.accountHomeUsedForAccountTurn = protocol().some(
    (line) => line.method === "turn/start" && line.threadId === accountThread && line.codexHome === accountHome,
  );

  writeFileSync(controlPath, JSON.stringify({ refuseTurns: true }));
  const refused = await runCauseEffect(
    app.agents.createAgent({
      name: "Refused",
      description: "Has a session whose first turn Codex refused.",
      avatarSeed: "refused",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  const refusedThread = await waitFor("the refused turn", () => {
    const session = app.store.activeProviderSession(refused.id)?.externalSessionId;
    const asked = protocol().some((line) => line.method === "turn/start" && line.threadId === session);
    return session && asked && idle(app, refused.id) ? session : null;
  });
  writeFileSync(controlPath, JSON.stringify({}));
  report.threads = { refused: refusedThread, account: accountThread, complete: completeThread };

  await runCauseEffect(app.agents.stop());
  app.database.close();
  const linesBefore = protocol().length;
  const startedAt = new Date().toISOString();
  app = await startApp();
  await runCauseEffect(app.agents.initialize());
  const reads = (pid: number) => {
    const lines = protocol()
      .slice(linesBefore)
      .filter((line) => line.pid === pid && line.method === "thread/turns/list");
    return {
      refusedReads: lines.filter((line) => line.threadId === refusedThread).length,
      accountReadsOnSharedProcess: lines.filter((line) => line.threadId === accountThread).length,
      completeReads: lines.filter((line) => line.threadId === completeThread).length,
    };
  };
  const shared = await waitFor("the shared Codex process", () =>
    protocol()
      .slice(linesBefore)
      .find((line) => line.start && line.codexHome === defaultHome),
  );
  await waitFor("the backfill at the first start", () => importedSince(complete.id, startedAt));
  report.firstStart = reads(shared.pid);

  const restartedAt = new Date().toISOString();
  process.kill(shared.pid, "SIGTERM");
  const restarted = await waitFor("Codex to start again", () =>
    protocol()
      .slice(linesBefore)
      .find((line) => line.start && line.codexHome === defaultHome && line.pid !== shared.pid),
  );
  await waitFor("the backfill after the restart", () => importedSince(complete.id, restartedAt));
  report.providerRestart = reads(restarted.pid);
  report.backfillErrors = app.errors
    .filter((error) => error.code === "provider_history_backfill_pending")
    .map((error) => ({ agent: error.agentId, message: error.message }));

  const linesBeforeTurn = protocol().length;
  await runCauseEffect(app.agents.sendMessage({ agentId: refused.id, text: "Second message." }));
  await waitFor("the next turn of the refused agent to end", () => {
    const after = protocol().slice(linesBeforeTurn);
    return after.some((line) => line.method === "turn/start") && idle(app, refused.id);
  });
  const newThread = app.store.activeProviderSession(refused.id)?.externalSessionId ?? null;
  const afterTurn = protocol().slice(linesBeforeTurn);
  report.refusedNextTurn = {
    resumeRefused: afterTurn.some((line) => line.method === "thread/resume" && line.threadId === refusedThread),
    newThread,
    turnStarted: afterTurn.some((line) => line.method === "turn/start" && line.threadId === newThread),
    errors: app.errors.filter((error) => error.agentId === refused.id).map((error) => error.code),
  };

  writeFileSync(controlPath, JSON.stringify({ holdTurns: true }));
  const starting = await runCauseEffect(
    app.agents.createAgent(
      {
        name: "Starting",
        description: "Has a session whose first turn is not saved yet.",
        avatarSeed: "starting",
        avatarHue: null,
        initialMessage: "First message.",
      },
      (agent) => app.agents.updateAgent({ agentId: agent.id, providerAccountId: account.id }),
    ),
  );
  const startingThread = await waitFor("the first turn of the new session", () => {
    const session = app.store.activeProviderSession(starting.id)?.externalSessionId;
    const asked = protocol().some((line) => line.method === "turn/start" && line.threadId === session);
    return session && asked ? session : null;
  });
  const secondRestartAt = new Date().toISOString();
  process.kill(restarted.pid, "SIGTERM");
  await waitFor("Codex to start again", () =>
    protocol().find(
      (line) => line.start && line.codexHome === defaultHome && line.pid !== shared.pid && line.pid !== restarted.pid,
    ),
  );
  await waitFor("the backfill during the first turn", () => importedSince(complete.id, secondRestartAt));
  report.startingSession = {
    read: protocol().some((line) => line.method === "thread/turns/list" && line.threadId === startingThread),
    errors: app.errors
      .filter((error) => error.agentId === starting.id && error.code === "provider_history_backfill_pending")
      .map((error) => error.message),
  };
  writeFileSync(controlPath, JSON.stringify({}));
  await waitFor("the first turn of the new session to end", () => idle(app, starting.id));
  const thirdRestartAt = new Date().toISOString();
  const lastShared = protocol().findLast((line) => line.start && line.codexHome === defaultHome);
  if (lastShared) process.kill(lastShared.pid, "SIGTERM");
  await waitFor(
    "Codex to exit",
    () => app.agents.getStatus().providers?.find((provider) => provider.id === "codex")?.state !== "available",
  );
  await runCauseEffect(app.agents.refreshProvider("codex"));
  await waitFor("the backfill after the first turn", () => importedSince(starting.id, thirdRestartAt));
  report.startingSession.importedAfterTurn = true;

  report.passed =
    report.accountHomeUsedForAccountTurn &&
    report.firstStart.refusedReads === 1 &&
    report.firstStart.accountReadsOnSharedProcess === 0 &&
    report.providerRestart.refusedReads === 0 &&
    report.providerRestart.accountReadsOnSharedProcess === 0 &&
    report.providerRestart.completeReads === 1 &&
    report.backfillErrors.length === 0 &&
    report.refusedNextTurn.resumeRefused &&
    report.refusedNextTurn.newThread !== null &&
    report.refusedNextTurn.newThread !== refusedThread &&
    report.refusedNextTurn.turnStarted &&
    report.refusedNextTurn.errors.length === 0 &&
    report.startingSession.read &&
    report.startingSession.errors.length === 0 &&
    report.startingSession.importedAfterTurn === true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(app.agents.stop()).catch(() => {});
  app.database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
