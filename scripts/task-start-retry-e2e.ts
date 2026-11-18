// Sends the same task start again, as a client does when the answer to the first start got lost, and
// checks that the host makes one task. Run it in this worktree's `bun run dev:test-client` stack: the
// app of this worktree is the host, and the test client reaches it through the Team API. It changes
// the data of the host profile and starts one real provider turn on each path, so the prompt is short.
// Pass an agent of the host whose provider is signed in:
// `bun scripts/task-start-retry-e2e.ts --allow-mutations --agent=<agent id>`
//
// 1. On the host: two starts at the same time and a third after them, with one client id, give one task.
// 2. From the test client, through the Team API: the same, with a new client id.
// At the end it deletes the tasks it started.
// Writes .openbot-build/task-start-retry-e2e/report.json.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { AgentTask, AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { argument, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const agentArgument = argument("agent");
assert.ok(agentArgument, "Pass --agent=<agent id> of a host agent whose provider is signed in.");
const agentId: string = agentArgument;

interface PathResult {
  taskIds: string[];
  newTasks: number;
}

interface Report {
  agentId: string;
  serverId?: string;
  host?: PathResult;
  teamApi?: PathResult;
  pageErrors: string[];
  passed: boolean;
}

const report: Report = { agentId, pageErrors: [], passed: false };
const host = await connectChannelE2e("task-start-retry-e2e");
const clientRecords = readDevInstanceRecords().filter(
  (record) => record.service === "test-client" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(clientRecords.length, 1, "Start `bun run dev:test-client` for this worktree first.");
const clientRecord = clientRecords[0];
assert.ok(clientRecord);
assertMutationAllowed({
  command: "task-start-retry-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: clientRecord.instanceId,
});
const client = await connectToDevApp(clientRecord.remoteDebuggingPort, createOpenBotLogger("task-start-retry-e2e"), {
  expectedRendererPort: clientRecord.rendererPort,
  ownerPid: clientRecord.pid,
});
for (const page of [host.page, client.page])
  page.on("pageerror", (error) => report.pageErrors.push(error.stack ?? error.message));
const started = new Set<string>();

function hostTasks(): Promise<AgentTasksSnapshot> {
  return host.page.evaluate((id) => window.openbot.agent.listTasks(id), agentId);
}

/** Starts one task three times with one client id: two starts at the same time, then one more. */
async function startThreeTimes(start: (clientMessageId: string) => Promise<AgentTask>): Promise<PathResult> {
  const before = new Set((await hostTasks()).tasks.map((task) => task.id));
  const clientMessageId = crypto.randomUUID();
  const first = await Promise.all([start(clientMessageId), start(clientMessageId)]);
  const again = await start(clientMessageId);
  const taskIds = [...first, again].map((task) => task.id);
  for (const id of taskIds) started.add(id);
  // The agent answers the first message once: the task is idle after one turn.
  const after = await waitFor(
    host.page,
    "the host runs the task",
    hostTasks,
    (snapshot) => snapshot.tasks.find((task) => task.id === taskIds[0])?.state === "idle",
  );
  const newTasks = after.tasks.filter((task) => !before.has(task.id)).length;
  return { taskIds, newTasks };
}

try {
  // 1. The host's own app.
  report.host = await startThreeTimes((clientMessageId) =>
    host.page.evaluate(
      ({ id, text, clientMessageId }) => window.openbot.agent.startTask({ agentId: id, text, clientMessageId }),
      { id: agentId, text: SHORT_PROMPT, clientMessageId },
    ),
  );
  assert.equal(new Set(report.host.taskIds).size, 1, "The host gave more than one task for one client id.");
  assert.equal(report.host.newTasks, 1, "The host made more than one task for one client id.");

  // 2. The test client, through the Team API.
  const servers = await client.page.evaluate(() => window.openbot.servers.list());
  const server = servers.find(
    (item) => item.kind === "remote" && item.compatibility?.capabilities.includes(AGENT_TASKS_CAPABILITY) === true,
  );
  assert.ok(server, `No joined server advertises ${AGENT_TASKS_CAPABILITY}. Start the host from this worktree.`);
  const serverId = server.id;
  report.serverId = serverId;
  report.teamApi = await startThreeTimes((clientMessageId) =>
    client.page.evaluate(
      ({ id, text, clientMessageId, server }) =>
        window.openbot.agent.startTask({ agentId: id, text, clientMessageId }, server),
      { id: agentId, text: SHORT_PROMPT, clientMessageId, server: serverId },
    ),
  );
  assert.equal(new Set(report.teamApi.taskIds).size, 1, "The Team API gave more than one task for one client id.");
  assert.equal(report.teamApi.newTasks, 1, "The Team API made more than one task for one client id.");
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} finally {
  for (const taskId of started)
    await host.page
      .evaluate((input) => window.openbot.agent.deleteTask(input), { agentId, taskId })
      .catch((error: unknown) => process.stderr.write(`Could not delete task ${taskId}: ${String(error)}\n`));
  writeReport("task-start-retry-e2e", report);
  await client.close();
  await host.close();
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
