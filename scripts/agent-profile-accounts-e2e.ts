// Checks that an agent lists the provider accounts and reads and sets another agent's account and backup
// models with `openbot.list_models`, `openbot.read_agent` and `openbot.update_profile`.
// Runs the real agent service, tool router and provider account store on a temporary profile with a fake
// Codex app-server and a second Codex account. The fake calls the tools through `tool_call`, as a model
// does, and logs the tool result that it gets.
// The check asserts that the accounts list with their id and label and without their folders, that
// list_models lists a short list of models with the models in use and finds the others with a query, that
// create_agent accepts a model that the short list leaves out, that the
// account and the backup models are written and read back, that an unknown account or model is a tool
// failure that changes nothing, that a reset returns both to their defaults, and that a delete stops the
// process that the agent runs on with the second account.
// `bun scripts/agent-profile-accounts-e2e.ts`. Writes .openbot-build/agent-profile-accounts-e2e/report.json.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { z } from "zod";
import type {
  createAgentToolSchema,
  listModelsToolSchema,
  updateProfileToolSchema,
} from "../src/backend/agent/profile-tools";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { isProcessAlive } from "./dev-automation/registry-files";

/** The arguments the fake passes to a profile tool; read_agent takes a subset. */
type ProfileToolArgs = z.input<typeof updateProfileToolSchema> &
  Pick<z.input<typeof createAgentToolSchema>, "initialMessage"> &
  z.input<typeof listModelsToolSchema>;

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-profile-accounts-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-profile-accounts-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const accountsRoot = join(root, "provider-accounts");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { ProviderAccountStore } = await import("../src/backend/agent/provider-account-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const CALL_MARK = "PROFILE-CALL";
const MODEL = "gpt-6-luna";
const OTHER_MODEL = "gpt-6-sol";
/** More models than the short list of list_models holds: 8 a provider. OTHER_MODEL is last in the catalog. */
const EXTRA_MODELS = Array.from({ length: 10 }, (_, index) => `gpt-6-extra-${index + 1}`);
const CATALOG = [
  { model: MODEL, displayName: "GPT-6 Luna" },
  ...EXTRA_MODELS.map((model, index) => ({ model, displayName: `GPT-6 Extra ${index + 1}` })),
  { model: OTHER_MODEL, displayName: "GPT-6 Sol" },
];

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `PROFILE-CALL <<ARGS{json}ARGS>>` calls the `__tool` that the JSON names with the other fields through
 * `tool_call`, logs the result, and ends. Other turns answer "Done.".
 */
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
/** Tool request id -> the turn that waits for its result. */
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: process.env.CODEX_HOME.startsWith(${JSON.stringify(accountsRoot)}) ? "team-b@example.com" : "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: ${JSON.stringify(CATALOG)} } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + process.pid + "-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + process.pid + "-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const match = text.includes(${JSON.stringify(CALL_MARK)}) ? /<<ARGS([\\s\\S]*?)ARGS>>/.exec(text) : null;
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId });
      const { __tool, ...args } = JSON.parse(match[1]);
      return write({
        id,
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: "tool_call",
          arguments: { name: "openbot." + __tool, arguments: args },
        },
      });
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
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        log({ turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
        finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface ToolLog {
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

interface ChoiceBody {
  provider: string;
  model: string;
  providerAccountId: string;
}

/** The fields of a tool result that the check reads. The router sends them as JSON text. */
interface ProfileToolBody {
  providers?: {
    provider: string;
    models?: { id: string }[];
    omittedModels?: number;
    accounts?: { id: string; label: string | null; state: string }[];
  }[];
  model?: string;
  name?: string;
  providerAccountId?: string;
  backupModels?: { automatic: boolean; order: ChoiceBody[] } | null;
  usageLimitReturn?: unknown;
}

const report: {
  calls: { name: string; turnId: string; success: boolean | null; text: string }[];
  stored?: Pick<AgentSummary, "providerAccountId" | "backupModels">;
  deletedAgent?: { ownProcessStopped: boolean; workspaceRemoved: boolean };
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

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
};

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function toolLogs(): ToolLog[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const accounts = new ProviderAccountStore(join(userData, "openbot-provider-accounts-v1.json"), accountsRoot);
await runCauseEffect(accounts.load());
const second = await runCauseEffect(accounts.create("codex"));
assert.ok(second, "The second Codex account was not created.");
await runCauseEffect(accounts.rename("codex", second.id, "Team B"));
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  providerAccounts: accounts,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

/** Sends a chat message that makes the fake call the tool, and returns the tool result it logged. */
async function callTool(name: string, agentId: string, tool: string, args: Partial<ProfileToolArgs> = {}) {
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
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
  let body: ProfileToolBody | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A failure is plain text.
  }
  return { success: entry.result?.success === true, text, body };
}

const storedAgent = (agentId: string) => {
  const agent = store.list().find((candidate) => candidate.id === agentId);
  assert.ok(agent, "The worker agent is missing.");
  return agent;
};

try {
  await runCauseEffect(agents.initialize());
  const create = (name: string) =>
    runCauseEffect(
      agents.createAgent({
        name,
        description: name,
        avatarSeed: name.toLowerCase(),
        avatarHue: null,
        initialMessage: "Hello.",
      }),
    );
  const coordinator = await create("Coordinator");
  const worker = await create("Worker");
  await waitFor("the first chat turns to end", () => idle(coordinator.id) && idle(worker.id));
  await waitFor("the second account to connect", () =>
    agents
      .getStatus()
      .providers?.find((row) => row.id === "codex")
      ?.accounts?.some((account) => account.id === second.id && account.state === "connected"),
  );

  // 1. list_models lists both accounts, the provider's own sign-in first, without emails or folders.
  const listed = await callTool("list models", coordinator.id, "list_models", { provider: "codex" });
  const listedAccounts = listed.body?.providers?.find((row) => row.provider === "codex")?.accounts ?? [];
  pass("list_models succeeds", listed.success, listed.text);
  pass(
    "list_models lists the provider's own sign-in and the second account with their labels",
    listedAccounts.length === 2 &&
      listedAccounts[0]?.id === "default" &&
      listedAccounts[0]?.label === null &&
      listedAccounts[1]?.id === second.id &&
      listedAccounts[1]?.label === "Team B" &&
      listedAccounts[1]?.state === "connected",
    listed.text,
  );
  const codexModels = (call: { body: ProfileToolBody | null }) =>
    call.body?.providers?.find((row) => row.provider === "codex");
  pass(
    "list_models lists the default model and the first models, and counts the others",
    codexModels(listed)
      ?.models?.map((model) => model.id)
      .join(",") === [MODEL, ...EXTRA_MODELS.slice(0, 7)].join(",") && codexModels(listed)?.omittedModels === 4,
    listed.text,
  );
  pass(
    "list_models has no account email or folder",
    !listed.text.includes("@") &&
      !listed.text.includes("redacted") &&
      !listed.text.includes(accountsRoot) &&
      !listed.text.includes(home),
    listed.text,
  );

  // 2. update_profile sets the account and the backup models. Equal choices are kept once, and the
  // model and account that the agent has after the call are not a backup.
  const updated = await callTool("set account and backups", coordinator.id, "update_profile", {
    agentId: worker.id,
    providerAccountId: second.id,
    backupModels: {
      automatic: true,
      order: [
        { provider: "codex", model: MODEL, providerAccountId: "default" },
        { provider: "codex", model: MODEL },
        { provider: "codex", model: OTHER_MODEL, providerAccountId: second.id },
        { provider: "codex", model: MODEL, providerAccountId: second.id },
      ],
    },
  });
  pass("update_profile succeeds", updated.success, updated.text);
  const afterUpdate = storedAgent(worker.id);
  report.stored = {
    ...(afterUpdate.providerAccountId === undefined ? {} : { providerAccountId: afterUpdate.providerAccountId }),
    ...(afterUpdate.backupModels === undefined ? {} : { backupModels: afterUpdate.backupModels }),
  };
  pass("The store has the new account", afterUpdate.providerAccountId === second.id);
  pass(
    "The store has the backup models as the settings page writes them",
    JSON.stringify(afterUpdate.backupModels) ===
      JSON.stringify({
        automatic: true,
        order: [
          { provider: "codex", model: MODEL },
          { provider: "codex", model: OTHER_MODEL, providerAccountId: second.id },
        ],
      }),
    JSON.stringify(afterUpdate.backupModels),
  );
  pass("The update_profile result has the account", updated.body?.providerAccountId === second.id, updated.text);

  // 3. list_models lists a backup model that the short list left out, and a query finds the others.
  const listedInUse = await callTool("list models in use", coordinator.id, "list_models", { provider: "codex" });
  pass(
    "list_models lists a model that an agent uses as a backup model",
    codexModels(listedInUse)?.models?.some((model) => model.id === OTHER_MODEL) === true &&
      codexModels(listedInUse)?.omittedModels === 4,
    listedInUse.text,
  );
  const searched = await callTool("search models", coordinator.id, "list_models", { query: "extra 9" });
  pass(
    "A list_models query searches all models",
    codexModels(searched)
      ?.models?.map((model) => model.id)
      .join(",") === "gpt-6-extra-9" && codexModels(searched)?.omittedModels === undefined,
    searched.text,
  );
  const created = await callTool("create with an omitted model", coordinator.id, "create_agent", {
    name: "Helper",
    description: "Helper",
    initialMessage: "Hello.",
    provider: "codex",
    model: "gpt-6-extra-9",
  });
  pass(
    "create_agent accepts a model that the short list leaves out",
    created.success && created.body?.model === "gpt-6-extra-9",
    created.text,
  );

  // 4. read_agent returns the account, the backup models and no usage limit return.
  const read = await callTool("read worker", coordinator.id, "read_agent", { agentId: worker.id });
  pass(
    "read_agent returns the account and the backup models",
    read.body?.providerAccountId === second.id &&
      read.body.backupModels?.automatic === true &&
      read.body.backupModels.order.map((choice) => choice.providerAccountId).join(",") === `default,${second.id}` &&
      read.body.usageLimitReturn === null,
    read.text,
  );

  // 5. An unknown account, an unknown backup account or an unknown backup model changes nothing.
  const unknownAccount = await callTool("unknown account", coordinator.id, "update_profile", {
    agentId: worker.id,
    name: "Renamed",
    providerAccountId: "a0123456789abcdef",
  });
  const unknownBackupAccount = await callTool("unknown backup account", coordinator.id, "update_profile", {
    agentId: worker.id,
    name: "Renamed",
    backupModels: {
      automatic: false,
      order: [{ provider: "codex", model: MODEL, providerAccountId: "a0123456789abcdef" }],
    },
  });
  const unknownBackupModel = await callTool("unknown backup model", coordinator.id, "update_profile", {
    agentId: worker.id,
    name: "Renamed",
    backupModels: { automatic: false, order: [{ provider: "codex", model: "gpt-0" }] },
  });
  const badId = await callTool("bad account id", coordinator.id, "update_profile", {
    agentId: worker.id,
    providerAccountId: "../other",
  });
  const refused = (call: { success: boolean; text: string }, reason: string) =>
    !call.success && call.text.includes(reason);
  pass(
    "Unknown accounts, models and ids are tool failures that name the reason",
    refused(unknownAccount, "account is not on this computer") &&
      refused(unknownBackupAccount, "account is not on this computer") &&
      refused(unknownBackupModel, `Available models: ${[MODEL, ...EXTRA_MODELS.slice(0, 7), "…"].join(", ")}.`) &&
      refused(badId, "Use an account id from list_models"),
    [unknownAccount, unknownBackupAccount, unknownBackupModel, badId].map((call) => call.text).join("\n"),
  );
  const afterFailures = storedAgent(worker.id);
  pass(
    "A refused request changes nothing, the name in the same call included",
    afterFailures.name === "Worker" &&
      afterFailures.providerAccountId === second.id &&
      JSON.stringify(afterFailures.backupModels) === JSON.stringify(afterUpdate.backupModels),
  );

  // 6. A null account returns the agent to the provider's own sign-in. An order that asks first with
  // no model is no saved backup models, as the settings page saves it.
  const reset = await callTool("reset", coordinator.id, "update_profile", {
    agentId: worker.id,
    providerAccountId: null,
    backupModels: { automatic: false, order: [] },
  });
  const afterReset = storedAgent(worker.id);
  pass(
    "The reset clears the account and the backup models",
    reset.success &&
      afterReset.providerAccountId === undefined &&
      afterReset.backupModels === undefined &&
      reset.body?.providerAccountId === "default" &&
      reset.body.backupModels === null,
    reset.text,
  );

  // 7. A delete stops the agent's own process. On Windows a live process in the workspace makes the
  // folder removal fail with EBUSY until the app restarts (#3205).
  const reassigned = await callTool("set account again", coordinator.id, "update_profile", {
    agentId: worker.id,
    providerAccountId: second.id,
  });
  pass("update_profile sets the account again", reassigned.success, reassigned.text);
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: worker.id, text: "Hello again." }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "own process turn: no delivery");
  await waitFor("the worker's turn to end", () => mailbox.getDelivery(deliveryId)?.delivery.status === "completed");
  // The fake names each turn `turn-<pid>-<n>`.
  const ownPid = Number(mailbox.getDelivery(deliveryId)?.delivery.turnId?.split("-")[1]);
  pass("The worker's turn ran on a live process of its own", Number.isInteger(ownPid) && isProcessAlive(ownPid));
  const { workspacePath } = storedAgent(worker.id);
  await runCauseEffect(agents.deleteAgent(worker.id));
  // The delete waits for the stop: on Windows the folder removal after it needs the process gone.
  const stopped = !isProcessAlive(ownPid);
  report.deletedAgent = { ownProcessStopped: stopped, workspaceRemoved: !existsSync(workspacePath) };
  pass("The delete stops the agent's own process", stopped);
  pass(
    "The delete removes the workspace and the record",
    report.deletedAgent.workspaceRemoved && !store.list().some((candidate) => candidate.id === worker.id),
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
