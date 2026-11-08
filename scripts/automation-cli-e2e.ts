// Runs `resources/cli/openbot-cli.mjs` as a child process against the real `AutomationServer` on a
// loopback port. The agent service behind the server is a small in-memory stand-in: a message gets a
// delivery that moves from queued to running to its end each time the CLI reads it. The script checks
// the CLI's output and exit codes for each outcome and that the token never reaches the output.
// Writes .openbot-build/automation-cli-e2e/report.json. Run: `bun scripts/automation-cli-e2e.ts`.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  type AgentModelOption,
  DEFAULT_AGENT_DEFAULTS,
  type QueueDelivery,
  type QueuedMessageReceipt,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { ContextResetBusyError } from "@openbot/contracts/team-protocol/context-reset-v1";
import { Effect } from "effect";
import { AgentSettingsRefused } from "../src/backend/agent/agent-settings-refused";
import { AutomationServer, type UpdatedAgent } from "../src/main/automation-server";

const OUT = resolve(import.meta.dirname, "../.openbot-build/automation-cli-e2e");
const CLI = resolve(import.meta.dirname, "../resources/cli/openbot-cli.mjs");

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

/** How a message's delivery ends, chosen by the message text. */
type Outcome = "completed" | "failed" | "person" | "forever" | "behind" | "restart";

interface FakeDelivery {
  id: string;
  agentId: string;
  outcome: Outcome;
  reads: number;
}

const agents = [
  {
    id: "agent-ada",
    name: "Ada",
    allowAutomation: true,
    provider: "claude",
    model: "claude-sonnet-5-5",
    reasoningEffort: "high",
  },
  {
    id: "agent-bo",
    name: "Bo",
    allowAutomation: false,
    provider: "claude",
    model: "claude-sonnet-5-5",
    reasoningEffort: "high",
  },
] as const;
function model(
  provider: AgentModelOption["provider"],
  id: string,
  defaultReasoningEffort: AgentModelOption["defaultReasoningEffort"],
  supportedReasoningEfforts: AgentModelOption["supportedReasoningEfforts"],
): AgentModelOption {
  return { provider, id, name: id, description: "", defaultReasoningEffort, supportedReasoningEfforts };
}
const models = [
  model("claude", "claude-sonnet-5-5", "high", ["low", "medium", "high"]),
  model("claude", "claude-opus-5-5", "high", ["low", "medium", "high", "max"]),
  model("codex", "gpt-5.5", "medium", ["low", "medium"]),
];
const deliveries = new Map<string, FakeDelivery>();
const updates: UpdateAgentInput[] = [];
const cleared: string[] = [];
const attentionResponses: unknown[] = [];
const routineRuns: unknown[] = [];
let busy = false;
/** The account default "Requests an hour" of Settings › Agents › Local scripts. */
let automationRunsPerHour = DEFAULT_AGENT_DEFAULTS.automationRunsPerHour;

function deliveryState(
  delivery: FakeDelivery,
): Pick<QueueDelivery, "recipientAgentId" | "status" | "turnId" | "error"> {
  delivery.reads += 1;
  const base = { recipientAgentId: delivery.agentId, turnId: delivery.reads > 1 ? `turn-${delivery.id}` : null };
  if (delivery.reads === 1 || delivery.outcome === "behind") return { ...base, status: "queued", error: null };
  // OpenBot restarts while the CLI waits: the next read comes through a new port and token.
  if (delivery.reads === 2 && delivery.outcome === "restart") restarted = restart();
  if (delivery.reads < 3 || delivery.outcome === "person" || delivery.outcome === "forever")
    return { ...base, status: "running", error: null };
  if (delivery.outcome === "failed") return { ...base, status: "failed", error: "The provider stopped." };
  return { ...base, status: "completed", error: null };
}

const root = mkdtempSync(join(tmpdir(), "openbot-cli-e2e-"));
const options: ConstructorParameters<typeof AutomationServer>[0] = {
  root,
  listAgents: () => agents,
  agentDefaults: () => ({ ...DEFAULT_AGENT_DEFAULTS, automationRunsPerHour }),
  listModels: () => models,
  listRoutines: () => [{ id: "routine-1", name: "Wake", active: false }],
  runRoutine: (input) => {
    routineRuns.push(input);
    return Effect.succeed({ id: "run-1", deliveryId: null });
  },
  sendMessage: (input) => {
    const id = `delivery-${deliveries.size + 1}`;
    const outcome: Outcome =
      input.text === "please fail"
        ? "failed"
        : input.text === "ask me"
          ? "person"
          : input.text === "forever"
            ? "forever"
            : input.text === "behind a question"
              ? "behind"
              : input.text === "restart"
                ? "restart"
                : "completed";
    deliveries.set(id, { id, agentId: input.agentId, outcome, reads: 0 });
    const receipt: QueuedMessageReceipt = {
      messageId: `message-${id}`,
      deliveries: [{ id, recipientAgentId: input.agentId, status: "queued", position: 1 }],
    };
    return Effect.succeed(receipt);
  },
  getLocalAttention: (agentId) => {
    // Only the newest delivery can wait: an earlier question is gone once the next test starts. A
    // delivery that stays queued waits behind an earlier turn's question.
    const newest = [...deliveries.values()].at(-1);
    const waiting = newest?.agentId === agentId && (newest.outcome === "person" || newest.outcome === "behind");
    return {
      prompts: [],
      approvals: [],
      browserTakeovers: waiting ? [{ requestId: "takeover-1", requiresOpenBot: true }] : [],
    };
  },
  respondToLocalAttention: (agentId, input) => {
    attentionResponses.push({ agentId, ...input });
    return Effect.void;
  },
  delivery: (deliveryId) => {
    const delivery = deliveries.get(deliveryId);
    return delivery ? deliveryState(delivery) : null;
  },
  turnAnswer: (_agentId, turnId) => `Answer of ${turnId}`,
  updateAgent: (input) => {
    if (busy) return Effect.fail({ cause: new AgentSettingsRefused("Wait until the agent is idle.") });
    if (input.providerAccountId === "a0000000000000000") return Effect.fail({ cause: new Error("disk full") });
    updates.push(input);
    const agent: UpdatedAgent = {
      id: input.agentId,
      name: "Ada",
      provider: input.provider ?? "claude",
      model: input.model ?? "claude-sonnet-5-5",
      reasoningEffort: input.reasoningEffort ?? "high",
      ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}),
    };
    return Effect.succeed(agent);
  },
  clearAgentContext: (agentId) => {
    if (busy) return Effect.fail({ cause: new ContextResetBusyError("Wait for the active turn to finish.") });
    cleared.push(agentId);
    return Effect.void;
  },
};
let server = new AutomationServer(options);
let restarted: Promise<void> | null = null;
function restart(): Promise<void> {
  const old = server;
  server = new AutomationServer(options);
  return Effect.runPromise(Effect.andThen(old.stop(), server.sync()));
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(args: string[], stdin?: string): Promise<Run> {
  return new Promise((done, fail) => {
    // The CLI is for Node, which is what users have; Bun runs only this script.
    const child = spawn("node", [CLI, ...args], {
      env: { ...process.env, OPENBOT_AUTOMATION_DIR: root },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

mkdirSync(OUT, { recursive: true });
const checks: Check[] = [];
const outputs: string[] = [];
async function check(name: string, args: string[], expectCode: number, test: (run: Run) => boolean, stdin?: string) {
  const run = await cli(args, stdin);
  outputs.push(run.stdout, run.stderr);
  checks.push({ name, passed: run.code === expectCode && test(run), detail: run });
}
const parsed = (run: Run) => JSON.parse(run.stdout);

async function mcpChecks() {
  const standalone = join(root, "openbot-cli.mjs");
  copyFileSync(CLI, standalone);
  const client = new Client({ name: "openbot-e2e", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [standalone, "mcp"],
    env: { PATH: process.env.PATH ?? "", OPENBOT_AUTOMATION_DIR: root },
    stderr: "pipe",
    cwd: tmpdir(),
  });
  transport.stderr?.on("data", (chunk: Buffer) => outputs.push(chunk.toString()));
  const verify = (name: string, passed: boolean, detail: unknown) => checks.push({ name, passed, detail });
  const call = async (name: string, args: Parameters<Client["callTool"]>[0]["arguments"]) => {
    const result = await client.callTool({ name, arguments: args });
    outputs.push(JSON.stringify(result));
    assert(Array.isArray(result.content));
    const text = result.content.find((item) => item.type === "text")?.text;
    assert.equal(typeof text, "string");
    return { error: result.isError === true, value: result.isError ? text : JSON.parse(text) };
  };
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    outputs.push(JSON.stringify(listed));
    verify(
      "MCP lists all nine tools with approval and new-chat annotations",
      listed.tools.length === 9 &&
        ["respond_to_approval", "new_chat"].every(
          (name) => listed.tools.find((tool) => tool.name === name)?.annotations?.destructiveHint === true,
        ),
      listed,
    );
    const agents = await call("list_agents", {});
    verify(
      "MCP lists only enabled agents and routines",
      !agents.error && agents.value.agents.length === 1 && agents.value.agents[0].routines[0].id === "routine-1",
      agents,
    );
    const queued = await call("send_message", { agent: "Ada", text: "hello", clientMessageId: "mcp-retry" });
    verify("MCP sends work without waiting", !queued.error && queued.value.status === "queued", queued);
    const progress: string[] = [];
    const complete = await client.callTool(
      {
        name: "send_message",
        arguments: { agent: "Ada", text: "hello", wait: true },
        _meta: { progressToken: "wait-1" },
      },
      undefined,
      {
        onprogress: (value) => {
          progress.push(value.message ?? "");
          outputs.push(JSON.stringify(value));
        },
      },
    );
    outputs.push(JSON.stringify(complete));
    assert(Array.isArray(complete.content));
    const answer = complete.content.find((item) => item.type === "text")?.text;
    assert.equal(typeof answer, "string");
    const completed = JSON.parse(answer);
    verify(
      "MCP waits for the answer and sends progress",
      completed.status === "completed" &&
        completed.answer === `Answer of turn-${completed.deliveryId}` &&
        progress.includes("queued") &&
        progress.includes("completed"),
      completed,
    );
    const delivery = await call("get_delivery", { agent: "Ada", deliveryId: completed.deliveryId });
    verify("MCP reads the delivery answer", !delivery.error && delivery.value.answer === completed.answer, delivery);
    const person = await call("send_message", { agent: "Ada", text: "ask me", wait: true });
    verify("MCP returns needs-person", !person.error && person.value.state === "needs-person", person);
    const pending = await call("get_pending", { agent: "Ada" });
    verify(
      "MCP reads pending attention",
      !pending.error && pending.value.browserTakeovers[0].requiresOpenBot === true,
      pending,
    );
    const question = await call("answer_question", {
      agent: "Ada",
      requestId: "question-1",
      answers: { build: ["Debug"] },
    });
    verify(
      "MCP submits the question answer",
      !question.error &&
        question.value.ok &&
        JSON.stringify(attentionResponses.at(-1)) ===
          JSON.stringify({
            agentId: "agent-ada",
            kind: "prompt",
            requestId: "question-1",
            answers: { build: ["Debug"] },
          }),
      attentionResponses.at(-1),
    );
    for (const decision of ["accept", "decline"]) {
      const approval = await call("respond_to_approval", { agent: "Ada", requestId: "approval-1", decision });
      verify(
        `MCP submits approval ${decision}`,
        !approval.error &&
          approval.value.ok &&
          JSON.stringify(attentionResponses.at(-1)) ===
            JSON.stringify({ agentId: "agent-ada", kind: "approval", requestId: "approval-1", decision }),
        attentionResponses.at(-1),
      );
    }
    const routine = await call("run_routine", { agent: "Ada", routineId: "routine-1", payload: "build done" });
    verify(
      "MCP runs a routine",
      !routine.error &&
        routine.value.runId === "run-1" &&
        JSON.stringify(routineRuns.at(-1)) ===
          JSON.stringify({ agentId: "agent-ada", routineId: "routine-1", payload: "build done" }),
      routine,
    );
    const updated = await call("update_agent", { agent: "Ada", model: "claude-opus-5-5", reasoningEffort: "max" });
    verify(
      "MCP updates the agent",
      !updated.error && updated.value.model === "claude-opus-5-5" && updates.at(-1)?.reasoningEffort === "max",
      updated,
    );
    const count = cleared.length;
    const chat = await call("new_chat", { agent: "Ada" });
    verify("MCP starts a new chat", !chat.error && chat.value.ok && cleared.length === count + 1, chat);
    const timeout = await call("send_message", { agent: "Ada", text: "forever", wait: true, timeout: "0s" });
    verify(
      "MCP timeout leaves the delivery queued",
      !timeout.error && timeout.value.state === "timed-out" && deliveries.has(timeout.value.deliveryId),
      timeout,
    );
    const failed = await call("send_message", { agent: "Ada", text: "please fail", wait: true });
    verify(
      "MCP returns a failed turn",
      !failed.error && failed.value.status === "failed" && failed.value.error === "The provider stopped.",
      failed,
    );
    const before = deliveries.size;
    const invalid = await call("send_message", { agent: "Ada", text: "hello", wait: "yes" });
    verify("MCP refuses invalid input without sending work", invalid.error && deliveries.size === before, invalid);
    const disabled = await call("send_message", { agent: "Bo", text: "hello" });
    verify("MCP refuses an agent without Local scripts", disabled.error && deliveries.size === before, disabled);
    await Effect.runPromise(server.stop());
    const stopped = await call("list_agents", {});
    verify(
      "MCP reports OpenBot not running",
      stopped.error && stopped.value.includes("OpenBot is not running"),
      stopped,
    );
  } catch (error) {
    verify("MCP client completes the tool checks", false, String(error));
  } finally {
    await client.close();
  }
}

try {
  const runtime = spawnSync("node", ["-p", "JSON.stringify({node:process.versions.node,bun:process.versions.bun})"], {
    encoding: "utf8",
  });
  const version = runtime.status === 0 ? JSON.parse(runtime.stdout) : null;
  checks.push({
    name: "child processes use Node 18 or later",
    passed: !!version && !version.bun && Number(version.node.split(".")[0]) >= 18,
    detail: version,
  });
  await Effect.runPromise(server.sync());
  const token = readFileSync(join(root, "token"), "utf8").trim();

  await check("list shows only agents with Local scripts", ["list", "--json"], 0, (run) => {
    const value = parsed(run);
    return value.ok === true && value.agents.length === 1 && value.agents[0].name === "Ada";
  });
  await check("run without --wait returns the queued delivery", ["run", "ada", "hello", "--json"], 0, (run) => {
    const value = parsed(run);
    return value.status === "queued" && value.deliveryId === "delivery-1";
  });
  await check("run --wait prints the turn's answer", ["run", "Ada", "do it", "--wait"], 0, (run) => {
    return run.stdout.trim() === "Answer of turn-delivery-2";
  });
  await check(
    "run --wait --json ends completed with the answer",
    ["run", "agent-ada", "-", "--wait", "--json"],
    0,
    (run) => {
      const value = parsed(run);
      return value.status === "completed" && value.answer === "Answer of turn-delivery-3";
    },
    "a task from stdin",
  );
  await check("a failed turn exits 1", ["run", "Ada", "please fail", "--wait", "--json"], 1, (run) => {
    const value = parsed(run);
    return value.status === "failed" && value.error === "The provider stopped.";
  });
  await check("a turn that waits for a person exits 3", ["run", "Ada", "ask me", "--wait", "--json"], 3, (run) => {
    return parsed(run).state === "needs-person";
  });
  await check(
    "a turn that runs past the timeout exits 4",
    ["run", "Ada", "forever", "--wait", "--timeout", "3s"],
    4,
    (run) => run.stdout.includes("Timed out"),
  );
  await check("status reads a delivery", ["status", "Ada", "delivery-2", "--json"], 0, (run) => {
    return parsed(run).answer === "Answer of turn-delivery-2";
  });
  await check(
    "a task queued behind a question exits 3",
    ["run", "Ada", "behind a question", "--wait", "--json"],
    3,
    (run) => parsed(run).state === "needs-person",
  );
  await check("status of an unknown delivery exits 1", ["status", "Ada", "delivery-404"], 1, (run) => {
    return run.stderr.length > 0;
  });
  const sent = deliveries.size;
  await check(
    "a wrong --timeout exits 2 and sends nothing",
    ["run", "Ada", "hello", "--wait", "--timeout", "soon"],
    2,
    (run) => {
      return run.stderr.length > 0 && deliveries.size === sent;
    },
  );
  await check("an agent without Local scripts is not found", ["run", "Bo", "hello"], 5, (run) => {
    return run.stderr.includes('No agent "Bo"');
  });
  await check("a wrong command line exits 2", ["run", "Ada"], 2, (run) => run.stderr.includes("Usage:"));
  const oldUrl = readFileSync(join(root, "url"), "utf8");
  await check(
    "run --wait continues after OpenBot restarts",
    ["run", "Ada", "restart", "--wait", "--json"],
    0,
    (run) => {
      return parsed(run).status === "completed" && readFileSync(join(root, "url"), "utf8") !== oldUrl;
    },
  );
  await restarted;
  const newToken = readFileSync(join(root, "token"), "utf8").trim();
  await check("set-account changes the account", ["agent", "set-account", "Ada", "a0123456789abcdef"], 0, (run) => {
    return (
      run.stdout.includes("account a0123456789abcdef") && updates.at(-1)?.providerAccountId === "a0123456789abcdef"
    );
  });
  await check(
    "set-model sends the model and the effort",
    ["agent", "set-model", "Ada", "claude-opus-5-5", "--effort", "max", "--json"],
    0,
    (run) => parsed(run).agent.model === "claude-opus-5-5" && updates.at(-1)?.reasoningEffort === "max",
  );
  await check("set-model takes the provider from the model", ["agent", "set-model", "Ada", "gpt-5.5"], 0, () => {
    const update = updates.at(-1);
    // The agent's `high` is not supported by gpt-5.5, so the model's default replaces it.
    return update?.provider === "codex" && update.model === "gpt-5.5" && update.reasoningEffort === "medium";
  });
  const updateCount = updates.length;
  await check(
    "an effort that the model does not support exits 1",
    ["agent", "set-model", "Ada", "claude-sonnet-5-5", "--effort", "max"],
    1,
    (run) => run.stderr.includes("max") && updates.length === updateCount,
  );
  await check(
    "an unexpected update failure exits 1 without its detail",
    ["agent", "set-account", "Ada", "a0000000000000000"],
    1,
    (run) => run.stderr.includes("internal error") && !run.stderr.includes("disk full"),
  );
  await check("an invalid account ID is refused", ["agent", "set-account", "Ada", "../x"], 1, (run) => {
    return run.stderr.includes("providerAccountId is invalid.");
  });
  await check("new-chat starts a new chat", ["agent", "new-chat", "Ada", "--json"], 0, (run) => {
    return parsed(run).cleared === true && cleared.at(-1) === "agent-ada";
  });
  await check("new-chat needs exactly one agent", ["agent", "new-chat"], 2, (run) => run.stderr.includes("Usage:"));
  // The restarted server has no runs yet, so the agent gets exactly the limit from the account default.
  automationRunsPerHour = 2;
  await check("a message under the limit is accepted", ["run", "Ada", "hello"], 0, () => true);
  await check("a message at the limit is accepted", ["run", "Ada", "hello"], 0, () => true);
  const beforeLimit = deliveries.size;
  await check("a message over the account limit exits 1 with the limit", ["run", "Ada", "hello"], 1, (run) => {
    return run.stderr.includes("2 message or routine requests") && deliveries.size === beforeLimit;
  });
  automationRunsPerHour = 3;
  await check("a raised limit accepts the next message at once", ["run", "Ada", "hello"], 0, () => {
    return deliveries.size === beforeLimit + 1;
  });
  busy = true;
  await check("a refused update exits 1 with its reason", ["agent", "set-account", "Ada", "default"], 1, (run) => {
    return run.stderr.includes("Wait until the agent is idle.");
  });
  await check("new-chat while the agent works exits 1 with its reason", ["agent", "new-chat", "Ada"], 1, (run) => {
    return run.stderr.includes("Wait for the active turn to finish.") && cleared.length === 1;
  });
  busy = false;
  automationRunsPerHour = DEFAULT_AGENT_DEFAULTS.automationRunsPerHour;
  await mcpChecks();
  await Effect.runPromise(server.stop());
  await check("a stopped app exits 5", ["list"], 5, (run) => run.stderr.includes("OpenBot is not running"));
  await check("a wrong command line exits 2 also when the app is stopped", ["agent", "foo", "Ada"], 2, (run) =>
    run.stderr.includes("Usage:"),
  );
  const leaked = outputs.some((text) => text.includes(token) || text.includes(newToken));
  for (const item of checks) {
    item.detail = JSON.parse(
      JSON.stringify(item.detail ?? null)
        .replaceAll(token, "[REDACTED]")
        .replaceAll(newToken, "[REDACTED]"),
    );
  }
  checks.push({
    name: "the token is never in the output",
    passed: !leaked,
    detail: null,
  });
} finally {
  await Effect.runPromise(server.stop());
  rmSync(root, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, checks }, null, 2)}\n`);
for (const item of checks) process.stdout.write(`${item.passed ? "ok" : "FAILED"} ${item.name}\n`);
assert.equal(failed.length, 0, `${failed.length} checks failed; see ${join(OUT, "report.json")}`);
