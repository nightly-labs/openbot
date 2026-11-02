// Checks a channel request that stops because the channel has no lead, in this worktree's running
// dev app with real provider turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-lead-required-e2e.ts --allow-mutations`. It needs two visible agents whose
// provider is signed in.
//
// It checks that a request in a channel of two members and no lead stops with the lead reason and
// no owner, that a save that sets a lead starts it again with no Continue, that the lead routes it,
// and that the member which does the work is told the lead's id. It makes its own channel and
// deletes it. Writes .openbot-build/channel-lead-required-e2e/report.json.
import assert from "node:assert/strict";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type { ChannelPage, ChannelTask } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const PROMPT =
  "Find the JSON object of your channel assignment. Copy the string value of its channel.leadAgentId field and reply with that string only. Do not use tools.";

interface Report {
  stopped?: { ownerAgentId: string | null; state: string; error: string | null };
  afterLead?: { ownerAgentId: string | null; state: string };
  reply?: string;
  leadAgentId?: string;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-lead-required-e2e");
const { page } = session;
const client = new ChannelClient(page);

const taskOf = (channel: ChannelPage, id: string): ChannelTask | undefined =>
  channel.tasks.find((task) => task.id === id);

try {
  const agents = (await client.agents()).filter((agent) => agentProviderDescriptor(agent.provider).concurrentTurns);
  assert.ok(agents.length >= 2, "This check needs two visible agents whose provider runs turns at the same time.");
  const [lead, other] = agents;
  assert.ok(lead && other);

  // 1. No lead and two members: routing has no model to ask, so the request stops with no owner.
  const channel = await client.create("E2E no lead", [lead.id, other.id], null);
  await client.send(channel.id, PROMPT, null);
  const stoppedPage = await waitFor(
    page,
    "the request stops for a missing lead",
    () => client.read(channel.id),
    (current) => current.tasks.at(-1)?.state === "paused",
  );
  const stopped = stoppedPage.tasks.at(-1);
  assert.ok(stopped);
  report.stopped = { ownerAgentId: stopped.ownerAgentId, state: stopped.state, error: stopped.error };
  assert.equal(stopped.ownerAgentId, null);
  assert.equal(stopped.error, sourceText("error.backend.channelLeadRequired"));

  // 2. The save that sets a lead starts the request again; the script never sends Continue.
  await client.command({
    type: "save",
    operationId: crypto.randomUUID(),
    channelId: channel.id,
    draft: {
      name: stoppedPage.channel.name,
      title: stoppedPage.channel.title,
      instructions: stoppedPage.channel.instructions,
      members: stoppedPage.channel.members,
      leadAgentId: lead.id,
    },
    update: true,
  });
  const routed = await waitFor(
    page,
    "the new lead routes the request",
    () => client.read(channel.id),
    (current) => taskOf(current, stopped.id)?.ownerAgentId != null,
  );
  const routedTask = taskOf(routed, stopped.id);
  assert.ok(routedTask);
  report.afterLead = { ownerAgentId: routedTask.ownerAgentId, state: routedTask.state };
  assert.notEqual(routedTask.state, "paused", "The request stayed stopped after the lead was set.");

  // 3. The owner reads the lead's id from its packet. Its answer is an assistant message; the lead's
  // routing receipt is a system row, so it cannot pass for the answer.
  const owner = routedTask.ownerAgentId;
  const answered = await waitFor(
    page,
    "the owner completes the request",
    () => client.read(channel.id),
    (current) => taskOf(current, stopped.id)?.state === "completed",
  );
  const reply = answered.messages
    .filter(
      (message) =>
        message.taskId === stopped.id &&
        message.author.id === owner &&
        message.message.author === "assistant" &&
        message.message.itemType !== "commentary",
    )
    .map((message) => message.message.text)
    .join("\n");
  report.reply = reply;
  report.leadAgentId = lead.id;
  assert.ok(reply.includes(lead.id), "The owner did not know the lead's id.");
  report.passed = true;
} finally {
  await client.cleanup();
  writeReport("channel-lead-required-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
