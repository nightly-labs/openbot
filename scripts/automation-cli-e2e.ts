// Runs `resources/cli/openbot-cli.mjs` as a child process against the real `AutomationServer` on a
// loopback port. The agent service behind the server is a small in-memory stand-in: a message gets a
// delivery that moves from queued to running to its end each time the CLI reads it. The script checks
// the CLI's output and exit codes for each outcome and that the token never reaches the output.
// Writes .openbot-build/automation-cli-e2e/report.json. Run: `bun scripts/automation-cli-e2e.ts`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
let busy = false;

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
  agentDefaults: () => DEFAULT_AGENT_DEFAULTS,
  listModels: () => models,
  listRoutines: () => [],
  runRoutine: () => Effect.die(new Error("No routine runs in this test.")),
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
  respondToLocalAttention: () => Effect.void,
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

try {
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
  busy = true;
  await check("a refused update exits 1 with its reason", ["agent", "set-account", "Ada", "default"], 1, (run) => {
    return run.stderr.includes("Wait until the agent is idle.");
  });
  await check("new-chat while the agent works exits 1 with its reason", ["agent", "new-chat", "Ada"], 1, (run) => {
    return run.stderr.includes("Wait for the active turn to finish.") && cleared.length === 1;
  });
  busy = false;
  await Effect.runPromise(server.stop());
  await check("a stopped app exits 5", ["list"], 5, (run) => run.stderr.includes("OpenBot is not running"));
  await check("a wrong command line exits 2 also when the app is stopped", ["agent", "foo", "Ada"], 2, (run) =>
    run.stderr.includes("Usage:"),
  );
  checks.push({
    name: "the token is never in the output",
    passed: outputs.every((text) => !text.includes(token) && !text.includes(newToken)),
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
