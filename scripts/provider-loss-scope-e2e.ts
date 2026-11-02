// Checks that the loss of a provider process ends only the work of that process (plan 006). Runs the
// real agent service on a temporary profile with a fake Codex app-server that exits during a
// compaction. The compaction of the lost process ends as "failed", its queued message reaches a final
// state, and the service does not clear the browser controls of every agent.
// `bun scripts/provider-loss-scope-e2e.ts`. Writes .openbot-build/provider-loss-scope-e2e/report.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-loss-scope-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-provider-loss-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const exitedPath = join(root, "exited");
const fakeCodex = join(root, "codex");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
process.env.OPENBOT_FAKE_CODEX_EXITED = exitedPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify(entry) + "\\n");
const control = () => JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8"));
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
/** threadId -> { turnId, finish } of the compaction turn that runs. */
const compacting = new Map();
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
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      // Codex 0.160.1 \`start_or_steer_turn\`: an active compaction turn cannot take input.
      if (compacting.has(params.threadId)) {
        log({ refused: params.threadId });
        return write({ id: message.id, error: { code: -32603, message: "failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact }" } });
      }
      const turnId = "turn-" + (++turns);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      write({ method: "thread/tokenUsage/updated", params: { threadId: params.threadId, turnId, tokenUsage: { total: { totalTokens: 90000 }, last: { totalTokens: 90000 }, modelContextWindow: 100000 } } });
      setTimeout(() => {
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status: "completed" } } });
      }, 50);
      return;
    }
    case "thread/compact/start": {
      const { compactionMs, ignoreInterrupt, exitDuringCompaction } = control();
      const turnId = "compact-turn-" + (++turns);
      const item = { type: "contextCompaction", id: "compact-item-" + turnId };
      write({ id: message.id, result: {} });
      // The first process exits during its compaction. The restarted one finds the marker and runs normally.
      if (exitDuringCompaction && !fs.existsSync(process.env.OPENBOT_FAKE_CODEX_EXITED)) {
        write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
        write({ method: "item/started", params: { threadId: params.threadId, turnId, item } });
        fs.writeFileSync(process.env.OPENBOT_FAKE_CODEX_EXITED, String(process.pid));
        process.stdout.write("", () => process.exit(1));
        return;
      }
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      write({ method: "item/started", params: { threadId: params.threadId, turnId, item } });
      const finish = (status) => {
        if (compacting.get(params.threadId)?.turnId !== turnId) return;
        compacting.delete(params.threadId);
        clearTimeout(timer);
        log({ compactionEnded: turnId, threadId: params.threadId, status });
        if (status === "completed") write({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: turnId, status } } });
      };
      const timer = setTimeout(() => finish("completed"), compactionMs);
      compacting.set(params.threadId, { turnId, finish, ignoreInterrupt });
      return;
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      const compaction = compacting.get(params.threadId);
      if (compaction?.turnId === params.turnId) {
        if (!compaction.ignoreInterrupt) compaction.finish("interrupted");
        return;
      }
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
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
      log({ method: message.method ?? null, id: message.id ?? null, params: message.params ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}
const report: { passed: boolean; checks: typeof checks; error?: string } = { passed: false, checks };

const calls = { clearControls: 0 };
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
  clearControls: () => {
    calls.clearControls += 1;
  },
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** The messages that OpenBot sent to the fake Codex. */
function protocol(): { method: string | null; threadId: string | null }[] {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => protocolEntry(JSON.parse(line)));
  } catch {
    return [];
  }
}

function protocolEntry(value: unknown) {
  const entry = isRecord(value) ? value : {};
  const params = isRecord(entry.params) ? entry.params : {};
  return { method: getString(entry, "method"), threadId: getString(params, "threadId") };
}

/** Waits for a state of the service or of the fake Codex. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Waits for a state, and records a failed check instead of a stop when it does not come. */
async function settle<T>(label: string, read: () => T | null | undefined | false, timeoutMs?: number) {
  return waitFor(label, read, timeoutMs).catch(() => null);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
await writeFile(
  controlPath,
  JSON.stringify({ compactionMs: 60_000, ignoreInterrupt: false, exitDuringCompaction: true }),
);
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  contextCompactionTimeoutMs: 30_000,
});

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Provider loss",
      description: "Checks the work that a lost provider process ends.",
      avatarSeed: "provider-loss",
      avatarHue: null,
      initialMessage: "First message.",
    }),
  );
  // The first turn reports 90% of the context window, so the next message starts a compaction.
  const threadId = await waitFor("the first turn to end", () => {
    const session = store.activeProviderSession(agent.id)?.externalSessionId;
    const started = protocol().some((line) => line.method === "turn/start" && line.threadId === session);
    const busy = agents
      .listQueue(agent.id)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
    return session && started && !busy ? session : null;
  });
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Second message." }));
  const deliveryId = receipt.deliveries[0]?.id;
  if (!deliveryId) throw new Error("The second message has no delivery.");
  await waitFor("the compaction to start", () =>
    protocol().some((line) => line.method === "thread/compact/start" && line.threadId === threadId),
  );
  await waitFor("the fake Codex to exit", () => existsSync(exitedPath));

  const failed = await settle("the compaction to end as failed", () =>
    agents
      .getRuntimeSnapshot()
      .contextStates?.find((state) => state.agentId === agent.id && state.compaction?.status === "failed"),
  );
  check("the compaction of the lost process ends as failed", Boolean(failed), {
    contextStates: agents.getRuntimeSnapshot().contextStates?.filter((state) => state.agentId === agent.id),
  });
  const finalStatus = await settle("the second message to end", () => {
    const status = mailbox.getDelivery(deliveryId)?.delivery.status;
    return status === "completed" || status === "failed" || status === "interrupted" ? status : null;
  });
  // The message ends as "interrupted" before and after this change: boot recovery orphans every unresolved
  // delivery of the provider. The check proves only that the queue does not wait for a compaction that
  // cannot end.
  check("the queued message reaches a final state after the loss", finalStatus !== null, {
    finalStatus,
    error: mailbox.getDelivery(deliveryId)?.delivery.error ?? null,
  });
  check("the loss of one process does not clear the browser controls of every agent", calls.clearControls === 0, {
    clearControls: calls.clearControls,
  });
  report.passed = checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
