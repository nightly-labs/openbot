// Checks `openbot.preview_agent_import` and `openbot.apply_agent_import` through the real tool router.
// Builds a minimal Grok Bot export zip, previews it, imports one agent when the user approves, and
// imports nothing when the user declines. `bun scripts/agent-import-tool-e2e.ts`.
// Writes `.openbot-build/agent-import-tool-e2e/report.json`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { z } from "zod";
import type { AgentImportToolPort } from "../src/backend/agent/agent-import-tool-port";
import type { applyAgentImportToolSchema, previewAgentImportToolSchema } from "../src/backend/agent/agent-import-tools";
import { toToolOperationFailed } from "../src/backend/agent/tool-operation";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { type AgentImportAgents, AgentImportService } from "../src/main/agent-import-service";
import { LocalSkillLibrary } from "../src/main/local-skill-library";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-import-tool-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-agent-import-tool-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const accountsRoot = join(root, "provider-accounts");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;

const CALL_MARK = "IMPORT-CALL";
const MODEL = "gpt-6-luna";

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ProviderAccountStore } = await import("../src/backend/agent/provider-account-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\\n");
  if (!line) continue;
    const message = JSON.parse(line);
    const params = message.params || {};
    // A notification, such as "initialized", carries no id and takes no answer: writing
    // {result:{}} for it is not a JSON-RPC message, and the client refuses the whole stream.
    if (message.id === undefined) continue;
    if (message.method === "initialize") write({ id: message.id, result: {} });
    else if (message.method === "account/read") write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    else if (message.method === "account/rateLimits/read") write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    else if (message.method === "model/list") write({ id: message.id, result: { data: [{ model: ${JSON.stringify(MODEL)}, displayName: "GPT-6 Luna" }] } });
    else if (message.method === "plugin/list") write({ id: message.id, result: { marketplaces: [] } });
    else if (message.method === "config/read") write({ id: message.id, result: config });
    else if (message.method === "config/batchWrite") write({ id: message.id, result: {} });
    else if (message.method === "thread/start") write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
    else if (message.method === "thread/resume") write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    else if (message.method === "thread/unsubscribe") write({ id: message.id, result: { status: "Unsubscribed" } });
    else if (message.method === "thread/turns/list" || message.method === "thread/items/list") write({ id: message.id, result: { data: [], nextCursor: null } });
    else if (message.method === "thread/read") write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    else if (message.method === "turn/start") {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      const match = text.match(/<<ARGS(.+)ARGS>>/);
      if (match) {
        const { __tool, ...args } = JSON.parse(match[1]);
        const callId = "call-" + turnId;
        write({ id: callId, method: "item/tool/call", params: { threadId: params.threadId, turnId, callId, namespace: "openbot", tool: "tool_call", arguments: { name: "openbot." + __tool, arguments: args } } });
        waiting.set(callId, { threadId: params.threadId, turnId, callId, tool: args.__tool });
      } else finish(params.threadId, turnId);
    } else if (message.id !== undefined && waiting.has(message.id)) {
      // The client answers the item/tool/call request by its id; that answer closes the turn.
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      log({ turnId: pending.turnId, result: message.result });
      finish(pending.threadId, pending.turnId);
    } else write({ id: message.id, result: {} });
  }
});
`;

const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: () => Effect.die("unused"),
  endTakeover: () => {},
  resolveUploadTarget: () => Effect.die("unused"),
  handleDynamicTool: () => Effect.die("unused"),
  userControlTabFor: () => null,
  awaitUserControlRelease: () => Effect.die("unused"),
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

function manifest(key: string, name: string): string {
  return JSON.stringify({
    format: "openbot-agent-import",
    version: 1,
    source: { app: "grok-bot", exportedAt: "2026-11-16T10:00:00Z" },
    agents: [
      {
        key,
        name,
        title: "",
        description: "Imported by the tool e2e.",
        avatar: null,
        skills: [],
        routines: [],
        memories: ["The user imports from a zip."],
        files: null,
      },
    ],
  });
}

async function buildZip(key: string, name: string): Promise<string> {
  const source = join(root, `export-${key}`);
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "openbot-import.json"), manifest(key, name));
  const zip = join(root, `${key}.zip`);
  const zipped = spawnSync("zip", ["-q", "-r", zip, "."], { cwd: source, encoding: "utf8" });
  assert.equal(zipped.status, 0, `zip failed: ${zipped.stderr}`);
  return zip;
}

interface ToolLog {
  turnId: string;
  result: { success?: boolean; contentItems?: Array<{ text?: string }> };
}

interface Report {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean }>;
  error?: string;
}
const report: Report = { passed: false, checks: [] };
/** Set as soon as the service exists, so the finally block can always stop the provider process. */
let stopService: (() => Promise<void>) | undefined;

type PreviewToolArgs = z.infer<typeof previewAgentImportToolSchema>;
type ApplyToolArgs = z.infer<typeof applyAgentImportToolSchema>;
type ImportToolArgs = PreviewToolArgs | ApplyToolArgs;

interface StagedPreviewBody {
  token: string;
  agents: Array<{ key: string }>;
}

function readStagedPreview(body: unknown): StagedPreviewBody | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("token" in body) || typeof body.token !== "string") return null;
  if (!("agents" in body) || !Array.isArray(body.agents)) return null;
  const agents: Array<{ key: string }> = [];
  for (const agent of body.agents) {
    if (typeof agent !== "object" || agent === null || !("key" in agent) || typeof agent.key !== "string") {
      return null;
    }
    agents.push({ key: agent.key });
  }
  return { token: body.token, agents };
}

function readAppliedAgentCount(body: unknown): number {
  if (typeof body !== "object" || body === null || !("agents" in body) || !Array.isArray(body.agents)) {
    return 0;
  }
  return body.agents.length;
}

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

function toolLogs(): ToolLog[] {
  try {
    return readFileSync(fakeLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

async function callTool(
  agents: InstanceType<typeof AgentService>,
  mailbox: InstanceType<typeof MailboxStore>,
  name: string,
  agentId: string,
  tool: string,
  args: ImportToolArgs,
) {
  const receipt = await runCauseEffect(
    agents.sendMessage({ agentId, text: `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: tool, ...args })}ARGS>>` }),
  );
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: no delivery`);
  const turnId = await waitFor(`${name} turn`, () => mailbox.getDelivery(deliveryId)?.delivery.turnId);
  const entry = await waitFor(`${name} tool result`, () => toolLogs().find((log) => log.turnId === turnId));
  await waitFor(`${name} turn end`, () => {
    const status = mailbox.getDelivery(deliveryId)?.delivery.status;
    return status === "completed" || status === "failed" || status === "interrupted";
  });
  const text = entry.result?.contentItems?.map((item) => item.text).join("\n") ?? "";
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { success: entry.result?.success === true, text, body };
}

const storedAgents: AgentSummary[] = [];
const agentBoundary: AgentImportAgents = {
  listAgents: () => storedAgents,
  createAgentProfile: (input) =>
    Effect.promise(async () => {
      const created: AgentSummary = {
        id: `agent-${storedAgents.length + 1}`,
        name: input.name,
        title: "",
        description: "",
        notifications: false,
        provider: "codex",
        model: MODEL,
        reasoningEffort: "medium",
        threadId: null,
        workspacePath: join(root, "agents", `agent-${storedAgents.length + 1}`),
        preview: "",
        updatedAt: null,
        avatarSeed: input.name,
        avatarHue: null,
        avatarUrl: null,
      };
      await mkdir(created.workspacePath, { recursive: true });
      storedAgents.push(created);
      return created;
    }),
  createRoutine: () => undefined,
  createMemory: () => undefined,
  memoryLimit: () => 50,
  initializeMemorySelection: () => undefined,
  setAvatar: () => Effect.die("unused"),
  deleteAgent: () => Effect.die("unused"),
  channels: { command: () => Effect.die("unused") },
  createChannelMemory: () => undefined,
  createChannelRoutine: () => undefined,
  deleteChannel: () => Effect.die("unused"),
};

try {
  await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
  const library = new LocalSkillLibrary(join(root, "skills"), () => storedAgents);
  const importService = new AgentImportService(
    agentBoundary,
    { library: () => library, installLocal: () => Effect.void },
    () => ({ id: "local", name: "Local" }),
    () => "UTC",
    null,
  );
  const agentImportHolder: { current: AgentImportToolPort | null } = {
    current: {
      stage: (path) => importService.stage(path).pipe(toToolOperationFailed),
      apply: (input) => importService.apply(input).pipe(toToolOperationFailed),
      discard: (token) =>
        importService.discard(token).pipe(
          toToolOperationFailed,
          Effect.map(() => undefined),
        ),
      stagedSummary: (token, keys, channelKeys) =>
        importService.stagedSummary(token, keys, channelKeys).pipe(toToolOperationFailed),
    },
  };

  const accounts = new ProviderAccountStore(join(userData, "openbot-provider-accounts-v1.json"), accountsRoot);
  await runCauseEffect(accounts.load());
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    providerAccounts: accounts,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    agentImportTools: () => agentImportHolder.current,
  });
  stopService = () => runCauseEffect(service.stop());
  await runCauseEffect(service.initialize());

  const approvals: { requestId: string | number; reason: string | null }[] = [];
  service.on("event", (event) => {
    if (event.type === "approval") {
      approvals.push({ requestId: event.approval.requestId, reason: event.approval.reason });
    }
  });

  async function applyWithAnswer(name: string, agentId: string, args: ApplyToolArgs, decision: "accept" | "decline") {
    const before = approvals.length;
    const pending = callTool(service, mailbox, name, agentId, "apply_agent_import", args);
    const approval = await waitFor(`${name} approval`, () => approvals[before]);
    await runCauseEffect(service.respondToApproval({ requestId: approval.requestId, decision }));
    return pending;
  }

  const coordinator = await runCauseEffect(
    service.createAgent({
      name: "Coordinator",
      description: "Runs import tools in the e2e.",
      avatarSeed: "coordinator",
      avatarHue: null,
      // createAgent refuses an empty initial message, and the chat turn it starts has to end
      // before the first import call, or the two deliveries share one chat queue.
      initialMessage: "Hello.",
      provider: "codex",
      model: MODEL,
    }),
  );
  await waitFor("the coordinator chat turn to end", () =>
    service
      .listQueue(coordinator.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );

  const alphaZip = await buildZip("alpha", "Alpha");
  const preview = await callTool(service, mailbox, "preview", coordinator.id, "preview_agent_import", {
    zipPath: alphaZip,
  });
  const previewBody = readStagedPreview(preview.body);
  pass("preview_agent_import succeeds", preview.success && previewBody !== null, preview.text);
  assert.ok(previewBody);
  const token = previewBody.token;
  const keys = previewBody.agents.map((agent) => agent.key);

  const applied = await applyWithAnswer("apply accept", coordinator.id, { token, keys }, "accept");
  pass(
    "apply_agent_import creates an agent when approved",
    applied.success && readAppliedAgentCount(applied.body) === 1,
    applied.text,
  );
  pass("the agent store has one imported agent", storedAgents.length === 1);

  const betaZip = await buildZip("beta", "Beta");
  const previewBeta = await callTool(service, mailbox, "preview beta", coordinator.id, "preview_agent_import", {
    zipPath: betaZip,
  });
  const betaBody = readStagedPreview(previewBeta.body);
  assert.ok(betaBody);
  const declined = await applyWithAnswer(
    "apply decline",
    coordinator.id,
    { token: betaBody.token, keys: ["beta"] },
    "decline",
  );
  pass(
    "a declined import is a tool failure with the declined message",
    !declined.success && declined.text.includes(sourceText("error.agent.agentImportDeclined")),
    declined.text,
  );
  pass("the declined import leaves the agent count unchanged", storedAgents.length === 1);

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  // Without stopping the service the provider process stays open and the script never exits,
  // which reads as a hang instead of the pass or fail the checks decided.
  await stopService?.().catch(() => {});
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

if (!report.passed) process.exit(1);
