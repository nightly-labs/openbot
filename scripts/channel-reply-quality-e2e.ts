// Checks the reply quality of a channel request to several members, in this worktree's running dev
// app with real provider turns. Start the app with `bun run dev` (never `--shared`), then run
// `bun scripts/channel-reply-quality-e2e.ts --allow-mutations`. It needs two visible agents whose
// provider is signed in and runs turns at the same time, and one of them must run on Claude.
//
// It sends one request to both members and stops one of them at once, so that member writes no text.
// The other member answers, and then a typed "continue" to the stopped one resumes the same request.
// The follow-up becomes the request of that task, so this is the hard case. It checks that the
// stop left no empty reply row, and that the packet of the resumed member does not carry the reply
// of the member that answered first. OpenBot does not store the packet, so the script reads it from
// the Claude session transcript of the resumed member. It finds that session in the dev database, in
// read-only mode. It makes its own channel and deletes it. Writes
// .openbot-build/channel-reply-quality-e2e/report.json.

import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type { ChannelPage, ChannelTask } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";

const REQUEST =
  "In two or three sentences, give your own view: should a small team write its tests first? Do not use tools.";

interface Report {
  emptyRows?: number;
  firstReply?: { agentId: string; excerpt: string };
  resumedPacket?: { agentId: string; length: number; hasAssignment: boolean; hasSiblingReply: boolean };
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-reply-quality-e2e");
const { page, instance } = session;
const client = new ChannelClient(page);
const database = new Database(join(resolveDevelopmentAppDataRoot(), instance.profile, "openbot.db"), {
  readonly: true,
});

const taskOf = (channel: ChannelPage, id: string): ChannelTask | undefined =>
  channel.tasks.find((task) => task.id === id);
const replies = (channel: ChannelPage, taskId: string) =>
  channel.messages.filter(
    (message) =>
      message.taskId === taskId &&
      message.author.kind === "agent" &&
      message.message.author === "assistant" &&
      message.message.itemType !== "commentary",
  );

/** The packets the member's Claude session got in this channel, oldest first. */
function packets(channelId: string, agentId: string): string[] {
  const row = database
    .query<{ id: string }, [string, string]>(
      `select s.external_session_id as id
         from projection_provider_sessions s
         join projection_channel_contexts c on c.thread_id = s.thread_id
        where c.channel_id = ? and c.agent_id = ? and s.provider = 'claude'
        order by s.updated_at desc limit 1`,
    )
    .get(channelId, agentId);
  assert.ok(row, "The resumed member has no Claude session in this channel.");
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  const directory = readdirSync(root).find((name) => readdirSync(join(root, name)).includes(`${row.id}.jsonl`));
  assert.ok(directory, "The Claude transcript of the resumed member was not found.");
  return readFileSync(join(root, directory, `${row.id}.jsonl`), "utf8")
    .split("\n")
    .flatMap((line) => {
      if (!line.trim()) return [];
      const entry = JSON.parse(line);
      if (!isDynamicRecord(entry) || entry.type !== "user" || !isDynamicRecord(entry.message)) return [];
      const content = entry.message.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((part) => (isDynamicRecord(part) && typeof part.text === "string" ? part.text : ""))
                .join("\n")
            : "";
      return text.includes("Current assignment:") ? [text] : [];
    });
}

try {
  const agents = (await client.agents()).filter((agent) => agentProviderDescriptor(agent.provider).concurrentTurns);
  assert.ok(agents.length >= 2, "This check needs two visible agents whose provider runs turns at the same time.");
  const other = agents.find((agent) => agent.provider === "claude");
  const lead = agents.find((agent) => agent.id !== other?.id);
  assert.ok(lead && other, "This check needs a Claude agent and one more agent.");
  const channel = await client.create("E2E reply quality", [lead.id, other.id], lead.id);

  // 1. One request to both members. The second member stops before it writes.
  await client.send(channel.id, `@everyone ${REQUEST}`, null);
  const started = await waitFor(
    page,
    "both members get a task",
    () => client.read(channel.id),
    (current) => current.tasks.filter((task) => task.parentTaskId === null && task.ownerAgentId).length === 2,
  );
  const tasks = started.tasks.filter((task) => task.parentTaskId === null);
  const first = tasks.find((task) => task.ownerAgentId === lead.id);
  const second = tasks.find((task) => task.ownerAgentId === other.id);
  assert.ok(first && second);
  await client.taskCommand("stop", channel.id, second.id);

  // 2. The first member answers alone.
  const answered = await waitFor(
    page,
    "the first member answers and the second one is stopped",
    () => client.read(channel.id),
    (current) =>
      taskOf(current, first.id)?.state === "completed" &&
      taskOf(current, second.id)?.state === "paused" &&
      replies(current, first.id).some((message) => message.message.text.trim().length > 40),
  );
  const firstText = replies(answered, first.id)
    .map((message) => message.message.text.trim())
    .find((text) => text.length > 40);
  assert.ok(firstText);
  report.firstReply = { agentId: lead.id, excerpt: firstText.slice(0, 80) };

  // 3. A typed "continue" to the stopped member resumes the same request. Its packet has no reply of
  // the first member, which is older than the follow-up.
  await client.send(channel.id, "continue", other.id);
  const resumed = await waitFor(
    page,
    "the resumed member answers",
    () => client.read(channel.id),
    (current) =>
      taskOf(current, second.id)?.state === "completed" &&
      replies(current, second.id).some((message) => message.message.text.trim()),
  );
  const packet = packets(channel.id, other.id).at(-1) ?? "";
  report.resumedPacket = {
    agentId: other.id,
    length: packet.length,
    hasAssignment: packet.includes("Current assignment:"),
    hasSiblingReply: packet.includes(firstText.slice(0, 60)),
  };
  assert.ok(report.resumedPacket.hasAssignment, "The packet of the resumed member was not found.");
  assert.equal(report.resumedPacket.hasSiblingReply, false, "The resumed member got the reply of the other member.");

  // 4. No reply row of the channel is empty.
  report.emptyRows = resumed.messages.filter(
    (message) =>
      message.author.kind === "agent" &&
      message.message.author === "assistant" &&
      !message.message.text.trim() &&
      !message.message.attachments?.length &&
      !message.message.questionPrompt,
  ).length;
  assert.equal(report.emptyRows, 0, "The channel has an empty reply row.");
  report.passed = true;
} finally {
  database.close();
  await client.cleanup();
  writeReport("channel-reply-quality-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
