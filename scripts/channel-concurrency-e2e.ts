// Runs channel work end to end in this worktree's running dev app, with real provider turns. Start
// the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-concurrency-e2e.ts --allow-mutations`. It needs four visible agents whose
// provider is signed in and runs turns at the same time.
//
// It checks that the host advertises the channel capabilities, that a channel that was archived
// stays archived and that restore opens it, that two agents work in two channels at the same time,
// and that channel work holds only the agent that does it: the agent's own chat waits and names the
// channel, another agent's chat runs, and the agent's task runs beside its channel turn. It makes
// its own two channels and deletes them at the end.
// Writes .openbot-build/channel-concurrency-e2e/report.json.
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
  ownChatHold?: { status: string | null; hold: unknown };
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
  // 1. The host advertises channels again.
  report.capabilities = (await hostCapabilities(session.instance)).filter((capability) =>
    capability.startsWith("channel-"),
  );
  for (const capability of ["channel-chats-v1", "channel-delete-v1", "channel-attention-v1"])
    assert.ok(report.capabilities.includes(capability), `The host does not advertise ${capability}.`);

  // 2. Archived channels stay archived; restore opens one again.
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

  // 3. Two agents work in two channels at the same time.
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

  // 4. The agent's own chat waits for its channel work, and says which channel holds it.
  await client.sendToAgent(a.id, SHORT_PROMPT);
  const held = await waitFor(
    page,
    "the agent's own chat names the channel",
    () => client.queue(a.id),
    (snapshot) => snapshot.hold?.channelId === first.id,
  );
  report.ownChatHold = { status: held.deliveries.at(-1)?.status ?? null, hold: held.hold };
  assert.ok(!queueBusy(held), "The agent's own chat started while its channel turn ran.");

  // 5. Another agent's chat is not held by that channel work.
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

  // 6. The agent's task runs beside its channel turn.
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
