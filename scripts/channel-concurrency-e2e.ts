import assert from "node:assert/strict";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type { AgentTask, ChannelPage, ChannelTask } from "@openbot/contracts/ipc";
import {
  ChannelClient,
  connectChannelE2e,
  hostCapabilities,
  LONG_PROMPT,
  queueBusy,
  SHORT_PROMPT,
  waitFor,
  writeReport,
} from "./channel-e2e-support";

interface Report {
  capabilities?: string[];
  archivedAtStart?: string[];
  restore?: { archived: boolean; restored: boolean };
  parallel?: { first: { owner: string | null; state: string }; second: { owner: string | null; state: string } };
  sameAgentInTwoChannels?: { agentId: string; first: string; third: string };
  ownChatBesideChannelTurn?: { busy: boolean; hold: unknown; channelTaskState: string };
  otherAgentRan?: { agentId: string; busy: boolean };
  taskBesideChannelTurn?: { state: string; channelTaskState: string };
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-concurrency-e2e");
const { page } = session;
const client = new ChannelClient(page);
const startedTasks: Array<{ agentId: string; taskId: string }> = [];

const runningTask = (channel: ChannelPage, ownerAgentId: string): ChannelTask | undefined =>
  channel.tasks.find((task) => task.ownerAgentId === ownerAgentId && task.state === "running");

try {
  report.capabilities = (await hostCapabilities(session.instance)).filter((capability) =>
    capability.startsWith("channel-"),
  );
  for (const capability of ["channel-chats-v1", "channel-delete-v1", "channel-attention-v1"])
    assert.ok(report.capabilities.includes(capability), `The host does not advertise ${capability}.`);

  report.archivedAtStart = (await client.list()).filter((channel) => channel.archived).map((channel) => channel.name);
  const agents = (await client.agents()).filter((agent) => agentProviderDescriptor(agent.provider).concurrentTurns);
  assert.ok(agents.length >= 4, "This check needs four visible agents whose provider runs turns at the same time.");
  const [a, b, c, d] = agents;
  assert.ok(a && b && c && d);
  const restoreCheck = await client.create("E2E restore", [a.id], a.id);
  await client.command({ type: "archive", operationId: crypto.randomUUID(), channelId: restoreCheck.id });
  const archived = (await client.summary(restoreCheck.id)).archived;
  await client.command({ type: "restore", operationId: crypto.randomUUID(), channelId: restoreCheck.id });
  const restored = !(await client.summary(restoreCheck.id)).archived;
  report.restore = { archived, restored };
  assert.ok(archived && restored);

  const first = await client.create("E2E first", [a.id, b.id], a.id);
  const second = await client.create("E2E second", [c.id, d.id], c.id);
  await client.send(first.id, LONG_PROMPT, a.id);
  await client.send(second.id, LONG_PROMPT, c.id);
  const [firstPage, secondPage] = await waitFor(
    page,
    "both channel tasks run",
    () => Promise.all([client.read(first.id), client.read(second.id)]),
    ([one, two]) => runningTask(one, a.id) !== undefined && runningTask(two, c.id) !== undefined,
  );
  const firstTask = runningTask(firstPage, a.id);
  const secondTask = runningTask(secondPage, c.id);
  assert.ok(firstTask && secondTask);
  report.parallel = {
    first: { owner: firstTask.ownerAgentId, state: firstTask.state },
    second: { owner: secondTask.ownerAgentId, state: secondTask.state },
  };

  const third = await client.create("E2E third", [a.id, d.id], a.id);
  await client.send(third.id, LONG_PROMPT, a.id);
  const [firstDuringThird, thirdPage] = await waitFor(
    page,
    "the same agent runs a task in a second channel",
    () => Promise.all([client.read(first.id), client.read(third.id)]),
    ([one, two]) => runningTask(two, a.id) !== undefined || runningTask(one, a.id) === undefined,
  );
  report.sameAgentInTwoChannels = {
    agentId: a.id,
    first: firstDuringThird.tasks.find((item) => item.id === firstTask.id)?.state ?? "missing",
    third: runningTask(thirdPage, a.id)?.state ?? "not running",
  };
  assert.ok(
    runningTask(firstDuringThird, a.id),
    "The first channel turn ended before the second channel started; use a longer prompt.",
  );
  assert.ok(runningTask(thirdPage, a.id), "The agent did not start its task in the second channel.");

  await client.sendToAgent(a.id, SHORT_PROMPT);
  const [ownChat, duringOwnChat] = await waitFor(
    page,
    "the agent's own chat starts during its channel turn",
    () => Promise.all([client.queue(a.id), client.read(first.id)]),
    ([snapshot]) => queueBusy(snapshot) || snapshot.deliveries.every((item) => item.status === "completed"),
  );
  report.ownChatBesideChannelTurn = {
    busy: queueBusy(ownChat),
    hold: ownChat.hold ?? null,
    channelTaskState: duringOwnChat.tasks.find((item) => item.id === firstTask.id)?.state ?? "missing",
  };
  assert.equal(ownChat.hold ?? null, null, "The agent's own chat names a hold during its channel turn.");
  assert.ok(
    runningTask(duringOwnChat, a.id),
    "The channel turn ended before the own chat started; use a longer prompt.",
  );

  const idle = agents.find((agent) => agent.id === b.id);
  assert.ok(idle);
  await client.sendToAgent(idle.id, SHORT_PROMPT);
  const other = await waitFor(
    page,
    "another agent's chat runs",
    () => Promise.all([client.queue(idle.id), client.read(first.id)]),
    ([snapshot]) => queueBusy(snapshot) || snapshot.deliveries.every((item) => item.status === "completed"),
  );
  report.otherAgentRan = { agentId: idle.id, busy: true };
  assert.equal(other[0].hold ?? null, null, "Another agent's chat names a hold.");
  assert.ok(runningTask(other[1], a.id), "The channel turn ended before the check; use a longer prompt.");

  const task: AgentTask = await page.evaluate(
    (input) => window.openbot.agent.startTask({ ...input, clientMessageId: crypto.randomUUID() }),
    { agentId: a.id, text: SHORT_PROMPT },
  );
  startedTasks.push({ agentId: a.id, taskId: task.id });
  const [tasks, channel] = await waitFor(
    page,
    "the agent's task starts during its channel turn",
    () => Promise.all([page.evaluate((id) => window.openbot.agent.listTasks(id), a.id), client.read(first.id)]),
    ([snapshot]) => snapshot.tasks.find((item) => item.id === task.id)?.state !== "queued",
  );
  const started = tasks.tasks.find((item) => item.id === task.id);
  const channelTask = channel.tasks.find((item) => item.id === firstTask.id);
  report.taskBesideChannelTurn = {
    state: started?.state ?? "missing",
    channelTaskState: channelTask?.state ?? "missing",
  };
  assert.equal(channelTask?.state, "running", "The channel turn ended before the task started; use a longer prompt.");

  report.passed = true;
} finally {
  await client.cleanup();
  for (const { agentId, taskId } of startedTasks) {
    await page.evaluate((input) => window.openbot.agent.stopTask(input), { agentId, taskId }).catch(() => undefined);
    await page.evaluate((input) => window.openbot.agent.closeTask(input), { agentId, taskId }).catch(() => undefined);
  }
  writeReport("channel-concurrency-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
