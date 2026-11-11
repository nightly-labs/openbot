// Runs the real agent service with a fake Codex app-server in a temporary profile.
// Checks safety error classification, bounded diagnostics, no automatic retry/failover, and
// explicit New chat recovery. No real authentication, model calls, or user data are used.
// Run: node --import tsx scripts/codex-safety-stop-e2e.ts
// Artifact: .openbot-build/codex-safety-stop-e2e/report.json
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { CONTEXT_RESET_CAPABILITY, CONTEXT_RESET_ROUTES } from "@openbot/contracts/team-protocol/context-reset-v1";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { getString, isRecord } from "../src/backend/protocol";
import { HttpError } from "../src/main/team-api/http-error";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import { routeContextReset } from "../src/main/team-api/route-context-reset";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-safety-stop-e2e");
const prepareUi = process.argv.includes("--prepare-ui");
const root = prepareUi
  ? resolve(".openbot-build/codex-safety-ui")
  : await mkdtemp(join(tmpdir(), "openbot-safety-stop-"));
const userData = join(root, "user-data");
const fixtureHome = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");
const FINAL_FAILURE = "This request was blocked by our safety systems. Reason: Potentially unintended activity.";
const PRIVATE_EXPLANATION = "private-explanation-canary";
const PRIVATE_CONTINUATION = "private-continuation-canary";

// The fake executable never reads provider credentials; the stores use the temporary profile.
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(fixtureHome, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

// Uses no real credentials or model requests. Only the fake process emits the safety error.
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 99.0.0\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify(entry) + "\\n");
const control = () => JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8"));
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
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
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }, { model: "gpt-backup", displayName: "Backup" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start":
    case "thread/resume": {
      const threadId = message.method === "thread/start" ? "thread-" + (++threads) : params.threadId;
      return write({ id: message.id, result: { thread: { id: threadId, turns: [] } } });
    }
    case "thread/name/set":
    case "thread/archive": return write({ id: message.id, result: {} });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const { fail, details, ordinary, hold } = control();
      const turnId = "turn-" + (++turns);
      const threadId = params.threadId;
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
      if (hold) return;
      setImmediate(() => {
        if (fail) {
          const error = { message: ${JSON.stringify(FINAL_FAILURE)}, codexErrorInfo: ordinary ? null : "misalignmentPolicyViolation",
            ...(details ? { misalignment: { detailedExplanation: ${JSON.stringify(PRIVATE_EXPLANATION)}, steer: { message: ${JSON.stringify(PRIVATE_CONTINUATION)} } } } : {}) };
          write({ method: "error", params: { threadId, turnId, error, willRetry: false } });
          write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error } } });
          return;
        }
        const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
        write({ method: "item/completed", params: { threadId, turnId, item } });
        write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
      });
      return;
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
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

interface CaseReport {
  details: boolean;
  failedStatus: string;
  oldThreadId: string;
  newThreadId: string;
  errorCode: string;
  retainedMessages: number;
  remoteReset: boolean;
  busyResetRefused: boolean;
  passed: boolean;
}
const report: { cases: CaseReport[]; passed: boolean; error?: string } = { cases: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
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

/** The `turn/start` requests that OpenBot sent on a thread. */
function turnStarts(threadId: string): number {
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line))
    .filter(
      (entry) =>
        isRecord(entry) &&
        getString(entry, "method") === "turn/start" &&
        isRecord(entry.params) &&
        getString(entry.params, "threadId") === threadId,
    ).length;
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

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
if (prepareUi) {
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "commonjs" }));
  await writeFile(controlPath, JSON.stringify({ fail: true }));
  process.stdout.write(`Synthetic Codex fixture ready at ${root}\n`);
  process.exit(0);
}
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, fixtureHome, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});

// Drive the released remote route, its wire decoder, and the real service over loopback HTTP.
const host = createServer((request, response) => {
  const json: TeamApiRequestContext["json"] = (status, value) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
    return "handled";
  };
  void routeContextReset(
    {
      request,
      response,
      method: request.method ?? "GET",
      url: new URL(request.url ?? "/", "http://localhost"),
      protocol: 9,
      capabilities: new Set(request.headers["x-test-old-host"] ? [] : [CONTEXT_RESET_CAPABILITY]),
      member: {
        id: "member-test",
        username: "test",
        email: null,
        name: "Test",
        role: "member",
        createdAt: new Date().toISOString(),
        disabled: false,
      },
      token: "test-token",
      sessionId: "test-session",
      sessionExpiresAt: new Date(Date.now() + 60000).toISOString(),
      agentLevel: () => (request.headers["x-test-view-only"] ? "view" : "chat"),
      json,
      empty: (status) => json(status, null),
    },
    agents,
    new Set(),
  ).catch((error) => json(error instanceof HttpError ? error.status : 500, { error: String(error) }));
});
host.listen(0, "127.0.0.1");
await once(host, "listening");
const address = host.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
async function remoteReset(agentId: string, headers: Record<string, string> = {}): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}${CONTEXT_RESET_ROUTES.clear}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ agentId }),
  });
  await response.text();
  return response.status;
}

const errorEvents: { agentId: string | null; code: string; message: string }[] = [];
agents.on("event", (event) => {
  if (event.type === "error")
    errorEvents.push({ agentId: event.agentId ?? null, code: event.code, message: event.message });
});
const logLines: string[] = [];
const stopLog = teeLogLines(["turn-lifecycle", "agent-error"], (line) => logLines.push(line));

try {
  await runCauseEffect(agents.initialize());

  for (const details of [false, true]) {
    await writeFile(controlPath, JSON.stringify({ fail: false }));
    const agent = await runCauseEffect(
      agents.createAgent({
        name: `Safety ${details}`,
        description: "Checks safety-stop diagnostics.",
        avatarSeed: `safety-${details}`,
        avatarHue: null,
        initialMessage: "First message.",
        provider: "codex",
        model: "gpt-5.5",
      }),
    );
    await waitFor("initial turn", () =>
      agents.listQueue(agent.id).deliveries.find((item) => item.status === "completed"),
    );
    await runCauseEffect(
      agents.updateAgent({
        agentId: agent.id,
        backupModels: { automatic: true, order: [{ provider: "codex", model: "gpt-backup" }] },
      }),
    );
    const oldThreadId = store.activeProviderSession(agent.id)?.externalSessionId ?? "missing";
    const before = turnStarts(oldThreadId);
    await writeFile(controlPath, JSON.stringify({ fail: true, details }));
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Synthetic safety-stop check." }));
    const failed = await waitFor("failed safety turn", () =>
      agents.listQueue(agent.id).deliveries.find((item) => item.status === "failed"),
    );
    await waitFor(
      "idle queue",
      () =>
        !agents.listQueue(agent.id).deliveries.some((item) => ["queued", "starting", "running"].includes(item.status)),
    );
    assert.equal(turnStarts(oldThreadId), before + 1, "No automatic retry");
    assert.equal(store.list().find((item) => item.id === agent.id)?.model, "gpt-5.5", "No automatic failover");
    assert.equal(
      store.activeProviderSession(agent.id)?.externalSessionId,
      oldThreadId,
      "The stopped session stays until New chat",
    );
    assert.ok(logLines.some((line) => line.includes('"causeCode":"content_blocked"')));
    assert.ok(!logLines.join("\n").includes(PRIVATE_EXPLANATION));
    assert.ok(!logLines.join("\n").includes(PRIVATE_CONTINUATION));
    const safetyEvent = errorEvents.find((event) => event.agentId === agent.id && event.code === "codex_safety_stop");
    assert.ok(safetyEvent, "The UI receives a structured safety-stop code");
    assert.equal(safetyEvent.message, FINAL_FAILURE);
    const beforeReset = await runCauseEffect(agents.readConversation(agent.id));
    const profileBeforeReset = store.list().find((item) => item.id === agent.id);
    assert.equal(await remoteReset(agent.id, { "x-test-old-host": "1" }), 400);
    assert.equal(await remoteReset(agent.id, { "x-test-view-only": "1" }), 403);
    assert.equal(await remoteReset("unknown-agent"), 404);
    assert.equal(store.activeProviderSession(agent.id)?.externalSessionId, oldThreadId);
    if (details) assert.equal(await remoteReset(agent.id), 200);
    else await runCauseEffect(agents.clearAgentContext(agent.id));
    const afterReset = await runCauseEffect(agents.readConversation(agent.id));
    for (const message of beforeReset.messages)
      assert.deepEqual(
        afterReset.messages.find((item) => item.id === message.id),
        message,
        "History stays unchanged",
      );
    assert.equal(afterReset.messages.filter((message) => message.itemType === "context-reset").length, 1);
    const profileAfterReset = store.list().find((item) => item.id === agent.id);
    assert.equal(profileAfterReset?.id, profileBeforeReset?.id);
    assert.equal(profileAfterReset?.workspacePath, profileBeforeReset?.workspacePath);
    assert.equal(profileAfterReset?.model, profileBeforeReset?.model);
    assert.deepEqual(profileAfterReset?.backupModels, profileBeforeReset?.backupModels);
    assert.equal(turnStarts(oldThreadId), before + 1, "Reset sends no provider turn");
    await writeFile(controlPath, JSON.stringify({ fail: false }));
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "New chat greeting." }));
    await waitFor("new session recovery", () => {
      const session = store.activeProviderSession(agent.id)?.externalSessionId;
      return session &&
        session !== oldThreadId &&
        turnStarts(session) === 1 &&
        agents
          .listQueue(agent.id)
          .deliveries.some((item) => item.text === "New chat greeting." && item.status === "completed") &&
        !agents.listQueue(agent.id).deliveries.some((item) => ["queued", "starting", "running"].includes(item.status))
        ? session
        : null;
    });
    const newThreadId = store.activeProviderSession(agent.id)?.externalSessionId ?? "missing";
    assert.notEqual(newThreadId, oldThreadId);
    assert.equal(turnStarts(newThreadId), 1);
    assert.equal(turnStarts(oldThreadId), before + 1, "New chat did not replay the stopped session");
    // Identical prose without the structured discriminator must stay an ordinary error.
    await writeFile(controlPath, JSON.stringify({ fail: true, ordinary: true }));
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Ordinary error check." }));
    await waitFor("ordinary failure", () =>
      agents
        .listQueue(agent.id)
        .deliveries.find((item) => item.text === "Ordinary error check." && item.status === "failed"),
    );
    assert.equal(errorEvents.at(-1)?.code, "agent_error");
    await writeFile(controlPath, JSON.stringify({ hold: true }));
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "Busy reset check." }));
    const busyTurn = await waitFor(
      "busy turn",
      () =>
        agents
          .listQueue(agent.id)
          .deliveries.find((item) => item.text === "Busy reset check." && item.status === "running")?.turnId,
    );
    const beforeBusyReset = await runCauseEffect(agents.readConversation(agent.id));
    assert.equal(await remoteReset(agent.id), 409);
    assert.deepEqual((await runCauseEffect(agents.readConversation(agent.id))).messages, beforeBusyReset.messages);
    await runCauseEffect(agents.interrupt(agent.id, busyTurn));
    await waitFor(
      "interrupted turn",
      () =>
        !agents.listQueue(agent.id).deliveries.some((item) => ["queued", "starting", "running"].includes(item.status)),
    );
    report.cases.push({
      details,
      failedStatus: failed.status,
      oldThreadId,
      newThreadId,
      errorCode: safetyEvent.code,
      retainedMessages: beforeReset.messages.length,
      remoteReset: details,
      busyResetRefused: true,
      passed: true,
    });
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  host.closeAllConnections();
  await new Promise<void>((done) => host.close(() => done()));
  stopLog();
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
