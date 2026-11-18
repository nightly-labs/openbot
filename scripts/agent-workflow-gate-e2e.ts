// Checks that only a person's message, in the agent's own chat or a side thread that the person
// opened, can change, delete or run a workflow through the agent tools, that a delete also waits for
// the person's approval when the agent has Full access, and that reads stay open. A routine run or a workflow run can carry text
// from outside, such as a webhook body, and a team member's message is checked by the Team API.
// Runs the real agent service, tool router and workflow service on a temporary profile with a fake
// Codex app-server. The fake calls the tool through `tool_call`, as a model does, and logs the result.
// `bun scripts/agent-workflow-gate-e2e.ts`. Writes .openbot-build/agent-workflow-gate-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-workflow-gate-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-workflow-gate-"));
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
const { WorkflowGitHubStore } = await import("../src/backend/workflows/workflow-github-store");
const { WorkflowRunStore } = await import("../src/backend/workflows/workflow-run-store");
const { WorkflowStore } = await import("../src/backend/workflows/workflow-store");
const { workflowScheduleDueAt } = await import("../src/backend/workflows/workflow-triggers");
const { createWorkflows } = await import("../src/backend/workflows/workflows");

const CALL_MARK = "WORKFLOW-CALL";
const PERSON = { id: "local", name: "Alex" };
/** A team member, whose app has only what the Team API gives it. */
const MEMBER = { id: "member-remote", name: "Sam" };
const REFUSAL = "Only a person's message";

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `WORKFLOW-CALL <<ARGS{"__tool":"…",…}ARGS>>` calls `openbot.<__tool>` with the rest of that JSON
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

/** The arguments the fake passes to the tool. */
interface WorkflowToolArgs {
  workflowId?: string;
  title?: string;
  brief?: string;
  ops?: (
    | { op: "add"; ref: string; kind: "trigger"; fields: { trigger: "manual" } }
    // Not valid: a field value cannot be an object.
    | { op: "update"; node: string; fields: { schedule: { kind: string } } }
  )[];
}

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
let workflows: WorkflowsHandle | null = null;
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  timezone: () => "UTC",
  channelRemotePerson: (personId) => personId === MEMBER.id,
  // Full access: a workflow delete must still ask the person.
  approvalAutomation: {
    autoApproves: () => true,
    set: () => Effect.succeed({ defaultAutoApprove: true, autoApproveOverrides: {} }),
  },
  workflowTools: () => {
    assert.ok(workflows, "The workflow service is not ready.");
    return workflows;
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

const callText = (tool: string, args: WorkflowToolArgs) =>
  `${CALL_MARK} <<ARGS${JSON.stringify({ __tool: tool, ...args })}ARGS>>`;

/** Sends a message to the agent's own chat that makes the fake call `tool`. */
async function callFromChat(
  name: string,
  agentId: string,
  tool: string,
  args: WorkflowToolArgs,
  sender: { id: string; name: string } = PERSON,
) {
  const before = toolLogs().length;
  await runCauseEffect(agents.sendMessage({ agentId, text: callText(tool, args) }, sender));
  const result = await logged(name, before);
  await idle(agentId);
  return result;
}

/** Asks the agent to delete the workflow, and answers its approval card as the person. */
async function deleteWithAnswer(name: string, agentId: string, workflowId: string, decision: "accept" | "decline") {
  const before = approvals.length;
  const result = callFromChat(name, agentId, "delete_workflow", { workflowId });
  const approval = await waitFor(`${name} approval`, () => approvals[before]);
  await runCauseEffect(agents.respondToApproval({ requestId: approval.requestId, decision }));
  return { ...(await result), reason: approval.reason };
}

/** Runs a routine whose instruction makes the fake call `tool`, as a webhook body could. */
async function callFromRoutine(name: string, agentId: string, tool: string, args: WorkflowToolArgs) {
  const before = toolLogs().length;
  const routine = agents.createRoutine({
    agentId,
    name,
    instruction: callText(tool, args),
    active: false,
    timezone: "UTC",
    schedule: { kind: "daily", time: "09:00" },
  });
  await runCauseEffect(agents.testRoutine({ agentId, routineId: routine.id }));
  const result = await logged(name, before);
  await idle(agentId);
  return result;
}

/** Waits until no side thread of the agent has a turn that runs or waits to start. */
function threadsIdle(agentId: string) {
  return waitFor("the side thread turns to end", () =>
    agents.listTasks(agentId).tasks.every((task) => task.state !== "running" && task.state !== "queued"),
  );
}

/** Starts a side thread as the person, with a first message that makes the fake call `tool`. */
async function callFromNewThread(name: string, agentId: string, tool: string, args: WorkflowToolArgs) {
  const before = toolLogs().length;
  await runCauseEffect(agents.startTask({ agentId, text: callText(tool, args) }, PERSON));
  const result = await logged(name, before);
  await threadsIdle(agentId);
  return result;
}

/** The workflow's title and revision, or null when it is gone. */
async function stored(workflowId: string) {
  assert.ok(workflows);
  const summary = (await Effect.runPromise(workflows.list())).find((item) => item.id === workflowId);
  if (!summary) return null;
  const detail = await Effect.runPromise(workflows.get(workflowId));
  return { title: summary.title, revision: detail.revision, nodes: detail.graph.nodes.length };
}

try {
  await runCauseEffect(agents.initialize());
  workflows = await Effect.runPromise(
    createWorkflows({
      store: new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") }),
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => ({ status: "running", turnId: null, error: null }),
      turnAnswer: () => null,
      sendHandoff: () => Effect.succeed(`delivery-${crypto.randomUUID()}`),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No output step runs in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Builder",
      description: "Builder makes workflows.",
      avatarSeed: "builder",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  await idle(agent.id);

  // 1. A person's message in the agent's own chat creates a workflow.
  const created = await callFromChat("create from the person", agent.id, "edit_workflow", {
    title: "Gate check",
    ops: [{ op: "add", ref: "start", kind: "trigger", fields: { trigger: "manual" } }],
  });
  const workflowId = created.success
    ? z.object({ workflowId: z.string() }).parse(JSON.parse(created.text)).workflowId
    : "";
  const before = await stored(workflowId);
  pass("A person's message can create a workflow", created.success && before?.nodes === 1, created.text);
  assert.ok(before);

  // A schedule put in the fields fails the schema. The model gets the field path as a tool failure,
  // not a JSON-RPC error, which Codex replaces with "dynamic tool request failed".
  const badArgs = await callFromChat("edit with a field that is an object", agent.id, "edit_workflow", {
    workflowId,
    ops: [{ op: "update", node: "start", fields: { schedule: { kind: "daily" } } }],
  });
  pass(
    "Bad arguments give a tool failure that names the field",
    !badArgs.success &&
      badArgs.text.includes("ops.0.fields.schedule") &&
      JSON.stringify(await stored(workflowId)) === JSON.stringify(before),
    badArgs.text,
  );

  // 2. A routine run reads, but cannot change, run or delete the workflow.
  const read = await callFromRoutine("read from a routine run", agent.id, "read_workflow", { workflowId });
  pass("A routine run can read a workflow", read.success && read.text.includes("trigger"), read.text);
  const listed = await callFromRoutine("list from a routine run", agent.id, "list_workflows", {});
  pass("A routine run can list workflows", listed.success && listed.text.includes("Gate check"), listed.text);
  for (const [tool, args] of [
    ["edit_workflow", { workflowId, title: "Changed by a run" }],
    ["run_workflow", { workflowId }],
    ["delete_workflow", { workflowId }],
  ] as const) {
    const refused = await callFromRoutine(`${tool} from a routine run`, agent.id, tool, args);
    pass(`A routine run cannot use ${tool}`, !refused.success && refused.text.includes(REFUSAL), refused.text);
  }
  const runsAfterRoutine = await callFromChat("runs after the routine", agent.id, "read_workflow_runs", {
    workflowId,
  });
  pass(
    "The refused calls changed and ran nothing",
    JSON.stringify(await stored(workflowId)) === JSON.stringify(before) &&
      runsAfterRoutine.success &&
      z.object({ runs: z.array(z.unknown()) }).parse(JSON.parse(runsAfterRoutine.text)).runs.length === 0,
    runsAfterRoutine.text,
  );

  // 3. A team member's message is refused, also for a read: the Team API checks that member's agent access.
  const fromMember = await callFromChat(
    "edit from a team member",
    agent.id,
    "edit_workflow",
    { workflowId, title: "Changed by a member" },
    MEMBER,
  );
  pass(
    "A team member's message cannot use edit_workflow",
    !fromMember.success &&
      fromMember.text.includes(REFUSAL) &&
      JSON.stringify(await stored(workflowId)) === JSON.stringify(before),
    fromMember.text,
  );
  const readFromMember = await callFromChat(
    "read from a team member",
    agent.id,
    "read_workflow",
    { workflowId },
    MEMBER,
  );
  pass(
    "A team member's message cannot read workflows",
    !readFromMember.success && !readFromMember.text.includes(workflowId),
    readFromMember.text,
  );

  // 4. A side thread that the person opened counts as the person's chat.
  const fromThread = await callFromNewThread("edit from the person's side thread", agent.id, "edit_workflow", {
    workflowId,
    title: "Gate check 2",
  });
  const renamed = await stored(workflowId);
  pass(
    "A person's message in a side thread they opened can use edit_workflow",
    fromThread.success && renamed?.title === "Gate check 2",
    fromThread.text,
  );
  assert.ok(renamed);

  // 5. A thread that the agent started with start_task does not, also for the person's later message.
  const started = await callFromChat("start a thread as the agent", agent.id, "start_task", {
    title: "Agent thread",
    brief: "Say hello.",
  });
  await threadsIdle(agent.id);
  const agentThread = agents.listTasks(agent.id).tasks.find((task) => task.origin === "agent");
  assert.ok(started.success && agentThread, started.text);
  const beforeAgentThread = toolLogs().length;
  await runCauseEffect(
    agents.sendMessage(
      { agentId: agent.id, taskId: agentThread.id, text: callText("edit_workflow", { workflowId, title: "No" }) },
      PERSON,
    ),
  );
  const inAgentThread = await logged("edit in the agent's thread", beforeAgentThread);
  await threadsIdle(agent.id);
  pass(
    "A person's message in a thread that the agent started cannot use edit_workflow",
    !inAgentThread.success &&
      inAgentThread.text.includes(REFUSAL) &&
      JSON.stringify(await stored(workflowId)) === JSON.stringify(renamed),
    inAgentThread.text,
  );

  // 6. The person runs and deletes the workflow.
  const run = await callFromChat("run from the person", agent.id, "run_workflow", { workflowId });
  pass("A person's message can run a workflow", run.success && run.text.includes("runId"), run.text);
  pass("No refused call showed an approval card", approvals.length === 0, JSON.stringify(approvals));
  const declined = await deleteWithAnswer("delete declined", agent.id, workflowId, "decline");
  pass(
    "A delete waits for the person's approval, also with Full access, and a decline keeps the workflow",
    declined.reason?.includes("Gate check 2") === true &&
      !declined.success &&
      declined.text.includes("declined") &&
      (await stored(workflowId)) !== null,
    `${declined.reason} ${declined.text}`,
  );
  const removed = await deleteWithAnswer("delete from the person", agent.id, workflowId, "accept");
  pass(
    "A person's message can delete a workflow after the approval",
    removed.success && (await stored(workflowId)) === null,
    removed.text,
  );

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  if (workflows) await Effect.runPromise(workflows.close()).catch(() => {});
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
