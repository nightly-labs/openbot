import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type AgentSummary } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { z } from "zod";
import type {
  createAgentToolSchema,
  listModelsToolSchema,
  updateAgentsToolSchema,
  updateProfileToolSchema,
} from "../src/backend/agent/profile-tools";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { isProcessAlive } from "./dev-automation/registry-files";

type ProfileToolArgs = z.input<typeof updateProfileToolSchema> &
  Pick<z.input<typeof createAgentToolSchema>, "initialMessage"> &
  z.input<typeof listModelsToolSchema> &
  Pick<z.input<typeof updateAgentsToolSchema>, "agentIds">;

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-profile-accounts-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-profile-accounts-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const accountsRoot = join(root, "provider-accounts");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

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
const { NO_PROVIDER_CREDENTIALS } = await import("../src/backend/provider-drivers");

const CALL_MARK = "PROFILE-CALL";
const MODEL = "gpt-6-luna";
const OTHER_MODEL = "gpt-6-sol";
const ACCOUNT_MODEL = "gpt-6.1-sol";
const EXTRA_MODELS = Array.from({ length: 10 }, (_, index) => `gpt-6-extra-${index + 1}`);
const CATALOG = [
  { model: MODEL, displayName: "GPT-6 Luna" },
  ...EXTRA_MODELS.map((model, index) => ({ model, displayName: `GPT-6 Extra ${index + 1}` })),
  { model: OTHER_MODEL, displayName: "GPT-6 Sol" },
];
const ACCOUNT_CATALOG = [...CATALOG, { model: ACCOUNT_MODEL, displayName: "GPT-6.1 Sol" }];
const ENDPOINT = {
  id: "gateway",
  name: "Gateway",
  baseUrl: "http://127.0.0.1:9/v1",
  apiKey: "sk-endpoint-secret-6471",
  models: [{ id: "chat-model", name: "Chat Model" }],
  headers: [],
  harness: "opencode",
} as const;

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
    case "model/list": return write({ id: message.id, result: { data: process.env.CODEX_HOME.startsWith(${JSON.stringify(accountsRoot)}) ? ${JSON.stringify(ACCOUNT_CATALOG)} : ${JSON.stringify(CATALOG)} } });
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

interface ProfileToolBody {
  providers?: {
    provider: string;
    models?: { id: string }[];
    omittedModels?: number;
    accounts?: { id: string; label: string | null; state: string; models?: { id: string }[] }[];
  }[];
  model?: string;
  name?: string;
  providerAccountId?: string;
  backupModels?: { automatic: boolean; order: ChoiceBody[] } | null;
  usageLimitReturn?: unknown;
  customProviders?: {
    settings: string;
    endpoints: { id: string; name: string; provider: string; models: string[]; message?: string }[];
  };
  updated?: number;
}

const report: {
  calls: { name: string; turnId: string; success: boolean | null; text: string }[];
  stored?: Pick<AgentSummary, "providerAccountId" | "backupModels">;
  deletedAgent?: { ownProcessStopped: boolean; workspaceRemoved: boolean };
  pool?: { second: string | null; default: string | null; null: string | null };
  poolModels?: {
    statusMarked: boolean;
    agentChoice: { model: string; account: string | null; pin: string | null };
    personChoice: { model: string; account: string | null; pin: string | null };
    pinnedBefore: string | null;
    created: { model: string; account: string | null; pin: string | null };
  };
  liveVoice?: { saved: string | null; afterRemove: string | null; automatic: string | null };
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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
  credentials: { ...NO_PROVIDER_CREDENTIALS, customProviders: () => [ENDPOINT] },
});

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

async function callTool(
  name: string,
  agentId: string,
  tool: string,
  args: Partial<ProfileToolArgs> | DynamicRecord = {},
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
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? "";
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
  let body: ProfileToolBody | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
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
      ?.accounts?.some(
        (account) => account.id === second.id && account.state === "connected" && account.models?.length === 1,
      ),
  );

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
    "list_models lists the model that only the second account serves under that account",
    listedAccounts[1]?.models?.map((model) => model.id).join(",") === ACCOUNT_MODEL &&
      listedAccounts[0]?.models === undefined &&
      codexModels(listed)?.models?.some((model) => model.id === ACCOUNT_MODEL) === false,
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
  pass(
    "A list_models call for another provider leaves the custom endpoints out",
    listed.body?.customProviders === undefined,
    listed.text,
  );

  const listedAll = await callTool("list all models", coordinator.id, "list_models");
  const endpointRow = listedAll.body?.customProviders?.endpoints[0];
  pass(
    "list_models names the saved custom endpoint and where the user changes it",
    listedAll.body?.customProviders?.settings === "Server settings > Providers > Custom provider" &&
      listedAll.body.customProviders.endpoints.length === 1 &&
      endpointRow?.id === ENDPOINT.id &&
      endpointRow.name === ENDPOINT.name &&
      endpointRow.provider === "opencode" &&
      endpointRow.models.length === 0 &&
      endpointRow.message?.startsWith("OpenCode runs this endpoint and cannot run now.") === true,
    listedAll.text,
  );
  pass(
    "list_models has no base URL or key of a custom endpoint",
    !listedAll.text.includes(ENDPOINT.baseUrl) && !listedAll.text.includes(ENDPOINT.apiKey),
    listedAll.text,
  );

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

  const read = await callTool("read worker", coordinator.id, "read_agent", { agentId: worker.id });
  pass(
    "read_agent returns the account and the backup models",
    read.body?.providerAccountId === second.id &&
      read.body.backupModels?.automatic === true &&
      read.body.backupModels.order.map((choice) => choice.providerAccountId).join(",") === `default,${second.id}` &&
      read.body.usageLimitReturn === null,
    read.text,
  );

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
  const extraBackupField = await callTool("extra backupModels field", coordinator.id, "update_profile", {
    agentId: worker.id,
    name: "Renamed",
    backupModels: { models: [{ provider: "codex", model: MODEL }], automatic: true, order: [] },
  });
  const extraEntryField = await callTool("extra backup entry field", coordinator.id, "update_profile", {
    agentId: worker.id,
    backupModels: { automatic: true, order: [{ provider: "codex", model: MODEL, effortLevel: "high" }] },
  });
  const extraToolField = await callTool("extra update_profile field", coordinator.id, "update_profile", {
    agentId: worker.id,
    fallbackModels: [MODEL],
  });
  const entryFields = "Each backupModels.order entry takes only: provider, model, providerAccountId.";
  pass(
    "A field that update_profile does not take is refused with the fields that its object takes",
    refused(
      extraBackupField,
      `Remove unsupported profile fields. backupModels takes only: automatic, order. ${entryFields}`,
    ) &&
      refused(extraEntryField, `Remove unsupported profile fields. ${entryFields}`) &&
      refused(extraToolField, "Remove unsupported profile fields. update_profile takes only: agentId, name,") &&
      [extraBackupField, extraEntryField, extraToolField].every(
        (call) => !call.text.includes("effortLevel") && !call.text.includes("fallbackModels"),
      ),
    [extraBackupField, extraEntryField, extraToolField].map((call) => call.text).join("\n"),
  );
  const afterFailures = storedAgent(worker.id);
  pass(
    "A refused request changes nothing, the name in the same call included",
    afterFailures.name === "Worker" &&
      afterFailures.providerAccountId === second.id &&
      JSON.stringify(afterFailures.backupModels) === JSON.stringify(afterUpdate.backupModels),
  );

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

  const ownSignIn = await callTool("account model on the own sign-in", coordinator.id, "update_profile", {
    agentId: worker.id,
    model: ACCOUNT_MODEL,
  });
  const ownSignInBackup = await callTool("account model backup on the own sign-in", coordinator.id, "update_profile", {
    agentId: worker.id,
    backupModels: { automatic: false, order: [{ provider: "codex", model: ACCOUNT_MODEL }] },
  });
  pass(
    "A model that only the second account serves is refused on the own sign-in",
    refused(ownSignIn, "Available models") &&
      refused(ownSignInBackup, "Available models") &&
      storedAgent(worker.id).model === MODEL &&
      storedAgent(worker.id).backupModels === undefined,
    [ownSignIn, ownSignInBackup].map((call) => call.text).join("\n"),
  );
  const accountModel = await callTool("account model with its account", coordinator.id, "update_profile", {
    agentId: worker.id,
    providerAccountId: second.id,
    model: ACCOUNT_MODEL,
    backupModels: {
      automatic: false,
      order: [
        { provider: "codex", model: ACCOUNT_MODEL, providerAccountId: second.id },
        { provider: "codex", model: MODEL },
      ],
    },
  });
  const afterAccountModel = storedAgent(worker.id);
  pass(
    "update_profile sets a model that only the agent's account serves",
    accountModel.success &&
      accountModel.body?.model === ACCOUNT_MODEL &&
      afterAccountModel.model === ACCOUNT_MODEL &&
      afterAccountModel.providerAccountId === second.id &&
      JSON.stringify(afterAccountModel.backupModels) ===
        JSON.stringify({ automatic: false, order: [{ provider: "codex", model: MODEL }] }),
    `${accountModel.text}\n${JSON.stringify(afterAccountModel.backupModels)}`,
  );
  const bulkModel = await callTool("update_agents to the account model", coordinator.id, "update_agents", {
    agentIds: [worker.id],
    model: ACCOUNT_MODEL,
  });
  const bulkEffort = await callTool("update_agents effort on the account model", coordinator.id, "update_agents", {
    agentIds: [worker.id],
    reasoningEffort: "medium",
  });
  pass(
    "update_agents accepts a model that only the agent's account serves",
    bulkModel.body?.updated === 1 && bulkEffort.body?.updated === 1 && storedAgent(worker.id).model === ACCOUNT_MODEL,
    `${bulkModel.text}\n${bulkEffort.text}`,
  );

  const reassigned = await callTool("set account again", coordinator.id, "update_profile", {
    agentId: worker.id,
    providerAccountId: second.id,
  });
  pass("update_profile sets the account again", reassigned.success, reassigned.text);
  const receipt = await runCauseEffect(agents.sendMessage({ agentId: worker.id, text: "Hello again." }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, "own process turn: no delivery");
  await waitFor("the worker's turn to end", () => mailbox.getDelivery(deliveryId)?.delivery.status === "completed");
  const ownPid = Number(mailbox.getDelivery(deliveryId)?.delivery.turnId?.split("-")[1]);
  pass("The worker's turn ran on a live process of its own", Number.isInteger(ownPid) && isProcessAlive(ownPid));
  const { workspacePath } = storedAgent(worker.id);
  await runCauseEffect(agents.deleteAgent(worker.id));
  const stopped = !isProcessAlive(ownPid);
  report.deletedAgent = { ownProcessStopped: stopped, workspaceRemoved: !existsSync(workspacePath) };
  pass("The delete stops the agent's own process", stopped);
  pass(
    "The delete removes the workspace and the record",
    report.deletedAgent.workspaceRemoved && !store.list().some((candidate) => candidate.id === worker.id),
  );

  await runCauseEffect(accounts.setPool("codex", { leftOut: [] }));
  const pooled = await create("Pooled");
  await waitFor("the pooled agent's first turn to end", () => idle(pooled.id));
  const pinnedSecond = await callTool("pin the second account", coordinator.id, "update_profile", {
    agentId: pooled.id,
    providerAccountId: second.id,
  });
  const pinSecond = storedAgent(pooled.id).pinnedAccountId;
  const pinnedDefault = await callTool("pin the own sign-in", coordinator.id, "update_profile", {
    agentId: pooled.id,
    providerAccountId: "default",
  });
  const afterDefault = storedAgent(pooled.id);
  const pooledAgain = await callTool("give the account to the pool", coordinator.id, "update_profile", {
    agentId: pooled.id,
    providerAccountId: null,
  });
  const afterNull = storedAgent(pooled.id);
  report.pool = {
    second: pinSecond ?? null,
    default: afterDefault.pinnedAccountId ?? null,
    null: afterNull.pinnedAccountId ?? null,
  };
  pass(
    "With Pool accounts on, an agent that names an account keeps it, also the own sign-in",
    pinnedSecond.success &&
      pinSecond === second.id &&
      pinnedDefault.success &&
      afterDefault.providerAccountId === undefined &&
      afterDefault.pinnedAccountId === "default",
    `${pinnedSecond.text}\n${pinnedDefault.text}`,
  );
  pass(
    "With Pool accounts on, a null account gives the agent to the pool",
    pooledAgain.success && afterNull.providerAccountId === undefined && afterNull.pinnedAccountId === undefined,
    pooledAgain.text,
  );
  const choiceOf = (agentId: string) => {
    const agent = storedAgent(agentId);
    return { model: agent.model, account: agent.providerAccountId ?? null, pin: agent.pinnedAccountId ?? null };
  };
  const statusMarked =
    agents.getStatus().providers?.find((row) => row.id === "codex")?.accountPool?.accountModels === true;
  await callTool("pin the own sign-in again", coordinator.id, "update_profile", {
    agentId: pooled.id,
    providerAccountId: "default",
  });
  const pinnedBefore = storedAgent(pooled.id).pinnedAccountId ?? null;
  const agentChose = await callTool("choose a model of one pool account", coordinator.id, "update_profile", {
    agentId: pooled.id,
    model: ACCOUNT_MODEL,
  });
  const agentChoice = choiceOf(pooled.id);
  await runCauseEffect(agents.updateAgent({ agentId: pooled.id, model: MODEL, providerAccountId: null }));
  await runCauseEffect(agents.updateAgent({ agentId: pooled.id, model: ACCOUNT_MODEL }));
  const personChoice = choiceOf(pooled.id);
  const createdAgent = await runCauseEffect(
    agents.createAgent({
      name: "Pool model",
      description: "Pool model",
      avatarSeed: "pool-model",
      avatarHue: null,
      initialMessage: "Hello.",
      provider: "codex",
      model: ACCOUNT_MODEL,
    }),
  );
  await waitFor("the new pool agent's first turn to end", () => idle(createdAgent.id));
  const createdChoice = choiceOf(createdAgent.id);
  report.poolModels = { statusMarked, agentChoice, personChoice, pinnedBefore, created: createdChoice };
  pass("The local status marks the pool as one that lists the models of each account", statusMarked);
  pass(
    "With Pool accounts on, an agent that selects a model of one account moves to that account and stays in the pool",
    pinnedBefore === "default" &&
      agentChose.success &&
      agentChoice.model === ACCOUNT_MODEL &&
      agentChoice.account === second.id &&
      agentChoice.pin === null,
    agentChose.text,
  );
  pass(
    "With Pool accounts on, a new agent with a model of one account starts on that account",
    createdChoice.model === ACCOUNT_MODEL && createdChoice.account === second.id && createdChoice.pin === null,
    JSON.stringify(createdChoice),
  );
  pass(
    "With Pool accounts on, a person who selects a model of one account moves the agent to that account in the pool",
    personChoice.model === ACCOUNT_MODEL && personChoice.account === second.id && personChoice.pin === null,
    JSON.stringify(personChoice),
  );
  await runCauseEffect(accounts.setPool("codex", null));

  await runCauseEffect(accounts.setLiveVoiceAccount(second.id));
  const reloaded = new ProviderAccountStore(join(userData, "openbot-provider-accounts-v1.json"), accountsRoot);
  await runCauseEffect(reloaded.load());
  const saved = reloaded.liveVoiceAccount();
  const removable = await runCauseEffect(accounts.create("codex"));
  assert.ok(removable, "live voice: no account to remove");
  await runCauseEffect(accounts.setLiveVoiceAccount(removable.id));
  await runCauseEffect(accounts.remove(removable));
  const afterRemove = accounts.liveVoiceAccount();
  await runCauseEffect(accounts.setLiveVoiceAccount(second.id));
  await runCauseEffect(accounts.setLiveVoiceAccount(null));
  report.liveVoice = { saved, afterRemove, automatic: accounts.liveVoiceAccount() };
  pass(
    "The live voice account is saved, a removed account is no longer the choice, and null goes back to automatic",
    saved === second.id &&
      afterRemove === null &&
      report.liveVoice.automatic === null &&
      reloaded.list("codex").length > 0,
  );

  const photoSource = join(root, "photo.png");
  await copyFile(resolve(import.meta.dirname, "../apps/auth-api/public/apple-touch-icon.png"), photoSource);
  const photo = await callTool("set photo", coordinator.id, "update_profile", {
    agentId: coordinator.id,
    avatarPath: photoSource,
  });
  const photoUrl = storedAgent(coordinator.id).avatarUrl;
  const photoFile = store.resolveAvatar(coordinator.id)?.path ?? "";
  pass("update_profile sets a photo", photo.success && photoUrl !== null && existsSync(photoFile), photo.text);
  const color = await callTool("set color", coordinator.id, "update_profile", {
    agentId: coordinator.id,
    avatarHue: 0,
  });
  pass(
    "update_profile with avatarHue keeps the photo and its file",
    color.success &&
      storedAgent(coordinator.id).avatarHue === 0 &&
      storedAgent(coordinator.id).avatarUrl === photoUrl &&
      existsSync(photoFile),
    color.text,
  );
  const face = await callTool("set generated face", coordinator.id, "update_profile", {
    agentId: coordinator.id,
    avatarSeed: storedAgent(coordinator.id).avatarSeed,
  });
  pass(
    "update_profile with avatarSeed removes the photo and its file",
    face.success && storedAgent(coordinator.id).avatarUrl === null && !existsSync(photoFile),
    face.text,
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
