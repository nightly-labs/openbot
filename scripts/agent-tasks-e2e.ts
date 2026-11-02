// Runs agent tasks end to end in this worktree's running dev app, through the real preload bridge,
// IPC, agent service and provider. It changes the data of the profile, so start the app with
// `bun run dev` (never `--shared`), and pass the id of an agent whose provider is signed in and runs
// turns at the same time (not a custom ACP agent):
// `bun scripts/agent-tasks-e2e.ts --allow-mutations --agent=<agent id>`.
//
// It checks the task limit and its hold, a raised limit that starts the waiting task, Stop, a
// provider switch queued while a task runs, and that the task list reports the `error` field. Each
// task turn is a real provider turn, so keep the prompts short. At the end it stops and closes the
// tasks it started and gives the agent its task limit back.
// Writes .openbot-build/agent-tasks-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import {
  type AgentSummary,
  type AgentTask,
  type AgentTasksSnapshot,
  type ClientAgentSummary,
  isAgentModelOption,
  isAgentSummary,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-tasks-e2e");
const argument = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of an agent whose provider is signed in.");
const agentId: string = agentArgument;

// Long enough that the first task still runs while the script reads the second one.
const LONG_PROMPT = "Write a numbered list of 40 short facts about rivers. Do not use tools.";
const SHORT_PROMPT = "Reply with the single word ready. Do not use tools.";
const WAIT_MS = 120_000;

interface Report {
  agentId: string;
  provider?: string;
  limitOne?: { first: string; second: string; secondHold: string | null; limit: number };
  raisedLimit?: { second: string; limit: number };
  stop?: { states: string[]; outcomes: Array<string | null> };
  providerSwitch?: {
    refused: boolean;
    target: string | null;
    provider?: string;
    pendingProvider?: string | null;
    pendingModel?: string | null;
  };
  errorField?: { present: boolean };
  restored?: { taskLimit: number | null };
  passed: boolean;
}

const report: Report = { agentId, passed: false };
const started: string[] = [];

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "agent-tasks-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("agent-tasks-e2e"), {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;

function listTasks(): Promise<AgentTasksSnapshot> {
  return page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
}

async function readAgent(): Promise<AgentSummary> {
  const agent = await page.evaluate(async (id) => {
    const agent = (await window.openbot.agent.listAgents()).find((candidate) => candidate.id === id);
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    return agent;
  }, agentId);
  if (!isAgentSummary(agent)) throw new Error(`The agent ${agentId} has a provider that this build does not know.`);
  return agent;
}

function setTaskLimit(taskLimit: number | null): Promise<ClientAgentSummary> {
  return page.evaluate(({ id, limit }) => window.openbot.agent.updateAgent({ agentId: id, taskLimit: limit }), {
    id: agentId,
    limit: taskLimit,
  });
}

async function startTask(text: string): Promise<AgentTask> {
  const task = await page.evaluate(
    ({ id, prompt }) =>
      window.openbot.agent.startTask({ agentId: id, text: prompt, clientMessageId: crypto.randomUUID() }),
    { id: agentId, prompt: text },
  );
  started.push(task.id);
  return task;
}

/** Reads the task list until `ready` accepts it. The app pushes no event to this script, so it reads again. */
async function waitForTasks(
  label: string,
  ready: (snapshot: AgentTasksSnapshot) => boolean,
): Promise<AgentTasksSnapshot> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const snapshot = await listTasks();
    if (ready(snapshot)) return snapshot;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}. Tasks: ${JSON.stringify(snapshot.tasks)}`);
    await page.waitForTimeout(250);
  }
}

const taskIn = (snapshot: AgentTasksSnapshot, taskId: string): AgentTask => {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task, `Task ${taskId} is not in the list.`);
  return task;
};

const before = await readAgent();
report.provider = before.provider;
assert.ok(
  agentProviderDescriptor(before.provider).concurrentTurns,
  `${before.provider} runs one turn at a time. Choose an agent on another provider.`,
);
const originalLimit = before.taskLimit ?? null;

try {
  // 1. With a limit of 1, the second task waits for the first one, and says why.
  await setTaskLimit(1);
  const first = await startTask(LONG_PROMPT);
  await waitForTasks("the first task runs", (snapshot) => taskIn(snapshot, first.id).state === "running");
  const second = await startTask(SHORT_PROMPT);
  const held = await waitForTasks(
    "the second task waits",
    (snapshot) => taskIn(snapshot, second.id).state === "queued" && taskIn(snapshot, first.id).state === "running",
  );
  report.limitOne = {
    first: taskIn(held, first.id).state,
    second: taskIn(held, second.id).state,
    secondHold: taskIn(held, second.id).hold,
    limit: held.limit,
  };
  assert.equal(held.limit, 1);
  assert.equal(taskIn(held, second.id).hold, "task-limit");

  // 2. A higher limit starts the waiting task while the first one still runs.
  await setTaskLimit(2);
  const raised = await waitForTasks(
    "the second task starts",
    (snapshot) => taskIn(snapshot, second.id).state !== "queued",
  );
  report.raisedLimit = { second: taskIn(raised, second.id).state, limit: raised.limit };
  assert.equal(raised.limit, 2);

  // 3. A provider switch while a task runs is queued for the next turn.
  const models = await page.evaluate(() => window.openbot.agent.listModels());
  const target = models.filter(isAgentModelOption).find((model) => model.provider !== before.provider) ?? null;
  const running = await listTasks();
  if (target && taskIn(running, first.id).state === "running") {
    const outcome = await page.evaluate(
      async ({ id, provider, model }) => {
        const agent = await window.openbot.agent.updateAgent({ agentId: id, provider, model });
        return {
          refused: false,
          provider: agent.provider,
          pendingProvider: agent.pendingRuntime?.provider ?? null,
          pendingModel: agent.pendingRuntime?.model ?? null,
        };
      },
      { id: agentId, provider: target.provider, model: target.id },
    );
    report.providerSwitch = { ...outcome, target: `${target.provider}/${target.id}` };
    assert.equal(outcome.refused, false, "The provider switch is queued while a task runs.");
    assert.equal(outcome.provider, before.provider, "The running provider stays until the task ends.");
    assert.equal(outcome.pendingProvider, target.provider);
    assert.equal(outcome.pendingModel, target.id);
    await page.evaluate(
      ({ id, provider, model }) => window.openbot.agent.updateAgent({ agentId: id, provider, model }),
      { id: agentId, provider: before.provider, model: before.model },
    );
  } else {
    report.providerSwitch = { refused: false, target: null };
  }

  // 4. Stop ends each task's turn as interrupted.
  for (const taskId of [first.id, second.id]) {
    await page.evaluate(({ id, task }) => window.openbot.agent.stopTask({ agentId: id, taskId: task }), {
      id: agentId,
      task: taskId,
    });
  }
  const stopped = await waitForTasks("both tasks stop", (snapshot) =>
    [first.id, second.id].every((taskId) => taskIn(snapshot, taskId).state === "idle"),
  );
  report.stop = {
    states: [first.id, second.id].map((taskId) => taskIn(stopped, taskId).state),
    outcomes: [first.id, second.id].map((taskId) => taskIn(stopped, taskId).outcome),
  };
  // The second task can finish its short turn before Stop reaches it.
  assert.equal(taskIn(stopped, first.id).outcome, "interrupted");

  // 5. The list reports the stored error of each task: null after a turn that did not fail.
  report.errorField = { present: stopped.tasks.every((task) => "error" in task) };
  assert.ok(report.errorField.present);
  report.passed = true;
} finally {
  for (const taskId of started) {
    await page
      .evaluate(({ id, task }) => window.openbot.agent.stopTask({ agentId: id, taskId: task }), {
        id: agentId,
        task: taskId,
      })
      .catch(() => undefined);
  }
  if (started.length > 0) {
    await waitForTasks("the started tasks stop", (snapshot) =>
      started.every((taskId) => taskIn(snapshot, taskId).state !== "running"),
    ).catch(() => undefined);
  }
  for (const taskId of started) {
    await page
      .evaluate(({ id, task }) => window.openbot.agent.closeTask({ agentId: id, taskId: task }), {
        id: agentId,
        task: taskId,
      })
      .catch(() => undefined);
  }
  const restored = await setTaskLimit(originalLimit);
  report.restored = { taskLimit: restored.taskLimit ?? null };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
