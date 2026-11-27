import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AGENT_PROVIDERS, type AgentEvent, type AgentReasoningEffort } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-ollama-thinking-e2e");
const NO_THINKING = "deephat-v1-7b:latest";
const HIGH_ONLY = "high-only-fixture:latest";
const LIST_OMITTED = "omitted-effort-fixture:latest";
const ROWS = [
  { model: NO_THINKING, defaultReasoningEffort: "none", supportedReasoningEfforts: [] },
  { model: HIGH_ONLY, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "high" }] },
  { model: LIST_OMITTED },
];

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const path = require("node:path");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.170.0\\n");
  process.exit(0);
}
const rows = ${JSON.stringify(ROWS)};
const history = path.join(process.env.CODEX_HOME, "fake-rollouts.json");
const rollouts = () => fs.existsSync(history) ? JSON.parse(fs.readFileSync(history, "utf8")) : [];
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const loaded = new Set();
let threads = 0;
let turns = 0;
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line) return;
  const { id, method, params = {} } = JSON.parse(line);
  if (id === undefined) return;
  const reply = (result) => write({ id, result });
  const fail = (message) => write({ id, error: { code: -32600, message } });
  const { model, threadId, effort, config: settings, profileGeneration } = params;
  if (["thread/start", "thread/resume", "turn/start"].includes(method)) {
    fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify({
      method, model, threadId,
      efforts: [effort ?? null, ...(settings && "model_reasoning_effort" in settings ? [settings.model_reasoning_effort] : [])],
      profile: profileGeneration === true || String(threadId ?? "").startsWith("profile-"),
    }) + "\\n");
  }
  switch (method) {
    case "initialize": return reply({});
    case "account/read": return reply({ account: { type: "chatgpt", email: "codex@example.com" } });
    case "account/rateLimits/read": return reply({ rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null });
    case "model/list": return reply({ data: rows });
    case "plugin/list": return reply({ marketplaces: [] });
    case "config/read": return reply(config);
    case "config/batchWrite": return reply({});
    case "thread/start": {
      const thread = (profileGeneration === true ? "profile-" : "thread-") + process.pid + "-" + (++threads);
      loaded.add(thread);
      return reply({ thread: { id: thread, turns: [] } });
    }
    case "thread/resume":
      if (!loaded.has(threadId) && !rollouts().includes(threadId)) return fail("no rollout found for thread id " + threadId);
      loaded.add(threadId);
      return reply({ thread: { id: threadId, turns: [] } });
    case "thread/unsubscribe":
      loaded.delete(threadId);
      return reply({ status: "unsubscribed" });
    case "thread/archive":
      loaded.delete(threadId);
      return reply({});
    case "thread/backgroundTerminals/list":
    case "thread/turns/list":
      return reply({ data: [], nextCursor: null });
    case "turn/start": {
      if (!loaded.has(threadId)) return fail("thread not found: " + threadId);
      const turnId = "turn-" + process.pid + "-" + (++turns);
      if (!threadId.startsWith("profile-")) fs.writeFileSync(history, JSON.stringify([...rollouts(), threadId]));
      reply({ turn: { id: turnId, status: "inProgress", items: [] } });
      write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
      const item = { type: "agentMessage", id: "message-" + turnId, text: "Ready.", phase: "final_answer" };
      write({ method: "item/completed", params: { threadId, turnId, item } });
      write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      return;
    }
    default:
      return write({ id, error: { code: -32601, message: "Method not found: " + method } });
  }
});
`;

interface Sent {
  method: string;
  model?: string;
  threadId?: string;
  efforts: (string | null)[];
  profile: boolean;
}

interface Check {
  name: string;
  expected: unknown;
  observed: unknown;
  passed: boolean;
}

const report: { passed: boolean; checks: Check[]; error?: string } = { passed: false, checks: [] };
const record = (name: string, expected: unknown, observed: unknown) => {
  report.checks.push({ name, expected, observed, passed: isDeepStrictEqual(expected, observed) });
};
const unused = () => Effect.die(new Error("Browser controls are unused in this E2E."));
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

async function checkOllamaThinking(root: string) {
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const userData = join(root, "data");
  const logPath = join(root, "app-server.jsonl");
  const fake = join(root, "codex");
  await mkdir(codexHome, { recursive: true });
  await writeFile(fake, FAKE_CODEX, { mode: 0o755 });
  for (const name of Object.keys(process.env)) {
    if (/^(CODEX_|OPENAI_|OLLAMA_|OPENBOT_FAKE_)/u.test(name)) delete process.env[name];
  }
  Object.assign(process.env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    CODEX_HOME: codexHome,
    OPENBOT_CODEX_PATH: fake,
    OPENBOT_FAKE_CODEX_LOG: logPath,
  });

  const { AgentService } = await import("../src/backend/agent-service");
  const { AgentStore } = await import("../src/backend/agent-store");
  const { runCauseEffect } = await import("../src/backend/effect-boundary");
  const { MailboxStore } = await import("../src/backend/mailbox-store");
  const { OpenBotDatabase } = await import("../src/backend/openbot-database");
  const { readJsonl } = await import("./provider-fakes/host");
  const sent = () => readJsonl<Sent>(logPath);
  const recordEfforts = (name: string, entries: readonly Sent[], expected: AgentReasoningEffort) => {
    record(name, [expected], [...new Set(entries.flatMap((entry) => entry.efforts))]);
  };

  const startApp = async () => {
    const database = new OpenBotDatabase(userData);
    const store = new AgentStore(userData, home, database);
    const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
    const agents = new AgentService({
      store,
      mailbox,
      browser,
      preferredProvider: "codex",
      offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
      finishCheck: false,
    });
    const turns: Extract<AgentEvent, { type: "turn-completed" }>[] = [];
    agents.on("event", (event) => {
      if (event.type === "turn-completed") turns.push(event);
    });
    let stopping: Promise<void> | undefined;
    const stop = () => (stopping ??= runCauseEffect(agents.stop()).finally(() => database.close()));
    const when = <T>(label: string, read: () => T | undefined) =>
      new Promise<T>((done, fail) => {
        const check = () => {
          const value = read();
          if (value === undefined) return;
          clearTimeout(timer);
          agents.off("event", check);
          done(value);
        };
        const timer = setTimeout(() => {
          agents.off("event", check);
          fail(new Error(`Timed out waiting for ${label}.`));
        }, 30_000);
        agents.on("event", check);
        check();
      });
    try {
      await runCauseEffect(agents.initialize());
      const catalog = await when("Codex to list the fixture models", () => {
        const listed = agents.listModels().filter((option) => option.provider === "codex");
        return ROWS.every((row) => listed.some((option) => option.id === row.model)) ? listed : undefined;
      });
      const observeTurn = async (name: string, model: string, action: () => Promise<string>) => {
        const mark = (await sent()).length;
        const start = turns.length;
        const id = await action();
        const turn = await when(name, () => turns.slice(start).find((event) => event.agentId === id));
        record(`${name} completes`, "completed", turn.status);
        return { id, entries: (await sent()).slice(mark).filter((entry) => entry.model === model) };
      };
      const newChat = (name: string, model: string) =>
        observeTurn(name, model, async () => {
          const agent = await runCauseEffect(
            agents.createAgent({
              name,
              description: "Checks the levels sent to Codex.",
              avatarSeed: model,
              avatarHue: null,
              provider: "codex",
              model,
              initialMessage: "Reply with Ready.",
            }),
          );
          return agent.id;
        });
      const send = (name: string, model: string, id: string) =>
        observeTurn(name, model, async () => {
          await runCauseEffect(agents.sendMessage({ agentId: id, text: "Reply with Ready again." }));
          return id;
        });
      const save = (agentId: string, reasoningEffort: AgentReasoningEffort) =>
        runCauseEffect(store.updateAgent({ agentId, reasoningEffort }));
      const saved = (id: string) => agents.listAgents().find((agent) => agent.id === id)?.reasoningEffort;
      return { agents, catalog, newChat, send, save, saved, stop };
    } catch (error) {
      await stop();
      throw error;
    }
  };

  let app = await startApp();
  try {
    const option = (model: string) => {
      const row = app.catalog.find((item) => item.id === model);
      return [row?.defaultReasoningEffort, row?.supportedReasoningEfforts, row?.reasoningEffortConfigurable !== false];
    };
    record("no-thinking model has a fixed default", ["none", ["none"], false], option(NO_THINKING));
    record("High-only model defaults to High", ["high", ["high"], true], option(HIGH_ONLY));

    const noThinking = await app.newChat("No thinking", NO_THINKING);
    recordEfforts("new chat sends None", noThinking.entries, "none");
    const originalThread = noThinking.entries.find((request) => request.method === "turn/start")?.threadId;
    await app.save(noThinking.id, "medium");

    const highOnly = await app.newChat("High only", HIGH_ONLY);
    await app.save(highOnly.id, "medium");
    const highTurn = await app.send("High-only saved Medium turn", HIGH_ONLY, highOnly.id);
    recordEfforts("High-only saved Medium sends High", highTurn.entries, "high");

    const unlisted = await app.newChat("Omitted list", LIST_OMITTED);
    await app.save(unlisted.id, "high");
    const unlistedTurn = await app.send("Omitted list saved High turn", LIST_OMITTED, unlisted.id);
    recordEfforts("omitted list keeps saved High on the wire", unlistedTurn.entries, "high");

    await app.stop();
    app = await startApp();
    const resumed = await app.send("Resumed no-thinking turn", NO_THINKING, noThinking.id);
    const resume = resumed.entries.find((request) => request.method === "thread/resume");
    const next = resumed.entries.find((request) => request.method === "turn/start");
    record(
      "resumed turn uses the original thread",
      true,
      Boolean(originalThread && resume?.threadId === originalThread && next?.threadId === originalThread),
    );
    recordEfforts("thread resume sends None", resume ? [resume] : [], "none");
    recordEfforts("resumed turn sends None", next ? [next] : [], "none");

    const mark = (await sent()).length;
    const answer = await runCauseEffect(
      app.agents.askSideQuestion({ agentId: noThinking.id, question: "Reply with Ready.", earlier: [] }),
    );
    const sideRequests = (await sent())
      .slice(mark)
      .filter((request) => request.profile && request.model === NO_THINKING);
    record("side question answers", "Ready.", answer);
    recordEfforts("side question sends None through a fresh process", sideRequests, "none");
    record(
      "saved levels survive sends and restart",
      ["medium", "medium", "high"],
      [app.saved(noThinking.id), app.saved(highOnly.id), app.saved(unlisted.id)],
    );
  } finally {
    await app.stop();
  }
}

let root: string | undefined;
try {
  root = await mkdtemp(join(tmpdir(), "openbot-codex-ollama-thinking-"));
  await checkOllamaThinking(root);
  report.passed = report.checks.length > 0 && report.checks.every((check) => check.passed);
} catch (error) {
  report.error = redactText(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  if (root) await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const reportPath = join(OUT, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const check of report.checks) if (!check.passed) process.stdout.write(`FAIL ${check.name}\n`);
  if (report.error) process.stdout.write(`ERROR ${report.error}\n`);
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${reportPath}\n`);
  if (!report.passed) process.exitCode = 1;
}
