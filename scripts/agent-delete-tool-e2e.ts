// Checks the `delete_agent` tool of issue #7005: an agent deletes other local agents only for a person's
// message, and only after the owner approves the card, also when the agent has Full access. A routine
// run, a team member's message, the agent's own id and an unknown id are refused with no card. A
// member cannot answer the card, a decline keeps the agents, and an accept deletes them and removes
// them from the sidebar and the Library, while the other agents stay. The card adds the id to a name
// that another agent also has.
// Runs the real agent service, tool router, sidebar and Library stores on a temporary profile with a fake Codex
// app-server. The fake calls the tool through `tool_call`, as a model does, and logs the result.
// `bun scripts/agent-delete-tool-e2e.ts`. Writes .openbot-build/agent-delete-tool-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-delete-tool-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-delete-tool-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { SidebarLayoutStore } = await import("../src/backend/sidebar-layout-store");
const { LibraryFoldersStore } = await import("../src/backend/library-folders-store");

const CALL_MARK = "DELETE-CALL";
const PERSON = { id: "local", name: "Alex" };
/** A team member, whose app has only what the Team API gives it. */
const MEMBER = { id: "member-remote", name: "Sam" };
const REFUSAL = "Only a person's message";

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `DELETE-CALL <<ARGS{"__tool":"…",…}ARGS>>` calls `openbot.<__tool>` with the rest of that JSON
 * through `tool_call`, logs the result, and ends. The last call in the input is the current one. Other turns answer "Done.".
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
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
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
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const calls = text.includes(${JSON.stringify(CALL_MARK)}) ? [...text.matchAll(/<<ARGS([\\s\\S]*?)ARGS>>/g)] : [];
      const match = calls.at(-1);
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId });
      // The packet carries the request as JSON text, so its quotes arrive escaped.
      const { __tool, ...args } = JSON.parse(match[1].replace(/\\\\"/g, '"'));
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

const report: {
  calls: { name: string; turnId: string; success: boolean | null; text: string }[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const library = new LibraryFoldersStore(join(userData, "library-folders.json"));
const agents = new AgentService({
  store,
  mailbox,
  browser,
  sidebarLayout: sidebar,
  // The agent view of the store. This test moves no files, so no file has a known agent.
  libraryFolders: {
    getSnapshot: () => library.getSnapshot(),
    placeInPath: (agentId, names, fileIds, context) => library.placeInPath(agentId, names, fileIds, context),
    mutate: (action, context) => library.mutate(action, context),
    removeAgent: (agentId) => library.removeAgent(agentId),
    fileAgents: () => Effect.succeed(new Map<string, string | null>()),
  },
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  timezone: () => "UTC",
  channelRemotePerson: (personId) => personId === MEMBER.id,
  // Full access: a deletion must still ask the owner.
  approvalAutomation: {
    autoApproves: () => true,
    set: () => Effect.succeed({ defaultAutoApprove: true, autoApproveOverrides: {} }),
  },
});

/** The approval cards that the service shows, in order. */
const approvals: { requestId: string | number; reason: string | null }[] = [];
agents.on("event", (event) => {
  if (event.type === "approval") approvals.push({ requestId: event.approval.requestId, reason: event.approval.reason });
});

/** Waits until the agent's chat has no open delivery. */
function idle(agentId: string) {
  return waitFor("the chat turn to end", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

/** Logs and returns the tool result of the fake's last call. */
async function logged(name: string, before: number) {
  const entry = await waitFor(`${name} tool result`, () => toolLogs()[before]);
  const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
  report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success === true, text });
  return { success: entry.result?.success === true, text };
}

const callText = (agentIds: string[]) =>
  `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: "delete_agent", agentIds })}ARGS>>`;

/** Sends a message to the agent's own chat that makes the fake call `delete_agent`. */
async function callFromChat(name: string, agentId: string, agentIds: string[], sender = PERSON) {
  const before = toolLogs().length;
  await runCauseEffect(agents.sendMessage({ agentId, text: callText(agentIds) }, sender));
  const result = await logged(name, before);
  await idle(agentId);
  return result;
}

/** Runs a routine whose instruction makes the fake call `delete_agent`, as a webhook body could. */
async function callFromRoutine(name: string, agentId: string, agentIds: string[]) {
  const before = toolLogs().length;
  const routine = agents.createRoutine({
    agentId,
    name,
    instruction: callText(agentIds),
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  await runCauseEffect(agents.testRoutine({ agentId, routineId: routine.id }));
  const result = await logged(name, before);
  await idle(agentId);
  return result;
}

const exists = (agentId: string) => agents.listAgents().some((agent) => agent.id === agentId);

try {
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(library.initialize());
  await runCauseEffect(agents.initialize());
  const chief = await runCauseEffect(
    agents.createAgent({
      name: "Chief",
      description: "Chief organizes the team.",
      avatarSeed: "chief",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(chief.id);
  const profile = (name: string) =>
    runCauseEffect(
      agents.createAgentProfile({
        name,
        description: name,
        avatarSeed: name.toLowerCase().replace(" ", "-"),
        avatarHue: null,
      }),
    );
  const editorA = await profile("Editor A");
  const editorB = await profile("Editor B");
  const keeper = await profile("Keeper");
  // Another agent with the name of a target: it stays, and the card names the target with its id.
  const twinB = await profile("Editor B");
  const ids = new Set(agents.listAgents().map((agent) => agent.id));
  const folderContext = { agentIds: ids, fileAgent: () => undefined };
  await runCauseEffect(
    library.mutate({ type: "create", id: "folder-a", agentId: editorA.id, name: "Drafts" }, folderContext),
  );
  await runCauseEffect(
    library.mutate({ type: "create", id: "folder-k", agentId: keeper.id, name: "Notes" }, folderContext),
  );
  await runCauseEffect(sidebar.mutate({ type: "create", name: "Editors", agentId: editorA.id }, ids));
  const sectionId = sidebar.getSnapshot().agentAssignments[editorA.id];
  assert.ok(sectionId, "Editor A is in the Editors section.");
  await runCauseEffect(sidebar.mutate({ type: "assign", agentId: keeper.id, sectionId }, ids));
  const targets = [editorA.id, editorB.id];

  // 1. Calls that must not delete, and must not show a card.
  const fromRoutine = await callFromRoutine("delete from a routine run", chief.id, targets);
  pass(
    "A routine run cannot delete an agent",
    !fromRoutine.success && fromRoutine.text.includes(REFUSAL),
    fromRoutine.text,
  );
  const fromMember = await callFromChat("delete from a team member", chief.id, targets, MEMBER);
  pass(
    "A team member's message cannot delete an agent",
    !fromMember.success && fromMember.text.includes(REFUSAL),
    fromMember.text,
  );
  const self = await callFromChat("delete itself", chief.id, [editorA.id, chief.id]);
  pass("An agent cannot delete itself", !self.success && self.text.includes("cannot delete yourself"), self.text);
  const unknown = await callFromChat("delete an unknown agent", chief.id, [editorA.id, "agent-missing"]);
  pass(
    "An unknown id fails and names the id",
    !unknown.success && unknown.text.includes("agent-missing"),
    unknown.text,
  );
  pass("No refused call showed an approval card", approvals.length === 0, JSON.stringify(approvals));
  pass(
    "The refused calls deleted nothing",
    [chief.id, editorA.id, editorB.id, keeper.id, twinB.id].every(exists),
    JSON.stringify(agents.listAgents().map((agent) => agent.name)),
  );

  // 2. A declined card keeps the agents, also with Full access.
  const declinedCall = callFromChat("delete declined", chief.id, targets);
  const declinedCard = await waitFor("the first card", () => approvals[0]);
  await runCauseEffect(agents.respondToApproval({ requestId: declinedCard.requestId, decision: "decline" }));
  const declined = await declinedCall;
  pass(
    "A deletion waits for the owner's card, which names the agents, also with Full access",
    declinedCard.reason === sourceText("status.agent.deleteAgents", { agents: `Editor A, Editor B (${editorB.id})` }),
    String(declinedCard.reason),
  );
  pass(
    "A declined card deletes nothing",
    declined.success && declined.text.includes('"declined"') && exists(editorA.id) && exists(editorB.id),
    declined.text,
  );

  // 3. Only the owner answers the card. After the owner accepts, both agents are gone.
  const acceptedCall = callFromChat("delete accepted", chief.id, targets);
  const card = await waitFor("the second card", () => approvals[1]);
  const byMember = await Effect.runPromise(
    Effect.result(agents.respondToApproval({ requestId: card.requestId, decision: "accept" }, { owner: false })),
  );
  pass("A member cannot answer the card", byMember._tag === "Failure" && exists(editorA.id), JSON.stringify(byMember));
  await runCauseEffect(agents.respondToApproval({ requestId: card.requestId, decision: "accept" }));
  const accepted = await acceptedCall;
  const result = JSON.parse(accepted.text);
  pass(
    "After the owner accepts, the agents are deleted",
    accepted.success && result.status === "deleted" && result.deleted === 2 && result.failed === 0,
    accepted.text,
  );
  pass("The deleted agents are not listed", !exists(editorA.id) && !exists(editorB.id));
  pass("The other agents stay", exists(chief.id) && exists(keeper.id) && exists(twinB.id));
  const layout = sidebar.getSnapshot();
  pass(
    "The sidebar no longer places the deleted agents, and keeps the others",
    !(editorA.id in layout.agentAssignments) &&
      !layout.agentOrder.includes(editorA.id) &&
      !layout.agentOrder.includes(editorB.id) &&
      layout.agentAssignments[keeper.id] === sectionId,
    JSON.stringify(layout),
  );
  const folders = library.getSnapshot().folders;
  pass(
    "The Library no longer has folders of the deleted agents, and keeps the others",
    !folders.some((folder) => folder.agentId === editorA.id) &&
      folders.some((folder) => folder.id === "folder-k" && folder.agentId === keeper.id),
    JSON.stringify(folders),
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
